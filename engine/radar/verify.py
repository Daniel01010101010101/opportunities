"""Verificación y seguridad: dominio oficial, organizador, términos, fechas, enlaces, señales de estafa."""
from __future__ import annotations

import re

from .classify import Organizer, Registry
from .util import domain_of, parse_day, registrable_domain, today

PAY_TO_CLAIM = re.compile(
    r"(paga(r)? (el|un|los) (env[ií]o|costo de env[ií]o|impuesto|gastos?|tr[aá]mite|seguro) (para|y) (recibir|reclamar|obtener)"
    r"|consigna(r)? .{0,40}(para|y) (recibir|reclamar)|transfi[eé]re(nos)? .{0,40}(para|y) (recibir|reclamar|liberar)"
    r"|deposita .{0,40}(para|y) (recibir|reclamar|liberar)|costo de (reclamaci[oó]n|liberaci[oó]n) del premio)",
    re.I,
)
FINANCIAL_DATA = re.compile(
    r"(n[uú]mero (completo )?de (tu |la )?tarjeta|c[oó]digo de seguridad de (tu |la )?tarjeta|\bcvv\b|\bcvc\b|clave (de tu cuenta|bancaria|din[aá]mica|del cajero)"
    r"|contrase[nñ]a (de tu|del) (banco|cuenta|correo)|c[oó]digo otp|c[oó]digo de verificaci[oó]n que (te )?(llegar[aá]|recibir[aá]s)|token bancario"
    r"|usuario y clave)",
    re.I,
)
SENSITIVE_DATA = re.compile(r"(foto (de|del) (tu )?(documento|c[eé]dula)|selfie con (tu )?(documento|c[eé]dula)|copia de (la|tu) c[eé]dula|huella)", re.I)
WINNER_BAIT = re.compile(r"(has sido (seleccionad[oa]|elegid[oa])|eres (el|la) ganador|felicidades,? (has|ganaste)|reclama tu premio (ya|ahora|por whatsapp)|te ganaste)", re.I)
URGENCY = re.compile(r"(solo por hoy|[uú]ltimas horas|quedan pocos|antes de que se agote|tienes \d+ minutos)", re.I)
WHATSAPP_CLAIM = re.compile(r"(whatsapp|wa\.me).{0,60}(reclam|premio|ganador)|(reclam|premio|ganador).{0,60}(whatsapp|wa\.me)", re.I)


def risk_assessment(registry: Registry, *, text: str, urls: list[str], organizer: Organizer | None,
                    mentioned: list[Organizer], source_is_news: bool) -> dict:
    flags: list[dict] = []
    sensitive = False

    def add(code: str, label: str, level: str):
        if not any(f["code"] == code for f in flags):
            flags.append({"code": code, "label": label, "level": level})

    for u in [x for x in urls if x]:
        host = domain_of(u)
        reg = registrable_domain(host)
        if any(host == s or host.endswith("." + s) for s in registry.shorteners):
            add("acortador", f"Usa un enlace acortado ({host}); no se puede confirmar el destino.", "medio")
        if any(host == s or host.endswith("." + s) for s in registry.suspicious_hosts):
            add("hosting_gratuito", f"La página está en un servicio de hosting gratuito ({host}), poco habitual para marcas oficiales.", "alto")
        tld = host.rsplit(".", 1)[-1] if "." in host else ""
        if tld in registry.suspicious_tlds:
            add("tld_sospechoso", f"Dominio con terminación poco usual (.{tld}).", "medio")
        # Suplantación: el texto habla de una marca conocida pero el enlace no es de sus dominios ni de un medio
        for o in mentioned[:2]:
            if organizer is not None and o is not organizer:
                continue
            official = any(host == d or host.endswith("." + d) for d in o.domains)
            if not official and not registry.is_news(u) and not registry.is_gov(u) and o.type != "gobierno":
                brand_token = re.sub(r"[^a-z0-9]", "", o.name.lower().split()[0])
                if brand_token and brand_token in reg.replace("-", "") and not official:
                    add("posible_suplantacion", f"El dominio {host} usa el nombre «{o.name}» pero no es uno de sus dominios oficiales.", "alto")
    if PAY_TO_CLAIM.search(text):
        add("pago_oculto", "Pide pagar, consignar o transferir dinero para recibir el premio.", "alto")
    if FINANCIAL_DATA.search(text):
        add("datos_financieros", "Solicita datos financieros sensibles (tarjeta, claves, códigos OTP).", "alto")
        sensitive = True
    if SENSITIVE_DATA.search(text):
        add("datos_sensibles", "Solicita fotos de tu documento o datos biométricos. Compártelos solo en el sitio oficial.", "medio")
        sensitive = True
    if WINNER_BAIT.search(text) and not source_is_news:
        add("anzuelo_ganador", "Mensaje del tipo «ya ganaste»: patrón típico de estafa.", "alto")
    if WHATSAPP_CLAIM.search(text) and not source_is_news:
        add("reclamo_whatsapp", "Pide reclamar el premio por WhatsApp.", "medio")
    if URGENCY.search(text):
        add("urgencia", "Usa presión de tiempo excesiva.", "bajo")

    level = "bajo"
    if any(f["level"] == "alto" for f in flags):
        level = "alto"
    elif sum(1 for f in flags if f["level"] == "medio") >= 1:
        level = "medio"
    return {"level": level, "flags": flags, "sensitive_data_warning": sensitive}


def verification_status(*, end_date: str | None, withdrawn: bool, closed: bool, link_ok: bool | None,
                        official_domain: bool, terms_found: bool, section: str, organizer_known: bool,
                        has_dates: bool, risk_level: str, source_official: bool, program_status: str | None) -> tuple[str, list[str]]:
    reasons: list[str] = []
    end = parse_day(end_date)
    if withdrawn:
        return "retirada", ["La fuente indica que fue cancelada, suspendida o la página ya no existe."]
    if (end and end < today()) or closed:
        return "vencida", ["La fecha de finalización ya pasó." if end and end < today() else "La fuente indica que ya cerró."]
    if risk_level == "alto":
        return "no_verificable", ["Tiene señales de riesgo alto; no se recomienda sin confirmar en el canal oficial de la marca."]
    if official_domain:
        reasons.append("El enlace pertenece a un dominio oficial del organizador.")
    if source_official:
        reasons.append("Proviene de una fuente oficial configurada.")
    if terms_found:
        reasons.append("Tiene términos y condiciones consultables.")
    if link_ok:
        reasons.append("El enlace respondió correctamente en la última verificación.")
    elif link_ok is False:
        reasons.append("El enlace no respondió en la última verificación.")
    if (official_domain or source_official) and link_ok is not False and (terms_found or section == "estado" or program_status == "permanente"):
        return "verificada", reasons
    if organizer_known or official_domain or source_official:
        reasons.append("Falta confirmar condiciones en la página oficial." if not terms_found else "Falta confirmar el enlace oficial de participación.")
        return "pendiente", reasons
    if has_dates:
        reasons.append("Organizador no identificado con certeza.")
        return "pendiente", reasons
    reasons.append("Información insuficiente: sin organizador identificado, fechas ni enlace oficial.")
    return "no_verificable", reasons
