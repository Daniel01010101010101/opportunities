"""Extracción heurística (sin IA) de los datos de una oportunidad a partir del texto de la fuente.

Principio: nunca inventar. Si un dato no aparece en el texto, queda vacío (None / lista vacía) y la web
lo muestra como "No informado por la fuente"."""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import date, timedelta

from .util import clean_space, norm, today, truncate

MONTHS = {
    "enero": 1, "ene": 1, "febrero": 2, "feb": 2, "marzo": 3, "mar": 3, "abril": 4, "abr": 4,
    "mayo": 5, "may": 5, "junio": 6, "jun": 6, "julio": 7, "jul": 7, "agosto": 8, "ago": 8,
    "septiembre": 9, "setiembre": 9, "sep": 9, "sept": 9, "octubre": 10, "oct": 10,
    "noviembre": 11, "nov": 11, "diciembre": 12, "dic": 12,
}
_MONTH_RE = r"(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre|ene|feb|mar|abr|may|jun|jul|ago|sept|sep|oct|nov|dic)\.?"
DATE_TEXT = re.compile(
    rf"\b(\d{{1,2}})(?:\s*(?:º|°|o))?\s+(?:de\s+)?{_MONTH_RE}(?:\s+(?:de|del)?\s*(\d{{4}}))?", re.I
)
DATE_NUM = re.compile(r"\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})\b")
DATE_ISO = re.compile(r"\b(20\d{2})-(\d{2})-(\d{2})\b")

END_CUES = re.compile(r"(hasta|vigencia|vigente|finaliza|finalizar[aá]|termina|cierre|cierra|cerrar[aá]|fecha l[ií]mite|plazo|[uú]ltimo d[ií]a|vence|al\b|culmina|m[aá]ximo el|antes del)", re.I)
START_CUES = re.compile(r"(desde|a partir|inicia|inicio|apertura|abre|abrir[aá]n?|comienza|del\b|entre el)", re.I)
DRAW_CUES = re.compile(r"(sorteo se (realizar[aá]|har[aá]|llevar[aá])|fecha del sorteo|se sortear[aá]n?|sorteo ser[aá]|ganadores se (anunciar[aá]n|dar[aá]n a conocer|publicar[aá]n)|se anunciar[aá]n? (los|el) ganador|d[ií]a del sorteo|sorteo final)", re.I)

MONEY = re.compile(
    r"(?:\$|cop\s?|col\$\s?)\s?(\d{1,3}(?:[.,]\d{3})+|\d+(?:[.,]\d+)?)(\s?(?:mil millones|millones|mill[oó]n|mil|k|m)\b)?"
    r"|(\d+(?:[.,]\d+)?)\s?(mil millones|millones|mill[oó]n)\s+de\s+pesos",
    re.I,
)
PRIZE_CONTEXT = re.compile(r"(premio|gana|ganar|ganador|bono|bonos|valor|sorte|recibe|obt[eé]n|regalo|subsidio|apoyo|beca|hasta por|monto|cashback|devoluci[oó]n|incentivo)", re.I)
THRESHOLD_CONTEXT = re.compile(r"(compras?|superiores?|mayores?|m[ií]nim[oa]|desde|por cada|a partir de|consumo|tanqueos?|iguales? o superiores?)\s*(de|a)?\s*$", re.I)

