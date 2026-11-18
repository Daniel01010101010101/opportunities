"""Conectores de fuentes. Cada conector devuelve una lista de candidatos (enlaces a analizar)."""
from __future__ import annotations

import html
import logging
import os
import re
from dataclasses import dataclass, field
from urllib.parse import parse_qs, quote_plus, urlparse

from datetime import timedelta

import feedparser

from ..http import PoliteSession
from ..parse import parse_html
from ..util import clean_space, iso, now

log = logging.getLogger("radar.sources")


@dataclass
class Candidate:
    url: str
    title: str = ""
    snippet: str = ""
    published: str | None = None
    image: str = ""
    source_id: str = ""
    source_name: str = ""
    source_type: str = ""
    trust: str = "news"  # official | news | search
    organizer: str = ""
    hints: dict = field(default_factory=dict)


class SourceError(Exception):
    pass


class SourceSkipped(Exception):
    """La fuente no aplica en esta ejecución (por ejemplo, falta una clave opcional)."""


def _strip_html(text: str) -> str:
    return clean_space(html.unescape(re.sub(r"<[^>]+>", " ", text or "")))


def _entry_date(entry) -> str | None:
    for key in ("published_parsed", "updated_parsed"):
        st = entry.get(key)
        if st:
            from datetime import datetime, timezone

            return iso(datetime(*st[:6], tzinfo=timezone.utc))
    return None


def bing_news(src: dict, http: PoliteSession) -> list[Candidate]:
    url = f"https://www.bing.com/news/search?q={quote_plus(src['query'])}&format=rss&mkt=es-CO"
    res = http.get(url)  # /news/search está permitido en el robots.txt de Bing
    if not res.ok:
        raise SourceError(res.error or f"HTTP {res.status}")
    feed = feedparser.parse(res.content)
    out = []
    for e in feed.entries[: src.get("max_items", 12)]:
        link = e.get("link", "")
        q = parse_qs(urlparse(link).query)
        real = q.get("url", [link])[0]
        image = ""
        for k, v in e.items():
            if k.lower().endswith("image") and isinstance(v, str) and v.startswith("http"):
                image = v.replace("&pid=News", "&pid=News&w=640")
        out.append(Candidate(url=real, title=_strip_html(e.get("title", "")), snippet=_strip_html(e.get("summary", "")),
                             published=_entry_date(e), image=image))
    return out


def gdelt(src: dict, http: PoliteSession) -> list[Candidate]:
    url = ("https://api.gdeltproject.org/api/v2/doc/doc?query=" + quote_plus(src["query"]) +
           f"&mode=artlist&format=json&maxrecords={src.get('max_items', 15)}&sort=datedesc&timespan=14d")
    res = http.get(url, check_robots=False, retries=1)
    if res.status == 429:
        raise SourceError("GDELT limitó la consulta (429); se reintentará en la próxima ejecución")
    if not res.ok:
        raise SourceError(res.error or f"HTTP {res.status}")
    try:
        import json

        data = json.loads(res.text or "{}")
    except ValueError as exc:
        raise SourceError(f"respuesta no válida de GDELT: {res.text[:120]!r}") from exc
    if "articles" not in data and data:
        raise SourceError(f"GDELT respondió sin artículos: {str(data)[:120]}")
    out = []
    for a in data.get("articles", []) or []:
        seen = a.get("seendate", "")
        pub = None
        if len(seen) >= 15:
            pub = f"{seen[0:4]}-{seen[4:6]}-{seen[6:8]}T{seen[9:11]}:{seen[11:13]}:{seen[13:15]}+00:00"
        out.append(Candidate(url=a.get("url", ""), title=clean_space(a.get("title", "")), published=pub,
                             image=a.get("socialimage", "")))
    return out


def rss(src: dict, http: PoliteSession) -> list[Candidate]:
    res = http.get(src["url"], conditional=True)
    if res.not_modified:
        return []
    if not res.ok:
        raise SourceError(res.error or f"HTTP {res.status}")
    feed = feedparser.parse(res.content)
    if feed.bozo and not feed.entries:
        raise SourceError("feed RSS ilegible")
    out = []
    for e in feed.entries[: src.get("max_items", 20)]:
        summary = e.get("summary", "") or ""
        img = ""
        m = re.search(r"<img[^>]+src=[\"']([^\"']+)", summary)
        if m:
            img = m.group(1)
        out.append(Candidate(url=e.get("link", ""), title=_strip_html(e.get("title", "")),
                             snippet=_strip_html(summary)[:600], published=_entry_date(e), image=img))
    return out


GENERIC_PAGE = re.compile(
    r"(login|iniciar-sesion|ingresa\b|transparencia|afiliaci|donde-estamos|encuentranos|contacto|contactanos|pqrs|nosotros|quienes-somos|"
    r"trabaja-con-nosotros|politica|privacidad|cookies|mapa-del-sitio|consultar-inscripciones|verifica si|portalpersonas|tienda-en-linea|"
    r"/empresas/?$|^empresas$|preguntas-frecuentes|ayuda|soporte|blog/?$|noticias/?$|sala-de-prensa/?$|terminos-condiciones/sitio-web|"
    r"condiciones-de-uso|tratamiento-de-datos|habeas|/#|\bmenu\b)",
    re.I,
)


