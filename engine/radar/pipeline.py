"""Orquestación del flujo completo de una ejecución del radar:

disparador -> fuentes -> candidatos -> extracción -> análisis -> verificación de enlaces -> deduplicación ->
actualización de existentes -> vencimientos -> prioridades -> guardado de JSON -> (GitHub Pages publica)."""
from __future__ import annotations

import logging
import os
import re
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import timedelta
from urllib.parse import urlparse

from . import __version__
from .classify import Registry, Taxonomy, cost_type
from .config import SCHEDULE_CRON_UTC, Settings, load_yaml
from .dedupe import DedupIndex
from .extract import WINNERS_TITLE, extract, foreign_reason, is_open_call_title, mechanics, relevance
from .http import BudgetExceeded, PoliteSession
from .llm import Enricher
from .notify import send as send_alerts
from .parse import Document, parse_any
from .score import score
from .sources import Candidate, SourceError, SourceSkipped, fetch_source
from .store import Store
from .util import (canonical_url, clean_space, domain_of, iso, next_scheduled_run, norm, now, parse_any_date, parse_day, parse_iso,
                   sha1, today, truncate)
from .verify import risk_assessment, verification_status

log = logging.getLogger("radar")

TERMS_LINK = re.compile(r"(t[eé]rminos\s*(y|&)\s*condiciones|reglamento|bases (del|de la|legales)|condiciones de (la|el) (promoci[oó]n|actividad|concurso|sorteo|campa[nñ]a)|t\s?&\s?c|tyc|terminos)", re.I)
GENERIC_TERMS = re.compile(r"(uso del (sitio|portal)|sitio web|portal|privacidad|datos personales|cookies|habeas|condiciones de uso|tratamiento de datos|pol[ií]tica)", re.I)
PARTICIPATE_LINK = re.compile(r"(participa|inscr[ií]bete|inscripci[oó]n|reg[ií]strate|registro|post[uú]late|postulaci[oó]n|aplica aqu[ií]|solicita|formulario|quiero participar|ingresa aqu[ií]|redime|reclama|descarga la app)", re.I)
OFFICIAL_HINT = re.compile(r"(t[eé]rminos|condiciones|reglamento|participa|inscr|post[uú]l|formulario|p[aá]gina oficial|sitio oficial|aqu[ií]|link|enlace|m[aá]s informaci[oó]n|consulta)", re.I)
SKIP_LINK_HOSTS = ("google.com", "goo.gl", "apple.com", "play.google.com", "apps.apple.com", "bing.com", "microsoft.com",
                   "doubleclick.net", "addtoany.com", "whatsapp.com", "wa.me", "t.me", "linkedin.com", "pinterest.com",
                   "news.google.com", "flipboard.com", "feedburner.com", "gravatar.com", "wordpress.org", "archive.org")
HEADLINE_BRAND = re.compile(r"^([A-ZÁÉÍÓÚÑ0-9][\w&'.\-]+(?: [A-ZÁÉÍÓÚÑ0-9][\w&'.\-]+){0,2}(?: y [A-ZÁÉÍÓÚÑ][\w&'.\-]+)?) "
                            r"(lanza|lanzan|abre|abren|habilita|habilitan|sortea|sortear[aá]n?|regala|regalar[aá]n?|premia|premiar[aá]n?|invita|presenta|anuncia|activa|activan)\b")
SELF_HOSTED = re.compile(r"(te invita(mos)? a participar|participa en nuestro|nuestro (concurso|sorteo|reto)|queremos (que|encontrar|premiar)|"
                         r"nuestros (lectores|seguidores|oyentes|suscriptores)|nuestra comunidad de (lectores|seguidores|oyentes))", re.I)
TITLE_PREFIX = re.compile(r"^\s*(t[eé]rminos\s*(y|&)\s*condiciones|reglamento|bases)\s*(de\s+la\s+|del\s+|para\s+la\s+|de\s+|para\s+)?(actividad|promoci[oó]n|campa[nñ]a|concurso|sorteo|din[aá]mica)?\s*[:\-–]?\s*", re.I)
SECTION_LABEL = {"concursos": "Concurso", "bonos": "Beneficio", "ofertas": "Oferta", "estado": "Programa público"}


# ====================================================================== generadores de consultas
def expand_generators(generators: list[dict]) -> list[dict]:
    """Convierte plantillas de consultas en fuentes concretas.

    Ejemplo: {id: marcas, type: bing_news, template: "{term} sorteo {year}", terms: [Kia, Yamaha]}
    -> fuentes gen-marcas-kia, gen-marcas-yamaha. {year} se reemplaza por el año actual (hora de Bogotá)."""
    year = str(now().year)
    out = []
    seen: set[str] = set()
    for g in generators or []:
        for term in dict.fromkeys(g.get("terms") or [""]):
            q = g["template"].replace("{term}", str(term)).replace("{year}", year).strip()
            slug = re.sub(r"[^a-z0-9]+", "-", norm(str(term) or q)).strip("-")[:40]
            src = {k: v for k, v in g.items() if k not in ("template", "terms", "id", "name")}
            if f"gen-{g['id']}-{slug}" in seen:
                continue
            seen.add(f"gen-{g['id']}-{slug}")
            src.update({"id": f"gen-{g['id']}-{slug}", "query": q,
                        "name": (g.get("name") or g["id"]).replace("{term}", str(term)), "origin_generator": g["id"]})
            out.append(src)
    return out


# ====================================================================== utilidades de construcción
GENERIC_TITLES = {"promociones", "promocion", "beneficios", "ofertas", "inicio", "home", "terminos y condiciones", "convocatorias",
                  "en", "es", "ver mas", "conoce mas", "aqui", "más información", "mas informacion", "ver más"}


def title_from_slug(url: str) -> str:
    slug = [p for p in urlparse(url).path.split("/") if p]
    if not slug:
        return ""
    words = re.sub(r"\.(pdf|html?|aspx)$", "", slug[-1], flags=re.I)
    words = re.sub(r"[_-]+", " ", words)
    words = re.sub(r"\b[0-9a-f]{8,}\b", "", words).strip()
    return words[:1].upper() + words[1:] if words else ""