PURCHASE_YES = [
    r"\b(por|con) (tus|sus|cada|la|tu) (compras?|tanqueos?|consumos?|pedidos?)\b",
    r"\bcompras? (superiores|mayores|iguales|m[ií]nimas?|desde|por valor)\b",
    r"\b(al|por) (comprar|adquirir|tanquear|consumir|pagar con)\b",
    r"\bmonto m[ií]nimo\b", r"\bpor cada \$", r"\bpor cada (compra|tanqueo|transacci[oó]n)",
    r"\btanqueos? (desde|superiores|de m[aá]s|mayores)\b", r"\bfactura (de compra|electr[oó]nica)\b",
    r"\b(realiza|haz|efect[uú]a|hagan) (una|tu|sus|tus) compras?\b", r"\bcompra m[ií]nima\b",
    r"\bpagando con\b", r"\bpaga con tu\b", r"\bpaga con\b", r"\bal pagar con\b", r"\ben compras con\b",
    r"\butiliza tu tarjeta\b", r"\bcon tu tarjeta de cr[eé]dito\b", r"\bdescuentos? (del|de hasta|hasta)( el| del)? \d+ ?%",
    r"\bcashback\b", r"\bdevoluci[oó]n del? \d+ ?%", r"\bte devolvemos\b",
    r"\b\d{1,2} ?% (de descuento|dcto|off)\b", r"\b2x1\b", r"\b3x2\b", r"\bpor la compra de\b",
    r"\bcompra (y|e) (gana|participa|recibe)\b", r"\bpor cada \d+ (mil|millones)\b",
]
PURCHASE_NO = [
    r"\bsin (necesidad de )?(realizar )?(ninguna )?compra", r"\bno (se )?(requiere|necesita|exige) (realizar )?(ninguna )?compra",
    r"\bno es necesario (comprar|realizar compras)", r"\bparticipaci[oó]n (es )?gratuita", r"\binscripci[oó]n (es )?gratuita",
    r"\btotalmente gratis\b", r"\bcompletamente gratis\b", r"\bsin costo\b", r"\bentrada libre\b", r"\bentrada gratuita\b",
    r"\bevento gratuito\b", r"\bgratuito para (el p[uú]blico|todos)\b", r"\bno tiene costo\b", r"\bes gratis\b", r"\bde forma gratuita\b",
    r"\bsin ning[uú]n costo\b", r"\bacceso gratuito\b", r"\bpostulaci[oó]n (es )?gratuita",
]
SUBSCRIPTION = [r"\bsuscripci[oó]n (mensual|anual|paga|premium)\b", r"\bmembres[ií]a (paga|mensual|anual)\b", r"\bplan (mensual|anual) de\b",
                r"\bprueba gratis.{0,80}(luego|despu[eé]s|posteriormente).{0,40}(cobr|\$)", r"\bse cobrar[aá]\b", r"\bcobro autom[aá]tico\b"]
DEPOSIT = [r"\b(dep[oó]sito|consignaci[oó]n|recarga|abono) (m[ií]nim[oa]|inicial|de \$)", r"\bapertura de (cuenta|cdt).{0,40}(con|desde) \$",
           r"\b(invierte|inversi[oó]n m[ií]nima)\b", r"\bmantener un saldo\b", r"\bsaldo m[ií]nimo\b", r"\babre (un|tu) cdt\b"]
FEE = [r"\bvalor de (la )?inscripci[oó]n\b", r"\bpago de (la )?inscripci[oó]n\b", r"\bcosto de (la )?inscripci[oó]n\b", r"\bderechos de inscripci[oó]n\b"]
REGISTRATION = [r"\breg[ií]strate\b", r"\bregistrarte\b", r"\binscr[ií]bete\b", r"\binscribirte\b", r"\binscripci[oó]n\b", r"\b(crear|crea|abre|abrir) (una|tu) cuenta\b",
                r"\bdiligencia(r)? (el|un) formulario\b", r"\bformulario de (registro|inscripci[oó]n|postulaci[oó]n)\b", r"\bdesc[aá]rga(r|) (la|nuestra) app\b",
                r"\bpost[uú]late\b", r"\bpostularte\b", r"\bregistro (en|previo)\b"]
SOCIAL = [r"\bs[ií]gue(nos)? (a|en|la cuenta)\b", r"\bseguir (la|nuestra|las) cuentas?\b", r"\bcomenta (esta|la|el)\b", r"\betiqueta a\b", r"\bcomparte (la|esta) publicaci[oó]n\b",
          r"\bdale (like|me gusta)\b", r"\b(instagram|tiktok|facebook)\b.{0,60}\b(comenta|sigue|etiqueta|comparte)", r"\b(comenta|sigue|etiqueta|comparte)\b.{0,60}\b(instagram|tiktok|facebook)\b"]
ACTIVITY = [r"\bresponde\b", r"\btrivia\b", r"\bpreguntas?\b.{0,30}\b(correctamente|responder)", r"\bacumula\b", r"\breto\b", r"\bdesaf[ií]o\b",
            r"\bsube (una|tu) (foto|video)\b", r"\bgraba (un|tu) video\b", r"\bcompleta (la|una|nuestra) encuesta\b", r"\bjuega\b", r"\bmisi[oó]n\b", r"\bpuntaje\b", r"\bc[oó]digos? (de|en) (las|los) (tapas|empaques|productos)"]

