"""Identificación del organizador y clasificación en sección / categoría / tipo de costo."""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path

from .config import load_json, load_yaml
from .util import domain_of, norm, registrable_domain


@dataclass
class Organizer:
    name: str
    type: str
    domains: list[str]
    aliases: list[str] = field(default_factory=list)


class Registry:
    def __init__(self, config_dir: Path):
        raw = load_yaml(config_dir / "organizers.yml") or {}
        self.organizers = [Organizer(o["name"], o.get("type", "marca"), [d.lower() for d in o.get("domains", [])],
                                     [a.lower() for a in o.get("aliases", [])]) for o in raw.get("organizers", [])]
        self.news_domains = {d.lower() for d in raw.get("news_domains", [])}
        self.suspicious_hosts = {d.lower() for d in raw.get("suspicious_hosts", [])}
        self.shorteners = {d.lower() for d in raw.get("shorteners", [])}
        self.suspicious_tlds = {t.lower() for t in raw.get("suspicious_tlds", [])}
        self._alias_patterns = []
        for o in self.organizers:
            for alias in [o.name.lower(), *o.aliases]:
                a = norm(alias)
                if len(a) < 3 and a not in ("d1",):
                    continue
                self._alias_patterns.append((re.compile(rf"(?<![a-z0-9]){re.escape(a)}(?![a-z0-9])"), o))
        # alias largos primero para preferir "banco de bogota" sobre "bogota"
        self._alias_patterns.sort(key=lambda x: -len(x[0].pattern))

    def by_domain(self, url_or_host: str) -> Organizer | None:
        host = domain_of(url_or_host) if "/" in url_or_host else url_or_host.lower()
        for o in self.organizers:
            for d in o.domains:
                if host == d or host.endswith("." + d):
                    return o
        return None

    def by_name(self, name: str) -> Organizer | None:
        n = norm(name)
        for o in self.organizers:
            if norm(o.name) == n or n in [norm(a) for a in o.aliases]:
                return o
        return None

    def mentioned(self, text: str, limit: int = 3) -> list[Organizer]:
        t = norm(text)
        found: list[Organizer] = []
        for pat, o in self._alias_patterns:
            if o not in found and pat.search(t):
                found.append(o)
                if len(found) >= limit:
                    break
        return found

    def is_news(self, url: str) -> bool:
        host = domain_of(url)
        return any(host == d or host.endswith("." + d) for d in self.news_domains)

    @staticmethod
    def is_gov(url: str) -> bool:
        host = domain_of(url)
        return host.endswith(".gov.co") or host == "gov.co" or host.endswith(".mil.co")

    @staticmethod
    def is_edu(url: str) -> bool:
        return domain_of(url).endswith(".edu.co")

    def is_official_for(self, url: str, organizer: Organizer | None) -> bool:
        if self.is_gov(url):
            return True
        if organizer is None:
            return False
        host = domain_of(url)
        return any(host == d or host.endswith("." + d) for d in organizer.domains)