def page_links(src: dict, http: PoliteSession) -> list[Candidate]:
    res = http.get(src["url"])
    if not res.ok:
        raise SourceError(res.error or f"HTTP {res.status}")
    doc = parse_html(res.text, res.final_url)
    include = re.compile(src.get("include", "."), re.I)
    exclude = re.compile(src["exclude"], re.I) if src.get("exclude") else None
    seen = set()
    out = []
    # parse_html ya filtró nav/footer; para listados usamos también todos los <a> del documento completo
    from bs4 import BeautifulSoup
    from urllib.parse import urljoin

    soup = BeautifulSoup(res.text, "lxml")
    anchors = [(urljoin(res.final_url, a["href"].strip()), clean_space(a.get_text(" "))) for a in soup.find_all("a", href=True)]
    anchors += [(link.url, link.text) for link in doc.links]
    base_host = urlparse(res.final_url).hostname or ""
    for href, text in anchors:
        if not href.startswith("http") or href in seen:
            continue
        if href.rstrip("/") == res.final_url.rstrip("/"):
            continue
        pu = urlparse(href)
        path = (pu.path or "/") + ("?" + pu.query if pu.query else "")
        # el patrón "include" se aplica a la ruta (no al dominio) para no capturar todo el sitio
        if not include.search(path):
            continue
        if GENERIC_PAGE.search(path) or GENERIC_PAGE.search(text or "") or re.match(r"^/en(/|$)", pu.path or ""):
            continue
        if exclude and (exclude.search(path) or exclude.search(text or "")):
            continue
        host = urlparse(href).hostname or ""
        if src.get("same_site", True) and base_host and not (host == base_host or host.endswith(base_host.split(".", 1)[-1])) \
                and not href.lower().endswith(".pdf"):
            continue
        seen.add(href)
        title = text[:200]
        for pattern, fixed in (src.get("titles") or {}).items():
            if re.search(pattern, path):
                title = fixed
        out.append(Candidate(url=href, title=title))
        if len(out) >= src.get("max_items", 12):
            break
    return out


def google_cse(src: dict, http: PoliteSession) -> list[Candidate]:
    key, cx = os.environ.get("GOOGLE_CSE_KEY"), os.environ.get("GOOGLE_CSE_CX")
    if not key or not cx:
        raise SourceSkipped("requiere los secretos GOOGLE_CSE_KEY y GOOGLE_CSE_CX")
    url = (f"https://www.googleapis.com/customsearch/v1?key={key}&cx={cx}&q={quote_plus(src['query'])}"
           "&gl=co&lr=lang_es&num=10&dateRestrict=m1")
    res = http.get(url, check_robots=False, retries=1)
    if not res.ok:
        raise SourceError(f"Google CSE: HTTP {res.status}")
    import json

    data = json.loads(res.text or "{}")
    out = []
    for it in data.get("items", []) or []:
        img = ""
        pm = it.get("pagemap", {})
        if pm.get("cse_image"):
            img = pm["cse_image"][0].get("src", "")
        out.append(Candidate(url=it.get("link", ""), title=it.get("title", ""), snippet=it.get("snippet", ""), image=img))
    return out


def brave(src: dict, http: PoliteSession) -> list[Candidate]:
    key = os.environ.get("BRAVE_API_KEY")
    if not key:
        raise SourceSkipped("requiere el secreto BRAVE_API_KEY")
    import json

    import requests

    try:
        resp = requests.get("https://api.search.brave.com/res/v1/web/search",
                            params={"q": src["query"], "country": "CO", "search_lang": "es", "count": 15, "freshness": "pm"},
                            headers={"X-Subscription-Token": key, "Accept": "application/json"}, timeout=20)
    except requests.RequestException as exc:
        raise SourceError(f"Brave: {exc}") from exc
    http.count += 1
    if resp.status_code != 200:
        raise SourceError(f"Brave: HTTP {resp.status_code}")
    data = json.loads(resp.text or "{}")
    return [Candidate(url=r.get("url", ""), title=_strip_html(r.get("title", "")), snippet=_strip_html(r.get("description", "")))
            for r in (data.get("web", {}) or {}).get("results", [])]


def _title_filter(src: dict, c: Candidate, max_age_days: int = 90) -> bool:
    """Para feeds generales: deja pasar solo títulos que parecen convocatorias/concursos/beneficios abiertos."""
    from ..extract import WINNERS_TITLE, is_open_call_title, relevance
    from ..util import parse_iso

    pub = parse_iso(c.published) if c.published else None
    if pub and now() - pub > timedelta(days=max_age_days):
        return False
    if WINNERS_TITLE.search(c.title or ""):
        return False
    mode = src.get("filter", "concursos")
    rel, _ = relevance(c.title, c.snippet, require_title_signal=True)
    if mode == "concursos":
        return is_open_call_title(c.title) and rel >= 0.2
    return rel >= 0.25