COVERAGE_NATIONAL = re.compile(r"(todo el (territorio )?(nacional|pa[ií]s)|a nivel nacional|en toda colombia|territorio colombiano|v[aá]lid[oa] en colombia|para toda colombia|en todo colombia|todo el territorio de la rep[uú]blica|residentes en colombia|nivel nacional)", re.I)
CITIES = [
    "Bogotá", "Medellín", "Cali", "Barranquilla", "Cartagena", "Bucaramanga", "Pereira", "Manizales", "Santa Marta", "Cúcuta",
    "Ibagué", "Villavicencio", "Pasto", "Neiva", "Armenia", "Montería", "Valledupar", "Popayán", "Tunja", "Sincelejo", "Soacha",
    "Chía", "Zipaquirá", "Fusagasugá", "Girardot", "Facatativá", "Mosquera", "Funza", "Cajicá", "Envigado", "Itagüí", "Bello",
    "Palmira", "Floridablanca", "Riohacha", "Quibdó", "Yopal", "Florencia", "Leticia", "San Andrés",
]
DEPARTMENTS = ["Cundinamarca", "Antioquia", "Valle del Cauca", "Atlántico", "Bolívar", "Santander", "Risaralda", "Caldas", "Boyacá",
               "Tolima", "Meta", "Nariño", "Huila", "Córdoba", "Cesar", "Magdalena", "Norte de Santander", "Quindío", "Cauca", "Sucre"]
AGE = re.compile(r"(mayores? de (\d{2})\s*a[nñ]os|mayor(es)? de edad|(\d{2}) a[nñ]os (o m[aá]s|en adelante|cumplidos)|entre (\d{2}) y (\d{2}) a[nñ]os|edad m[ií]nima (de )?(\d{2}))", re.I)
WINNERS = re.compile(r"\b(\d{1,4}|un|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|veinte|cien|mil)\s+(ganadores|ganador|premios|beneficiarios|cupos|bonos)\b", re.I)
ODDS = re.compile(r"(probabilidad(es)? de ganar[^.\n]{0,120})", re.I)
WORD_NUM = {"un": 1, "una": 1, "dos": 2, "tres": 3, "cuatro": 4, "cinco": 5, "seis": 6, "siete": 7, "ocho": 8, "nueve": 9, "diez": 10, "veinte": 20, "cien": 100, "mil": 1000}
DOC_TYPES = [
    ("cédula", r"\bc[eé]dula\b|documento de identidad"), ("Tarjeta de identidad", r"tarjeta de identidad"),
    ("RUT", r"\brut\b"), ("Certificado SISBÉN", r"sisb[eé]n"), ("Diploma o acta de grado", r"diploma|acta de grado"),
    ("Certificado de notas", r"certificado de notas|calificaciones"), ("Certificado laboral", r"certificado laboral|certificaci[oó]n laboral"),
    ("Factura de compra", r"factura de compra|tirilla|comprobante de compra"), ("Registro civil", r"registro civil"),
    ("Certificado de residencia", r"certificado de residencia|recibo de servicio"), ("Extractos bancarios", r"extractos? bancarios?"),
    ("Hoja de vida", r"hoja de vida"), ("Carta de motivación", r"carta de (motivaci[oó]n|intenci[oó]n)"),
    ("Pasaporte", r"pasaporte"), ("Certificado de ingresos", r"certificado de ingresos|declaraci[oó]n de renta"),
]
REQ_SENTENCE = re.compile(r"(requisito|deber[aá]s?|debes|ser mayor|residente|ser cliente|tener (una|un|cuenta)|contar con|estar (inscrito|registrado|afiliado)|aplica (solo|para)|dirigid[oa] a|podr[aá]n participar|pueden participar|no podr[aá]n participar|est[aá]n excluidos|exclusivo para)", re.I)
STATUS_CLOSED = re.compile(r"(convocatoria (cerrada|finalizada)|inscripciones cerradas|ha finalizado|finaliz[oó] la (promoci[oó]n|campa[nñ]a|actividad)|promoci[oó]n (finalizada|terminada|vencida)|ya (finaliz[oó]|termin[oó]|cerr[oó]))", re.I)
STATUS_WITHDRAWN = re.compile(r"(promoci[oó]n (cancelada|suspendida|retirada)|se (cancela|suspende) (la|el) (promoci[oó]n|concurso|sorteo|actividad)|actividad cancelada|sorteo (cancelado|suspendido))", re.I)
STATUS_SOON = re.compile(r"(pr[oó]ximamente|pr[oó]xima apertura|abrir[aá]n? (sus )?inscripciones|se abrir[aá]|inscripciones (abrir[aá]n|a partir))", re.I)
STATUS_OPEN = re.compile(r"(inscripciones abiertas|convocatoria abierta|ya puedes (inscribirte|postularte|participar)|est[aá] abierta|postulaciones abiertas|participa ya|vigente)", re.I)
PERMANENT = re.compile(r"(permanente|todo el a[nñ]o|en cualquier momento|siempre disponible|de manera continua)", re.I)
DISCOUNT_PCT = re.compile(r"(\d{1,2}|100)\s?%\s?(de descuento|dcto|off|menos)|(descuento|dcto)s?\s(del?|de hasta|hasta (del?)?)\s?(\d{1,2}|100)\s?%", re.I)
CODE = re.compile(r"(c[oó]digo|cup[oó]n)( promocional| de descuento)?\s*[:\"“'«]?\s*([A-Z0-9]{4,16})\b")
PRICE_BEFORE = re.compile(r"(antes|precio (normal|regular|anterior)|de)\s*\$\s?(\d{1,3}(?:[.,]\d{3})+)", re.I)
PRICE_NOW = re.compile(r"(ahora|ahora a|precio (especial|promocional|oferta)|a solo|por solo|hoy)\s*\$\s?(\d{1,3}(?:[.,]\d{3})+)", re.I)


