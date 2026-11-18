"""Detección de duplicados: una misma promoción puede aparecer en varias noticias y páginas."""
from __future__ import annotations

from .util import canonical_url, jaccard, tokens


def keys_for(op: dict) -> set[str]:
    urls = op.get("urls") or {}
    keys = set()
    for k in ("participate", "terms", "official"):
        if urls.get(k):
            keys.add(canonical_url(urls[k]))
    for s in op.get("sources") or []:
        if s.get("url"):
            keys.add(canonical_url(s["url"]))
    return {k for k in keys if k}


def same_opportunity(a: dict, b: dict) -> bool:
    if keys_for(a) & keys_for(b):
        return True
    ta, tb = tokens(a.get("title", "")), tokens(b.get("title", ""))
    sim = jaccard(ta, tb)
    org_a = ((a.get("organizer") or {}).get("name") or "").lower()
    org_b = ((b.get("organizer") or {}).get("name") or "").lower()
    end_a = (a.get("dates") or {}).get("end")
    end_b = (b.get("dates") or {}).get("end")
    unknown = "no identificado"
    if a.get("section") and b.get("section") and a.get("section") != b.get("section"):
        return sim >= 0.8
    if end_a and end_b and end_a != end_b:
        return False
    if org_a and org_a == org_b and unknown not in org_a:
        if sim >= 0.45:
            return True
        if end_a and end_a == end_b and sim >= 0.3:
            return True
        return False
    a_unknown = not org_a or unknown in org_a
    b_unknown = not org_b or unknown in org_b
    if a_unknown != b_unknown:
        return sim >= 0.55
    if not a_unknown and not b_unknown:  # organizadores distintos y conocidos
        return sim >= 0.85
    return sim >= 0.6


class DedupIndex:
    def __init__(self, items: list[dict]):
        self.items = items
        self.by_key: dict[str, dict] = {}
        for it in items:
            for k in keys_for(it):
                self.by_key.setdefault(k, it)

    def find(self, op: dict) -> dict | None:
        for k in keys_for(op):
            if k in self.by_key:
                return self.by_key[k]
        for it in self.items:
            if it is not op and same_opportunity(it, op):
                return it
        return None

    def add(self, op: dict) -> None:
        self.items.append(op)
        for k in keys_for(op):
            self.by_key.setdefault(k, op)

    def known_url(self, url: str) -> dict | None:
        return self.by_key.get(canonical_url(url))
