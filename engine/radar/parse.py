"""Conversión de HTML / PDF a un documento estructurado (título, texto, enlaces, listas, metadatos)."""
from __future__ import annotations

import io
import json
import logging
import re
from dataclasses import dataclass, field
from urllib.parse import urljoin

from bs4 import BeautifulSoup

from .util import clean_space, norm

log = logging.getLogger("radar.parse")

STEP_HEADINGS = re.compile(
    r"(c[oó]mo (participar|participo|inscribirte|inscribirse|postularte|postularse|reclamar|redimir|acceder|funciona|obtener|aplicar|solicitar)"
    r"|mec[aá]nica|pasos|para participar|proceso de (inscripci[oó]n|postulaci[oó]n|selecci[oó]n)|ruta de (inscripci[oó]n|acceso)"
    r"|paso a paso|participa as[ií]|instrucciones|c[oó]mo hacerlo|redime|c[oó]mo ganar)",
    re.I,
)
REQ_HEADINGS = re.compile(r"(requisitos|qui[eé]n(es)? (puede|pueden) (participar|postularse|acceder)|condiciones de participaci[oó]n|dirigido a|perfil|poblaci[oó]n objetivo)", re.I)
DOC_HEADINGS = re.compile(r"(documentos|documentaci[oó]n|soportes|anexos)", re.I)


@dataclass
class Link:
    url: str
    text: str


@dataclass
class Document:
    url: str
    title: str = ""
    description: str = ""
    image: str = ""
    published: str = ""
    lang: str = ""
    site_name: str = ""
    text: str = ""
    links: list[Link] = field(default_factory=list)
    step_items: list[str] = field(default_factory=list)
    requirement_items: list[str] = field(default_factory=list)
    document_items: list[str] = field(default_factory=list)
    is_pdf: bool = False
    jsonld: list[dict] = field(default_factory=list)


def _meta(soup: BeautifulSoup, *names: str) -> str:
    for name in names:
        tag = soup.find("meta", attrs={"property": name}) or soup.find("meta", attrs={"name": name})
        if tag and tag.get("content"):
            return clean_space(tag["content"])
    return ""


def _list_after(el, limit: int = 12) -> list[str]:
    """Busca la primera lista (ol/ul) o párrafos numerados que siguen a un encabezado."""
    items: list[str] = []
    sib = el
    for _ in range(8):
        sib = sib.find_next_sibling() if sib is not None else None
        if sib is None:
            break
        if sib.name in ("h1", "h2", "h3", "h4") and items:
            break
        lists = [sib] if sib.name in ("ol", "ul") else sib.find_all(["ol", "ul"], limit=1)
        if lists:
            for li in lists[0].find_all("li", recursive=False)[:limit] or lists[0].find_all("li")[:limit]:
                t = clean_space(li.get_text(" "))
                if 6 <= len(t) <= 400:
                    items.append(t)
            if items:
                break
        t = clean_space(sib.get_text(" "))
        if re.match(r"^(paso\s*\d+|\d+[.)-])\s+", t, re.I) and len(t) < 400:
            items.append(t)
        elif items:
            break
    return items[:limit]


def _section_items(soup: BeautifulSoup, pattern: re.Pattern) -> list[str]:
    for el in soup.find_all(["h1", "h2", "h3", "h4", "h5", "strong", "b", "p", "summary", "button"]):
        txt = clean_space(el.get_text(" "))
        if 3 <= len(txt) <= 90 and pattern.search(txt):
            anchor = el
            # si el texto está dentro de un <p> o <strong>, la lista suele seguir al bloque contenedor
            if el.name in ("strong", "b") and el.parent is not None and el.parent.name in ("p", "div", "span"):
                anchor = el.parent
            items = _list_after(anchor)
            if items:
                return items
    return []