def _any(patterns: list[str], text: str) -> str | None:
    for p in patterns:
        m = re.search(p, text, re.I)
        if m:
            return m.group(0)
    return None


def _mk_date(day: int, month: int, year: int | None, ref: date) -> date | None:
    explicit_year = year is not None
    year = year or ref.year
    try:
        d = date(year, month, day)
    except ValueError:
        return None
    if not explicit_year and d < ref - timedelta(days=150):
        try:
            d = date(year + 1, month, day)
        except ValueError:
            return None
    if d.year < 2015 or d.year > ref.year + 3:
        return None
    return d


@dataclass
class DateMention:
    value: date
    start: int
    end: int
    context: str


def find_dates(text: str, ref: date | None = None) -> list[DateMention]:
    ref = ref or today()
    out: list[DateMention] = []
    for m in DATE_TEXT.finditer(text):
        day, mon, yr = int(m.group(1)), MONTHS.get(m.group(2).lower().rstrip(".")), m.group(3)
        if not mon:
            continue
        d = _mk_date(day, mon, int(yr) if yr else None, ref)
        if d:
            out.append(DateMention(d, m.start(), m.end(), text[max(0, m.start() - 70): m.start()]))
    for m in DATE_NUM.finditer(text):
        d = _mk_date(int(m.group(1)), int(m.group(2)), int(m.group(3)), ref)
        if d:
            out.append(DateMention(d, m.start(), m.end(), text[max(0, m.start() - 70): m.start()]))
    for m in DATE_ISO.finditer(text):
        try:
            d = date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
        except ValueError:
            continue
        out.append(DateMention(d, m.start(), m.end(), text[max(0, m.start() - 70): m.start()]))
    out.sort(key=lambda x: x.start)
    return out