def news_feed(src: dict, http: PoliteSession) -> list[Candidate]:
    """Feed RSS general de un medio (últimas ~100 notas). Solo pasan títulos de convocatorias abiertas."""
    res = http.get(src["url"], conditional=True)
    if res.not_modified:
        return []
    if not res.ok:
        raise SourceError(res.error or f"HTTP {res.status}")
    feed = feedparser.parse(res.content)
    if not feed.entries:
        raise SourceError("feed sin entradas o ilegible")
    out = []
    for e in feed.entries[: src.get("scan_items", 150)]:
        summary = e.get("summary", "") or ""
        img = ""
        for m in (e.get("media_content") or []) + (e.get("media_thumbnail") or []):
            if isinstance(m, dict) and m.get("url"):
                img = m["url"]
                break
        c = Candidate(url=e.get("link", ""), title=_strip_html(e.get("title", "")), snippet=_strip_html(summary)[:600],
                      published=_entry_date(e), image=img)
        if _title_filter(src, c, src.get("max_age_days", 60)):
            out.append(c)
    return out[: src.get("max_items", 15)]


def wp_search(src: dict, http: PoliteSession) -> list[Candidate]:
    """Búsqueda dentro de un medio con WordPress (API REST o feed de búsqueda) o Blogger."""
    import json
    from datetime import datetime, timezone

    site = src["site"].rstrip("/")
    api = src.get("api", "rest")
    after = (datetime.now(timezone.utc) - timedelta(days=src.get("max_age_days", 75))).strftime("%Y-%m-%dT%H:%M:%S")
    out: list[Candidate] = []
    seen: set[str] = set()
    errors = []
    for q in src.get("queries") or ["concurso", "sorteo", "participa gana"]:
        if api == "blogger":
            url = f"https://{site}/feeds/posts/default?q={quote_plus(q)}&alt=rss&max-results=25"
        elif api == "feed":
            url = f"https://{site}/?s={quote_plus(q)}&feed=rss2"
        else:
            url = (f"https://{site}/wp-json/wp/v2/posts?search={quote_plus(q)}&per_page=20&orderby=date&order=desc"
                   f"&after={after}&_fields=link,title,date,excerpt")
        res = http.get(url, retries=1)
        if res.from_robots_block:
            raise SourceSkipped(f"robots.txt de {site} no permite esta búsqueda")
        if not res.ok:
            errors.append(res.error or f"HTTP {res.status}")
            continue
        items = []
        if api == "rest":
            try:
                for p in json.loads(res.text or "[]"):
                    items.append(Candidate(url=p.get("link", ""), title=_strip_html((p.get("title") or {}).get("rendered", "")),
                                           snippet=_strip_html((p.get("excerpt") or {}).get("rendered", ""))[:600],
                                           published=(p.get("date") or "")[:19] + "-05:00" if p.get("date") else None))
            except (ValueError, AttributeError):
                errors.append("respuesta no válida de la API de WordPress")
                continue
        else:
            for e in feedparser.parse(res.content).entries:
                items.append(Candidate(url=e.get("link", ""), title=_strip_html(e.get("title", "")),
                                       snippet=_strip_html(e.get("summary", ""))[:600], published=_entry_date(e)))
        for c in items:
            if c.url and c.url not in seen and _title_filter(src, c, src.get("max_age_days", 75)):
                seen.add(c.url)
                out.append(c)
    if errors and not out and len(errors) == len(src.get("queries") or [1, 2, 3]):
        raise SourceError("; ".join(errors[:2]))
    return out[: src.get("max_items", 12)]


CONNECTORS = {
    "news_feed": news_feed,
    "wp_search": wp_search,
    "bing_news": bing_news,
    "gdelt": gdelt,
    "rss": rss,
    "page_links": page_links,
    "google_cse": google_cse,
    "brave": brave,
}


def fetch_source(src: dict, http: PoliteSession) -> list[Candidate]:
    fn = CONNECTORS.get(src["type"])
    if fn is None:
        raise SourceSkipped(f"tipo de fuente desconocido: {src['type']}")
    cands = fn(src, http)
    trust = src.get("trust") or ("search" if src["type"] in ("google_cse", "brave") else
                                 "news" if src["type"] in ("bing_news", "gdelt", "news_feed", "wp_search") else "official")
    for c in cands:
        c.source_id = src["id"]
        c.source_name = src.get("name", src["id"])
        c.source_type = src["type"]
        c.trust = trust
        c.organizer = src.get("organizer", "")
        c.hints = dict(src.get("hints") or {})
    return [c for c in cands if c.url.startswith("http")]


__all__ = ["Candidate", "SourceError", "SourceSkipped", "fetch_source", "now"]
