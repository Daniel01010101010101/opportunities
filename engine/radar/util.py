"""Utilidades comunes: tiempo, hashing, normalización de texto y URLs."""
from __future__ import annotations

import hashlib
import re
import unicodedata
from datetime import date, datetime, timedelta, timezone
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse

from .config import SCHEDULE_EVERY_HOURS, SCHEDULE_MINUTE, TZ


def now() -> datetime:
    return datetime.now(TZ)


def iso(dt: datetime | None) -> str | None:
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=TZ)
    return dt.astimezone(TZ).isoformat(timespec="seconds")


def parse_iso(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=TZ)
    return dt


def parse_any_date(value: str | None) -> datetime | None:
    """ISO 8601, RFC 2822 (feeds) o dd/mm/aaaa · mm/dd/aaaa (si es ambiguo se toma la fecha pasada más reciente)."""
    if not value:
        return None
    v = str(value).strip()
    dt = parse_iso(v)
    if dt:
        return dt
    try:
        from email.utils import parsedate_to_datetime

        return parsedate_to_datetime(v)
    except (TypeError, ValueError, IndexError):
        pass
    m = re.match(r"^(\d{1,2})/(\d{1,2})/(\d{4})", v)
    if m:
        a, b, y = int(m.group(1)), int(m.group(2)), int(m.group(3))
        options = []
        for d_, m_ in ((a, b), (b, a)):
            try:
                options.append(datetime(y, m_, d_, tzinfo=TZ))
            except ValueError:
                continue
        past = [o for o in options if o <= now() + timedelta(days=1)]
        if past:
            return max(past)
        if options:
            return min(options)
    return None


def parse_day(value: str | None) -> date | None:
    if not value:
        return None
    try:
        return date.fromisoformat(value[:10])
    except ValueError:
        return None


def today() -> date:
    return now().date()


def next_scheduled_run(after: datetime | None = None) -> datetime:
    """Próxima ejecución del cron "17 */2 * * *" (UTC) expresada en hora de Bogotá."""
    after = (after or now()).astimezone(timezone.utc)
    candidate = after.replace(minute=SCHEDULE_MINUTE, second=0, microsecond=0)
    # avanzar hasta una hora UTC par con minuto 17 posterior a "after"
    for _ in range(0, 3 * SCHEDULE_EVERY_HOURS + 1):
        if candidate > after and candidate.hour % SCHEDULE_EVERY_HOURS == 0:
            return candidate.astimezone(TZ)
        candidate = candidate + timedelta(hours=1)
    return candidate.astimezone(TZ)


def sha1(text: str) -> str:
    return hashlib.sha1(text.encode("utf-8")).hexdigest()


def strip_accents(text: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFD", text) if unicodedata.category(c) != "Mn")


def norm(text: str) -> str:
    """Minúsculas, sin tildes y espacios colapsados (para comparar y buscar palabras clave)."""
    return re.sub(r"\s+", " ", strip_accents(text or "").lower()).strip()


def clean_space(text: str) -> str:
    return re.sub(r"\s+", " ", text or "").strip()


def truncate(text: str, n: int) -> str:
    text = clean_space(text)
    if len(text) <= n:
        return text
    cut = text[: n - 1].rsplit(" ", 1)[0]
    return cut.rstrip(",;:.-") + "…"


TRACKING_PARAMS = {
    "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "utm_id", "utm_name",
    "gclid", "fbclid", "mc_cid", "mc_eid", "ref", "ref_src", "igshid", "_ga", "_gl", "cmpid",
    "ocid", "s_cid", "spm", "yclid", "msclkid", "oc", "hl_src",
}


def canonical_url(url: str) -> str:
    """Normaliza una URL para detectar duplicados: sin tracking, sin fragmento, sin www, sin /amp."""
    if not url:
        return ""
    try:
        p = urlparse(url.strip())
    except ValueError:
        return url
    scheme = "https" if p.scheme in ("http", "https", "") else p.scheme
    host = (p.hostname or "").lower()
    if host.startswith("www."):
        host = host[4:]
    if host.startswith("m.") and host.count(".") >= 2:
        host = host[2:]
    path = re.sub(r"/(amp|amp\.html)/?$", "/", p.path or "/")
    path = re.sub(r"/{2,}", "/", path)
    if len(path) > 1 and path.endswith("/"):
        path = path[:-1]
    query = [(k, v) for k, v in parse_qsl(p.query, keep_blank_values=False) if k.lower() not in TRACKING_PARAMS]
    query.sort()
    return urlunparse((scheme, host, path, "", urlencode(query), ""))


def domain_of(url: str) -> str:
    try:
        host = (urlparse(url).hostname or "").lower()
    except ValueError:
        return ""
    return host[4:] if host.startswith("www.") else host


def registrable_domain(host: str) -> str:
    """Dominio registrable aproximado (soporta sufijos colombianos como .com.co, .gov.co, .edu.co)."""
    host = (host or "").lower().strip(".")
    parts = host.split(".")
    if len(parts) >= 3 and parts[-1] == "co" and parts[-2] in {"com", "gov", "edu", "org", "net", "mil", "nom"}:
        return ".".join(parts[-3:])
    if len(parts) >= 2:
        return ".".join(parts[-2:])
    return host


STOPWORDS = set(
    """a al algo algunas algunos ante antes como con contra cual cuando de del desde donde durante e el ella ellas ellos
    en entre era es esa esas ese eso esos esta estas este esto estos fue fueron ha han hasta hay la las le les lo los mas
    me mi mis mucho muy ni no nos o os otra otro para pero por porque que quien se ser si sin sobre su sus te tiene tu tus
    un una uno unos y ya the and for with to of in on at by from your you this that is are be gana ganar como hoy aqui
    nuevo nueva colombia colombianos 2024 2025 2026 2027""".split()
)


def _stem(t: str) -> str:
    if t.isdigit():
        return t
    if len(t) > 4 and t.endswith("es"):
        t = t[:-2]
    elif len(t) > 3 and t.endswith("s"):
        t = t[:-1]
    return t[:5]


def tokens(text: str) -> set[str]:
    """Tokens normalizados con un stemming simple (prefijo de 5 letras) para comparar títulos en español."""
    return {_stem(t) for t in re.findall(r"[a-z0-9]+", norm(text)) if len(t) > 2 and t not in STOPWORDS}


def jaccard(a: set[str], b: set[str]) -> float:
    if not a or not b:
        return 0.0
    return len(a & b) / len(a | b)