def extract_dates(text: str, ref: date | None = None) -> dict:
    """Asigna fechas a roles (inicio, fin, sorteo) usando las palabras que las preceden."""
    ref = ref or today()
    mentions = find_dates(text, ref)
    result: dict[str, date | None] = {"start": None, "end": None, "draw": None}
    # Rangos explícitos: "del 1 de octubre al 31 de diciembre de 2026", "desde ... hasta ..."
    for i in range(len(mentions) - 1):
        a, b = mentions[i], mentions[i + 1]
        between = text[a.end: b.start]
        if len(between) <= 25 and re.search(r"\b(al|hasta|y el|-|a)\b", between, re.I):
            # Si el primer extremo no tenía año explícito, hereda el del segundo
            start_val = a.value
            if start_val > b.value and start_val.year > b.value.year:
                try:
                    start_val = start_val.replace(year=b.value.year)
                except ValueError:
                    pass
            if start_val <= b.value and (b.value - start_val).days <= 800:
                ctx = norm(a.context[-45:])
                if DRAW_CUES.search(ctx):
                    continue
                if result["start"] is None:
                    result["start"] = start_val
                if result["end"] is None or b.value > result["end"]:
                    result["end"] = b.value
    for m in mentions:
        ctx = m.context[-60:]
        if DRAW_CUES.search(ctx):
            if result["draw"] is None:
                result["draw"] = m.value
            continue
        tail = ctx[-30:]
        if END_CUES.search(tail) and not START_CUES.search(tail[-12:]):
            if result["end"] is None or (m.value > result["end"] and (m.value - ref).days < 500):
                result["end"] = m.value
        elif START_CUES.search(tail) and result["start"] is None:
            result["start"] = m.value
    if result["start"] and result["end"] and result["start"] > result["end"]:
        result["start"] = None
    return {k: (v.isoformat() if v else None) for k, v in result.items()}


def parse_money(raw_num: str, unit: str | None) -> int | None:
    num = raw_num.strip()
    unit = (unit or "").strip().lower()
    if re.fullmatch(r"\d{1,3}([.,]\d{3})+", num):
        value = float(re.sub(r"[.,]", "", num))
    else:
        try:
            value = float(num.replace(",", "."))
        except ValueError:
            return None
    if unit.startswith("mil millones"):
        value *= 1_000_000_000
    elif unit.startswith("mill") or unit == "m":
        value *= 1_000_000
    elif unit in ("mil", "k"):
        value *= 1_000
    if value < 1000 or value > 20_000_000_000:
        return None
    return int(value)


def extract_money(text: str) -> dict:
    """Devuelve el mayor valor monetario mencionado en contexto de premio/beneficio, y el umbral de compra si existe."""
    best: tuple[int, str] | None = None
    threshold: tuple[int, str] | None = None
    for m in MONEY.finditer(text):
        if m.group(1):
            value = parse_money(m.group(1), m.group(2))
        else:
            value = parse_money(m.group(3), m.group(4))
        if not value:
            continue
        before = text[max(0, m.start() - 70): m.start()]
        after = text[m.end(): m.end() + 40]
        label = clean_space(m.group(0))
        if THRESHOLD_CONTEXT.search(before[-40:]):
            if threshold is None or value < threshold[0]:
                threshold = (value, label)
            continue
        if PRIZE_CONTEXT.search(before) or PRIZE_CONTEXT.search(after[:25]):
            if best is None or value > best[0]:
                best = (value, label)
    return {
        "value_cop": best[0] if best else None,
        "value_text": best[1] if best else None,
        "purchase_threshold_cop": threshold[0] if threshold else None,
        "purchase_threshold_text": threshold[1] if threshold else None,
    }


@dataclass
class Extraction:
    dates: dict = field(default_factory=dict)
    money: dict = field(default_factory=dict)
    requires_purchase: bool | None = None
    purchase_evidence: str | None = None
    requires_registration: bool = False
    requires_social: bool = False
    requires_activity: bool = False
    requires_subscription: bool = False
    requires_deposit: bool = False
    has_fee: bool = False
    min_age: int | None = None
    age_text: str | None = None
    coverage: str = "desconocida"
    cities: list[str] = field(default_factory=list)
    winners: int | None = None
    odds_text: str | None = None
    requirements: list[str] = field(default_factory=list)
    documents: list[str] = field(default_factory=list)
    steps: list[str] = field(default_factory=list)
    program_status_hint: str | None = None
    discount_pct: int | None = None
    promo_code: str | None = None
    price_before: int | None = None
    price_now: int | None = None
    closed_signal: str | None = None
    withdrawn_signal: str | None = None