def clean_title(title: str, site_name: str = "", url: str = "") -> str:
    t = clean_space(title)
    t = re.sub(r"^[a-zA-Z]\s+(?=[A-ZÁÉÍÓÚÑ])", "", t)  # letras de iconos: "e Empresarial ..."
    t = re.sub(r"^(promociones|promoci[oó]n|beneficios|ofertas|convocatorias)\s*[-|:–]\s*", "", t, flags=re.I)
    t = re.sub(r"\s*[|·–—-]\s*[^|·–—-]{2,40}$", "", t) if len(t) > 40 else t
    if site_name:
        t = re.sub(rf"\s*[|·–—-]\s*{re.escape(site_name)}\s*$", "", t, flags=re.I)
    t2 = TITLE_PREFIX.sub("", t).strip(" \"'“”«»")
    if len(t2) >= 8:
        t = t2
    if t.isupper() and len(t) > 12:
        t = t.capitalize()
    if (norm(t) in GENERIC_TITLES or len(t) < 6) and url:
        t = title_from_slug(url) or t
    return truncate(t, 140)


def pick_terms_link(doc: Document, official_hosts: set[str] | None = None) -> str | None:
    best = None
    for link in doc.links:
        if not TERMS_LINK.search(link.text) and not re.search(r"(termino|condicion|reglamento|tyc)", link.url, re.I):
            continue
        if GENERIC_TERMS.search(link.text):
            continue
        host = domain_of(link.url)
        if official_hosts and not any(host == h or host.endswith("." + h) for h in official_hosts) and not link.url.lower().endswith(".pdf"):
            continue
        if best is None or link.url.lower().endswith(".pdf"):
            best = link.url
    return best


def pick_participate_link(doc: Document, page_host: str) -> str | None:
    for link in doc.links:
        if PARTICIPATE_LINK.search(link.text) and not GENERIC_TERMS.search(link.text):
            host = domain_of(link.url)
            if host == page_host or host.endswith("." + page_host.split(".", 1)[-1]) or host in ("forms.gle", "docs.google.com"):
                return link.url
    return None


def find_official_link(doc: Document, article_url: str, registry: Registry, mentioned) -> str | None:
    article_host = domain_of(article_url)
    scored: list[tuple[int, str]] = []
    mentioned_domains = {d for o in mentioned for d in o.domains}
    for link in doc.links:
        url = link.url
        host = domain_of(url)
        if not host or host == article_host or host.endswith("." + article_host):
            continue
        if any(host == s or host.endswith("." + s) for s in SKIP_LINK_HOSTS):
            continue
        if registry.is_news(url):
            continue
        if host in ("facebook.com", "instagram.com", "tiktok.com", "x.com", "twitter.com", "youtube.com"):
            continue
        s = 0
        if any(host == d or host.endswith("." + d) for d in mentioned_domains):
            s += 5
        if registry.by_domain(url):
            s += 2
        if registry.is_gov(url) or registry.is_edu(url):
            s += 3
        if OFFICIAL_HINT.search(link.text or ""):
            s += 2
        if TERMS_LINK.search(link.text or "") or re.search(r"(termino|condicion|reglamento)", url, re.I):
            s += 2
        if urlparse(url).path in ("", "/") and not PARTICIPATE_LINK.search(link.text or ""):
            continue
        if s >= 4:
            scored.append((s, url))
    scored.sort(key=lambda x: -x[0])
    return scored[0][1] if scored else None


def compute_status(ex, dates: dict, withdrawn: bool) -> str:
    end, start = parse_day(dates.get("end")), parse_day(dates.get("start"))
    if withdrawn:
        return "retirada"
    if (end and end < today()) or ex.closed_signal:
        return "vencida"
    if start and start > today():
        return "proxima"
    if ex.program_status_hint == "proxima" and not end:
        return "proxima"
    if not end and ex.program_status_hint == "permanente":
        return "permanente"
    if end and end >= today():
        return "activa"
    if ex.program_status_hint == "abierta":
        return "activa"
    return "sin_confirmar"


