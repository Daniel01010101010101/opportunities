"""Puntuación de PRIORIDAD DE REVISIÓN (0-100). No representa probabilidad de ganar."""
from __future__ import annotations

import math

from .util import parse_day, today

FREE_POINTS = {
    "gratis": 25, "gratis_registro": 22, "gratis_actividad": 18, "desconocido": 9,
    "requiere_suscripcion": 5, "requiere_condiciones": 4, "requiere_compra": 4,
}
CREDIBILITY = {"verificada": 10, "pendiente": 6, "no_verificable": 2, "vencida": 0, "retirada": 0}
COVERAGE = {"nacional": 10, "bogota": 10, "regional": 5, "desconocida": 6, "internacional": 4}


def value_points(op: dict) -> tuple[int, str]:
    value = (op.get("prize") or {}).get("value_cop")
    section = op.get("section")
    category = op.get("category")
    if value:
        # 20.000 COP -> ~8 pts, 1.000.000 -> ~16, 100.000.000+ -> 25
        pts = max(4, min(25, round(2.2 * math.log10(value / 1000) + 5.5)))
        return pts, f"valor publicado {value:,.0f} COP".replace(",", ".")
    big = {"carros": 22, "motos": 18, "viajes": 16, "dinero": 15, "computadores": 13, "celulares": 12, "televisores": 12,
           "becas": 16, "vivienda": 18, "ayudas": 14, "emprendimiento": 14, "formacion": 11, "electrodomesticos": 11}
    if category in big:
        return big[category], "valor no publicado (estimado por tipo de premio)"
    if section == "ofertas":
        pct = (op.get("offer") or {}).get("discount_pct") or 0
        return (12 if pct >= 50 else 8 if pct >= 30 else 5), "descuento sobre compra"
    return 9, "valor no publicado"


def ease_points(op: dict) -> tuple[int, str]:
    cost = op.get("cost") or {}
    pts = 15
    notes = []
    if cost.get("requires_registration"):
        pts -= 2; notes.append("registro")
    if cost.get("requires_activity"):
        pts -= 3; notes.append("actividad")
    if cost.get("requires_social"):
        pts -= 2; notes.append("redes sociales")
    reqs = len(op.get("requirements") or [])
    docs = len(op.get("documents") or [])
    pts -= min(4, reqs // 2 + docs // 2)
    steps = len(op.get("steps") or [])
    if steps > 6:
        pts -= 2
    return max(2, pts), ", ".join(notes) or "pocos requisitos"


def time_points(op: dict) -> tuple[int, str]:
    status = op.get("status")
    if status in ("vencida", "retirada"):
        return 0, "terminada"
    end = parse_day((op.get("dates") or {}).get("end"))
    if status == "permanente":
        return 8, "programa permanente"
    if status == "proxima":
        return 6, "abre próximamente"
    if not end:
        return 5, "sin fecha límite publicada"
    days = (end - today()).days
    if days < 0:
        return 0, "vencida"
    if days <= 3:
        return 9, f"vence en {days} día(s): revisar ya"
    if days <= 30:
        return 10, f"vigente ({days} días restantes)"
    return 8, f"vigente ({days} días restantes)"


def score(op: dict) -> dict:
    v, v_note = value_points(op)
    f = FREE_POINTS.get((op.get("cost") or {}).get("type", "desconocido"), 8)
    e, e_note = ease_points(op)
    t, t_note = time_points(op)
    cov = COVERAGE.get((op.get("eligibility") or {}).get("coverage", "desconocida"), 6)
    ver = op.get("verification") or {}
    cred = CREDIBILITY.get(ver.get("status", "no_verificable"), 2)
    clarity = 5 if (op.get("urls") or {}).get("terms") else (3 if op.get("steps") else 1)
    total = v + f + e + t + cov + cred + clarity
    risk = (op.get("risk") or {}).get("level")
    if risk == "alto":
        total = min(total, 20)
    elif risk == "medio":
        total -= 10
    if op.get("status") in ("vencida", "retirada"):
        total = min(total, 10)
    total = max(0, min(100, int(round(total))))
    free = (op.get("cost") or {}).get("type") in ("gratis", "gratis_registro", "gratis_actividad")
    if total >= 70 and free and ver.get("status") in ("verificada", "pendiente") and risk != "alto":
        level = "alta"
    elif total >= 45:
        level = "media"
    else:
        level = "baja"
    if level == "alta" and not free:
        level = "media"
    return {
        "score": total,
        "level": level,
        "breakdown": {
            "valor": {"points": v, "max": 25, "note": v_note},
            "gratuidad": {"points": f, "max": 25, "note": (op.get("cost") or {}).get("type", "desconocido")},
            "facilidad": {"points": e, "max": 15, "note": e_note},
            "vigencia": {"points": t, "max": 10, "note": t_note},
            "cobertura": {"points": cov, "max": 10, "note": (op.get("eligibility") or {}).get("coverage", "desconocida")},
            "credibilidad": {"points": cred, "max": 10, "note": ver.get("status", "no_verificable")},
            "claridad": {"points": clarity, "max": 5, "note": "términos publicados" if (op.get("urls") or {}).get("terms") else "sin términos enlazados"},
        },
    }