def extract(text: str, *, step_items: list[str] | None = None, requirement_items: list[str] | None = None,
            document_items: list[str] | None = None, ref: date | None = None) -> Extraction:
    ref = ref or today()
    t = text or ""
    low = t.lower()
    ex = Extraction()
    ex.dates = extract_dates(t, ref)
    ex.money = extract_money(t)

    no = _any(PURCHASE_NO, low)
    yes = _any(PURCHASE_YES, low)
    if no and not (yes and re.search(r"(descuento|%|2x1|tanque|factura)", yes)):
        ex.requires_purchase = False
        ex.purchase_evidence = no
    elif yes:
        ex.requires_purchase = True
        ex.purchase_evidence = yes
    ex.requires_subscription = bool(_any(SUBSCRIPTION, low))
    ex.requires_deposit = bool(_any(DEPOSIT, low))
    ex.has_fee = bool(_any(FEE, low))
    ex.requires_registration = bool(_any(REGISTRATION, low))
    ex.requires_social = bool(_any(SOCIAL, low))
    ex.requires_activity = bool(_any(ACTIVITY, low)) or ex.requires_social

    m = AGE.search(t)
    if m:
        ex.age_text = clean_space(m.group(0))
        nums = [int(x) for x in re.findall(r"\d{2}", m.group(0))]
        ex.min_age = nums[0] if nums else 18

    if COVERAGE_NATIONAL.search(t):
        ex.coverage = "nacional"
    found = []
    nt = norm(t)
    for city in CITIES:
        if re.search(rf"\b{re.escape(norm(city))}\b", nt):
            found.append(city)
    ex.cities = found[:8]
    if ex.coverage != "nacional":
        if found == ["Bogotá"] or (found and found[0] == "Bogotá" and len(found) <= 2):
            ex.coverage = "bogota"
        elif found:
            ex.coverage = "regional"
        elif any(re.search(rf"\b{re.escape(norm(d))}\b", nt) for d in DEPARTMENTS):
            ex.coverage = "regional"

    wm = WINNERS.search(t)
    if wm:
        raw = wm.group(1).lower()
        ex.winners = int(raw) if raw.isdigit() else WORD_NUM.get(raw)
        if wm.group(2).lower() in ("cupos", "bonos", "beneficiarios", "premios") and ex.winners and ex.winners > 100000:
            ex.winners = None
    om = ODDS.search(t)
    if om:
        ex.odds_text = truncate(om.group(1), 160)

    ex.requirements = [truncate(x, 220) for x in (requirement_items or [])][:8]
    if not ex.requirements:
        sentences = re.split(r"(?<=[.;:\n])\s+", t)
        reqs = []
        for s in sentences:
            s2 = clean_space(s)
            if 25 <= len(s2) <= 260 and REQ_SENTENCE.search(s2) and not re.search(r"(cookies|privacidad|tratamiento de datos)", s2, re.I):
                reqs.append(truncate(s2, 220))
            if len(reqs) >= 6:
                break
        ex.requirements = reqs

    docs = []
    doc_source = " ".join(document_items or []) + " " + low
    for label, pat in DOC_TYPES:
        if re.search(pat, doc_source, re.I):
            docs.append("Documento de identidad (cédula)" if label == "cédula" else label)
    ex.documents = docs[:8]

    ex.steps = [truncate(re.sub(r"^(paso\s*\d+\s*[:.-]?|\d{1,2}[.)-])\s*", "", s, flags=re.I), 240) for s in (step_items or [])][:10]
    ex.steps = [s for s in ex.steps if len(s) >= 6]

    if STATUS_WITHDRAWN.search(t):
        ex.withdrawn_signal = STATUS_WITHDRAWN.search(t).group(0)
    if STATUS_CLOSED.search(t):
        ex.closed_signal = STATUS_CLOSED.search(t).group(0)
    if STATUS_SOON.search(t):
        ex.program_status_hint = "proxima"
    elif STATUS_OPEN.search(t):
        ex.program_status_hint = "abierta"
    elif PERMANENT.search(t):
        ex.program_status_hint = "permanente"

    dm = DISCOUNT_PCT.search(t)
    if dm:
        pct = dm.group(1) or dm.group(5)
        try:
            ex.discount_pct = int(pct)
        except (TypeError, ValueError):
            ex.discount_pct = None
    cm = CODE.search(t)
    if cm and not cm.group(3).isdigit():
        ex.promo_code = cm.group(3)
    pb, pn = PRICE_BEFORE.search(t), PRICE_NOW.search(t)
    if pb and pn:
        b = parse_money(pb.group(3), None)
        n = parse_money(pn.group(3), None)
        if b and n and n < b:
            ex.price_before, ex.price_now = b, n
    return ex


