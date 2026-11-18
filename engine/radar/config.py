"""Configuración global del motor: rutas, límites, zona horaria y lectura de archivos de configuración."""
from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from pathlib import Path
from zoneinfo import ZoneInfo

import yaml

TZ = ZoneInfo("America/Bogota")

# Cron real usado por GitHub Actions (UTC). Colombia es UTC-5 todo el año (sin horario de verano),
# por lo que "17 */2 * * *" equivale a las :17 de cada hora impar en Bogotá.
SCHEDULE_CRON_UTC = "17 */2 * * *"
SCHEDULE_MINUTE = 17
SCHEDULE_EVERY_HOURS = 2

REPO_ROOT = Path(__file__).resolve().parents[2]

USER_AGENT = (
    "Mozilla/5.0 (compatible; OportuniaRadar/1.0; buscador personal de oportunidades; "
    "respeta robots.txt)"
)


def _env_int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, default))
    except (TypeError, ValueError):
        return default


@dataclass
class Settings:
    config_dir: Path
    data_dir: Path  # carpeta publicada (JSON que consume la web)
    state_dir: Path  # estado interno (caché, rotación, notificaciones) - no se publica
    trigger: str = "manual"
    category: str = ""
    query: str = ""
    full: bool = False
    dry_run: bool = False
    offline: bool = False  # no consulta Internet (solo mantenimiento)
    max_fetches: int = field(default_factory=lambda: _env_int("RADAR_MAX_FETCHES", 520))
    max_runtime_s: int = field(default_factory=lambda: _env_int("RADAR_MAX_RUNTIME_S", 1800))
    max_candidates: int = field(default_factory=lambda: _env_int("RADAR_MAX_CANDIDATES", 200))
    reverify_per_run: int = field(default_factory=lambda: _env_int("RADAR_REVERIFY_PER_RUN", 40))
    workers: int = field(default_factory=lambda: _env_int("RADAR_WORKERS", 6))
    git_sha: str = field(default_factory=lambda: os.environ.get("GITHUB_SHA", "")[:7])
    run_url: str = field(default_factory=lambda: _run_url())

    @property
    def published_files(self) -> dict[str, Path]:
        return {
            "opportunities": self.data_dir / "opportunities.json",
            "archive": self.data_dir / "archive.json",
            "status": self.data_dir / "status.json",
            "runs": self.data_dir / "runs.json",
            "sources": self.data_dir / "sources.json",
            "changes": self.data_dir / "changes.json",
        }


def _run_url() -> str:
    server = os.environ.get("GITHUB_SERVER_URL")
    repo = os.environ.get("GITHUB_REPOSITORY")
    run_id = os.environ.get("GITHUB_RUN_ID")
    if server and repo and run_id:
        return f"{server}/{repo}/actions/runs/{run_id}"
    return ""


def load_yaml(path: Path):
    with open(path, encoding="utf-8") as fh:
        return yaml.safe_load(fh)


def load_json(path: Path, default=None):
    try:
        with open(path, encoding="utf-8") as fh:
            return json.load(fh)
    except FileNotFoundError:
        return default
    except json.JSONDecodeError:
        return default


def save_json(path: Path, payload, compact: bool = False) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    with open(tmp, "w", encoding="utf-8") as fh:
        if compact:
            json.dump(payload, fh, ensure_ascii=False, separators=(",", ":"))
        else:
            json.dump(payload, fh, ensure_ascii=False, indent=1)
        fh.write("\n")
    os.replace(tmp, path)