class Taxonomy:
    def __init__(self, config_dir: Path):
        data = load_json(config_dir / "taxonomy.json", {})
        self.sections = data.get("sections", [])
        self.categories = data.get("categories", [])
        self.cost_types = data.get("cost_types", {})
        self.section_ids = [s["id"] for s in self.sections]
        self._cat_by_id = {c["id"]: c for c in self.categories}

    def category(self, cid: str) -> dict | None:
        return self._cat_by_id.get(cid)

    @staticmethod
    def _hits(keywords: list[str], text: str) -> int:
        n = 0
        for kw in keywords:
            k = norm(kw)
            if k and re.search(rf"(?<![a-z0-9]){re.escape(k)}(?![a-z0-9])", text):
                n += 1
        return n

    def classify(self, *, title: str, text: str, organizer: Organizer | None, url: str, hints: dict | None,
                 requires_purchase: bool | None, discount_pct: int | None, is_gov: bool) -> tuple[str, str, list[str]]:
        hints = hints or {}
        t_title = norm(title)
        t_all = norm(title + " " + title + " " + (text or "")[:6000])
        scores = {}
        for s in self.sections:
            scores[s["id"]] = self._hits(s["keywords"], t_all) + 2 * self._hits(s["keywords"], t_title)
        if is_gov or (organizer and organizer.type in ("gobierno", "caja")):
            scores["estado"] = scores.get("estado", 0) + 6
        if discount_pct or re.search(r"\b(2x1|3x2)\b", t_all):
            scores["ofertas"] += 3
        if re.search(r"(black friday|cyber ?monday|dia sin iva|descuentos? de hasta|\d+ ?% de descuento|hot sale)", t_title):
            scores["ofertas"] += 8
        if requires_purchase and scores.get("concursos", 0) == 0:
            scores["ofertas"] += 2
        if requires_purchase is False:
            scores["ofertas"] -= 2
        hinted = hints.get("section")
        if hinted in scores:
            scores[hinted] += 2
        section = max(scores, key=lambda k: scores[k]) if any(v > 0 for v in scores.values()) else (hinted or "bonos")

        # categoría dentro de la sección elegida
        best_cat, best_score = None, 0
        tags = []
        for c in self.categories:
            h = self._hits(c["keywords"], t_all) + 2 * self._hits(c["keywords"], t_title)
            if h and c["section"] == section and h > best_score:
                best_cat, best_score = c["id"], h
            if h >= 2:
                tags.append(c["label"])
        hint_cat = hints.get("category")
        if hint_cat:
            hc = self.category(hint_cat)
            if hc and hc["section"] == section and best_score <= 1:
                best_cat = hint_cat
            elif hc and hc["section"] != section:
                # mapear pista de concursos a su equivalente en otra sección (gasolina -> bono_gasolina / of_transporte)
                equivalents = {("gasolina", "bonos"): "bono_gasolina", ("gasolina", "ofertas"): "of_transporte",
                               ("supermercado", "ofertas"): "of_supermercados", ("entradas", "bonos"): "eventos_gratis",
                               ("of_bancarias", "concursos"): "dinero", ("cashback", "ofertas"): "of_bancarias"}
                if best_score <= 1 and (hint_cat, section) in equivalents:
                    best_cat = equivalents[(hint_cat, section)]
        if not best_cat:
            best_cat = {"concursos": "otros_premios", "bonos": "otros_beneficios", "ofertas": "otras_ofertas", "estado": "convocatorias"}.get(section, "")
        return section, best_cat, sorted(set(tags))[:6]


def cost_type(ex, section: str, is_official_text: bool) -> tuple[str, str, list[str]]:
    """Determina el tipo de costo y su nivel de certeza (explicito | inferido | desconocido)."""
    notes = []
    if ex.requires_deposit:
        notes.append("Exige depósito, saldo mínimo o apertura de producto con dinero.")
        return "requiere_condiciones", "explicito", notes
    if ex.has_fee:
        notes.append("La inscripción tiene costo según la fuente.")
        return "requiere_condiciones", "explicito", notes
    if ex.requires_purchase:
        notes.append(f"La fuente indica condición de compra: «{ex.purchase_evidence}».")
        if ex.money.get("purchase_threshold_text"):
            notes.append(f"Monto mínimo mencionado: {ex.money['purchase_threshold_text']}.")
        return "requiere_compra", "explicito", notes
    if ex.requires_subscription:
        notes.append("Requiere suscripción o membresía; revisa si hay cobro posterior.")
        return "requiere_suscripcion", "explicito", notes
    explicit_free = ex.requires_purchase is False
    if section == "ofertas" and not explicit_free:
        notes.append("Es una oferta comercial: el beneficio aplica sobre una compra.")
        return "requiere_compra", "inferido", notes
    if explicit_free:
        notes.append(f"La fuente lo indica: «{ex.purchase_evidence}».")
    if ex.requires_social:
        notes.append("Pide interactuar en redes sociales (seguir, comentar o etiquetar).")
    if explicit_free or section == "estado" or is_official_text:
        certainty = "explicito" if explicit_free else "inferido"
        if not explicit_free:
            notes.append("No se encontró ninguna condición de compra en la fuente oficial (inferido, confírmalo en los términos).")
        if section == "estado":
            return "gratis_registro", certainty, notes
        if ex.requires_activity:
            return "gratis_actividad", certainty, notes
        if ex.requires_registration or section == "estado":
            return "gratis_registro", certainty, notes
        return "gratis", certainty, notes
    return "desconocido", "desconocido", notes