# ====================================================================== motor
class Radar:
    def __init__(self, settings: Settings):
        self.s = settings
        self.started = now()
        self.t0 = time.monotonic()
        self.store = Store(settings)
        self.registry = Registry(settings.config_dir)
        self.taxonomy = Taxonomy(settings.config_dir)
        cfg = load_yaml(settings.config_dir / "sources.yml") or {}
        self.defaults = cfg.get("defaults", {})
        self.limits = cfg.get("limits", {})
        raw = list(cfg.get("sources", [])) + expand_generators(cfg.get("generators", []))
        self.sources = [{**self.defaults, **s} for s in raw]
        self.http = PoliteSession(cache=self.store.http_cache, max_fetches=settings.max_fetches,
                                  deadline=time.monotonic() + settings.max_runtime_s)
        self.enricher = Enricher(self.store.llm_cache)
        self.errors: list[str] = []
        self.source_results: list[dict] = []
        self.discarded = 0
        self.discard_reasons: dict[str, int] = {}
        self.new_ids: set[str] = set()
        self.updated_ids: set[str] = set()

    # ------------------------------------------------------------------ selección de fuentes
    def due_sources(self) -> list[dict]:
        s = self.s
        q = norm(s.query)
        if q:
            # Investigación bajo demanda: búsqueda ad-hoc en noticias (+ buscadores con API si hay claves)
            ad_hoc = [{"id": f"q-{sha1(q)[:8]}", "type": "bing_news", "name": f"Búsqueda manual: {s.query}",
                       "query": f"{s.query} Colombia", "max_items": 15, "hints": {}},
                      {"id": f"q-{sha1(q)[:8]}-cse", "type": "google_cse", "name": f"Google CSE: {s.query}",
                       "query": f"{s.query} Colombia", "hints": {}},
                      {"id": f"q-{sha1(q)[:8]}-brave", "type": "brave", "name": f"Brave: {s.query}",
                       "query": f"{s.query} Colombia", "hints": {}}]
            niche = [{"id": f"q-{sha1(q)[:8]}-wp-{src['site']}", "type": "wp_search", "name": f"{src.get('name', src['site'])}: {s.query}",
                      "site": src["site"], "api": src.get("api", "rest"), "queries": [s.query], "filter": "oportunidades",
                      "max_age_days": 120, "hints": {}} for src in self.sources if src["type"] == "wp_search"]
            related = [src for src in self.sources if any(w in norm(src.get("query", "") + " " + src.get("name", ""))
                                                          for w in q.split() if len(w) > 3)]
            return ad_hoc + niche[:12] + related[:8]
        if s.category and s.category not in ("todas", "all"):
            cat = s.category
            return [src for src in self.sources if (src.get("hints") or {}).get("section") == cat
                    or (src.get("hints") or {}).get("category") == cat or cat in src["id"]
                    or (cat == "concursos" and src["type"] in ("news_feed", "wp_search"))]
        due = []
        for src in self.sources:
            st = self.store.sources_state.get(src["id"], {})
            last = parse_iso(st.get("last_run_at"))
            every = float(src.get("every_hours", 6))
            failed = st.get("consecutive_failures", 0) > 0 and st.get("last_status") == "error"
            if s.full or last is None or failed or now() - last >= timedelta(hours=every) - timedelta(minutes=20):
                due.append((last.timestamp() if last else 0.0, src))
        # Tope por tipo de fuente y ejecución: primero las que llevan más tiempo sin consultarse
        due.sort(key=lambda x: x[0])
        per_type: dict[str, int] = {}
        out = []
        for _, src in due:
            cap = int(self.limits.get(src["type"], 10_000))
            if per_type.get(src["type"], 0) >= cap:
                continue
            per_type[src["type"]] = per_type.get(src["type"], 0) + 1
            out.append(src)
        return out

    # ------------------------------------------------------------------ fase 1: fuentes
    def collect(self, sources: list[dict]) -> list[Candidate]:
        cands: list[Candidate] = []

        def work(src):
            t = time.monotonic()
            try:
                items = fetch_source(src, self.http)
                return src, items, "ok", "", int((time.monotonic() - t) * 1000)
            except SourceSkipped as exc:
                return src, [], "omitida", str(exc), 0
            except BudgetExceeded as exc:
                return src, [], "pendiente", str(exc), 0
            except SourceError as exc:
                return src, [], "error", str(exc), int((time.monotonic() - t) * 1000)
            except Exception as exc:  # noqa: BLE001 - una fuente nunca detiene el proceso
                return src, [], "error", f"{type(exc).__name__}: {str(exc)[:160]}", int((time.monotonic() - t) * 1000)

        # Más hilos en esta fase: muchas fuentes comparten dominio (bing.com) y esperan su turno de cortesía,
        # así que hilos extra permiten avanzar con los demás dominios mientras tanto.
        with ThreadPoolExecutor(max_workers=max(self.s.workers, 14)) as pool:
            futures = [pool.submit(work, src) for src in sources]
            for fut in as_completed(futures):
                src, items, status, error, ms = fut.result()
                self.source_results.append({"id": src["id"], "status": status, "error": error, "items": len(items), "ms": ms})
                if status == "error":
                    self.errors.append(f"Fuente {src.get('name', src['id'])}: {error}")
                cands.extend(items)
        return cands

    # ------------------------------------------------------------------ fase 2: filtrado
    def prefilter(self, cands: list[Candidate], index: DedupIndex) -> list[Candidate]:
        seen: set[str] = set()
        out = []
        for c in cands:
            cu = canonical_url(c.url)
            if not cu or cu in seen:
                continue
            seen.add(cu)
            existing = index.known_url(c.url)
            if existing is not None:
                existing["last_seen"] = iso(now())
                self._add_source(existing, c)
                continue
            if self.store.is_rejected(cu):
                continue
            if c.trust != "official":
                if WINNERS_TITLE.search(c.title or ""):
                    self._discard(cu, "nota sobre ganadores o resultados, no es una convocatoria abierta")
                    continue
                open_call = is_open_call_title(c.title)
                if (c.hints or {}).get("section") == "concursos" and not open_call and c.source_type in ("bing_news", "gdelt"):
                    self._discard(cu, "búsqueda de concursos: el título no anuncia una convocatoria abierta")
                    continue
                pub = parse_iso(c.published)
                window = 90 if open_call else 30
                if pub and now() - pub > timedelta(days=window):
                    self._discard(cu, f"noticia antigua (más de {window} días)")
                    continue
                rel, _ = relevance(c.title, c.snippet)
                if rel < 0.2:
                    self._discard(cu, "título sin señales de oportunidad o con señales negativas")
                    continue
            out.append(c)
        # oficiales primero, luego noticias más recientes
        out.sort(key=lambda c: (c.trust != "official", -(parse_iso(c.published) or self.started).timestamp()))
        return out[: self.s.max_candidates]

    def _discard(self, url: str, reason: str) -> None:
        self.discarded += 1
        self.discard_reasons[reason] = self.discard_reasons.get(reason, 0) + 1
        self.store.reject(url, reason)

    @staticmethod
    def _add_source(op: dict, c: Candidate) -> None:
        srcs = op.setdefault("sources", [])
        cu = canonical_url(c.url)
        if not any(canonical_url(s.get("url", "")) == cu for s in srcs):
            srcs.append({"url": c.url, "name": c.source_name, "type": c.trust, "seen_at": iso(now())})
            del srcs[:-8]

    # ------------------------------------------------------------------ fase 3: análisis de un candidato
    def analyze(self, c: Candidate) -> tuple[dict | None, str]:
        res = self.http.get(c.url)
        if res.from_robots_block:
            return None, "bloqueado por robots.txt / fuente no permitida"
        if not res.ok:
            return None, f"enlace no disponible ({res.error or res.status})"
        doc = parse_any(res)
        page_url = res.final_url
        on_official_site = bool(self.registry.by_domain(page_url)) or self.registry.is_gov(page_url) or self.registry.is_edu(page_url)
        is_news = self.registry.is_news(page_url) or (c.trust == "news" and not on_official_site)
        # Los medios de comunicación no son organizadores de las promociones que reseñan
        mentioned = [o for o in (self.registry.mentioned(f"{c.title} {doc.title}") or self.registry.mentioned(doc.text[:600]))
                     if o.type != "medio"]

        organizer = None
        if c.organizer:
            organizer = self.registry.by_name(c.organizer)
        organizer = organizer or (None if is_news else self.registry.by_domain(page_url))
        official_doc: Document | None = None
        official_url = None
        if is_news or (c.trust == "search" and not on_official_site):
            official_url = find_official_link(doc, page_url, self.registry, mentioned)
            if official_url and self.http.budget_left() > 15:
                ores = self.http.get(official_url)
                if ores.ok:
                    official_doc = parse_any(ores)
                    official_url = ores.final_url
                    organizer = organizer or self.registry.by_domain(official_url)
                    host = domain_of(official_url)
                    d = self.store.discovered.setdefault(host, {"first_seen": iso(now()), "count": 0})
                    d.update({"last_seen": iso(now()), "sample_url": official_url, "from": c.source_id})
                    d["count"] = d.get("count", 0) + 1
                    if organizer:
                        d["organizer"] = organizer.name
        gov_page = self.registry.is_gov(official_url or page_url)
        if organizer is None and mentioned and not gov_page:
            organizer = mentioned[0]

        main = official_doc or doc
        text = (official_doc.text + "\n\n" if official_doc else "") + doc.text
        if c.source_type == "page_links":
            anchor = clean_space(c.title)
            title_src = doc.title if doc.title and len(doc.title) >= 12 and len(anchor) < 15 else (anchor or doc.title)
        else:
            title_src = c.title or doc.title
        rel, rel_reasons = relevance(title_src, text, require_title_signal=c.source_type in ("rss", "bing_news", "gdelt"))
        if c.source_type == "page_links":
            # listados oficiales curados: basta con señales mínimas
            rel = max(rel, 0.35 if rel > 0 else 0.15)
        if rel < 0.3:
            return None, "no describe una oportunidad aprovechable" + (f" ({rel_reasons[0]})" if rel_reasons else "")
        if c.trust != "official" and not self.registry.is_gov(official_url or page_url):
            why = foreign_reason(official_url or page_url, title_src, text)
            if why:
                return None, f"no aplica en Colombia ({why})"

        ex = extract(text, step_items=main.step_items or doc.step_items, requirement_items=main.requirement_items or doc.requirement_items,
                     document_items=main.document_items or doc.document_items)

        # ---------- IA opcional (solo extrae lo que está en el texto)
        ai = self.enricher.enrich(url=official_url or page_url, title=title_src, text=text)
        if ai is not None and not ai.get("is_opportunity", True):
            return None, "la IA determinó que no es una oportunidad: " + truncate(ai.get("reason", ""), 80)

        is_gov = self.registry.is_gov(official_url or page_url) or (organizer is not None and organizer.type == "gobierno")
        section, category, tags = self.taxonomy.classify(
            title=title_src, text=text, organizer=organizer, url=page_url, hints=c.hints,
            requires_purchase=ex.requires_purchase, discount_pct=ex.discount_pct, is_gov=is_gov)

        official_hosts = set(organizer.domains) if organizer else {domain_of(official_url or page_url)}
        if not is_news:
            official_hosts.add(domain_of(page_url))
        terms_url = None
        if (official_url or not is_news) and re.search(r"(termino|condicion|reglamento|legal)", (official_url or page_url), re.I):
            terms_url = official_url or page_url
        terms_url = terms_url or pick_terms_link(main, official_hosts) or (pick_terms_link(doc, official_hosts) if official_doc else None)
        if (official_url or page_url).lower().split("?")[0].endswith(".pdf") and not is_news:
            terms_url = terms_url or (official_url or page_url)
        participate = pick_participate_link(main, domain_of(official_url or page_url)) or official_url or (None if is_news else page_url)

        official_domain = bool(participate and self.registry.is_official_for(participate, organizer)) or \
            (not is_news and c.trust == "official") or (organizer is not None and self.registry.is_official_for(page_url, organizer))

        dates = dict(ex.dates)
        if ai:
            for k_ai, k in (("start_date", "start"), ("end_date", "end"), ("draw_date", "draw")):
                if ai.get(k_ai) and parse_day(ai[k_ai]):
                    dates[k] = ai[k_ai][:10]
        published = doc.published or c.published
        pub_dt = parse_any_date(published)
        if pub_dt:
            published = iso(pub_dt)
        stale_days = 45 if is_open_call_title(title_src) else 21
        if is_news and not dates.get("end") and pub_dt and now() - pub_dt > timedelta(days=stale_days):
            return None, f"noticia sin fecha de cierre y con más de {stale_days} días"

        withdrawn = bool(ex.withdrawn_signal)
        status = compute_status(ex, dates, withdrawn)
        if status == "vencida":
            return None, "ya está vencida"

        if organizer:
            organizer_name = organizer.name
        elif gov_page:
            organizer_name = (official_doc.site_name if official_doc else doc.site_name) or domain_of(official_url or page_url)
        elif not is_news:
            organizer_name = doc.site_name or domain_of(page_url)
        else:
            organizer_name = "Organizador no identificado"
        if organizer_name == "Organizador no identificado":
            hm = HEADLINE_BRAND.match(clean_space(title_src))
            if hm:
                organizer_name = hm.group(1)
        if ai and ai.get("organizer") and not organizer:
            organizer_name = ai["organizer"]

        # ---------- costo (con ajustes de la IA si existe)
        if ai:
            if ai.get("requires_purchase") is not None:
                ex.requires_purchase = ai["requires_purchase"]
                ex.purchase_evidence = ex.purchase_evidence or ai.get("purchase_condition_es") or "según el texto de la fuente"
            if ai.get("requires_deposit_or_payment"):
                ex.requires_deposit = True
            for k in ("requires_registration", "requires_social", "requires_activity"):
                if ai.get(k) is not None:
                    setattr(ex, k, bool(ai[k]))
        # El medio organiza el concurso (lo anuncia en primera persona y publica los pasos): su página es la oficial
        self_hosted = section == "concursos" and not official_doc and bool(ex.steps) and bool(SELF_HOSTED.search(text[:8000]))
        ctype, certainty, cost_notes = cost_type(ex, section, is_official_text=(official_domain and not is_news) or bool(official_doc) or self_hosted)
        ct_info = self.taxonomy.cost_types.get(ctype, {})
        if self_hosted:
            site = doc.site_name or domain_of(page_url)
            organizer_name = f"{site} · con {organizer.name}" if organizer and organizer.name.lower() not in site.lower() else site

        official_title = ""
        if official_doc and len(official_doc.title) > 12:
            from .util import jaccard, tokens

            if not is_news or jaccard(tokens(official_doc.title), tokens(title_src)) >= 0.15:
                official_title = official_doc.title
        title = clean_title((ai or {}).get("title_es") or official_title or title_src, doc.site_name, official_url or page_url)
        summary = (ai or {}).get("summary_es") or truncate(main.description or c.snippet or doc.description or text[:300], 280)
        prize_desc = (ai or {}).get("prize_es") or None
        value_cop = (ai or {}).get("value_cop") or ex.money.get("value_cop")
        value_text = ex.money.get("value_text") if ex.money.get("value_cop") == value_cop else (f"${value_cop:,.0f}".replace(",", ".") if value_cop else None)

        steps = ((ai or {}).get("steps_es") or ex.steps)[:10]
        steps_source = None
        if steps:
            steps_source = "ia_desde_texto_oficial" if ai and ai.get("steps_es") else ("pagina_oficial" if (official_doc or not is_news) else "fuente_secundaria")
        requirements = ((ai or {}).get("requirements_es") or ex.requirements)[:8]
        documents = ((ai or {}).get("documents_es") or ex.documents)[:8]
        coverage = (ai or {}).get("coverage") if ai and ai.get("coverage") not in (None, "desconocida") else ex.coverage
        if coverage == "desconocida" and is_gov:
            host = domain_of(official_url or page_url)
            coverage = "bogota" if any(x in host for x in ("bogota", "idartes", "idrd", "sdis", "scrd")) else \
                "regional" if any(x in host for x in ("cundinamarca", "antioquia", "valle")) else "nacional"
        if coverage == "desconocida" and organizer and organizer.type in ("combustible", "banco", "billetera", "comercio", "telecom") and c.trust == "official":
            coverage = "desconocida"

        risk = risk_assessment(self.registry, text=text[:12000], urls=[u for u in (participate, terms_url, official_url, page_url) if u],
                               organizer=organizer, mentioned=mentioned, source_is_news=is_news and not official_doc)
        if ai and ai.get("asks_sensitive_financial_data"):
            risk["sensitive_data_warning"] = True
            if not any(f["code"] == "datos_financieros" for f in risk["flags"]):
                risk["flags"].append({"code": "datos_financieros", "label": "Solicita datos financieros sensibles.", "level": "alto"})
                risk["level"] = "alto"

        program_status = None
        if section == "estado":
            program_status = {"activa": "abierta", "proxima": "proxima", "permanente": "permanente", "vencida": "cerrada",
                              "retirada": "cerrada"}.get(status, "sin_confirmar")

        link_ok = True if (official_doc is not None or not is_news) else None
        vstatus, vreasons = verification_status(
            end_date=dates.get("end"), withdrawn=withdrawn, closed=bool(ex.closed_signal), link_ok=link_ok,
            official_domain=official_domain, terms_found=bool(terms_url), section=section,
            organizer_known=organizer is not None, has_dates=bool(dates.get("end") or dates.get("start")),
            risk_level=risk["level"], source_official=(c.trust == "official"), program_status=status)

        offer = None
        if section == "ofertas" or ex.discount_pct:
            pct = ex.discount_pct
            if ex.price_before and ex.price_now:
                pct = round(100 * (ex.price_before - ex.price_now) / ex.price_before)
            offer = {"discount_pct": pct, "original_price": ex.price_before, "promo_price": ex.price_now,
                     "code": ex.promo_code, "pct_verified": bool(ex.price_before and ex.price_now)}

        lang = (doc.lang or "es")[:2]
        stamp = iso(now())
        op = {
            "id": "op_" + sha1(canonical_url(official_url or page_url))[:12],
            "title": title,
            "summary": summary,
            "section": section,
            "category": category,
            "tags": tags,
            "mechanics": mechanics(f"{title_src}\n{text}") if section in ("concursos", "bonos") else [],
            "kind": SECTION_LABEL.get(section, "Oportunidad"),
            "organizer": {"name": organizer_name, "type": organizer.type if organizer else ("gobierno" if is_gov else "desconocido"),
                          "domain": domain_of(official_url or page_url) if not is_news else (organizer.domains[0] if organizer else None),
                          "known": organizer is not None},
            "prize": {"description": prize_desc, "value_cop": value_cop, "value_text": value_text,
                      "value_source": ("pagina_oficial" if (official_doc or not is_news) else "noticia") if value_cop else None,
                      "winners": (ai or {}).get("winners") or ex.winners, "odds_text": (ai or {}).get("odds_es") or ex.odds_text},
            "cost": {"type": ctype, "label": ct_info.get("label", ctype), "free": bool(ct_info.get("free")), "certainty": certainty,
                     "requires_purchase": ex.requires_purchase, "requires_registration": ex.requires_registration,
                     "requires_social": ex.requires_social, "requires_activity": ex.requires_activity,
                     "requires_subscription": ex.requires_subscription, "requires_deposit": ex.requires_deposit,
                     "purchase_threshold_text": ex.money.get("purchase_threshold_text"), "notes": cost_notes},
            "eligibility": {"who": (ai or {}).get("who_can_participate_es"), "min_age": (ai or {}).get("min_age") or ex.min_age,
                            "age_text": ex.age_text, "coverage": coverage or "desconocida",
                            "cities": (ai or {}).get("cities") or ex.cities},
            "requirements": requirements,
            "documents": documents,
            "steps": steps,
            "steps_source": steps_source,
            "dates": {"published": published, "start": dates.get("start"), "end": dates.get("end"), "draw": dates.get("draw")},
            "status": status,
            "gov": {"program_status": program_status, "entity": organizer_name} if section == "estado" else None,
            "offer": offer,
            "verification": {"status": vstatus, "reasons": vreasons, "checked_at": stamp, "link_ok": link_ok,
                             "official_domain": official_domain, "terms_found": bool(terms_url), "link_failures": 0},
            "risk": risk,
            "urls": {"source": page_url, "participate": participate, "terms": terms_url, "official": official_url,
                     "image": (official_doc.image if official_doc and official_doc.image else None) or doc.image or c.image or None},
            "sources": [{"url": c.url, "name": c.source_name, "type": c.trust, "seen_at": stamp}],
            "language": lang,
            "translated": bool(ai and lang != "es"),
            "extraction": {"method": "ia+heuristica" if ai else "heuristica", "relevance": round(rel, 2),
                           "model": self.enricher.model if ai else None},
            "discovered_at": stamp,
            "updated_at": stamp,
            "last_verified": stamp,
            "last_seen": stamp,
            "history": [],
        }
        op["priority"] = score(op)
        return op, ""

    # ------------------------------------------------------------------ fase 4: integración
    def merge(self, op: dict, index: DedupIndex) -> str:
        existing = index.find(op)
        if existing is None:
            index.add(op)
            self.new_ids.add(op["id"])
            return "nueva"
        before = {k: (dict(v) if isinstance(v, dict) else v) for k, v in existing.items()}
        # combinar: conservar ID y fecha de descubrimiento; preferir datos oficiales y más completos
        for s in op.get("sources", []):
            if not any(canonical_url(x.get("url", "")) == canonical_url(s["url"]) for x in existing.get("sources", [])):
                existing.setdefault("sources", []).append(s)
        prefer_new = op["verification"]["official_domain"] or not existing["verification"].get("official_domain")
        if prefer_new:
            for key in ("title", "summary", "section", "category", "tags", "mechanics", "kind", "organizer", "cost", "eligibility",
                        "gov", "offer", "risk", "language", "translated", "extraction"):
                if op.get(key):
                    existing[key] = op[key]
            for key in ("requirements", "documents", "steps"):
                if len(op.get(key) or []) >= len(existing.get(key) or []):
                    existing[key] = op[key]
            if op.get("steps"):
                existing["steps_source"] = op.get("steps_source")
            for k, v in (op.get("urls") or {}).items():
                if v:
                    existing.setdefault("urls", {})[k] = v
            for k, v in (op.get("dates") or {}).items():
                if v:
                    existing.setdefault("dates", {})[k] = v
            for k, v in (op.get("prize") or {}).items():
                if v:
                    existing.setdefault("prize", {})[k] = v
            existing["status"] = op["status"]
            existing["verification"] = op["verification"]
        existing["last_seen"] = op["last_seen"]
        existing["last_verified"] = op["last_verified"]
        existing["priority"] = score(existing)
        if self.store.record_changes(before, existing):
            existing["updated_at"] = iso(now())
            self.updated_ids.add(existing["id"])
            return "actualizada"
        return "sin_cambios"

    # ------------------------------------------------------------------ fase 5: mantenimiento de existentes
    def revalidate(self) -> int:
        """Aplica las reglas vigentes a lo ya guardado: si una nota de prensa ya no pasa los filtros
        (ganadores/premiaciones, o «concurso» sin convocatoria abierta), sale de la base."""
        keep, removed = [], 0
        for it in self.store.items:
            title = it.get("title", "")
            news_only = not (it.get("verification") or {}).get("official_domain") and \
                all(src.get("type") != "official" for src in it.get("sources") or [])
            bad = news_only and (WINNERS_TITLE.search(title) or (it.get("section") == "concursos" and not is_open_call_title(title)
                                                                 and not it.get("steps")))
            if bad:
                removed += 1
                for src in it.get("sources") or []:
                    self.store.reject(canonical_url(src.get("url", "")), "depurada al aplicar los filtros vigentes")
            else:
                keep.append(it)
        self.store.items = keep
        return removed

    def maintain(self) -> dict:
        stats = {"reverified": 0, "expired": 0, "withdrawn": 0}
        stale = sorted(
            [it for it in self.store.items if it.get("status") not in ("vencida", "retirada")],
            key=lambda it: it.get("last_verified") or "",
        )
        limit = self.s.reverify_per_run if not self.s.offline else 0
        for it in stale[:limit]:
            last = parse_iso(it.get("last_verified"))
            if last and now() - last < timedelta(hours=20):
                continue
            url = (it.get("urls") or {}).get("participate") or (it.get("urls") or {}).get("official") or (it.get("urls") or {}).get("source")
            if not url or self.http.budget_left() < 5 or self.http.time_left() < 60:
                break
            try:
                res = self.http.get(url, retries=1)
            except BudgetExceeded:
                break
            before = {k: (dict(v) if isinstance(v, dict) else v) for k, v in it.items()}
            ver = it.setdefault("verification", {})
            ver["checked_at"] = iso(now())
            it["last_verified"] = iso(now())
            stats["reverified"] += 1
            if res.from_robots_block:
                continue
            if res.ok:
                ver["link_ok"] = True
                ver["link_failures"] = 0
                if ver.get("official_domain"):
                    doc = parse_any(res)
                    ex = extract(doc.text)
                    if ex.withdrawn_signal:
                        it["status"] = "retirada"
                        stats["withdrawn"] += 1
                    elif ex.closed_signal:
                        it["status"] = "vencida"
                    new_end = ex.dates.get("end")
                    if new_end and new_end != (it.get("dates") or {}).get("end") and parse_day(new_end) and parse_day(new_end) >= today():
                        it.setdefault("dates", {})["end"] = new_end
            else:
                ver["link_ok"] = False
                ver["link_failures"] = ver.get("link_failures", 0) + 1
                if res.status in (404, 410) and ver["link_failures"] >= 2 and ver.get("official_domain"):
                    it["status"] = "retirada"
                    stats["withdrawn"] += 1
            self.store.record_changes(before, it)
        # vencimientos y recálculo diario de estado y prioridad
        for it in self.store.items:
            before_status = it.get("status")
            end = parse_day((it.get("dates") or {}).get("end"))
            start = parse_day((it.get("dates") or {}).get("start"))
            if it.get("status") not in ("retirada",) and end and end < today():
                it["status"] = "vencida"
            elif it.get("status") == "proxima" and start and start <= today():
                it["status"] = "activa"
            v = it.setdefault("verification", {})
            if it["status"] in ("vencida", "retirada"):
                v["status"] = it["status"]
                if it.get("gov"):
                    it["gov"]["program_status"] = "cerrada"
            if before_status != it["status"]:
                if it["status"] == "vencida":
                    stats["expired"] += 1
                self.store.record_changes({**it, "status": before_status}, it)
            it["priority"] = score(it)
        return stats

    # ------------------------------------------------------------------ ejecución completa
    def run(self) -> dict:
        index = DedupIndex(self.store.items)
        sources = [] if self.s.offline else self.due_sources()
        log.info("Fuentes a consultar: %d", len(sources))
        cands = self.collect(sources) if sources else []
        log.info("Candidatos obtenidos: %d", len(cands))
        cands = self.prefilter(cands, index)
        log.info("Candidatos a analizar: %d", len(cands))

        outcomes = {"nueva": 0, "actualizada": 0, "sin_cambios": 0}
        per_source_new: dict[str, int] = {}
        if cands:
            with ThreadPoolExecutor(max_workers=self.s.workers) as pool:
                futures = {pool.submit(self._safe_analyze, c): c for c in cands}
                for fut in as_completed(futures):
                    c = futures[fut]
                    op, reason = fut.result()
                    if op is None:
                        if reason and not reason.startswith("presupuesto") and not reason.startswith("tiempo"):
                            self._discard(canonical_url(c.url), reason)
                        continue
                    res = self.merge(op, index)
                    outcomes[res] += 1
                    if res == "nueva":
                        per_source_new[c.source_id] = per_source_new.get(c.source_id, 0) + 1
        self.store.items = index.items
        purged = self.revalidate()
        maint = self.maintain()
        maint["purged"] = purged
        archived = self.store.archive_old()
        alerts = {"sent": 0}
        try:
            alerts = send_alerts(self.s, self.store.items, self.new_ids, self.store.notified)
        except Exception as exc:  # noqa: BLE001
            self.errors.append(f"Alertas: {exc}")
        return self.finish(sources, outcomes, maint, archived, alerts, per_source_new)

    def _safe_analyze(self, c: Candidate):
        try:
            return self.analyze(c)
        except BudgetExceeded as exc:
            return None, str(exc)
        except Exception as exc:  # noqa: BLE001 - un candidato defectuoso nunca detiene el proceso
            log.exception("Error analizando %s", c.url)
            self.errors.append(f"Análisis de {domain_of(c.url)}: {type(exc).__name__}: {str(exc)[:120]}")
            return None, ""

    # ------------------------------------------------------------------ cierre: historial y estado
    def finish(self, sources, outcomes, maint, archived, alerts, per_source_new) -> dict:
        finished = now()
        duration = round(time.monotonic() - self.t0, 1)
        ok_sources = [r for r in self.source_results if r["status"] == "ok"]
        failed = [r for r in self.source_results if r["status"] == "error"]
        if not sources and not self.s.offline:
            final = "sin_fuentes_pendientes"
        elif failed and not ok_sources:
            final = "error"
        elif failed:
            final = "parcial"
        elif outcomes["nueva"] == 0 and outcomes["actualizada"] == 0:
            final = "sin_novedades"
        else:
            final = "ok"
        run = {
            "id": self.started.strftime("%Y%m%d-%H%M%S"),
            "started_at": iso(self.started),
            "finished_at": iso(finished),
            "duration_s": duration,
            "trigger": self.s.trigger,
            "category": self.s.category or None,
            "query": self.s.query or None,
            "status": final,
            "sources_checked": len(self.source_results),
            "sources_ok": len(ok_sources),
            "sources_failed": [{"id": r["id"], "error": r["error"]} for r in failed],
            "sources_skipped": [{"id": r["id"], "reason": r["error"]} for r in self.source_results if r["status"] in ("omitida", "pendiente")],
            "new": outcomes["nueva"],
            "updated": outcomes["actualizada"] + maint["withdrawn"],
            "unchanged": outcomes["sin_cambios"],
            "discarded": self.discarded,
            "discard_reasons": dict(sorted(self.discard_reasons.items(), key=lambda kv: -kv[1])[:8]),
            "expired": maint["expired"],
            "reverified": maint["reverified"],
            "archived": archived,
            "purged": maint.get("purged", 0),
            "http_requests": self.http.count,
            "robots_blocked": self.http.robots_blocked,
            "errors": self.errors[:30],
            "llm": self.enricher.summary(),
            "alerts": alerts,
            "git_sha": self.s.git_sha or None,
            "run_url": self.s.run_url or None,
        }
        self.store.runs.append(run)

        # ---- salud de fuentes
        by_id = {r["id"]: r for r in self.source_results}
        sources_out = []
        configured = list(self.sources)
        if self.s.query:
            configured += [s for s in sources if s["id"].startswith("q-")]
        for src in configured:
            st = dict(self.store.sources_state.get(src["id"], {}))
            r = by_id.get(src["id"])
            if r and r["status"] in ("ok", "error"):
                st["last_run_at"] = iso(finished)
                st["last_status"] = r["status"]
                st["last_error"] = r["error"] or None
                st["last_items"] = r["items"]
                st["last_ms"] = r["ms"]
                if r["status"] == "ok":
                    st["last_ok_at"] = iso(finished)
                    st["consecutive_failures"] = 0
                    st["total_items"] = st.get("total_items", 0) + r["items"]
                else:
                    st["consecutive_failures"] = st.get("consecutive_failures", 0) + 1
                st["new_last_run"] = per_source_new.get(src["id"], 0)
                st["total_new"] = st.get("total_new", 0) + per_source_new.get(src["id"], 0)
            elif r and r["status"] == "omitida":
                st["last_status"] = "omitida"
                st["last_error"] = r["error"]
            st.update({"id": src["id"], "name": src.get("name", src["id"]), "type": src["type"],
                       "url": src.get("url") or None, "query": src.get("query") or None,
                       "trust": src.get("trust") or ("official" if src["type"] in ("rss", "page_links") else "news"),
                       "every_hours": src.get("every_hours"), "organizer": src.get("organizer") or None,
                       "hints": src.get("hints") or {}, "origin": "manual" if src["id"].startswith("q-") else "configurada"})
            sources_out.append(st)
        for host, d in sorted(self.store.discovered.items(), key=lambda kv: -kv[1].get("count", 0))[:60]:
            sources_out.append({"id": f"disc-{host}", "name": d.get("organizer") or host, "type": "descubierta", "url": d.get("sample_url"),
                                "trust": "official" if (self.registry.by_domain(host) or host.endswith(".gov.co")) else "desconocida",
                                "origin": "descubierta", "first_seen": d.get("first_seen"), "last_run_at": d.get("last_seen"),
                                "last_status": "ok", "total_items": d.get("count", 0)})

        # ---- estado global
        items = self.store.items
        active = [i for i in items if i.get("status") not in ("vencida", "retirada")]
        last_success = iso(finished) if final in ("ok", "sin_novedades", "parcial", "sin_fuentes_pendientes") else self._last_success()
        last_new = max((i.get("discovered_at") or "" for i in items), default=None)
        counts = {
            "total": len(items),
            "active": len(active),
            "new_24h": sum(1 for i in active if (parse_iso(i.get("discovered_at")) or self.started) > finished - timedelta(hours=24)),
            "verified": sum(1 for i in active if i.get("verification", {}).get("status") == "verificada"),
            "pending": sum(1 for i in active if i.get("verification", {}).get("status") == "pendiente"),
            "unverifiable": sum(1 for i in active if i.get("verification", {}).get("status") == "no_verificable"),
            "expired": sum(1 for i in items if i.get("status") == "vencida"),
            "withdrawn": sum(1 for i in items if i.get("status") == "retirada"),
            "archived": len(self.store.archive),
            "by_section": {s: sum(1 for i in active if i.get("section") == s) for s in self.taxonomy.section_ids},
            "by_priority": {lvl: sum(1 for i in active if (i.get("priority") or {}).get("level") == lvl) for lvl in ("alta", "media", "baja")},
            "free": sum(1 for i in active if (i.get("cost") or {}).get("free")),
            "expiring_7d": sum(1 for i in active if parse_day((i.get("dates") or {}).get("end"))
                               and 0 <= (parse_day(i["dates"]["end"]) - today()).days <= 7),
        }
        status = {
            "engine_version": __version__,
            "generated_at": iso(finished),
            "timezone": "America/Bogota",
            "schedule": {"cron_utc": SCHEDULE_CRON_UTC, "description": "Cada 2 horas, minuto 17 (horas impares en Bogotá)",
                         "next_run_at": iso(next_scheduled_run(finished))},
            "last_run": {k: run[k] for k in ("id", "started_at", "finished_at", "duration_s", "status", "trigger", "new",
                                             "updated", "discarded", "sources_checked", "sources_ok", "run_url")},
            "last_success_at": last_success,
            "last_new_opportunity_at": last_new,
            "sources": {"configured": len(self.sources), "checked_last_run": len(self.source_results), "ok_last_run": len(ok_sources),
                        "failed_last_run": len(failed), "discovered": len(self.store.discovered),
                        "with_errors": sum(1 for s in sources_out if s.get("last_status") == "error")},
            "counts": counts,
            "llm": self.enricher.summary(),
            "alerts_configured": {"telegram": bool(os.environ.get("TELEGRAM_BOT_TOKEN")),
                                  "email": bool(os.environ.get("SMTP_HOST"))},
            "message": {
                "ok": f"Búsqueda completada: {outcomes['nueva']} nuevas y {outcomes['actualizada']} actualizadas.",
                "sin_novedades": "La búsqueda terminó sin novedades: no se encontraron oportunidades nuevas en esta ejecución.",
                "parcial": f"Búsqueda completada con {len(failed)} fuente(s) con error; el resto se procesó normalmente.",
                "error": "Ninguna fuente respondió en esta ejecución. Se reintentará en la próxima ejecución programada.",
                "sin_fuentes_pendientes": "No había fuentes pendientes según la rotación; se ejecutó solo el mantenimiento.",
            }[final],
        }
        if not self.s.dry_run:
            self.store.save(status, sources_out)
        return run

    def _last_success(self) -> str | None:
        for r in reversed(self.store.runs):
            if r.get("status") in ("ok", "sin_novedades", "parcial", "sin_fuentes_pendientes"):
                return r.get("finished_at")
        return None
