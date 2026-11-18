"""Alertas por Telegram y/o correo. Los tokens viven en GitHub Secrets; nunca en el frontend ni en el repo.

Secretos:
  TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID
  SMTP_HOST, SMTP_PORT (opcional, 465 por defecto), SMTP_USER, SMTP_PASSWORD, ALERT_EMAIL_TO
Preferencias (qué notificar): config/alerts.json"""
from __future__ import annotations

import html
import logging
import os
import smtplib
import ssl
from datetime import timedelta
from email.mime.text import MIMEText

import requests

from .config import Settings, load_json
from .util import iso, now, parse_day, today

log = logging.getLogger("radar.notify")

DEFAULT_PREFS = {
    "enabled": True,
    "channels": {"telegram": True, "email": True},
    "min_priority": 70,
    "sections": ["concursos", "bonos", "ofertas", "estado"],
    "categories": [],
    "only_free": False,
    "notify_new_high_priority": True,
    "notify_expiring_hours": 24,
    "notify_gasoline": True,
    "notify_opening_calls": True,
    "max_per_run": 10,
}


def _fmt(op: dict) -> str:
    prize = (op.get("prize") or {}).get("description") or op.get("summary") or ""
    value = (op.get("prize") or {}).get("value_text")
    end = (op.get("dates") or {}).get("end")
    cost = (op.get("cost") or {}).get("label") or ""
    url = (op.get("urls") or {}).get("participate") or (op.get("urls") or {}).get("source")
    parts = [f"<b>{html.escape(op.get('title', ''))}</b>"]
    if prize:
        parts.append(html.escape(prize[:180]))
    meta = " · ".join(x for x in [value and f"Valor: {value}", cost, end and f"Hasta: {end}",
                                   f"Prioridad {op.get('priority', {}).get('score', 0)}/100"] if x)
    parts.append(html.escape(meta))
    if url:
        parts.append(html.escape(url))
    return "\n".join(parts)


def select_alerts(items: list[dict], new_ids: set[str], notified: dict, prefs: dict) -> list[tuple[str, dict]]:
    out: list[tuple[str, dict]] = []
    sections = set(prefs.get("sections") or [])
    cats = set(prefs.get("categories") or [])
    for op in items:
        if op.get("status") in ("vencida", "retirada") or (op.get("risk") or {}).get("level") == "alto":
            continue
        if sections and op.get("section") not in sections:
            continue
        if cats and op.get("category") not in cats:
            continue
        free = (op.get("cost") or {}).get("type") in ("gratis", "gratis_registro", "gratis_actividad")
        if prefs.get("only_free") and not free:
            continue
        score = (op.get("priority") or {}).get("score", 0)
        oid = op["id"]
        if oid in new_ids and f"new:{oid}" not in notified:
            if prefs.get("notify_new_high_priority") and score >= prefs.get("min_priority", 70):
                out.append(("Nueva oportunidad de prioridad alta", op))
                continue
            if prefs.get("notify_gasoline") and op.get("category") in ("gasolina", "bono_gasolina") and free:
                out.append(("Nuevo bono de gasolina gratuito", op))
                continue
            if prefs.get("notify_opening_calls") and op.get("section") == "estado" and (op.get("gov") or {}).get("program_status") == "abierta":
                out.append(("Convocatoria abierta", op))
                continue
        end = parse_day((op.get("dates") or {}).get("end"))
        hours = prefs.get("notify_expiring_hours", 24)
        if end and hours and f"exp:{oid}" not in notified and score >= 45:
            if timedelta(0) <= (end - today()) <= timedelta(hours=hours):
                out.append(("Vence en menos de 24 horas", op))
    return out[: prefs.get("max_per_run", 10)]


def send(settings: Settings, items: list[dict], new_ids: set[str], notified: dict) -> dict:
    prefs = {**DEFAULT_PREFS, **(load_json(settings.config_dir / "alerts.json", {}) or {})}
    result = {"telegram": "no_configurado", "email": "no_configurado", "sent": 0}
    if not prefs.get("enabled", True):
        result["telegram"] = result["email"] = "desactivado"
        return result
    alerts = select_alerts(items, new_ids, notified, prefs)
    if not alerts:
        return result
    tg_token, tg_chat = os.environ.get("TELEGRAM_BOT_TOKEN"), os.environ.get("TELEGRAM_CHAT_ID")
    smtp_host, smtp_user = os.environ.get("SMTP_HOST"), os.environ.get("SMTP_USER")
    smtp_pass, mail_to = os.environ.get("SMTP_PASSWORD"), os.environ.get("ALERT_EMAIL_TO")
    delivered = False
    if tg_token and tg_chat and prefs["channels"].get("telegram", True) and not settings.dry_run:
        ok = 0
        for reason, op in alerts:
            msg = f"📡 <b>OPORTUNIA RADAR · {html.escape(reason)}</b>\n\n{_fmt(op)}"
            try:
                r = requests.post(f"https://api.telegram.org/bot{tg_token}/sendMessage",
                                  json={"chat_id": tg_chat, "text": msg, "parse_mode": "HTML", "disable_web_page_preview": True},
                                  timeout=15)
                ok += int(r.status_code == 200)
            except requests.RequestException as exc:
                log.warning("Telegram falló: %s", exc)
        result["telegram"] = f"enviadas {ok}/{len(alerts)}"
        delivered = delivered or ok > 0
    if smtp_host and smtp_user and smtp_pass and mail_to and prefs["channels"].get("email", True) and not settings.dry_run:
        body = "<h2>OPORTUNIA RADAR</h2>" + "".join(
            f"<h3>{html.escape(reason)}</h3><p>{_fmt(op).replace(chr(10), '<br>')}</p>" for reason, op in alerts)
        msg = MIMEText(body, "html", "utf-8")
        msg["Subject"] = f"OPORTUNIA RADAR: {len(alerts)} oportunidad(es) para revisar"
        msg["From"] = smtp_user
        msg["To"] = mail_to
        try:
            port = int(os.environ.get("SMTP_PORT", "465"))
            if port == 465:
                with smtplib.SMTP_SSL(smtp_host, port, context=ssl.create_default_context(), timeout=20) as s:
                    s.login(smtp_user, smtp_pass)
                    s.send_message(msg)
            else:
                with smtplib.SMTP(smtp_host, port, timeout=20) as s:
                    s.starttls(context=ssl.create_default_context())
                    s.login(smtp_user, smtp_pass)
                    s.send_message(msg)
            result["email"] = f"enviado ({len(alerts)} oportunidades)"
            delivered = True
        except (smtplib.SMTPException, OSError) as exc:
            result["email"] = f"error: {str(exc)[:120]}"
    if delivered:
        stamp = iso(now())
        for reason, op in alerts:
            key = ("exp:" if reason.startswith("Vence") else "new:") + op["id"]
            notified[key] = stamp
        result["sent"] = len(alerts)
    return result
