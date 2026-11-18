"""Persistencia en JSON: base de oportunidades, historial de cambios, ejecuciones y salud de fuentes."""
from __future__ import annotations

from datetime import timedelta

from .config import Settings, load_json, save_json
from .util import iso, now, parse_day, parse_iso, today

TRACKED_FIELDS = [
    ("dates.end", "Fecha de finalización"),
    ("dates.start", "Fecha de inicio"),
    ("dates.draw", "Fecha del sorteo"),
    ("status", "Estado"),
    ("verification.status", "Verificación"),
    ("prize.value_cop", "Valor"),
    ("urls.participate", "Enlace de participación"),
    ("cost.type", "Costo"),
]
MAX_RUNS = 500
MAX_CHANGES = 800
ARCHIVE_AFTER_DAYS = 30


def _get(d: dict, path: str):
    cur = d
    for part in path.split("."):
        if not isinstance(cur, dict):
            return None
        cur = cur.get(part)
    return cur


class Store:
    def __init__(self, settings: Settings):
        self.s = settings
        f = settings.published_files
        self.items: list[dict] = (load_json(f["opportunities"], {}) or {}).get("items", [])
        self.archive: list[dict] = (load_json(f["archive"], {}) or {}).get("items", [])
        self.runs: list[dict] = (load_json(f["runs"], {}) or {}).get("runs", [])
        self.changes: list[dict] = (load_json(f["changes"], {}) or {}).get("changes", [])
        self.sources_state: dict = {s["id"]: s for s in (load_json(f["sources"], {}) or {}).get("sources", [])}
        self.state_files = {
            "http_cache": settings.state_dir / "http_cache.json",
            "rejected": settings.state_dir / "rejected.json",
            "llm_cache": settings.state_dir / "llm_cache.json",
            "notified": settings.state_dir / "notified.json",
            "discovered": settings.state_dir / "discovered.json",
        }
        self.http_cache = load_json(self.state_files["http_cache"], {}) or {}
        self.rejected = load_json(self.state_files["rejected"], {}) or {}
        self.llm_cache = load_json(self.state_files["llm_cache"], {}) or {}
        self.notified = load_json(self.state_files["notified"], {}) or {}
        self.discovered = load_json(self.state_files["discovered"], {}) or {}
        self._prune_rejected()

    # ------------------------------------------------------------------ rechazados (caché negativa)
    def _prune_rejected(self) -> None:
        limit = now() - timedelta(days=10)
        self.rejected = {k: v for k, v in self.rejected.items() if (parse_iso(v.get("at")) or now()) > limit}

    def reject(self, url: str, reason: str) -> None:
        self.rejected[url] = {"at": iso(now()), "reason": reason[:160]}

    def is_rejected(self, url: str) -> bool:
        return url in self.rejected

    # ------------------------------------------------------------------ cambios
    def record_changes(self, old: dict, new: dict) -> list[dict]:
        changed = []
        for path, label in TRACKED_FIELDS:
            a, b = _get(old, path), _get(new, path)
            if a != b and not (a in (None, "") and b in (None, "")):
                entry = {"at": iso(now()), "field": path, "label": label, "from": a, "to": b}
                changed.append(entry)
        if changed:
            hist = new.setdefault("history", [])
            hist.extend(changed)
            del hist[:-25]
            for c in changed:
                self.changes.append({**c, "id": new["id"], "title": new.get("title", "")})
        return changed

    # ------------------------------------------------------------------ mantenimiento
    def archive_old(self) -> int:
        keep, moved = [], 0
        cutoff = today() - timedelta(days=ARCHIVE_AFTER_DAYS)
        for it in self.items:
            end = parse_day((it.get("dates") or {}).get("end"))
            finished = it.get("status") in ("vencida", "retirada")
            last_seen = parse_iso(it.get("last_seen")) or parse_iso(it.get("discovered_at"))
            stale = (not end and it.get("verification", {}).get("status") in ("no_verificable", "pendiente")
                     and last_seen and last_seen < now() - timedelta(days=45))
            if (finished and ((end and end < cutoff) or (last_seen and last_seen.date() < cutoff))) or stale:
                it["archived_at"] = iso(now())
                self.archive.append(it)
                moved += 1
            else:
                keep.append(it)
        self.items = keep
        self.archive = self.archive[-1500:]
        return moved

    # ------------------------------------------------------------------ guardado
    def save(self, status: dict, sources: list[dict]) -> None:
        f = self.s.published_files
        generated = iso(now())
        self.items.sort(key=lambda x: (-(x.get("priority") or {}).get("score", 0), x.get("title", "")))
        save_json(f["opportunities"], {"generated_at": generated, "count": len(self.items), "items": self.items})
        save_json(f["archive"], {"generated_at": generated, "count": len(self.archive), "items": self.archive}, compact=True)
        save_json(f["runs"], {"generated_at": generated, "runs": self.runs[-MAX_RUNS:]})
        save_json(f["changes"], {"generated_at": generated, "changes": self.changes[-MAX_CHANGES:]})
        save_json(f["sources"], {"generated_at": generated, "sources": sources})
        save_json(f["status"], status)
        for key, path in self.state_files.items():
            save_json(path, getattr(self, key), compact=True)