def parse_html(html: str, url: str) -> Document:
    soup = BeautifulSoup(html, "lxml")
    doc = Document(url=url)
    doc.lang = (soup.html.get("lang", "") if soup.html else "")[:5].lower()
    doc.title = _meta(soup, "og:title", "twitter:title") or (
        clean_space(soup.h1.get_text(" ")) if soup.h1 else ""
    ) or (clean_space(soup.title.get_text(" ")) if soup.title else "")
    doc.description = _meta(soup, "og:description", "description", "twitter:description")
    img = _meta(soup, "og:image", "og:image:url", "twitter:image", "twitter:image:src")
    doc.image = urljoin(url, img) if img else ""
    doc.site_name = _meta(soup, "og:site_name", "application-name")
    doc.published = _meta(soup, "article:published_time", "og:updated_time", "date", "pubdate", "dc.date")

    for script in soup.find_all("script", attrs={"type": "application/ld+json"}):
        try:
            data = json.loads(script.string or "")
        except (json.JSONDecodeError, TypeError):
            continue
        items = data if isinstance(data, list) else data.get("@graph", [data]) if isinstance(data, dict) else []
        for item in items:
            if isinstance(item, dict):
                doc.jsonld.append(item)
                if not doc.published and item.get("datePublished"):
                    doc.published = str(item["datePublished"])
                if not doc.image and isinstance(item.get("image"), (str, dict)):
                    im = item["image"]
                    doc.image = im if isinstance(im, str) else im.get("url", "")

    if not doc.published:
        t = soup.find("time", attrs={"datetime": True})
        if t:
            doc.published = t["datetime"]

    doc.step_items = _section_items(soup, STEP_HEADINGS)
    doc.requirement_items = _section_items(soup, REQ_HEADINGS)
    doc.document_items = _section_items(soup, DOC_HEADINGS)

    for bad in soup(["script", "style", "noscript", "svg", "iframe", "form", "template"]):
        bad.decompose()
    for bad in soup.find_all(["nav", "footer", "header", "aside"]):
        bad.decompose()
    for bad in soup.find_all(attrs={"class": re.compile(r"(cookie|newsletter|related|recomendad|comments|share|social|menu|breadcrumb|banner-publicidad|ads?\b)", re.I)}):
        try:
            bad.decompose()
        except Exception:  # noqa: BLE001
            pass

    main = soup.find("article") or soup.find("main") or soup.find(attrs={"role": "main"}) or soup.body or soup
    for a in main.find_all("a", href=True):
        href = a["href"].strip()
        if href.startswith(("javascript:", "mailto:", "tel:", "#")):
            continue
        doc.links.append(Link(urljoin(url, href), clean_space(a.get_text(" "))[:160]))
    # Enlaces de términos suelen estar fuera del <article> (pie de página de la campaña)
    if not any("termin" in norm(link.text) or "condicion" in norm(link.text) for link in doc.links):
        for a in soup.find_all("a", href=True):
            txt = clean_space(a.get_text(" "))
            if re.search(r"t[eé]rminos|condiciones|reglamento|bases", txt, re.I):
                doc.links.append(Link(urljoin(url, a["href"].strip()), txt[:160]))

    text = main.get_text("\n")
    lines = [clean_space(x) for x in text.splitlines()]
    doc.text = "\n".join(x for x in lines if x)[:30000]
    if not doc.description:
        for p in main.find_all("p"):
            t = clean_space(p.get_text(" "))
            if len(t) > 80:
                doc.description = t[:400]
                break
    return doc


def parse_pdf(content: bytes, url: str) -> Document:
    doc = Document(url=url, is_pdf=True)
    try:
        from pypdf import PdfReader

        reader = PdfReader(io.BytesIO(content))
        parts = []
        for page in reader.pages[:12]:
            try:
                parts.append(page.extract_text() or "")
            except Exception:  # noqa: BLE001
                continue
        text = "\n".join(parts)
    except Exception as exc:  # noqa: BLE001
        log.info("PDF ilegible %s: %s", url, exc)
        return doc
    lines = [clean_space(x) for x in text.splitlines()]
    doc.text = "\n".join(x for x in lines if x)[:30000]
    first = next((x for x in lines if len(x) > 12), "")
    doc.title = first[:160]
    # pasos numerados en PDFs de términos y condiciones
    m = STEP_HEADINGS.search(doc.text)
    if m:
        tail = doc.text[m.end(): m.end() + 3000]
        steps = re.findall(r"(?:^|\n)\s*(?:paso\s*\d+|\d{1,2}[.)])\s*[:.-]?\s*([^\n]{8,300})", tail, re.I)
        doc.step_items = [clean_space(s) for s in steps[:10]]
    return doc


def parse_any(result) -> Document:
    if result.is_pdf:
        return parse_pdf(result.content, result.final_url)
    return parse_html(result.text, result.final_url)
