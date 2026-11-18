"""CLI del motor.

Uso:
  python -m radar run --data ../store/data --state ../store/state [--trigger schedule] [--category estado]
                      [--query "bonos de gasolina"] [--full] [--dry-run] [--offline]
"""
from __future__ import annotations

import argparse
import json
import logging
import sys
from pathlib import Path

from .config import REPO_ROOT, Settings
from .pipeline import Radar


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="radar", description="OPORTUNIA RADAR - motor de investigación")
    sub = p.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("run", help="ejecuta una búsqueda completa")
    r.add_argument("--config", default=str(REPO_ROOT / "config"))
    r.add_argument("--data", default=str(REPO_ROOT / ".radar-local" / "data"))
    r.add_argument("--state", default=str(REPO_ROOT / ".radar-local" / "state"))
    r.add_argument("--trigger", default="manual", choices=["schedule", "manual", "push", "retry", "local"])
    r.add_argument("--category", default="")
    r.add_argument("--query", default="")
    r.add_argument("--full", action="store_true", help="consulta todas las fuentes sin importar la rotación")
    r.add_argument("--dry-run", action="store_true", help="no guarda resultados ni envía alertas")
    r.add_argument("--offline", action="store_true", help="solo mantenimiento (vencimientos y prioridades) sin consultar fuentes")
    r.add_argument("--max-fetches", type=int)
    r.add_argument("--max-runtime", type=int)
    r.add_argument("-v", "--verbose", action="store_true")
    args = p.parse_args(argv)

    logging.basicConfig(level=logging.DEBUG if args.verbose else logging.INFO,
                        format="%(asctime)s %(levelname)s %(name)s: %(message)s", stream=sys.stderr)
    logging.getLogger("urllib3").setLevel(logging.WARNING)

    s = Settings(config_dir=Path(args.config), data_dir=Path(args.data), state_dir=Path(args.state),
                 trigger=args.trigger, category=(args.category or "").strip().lower(), query=(args.query or "").strip()[:120],
                 full=args.full, dry_run=args.dry_run, offline=args.offline)
    if args.max_fetches:
        s.max_fetches = args.max_fetches
    if args.max_runtime:
        s.max_runtime_s = args.max_runtime
    run = Radar(s).run()
    print(json.dumps(run, ensure_ascii=False, indent=1))
    # Código de salida: 0 salvo que TODAS las fuentes fallen (permite que el workflow reintente)
    return 2 if run["status"] == "error" else 0


if __name__ == "__main__":
    raise SystemExit(main())