# ------------------------------------------------------------------ relevancia
OPPORTUNITY_SIGNALS = re.compile(
    r"(sorteo|sortea|concurso|participa|gana(r|te)?\b|g[aá]nate|premio|bono|gratis|gratuit|regalo|obsequio|beneficio|subsidio|beca|convocatoria|"
    r"inscripci[oó]n|inscr[ií]bete|post[uú]late|descuento|promoci[oó]n|cashback|cup[oó]n|2x1|oferta|entrada libre|muestra|ayuda econ[oó]mica|"
    r"pago de|giro|estimulo|est[ií]mulo|cursos?|formaci[oó]n)",
    re.I,
)
NEGATIVE_SIGNALS = re.compile(
    r"(resultados? (del|de la|de los) (sorteo|loter[ií]a|chance)|n[uú]meros? ganador|n[uú]mero ganador|loter[ií]a de (bogot[aá]|medell[ií]n|boyac[aá]|cundinamarca|"
    r"santander|cruz roja|manizales|huila|valle|tolima|cauca|meta|risaralda|quind[ií]o)|baloto|miloto|colorloto|chance|super astro|dorado (ma[nñ]ana|tarde|noche)|"
    r"sinuano|culona|paisita|caf[eé]tero|pijao|la fant[aá]stica|extra de colombia|sorteo extraordinario|astro luna|astro sol|"
    r"capturad|homicidio|asesinad|accidente|muri[oó]|fallec|condenad|imputad|estafa|estafador|fraude|enga[nñ]o|falso sorteo|suplantaci[oó]n|"
    r"hor[oó]scopo|tarot|apuestas deportivas|casino|\bbet\b|cuotas de apuesta|pron[oó]stico deportivo|f[uú]tbol en vivo|marcador|goles|selecci[oó]n colombia vs|"
    r"impuesto (a|por) (la )?ganancia ocasional|declaraci[oó]n de renta|reforma tributaria|tasa de inter[eé]s del banco|d[oó]lar hoy|precio del d[oó]lar|"
    r"c[oó]mo reconocer|consejos para|tips para|evite caer|evita caer|qu[eé] es el black friday|recomendaciones para comprar)",
    re.I,
)
SCAM_ARTICLE = re.compile(r"(estafa|estafadores|fraude|falso|falsa|suplantaci[oó]n|alerta por|cuidado con|no caiga|enga[nñ]o)", re.I)


STRONG_BODY = re.compile(r"(inscripci[oó]n|inscr[ií]bete|post[uú]la|convocatoria abierta|fecha l[ií]mite|cierre de (la )?convocatoria|requisitos para|"
                         r"c[oó]mo participar|participa|aplica (aqu[ií]|hasta)|reg[ií]strate|t[eé]rminos y condiciones|vigencia|cupos)", re.I)


def relevance(title: str, text: str, require_title_signal: bool = False) -> tuple[float, list[str]]:
    """0..1 indicando si el contenido describe una oportunidad aprovechable (no una noticia general)."""
    reasons = []
    t_title = title or ""
    head = (t_title + " \n " + (text or "")[:4000])
    pos_title = len(OPPORTUNITY_SIGNALS.findall(t_title))
    pos_body = len(OPPORTUNITY_SIGNALS.findall(head))
    neg = NEGATIVE_SIGNALS.findall(head[:2500])
    score = min(1.0, 0.25 * pos_title + 0.04 * pos_body)
    if neg:
        score -= 0.35 * len(neg)
        reasons.append("señales negativas: " + ", ".join(sorted({n[0] if isinstance(n, tuple) else n for n in neg}))[:120])
    if SCAM_ARTICLE.search(t_title):
        score -= 0.6
        reasons.append("la noticia trata sobre una estafa o alerta")
    if re.search(r"(c[oó]mo participar|t[eé]rminos y condiciones|inscripciones|vigencia|requisitos|mec[aá]nica)", head, re.I):
        score += 0.2
    if require_title_signal and pos_title == 0 and len(STRONG_BODY.findall((text or "")[:3000])) < 2:
        score = min(score, 0.25)
        reasons.append("el título no describe una oportunidad (posible comunicado de prensa)")
    return max(0.0, min(1.0, score)), reasons
