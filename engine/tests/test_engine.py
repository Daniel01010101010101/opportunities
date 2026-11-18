from datetime import date
from pathlib import Path

import pytest

from radar.classify import Registry, Taxonomy, cost_type
from radar.dedupe import DedupIndex, same_opportunity
from radar.extract import extract, extract_dates, extract_money, relevance
from radar.parse import parse_html
from radar.score import score
from radar.util import canonical_url, next_scheduled_run, registrable_domain
from radar.verify import risk_assessment, verification_status

CONFIG = Path(__file__).resolve().parents[2] / "config"
REF = date(2026, 11, 18)


@pytest.fixture(scope="module")
def registry():
    return Registry(CONFIG)


@pytest.fixture(scope="module")
def taxonomy():
    return Taxonomy(CONFIG)


def test_spanish_date_range():
    d = extract_dates("La promoción estará vigente del 1 de noviembre al 31 de diciembre de 2026.", REF)
    assert d["start"] == "2026-11-01"
    assert d["end"] == "2026-12-31"


def test_end_and_draw_dates():
    text = "Podrás participar hasta el 15 de diciembre de 2026. El sorteo se realizará el 20 de diciembre de 2026."
    d = extract_dates(text, REF)
    assert d["end"] == "2026-12-15"
    assert d["draw"] == "2026-12-20"


def test_numeric_dates_colombian_format():
    d = extract_dates("Inscripciones abiertas desde el 01/12/2026 hasta el 30/01/2027", REF)
    assert d["start"] == "2026-12-01"
    assert d["end"] == "2027-01-30"


def test_money_prize_vs_purchase_threshold():
    m = extract_money("Por compras superiores a $50.000 participa por un bono de $1.000.000 en gasolina")
    assert m["value_cop"] == 1_000_000
    assert m["purchase_threshold_cop"] == 50_000


def test_money_millions():
    m = extract_money("Gana un premio de 20 millones de pesos")
    assert m["value_cop"] == 20_000_000


def test_purchase_detection():
    assert extract("Por tus compras con tarjeta participa en el sorteo").requires_purchase is True
    ex = extract("Participación gratuita: no se requiere compra. Regístrate en la página y responde la trivia.")
    assert ex.requires_purchase is False
    assert ex.requires_registration and ex.requires_activity


def test_cost_type_never_free_with_purchase():
    ex = extract("Gratis: por compras superiores a $30.000 recibe un bono")
    ctype, _, _ = cost_type(ex, "bonos", True)
    assert ctype == "requiere_compra"


def test_cost_type_unknown_for_news_without_signals():
    ex = extract("La marca anunció una nueva campaña para sus clientes.")
    ctype, cert, _ = cost_type(ex, "concursos", False)
    assert ctype == "desconocido" and cert == "desconocido"


def test_relevance_filters_lottery_results():
    rel, _ = relevance("Resultados del sorteo de la Lotería de Bogotá: número ganador", "")
    assert rel < 0.2
    rel2, _ = relevance("Terpel lanza concurso: participa y gana un carro", "Términos y condiciones. Cómo participar.")
    assert rel2 >= 0.3


def test_steps_from_html():
    html = """<html><body><article><h1>Gana con Primax</h1><h3>¿Cómo participar?</h3>
    <ol><li>Ingresa a la página oficial</li><li>Regístrate con tus datos</li><li>Responde la trivia</li></ol>
    <a href="/terminos.pdf">Términos y condiciones</a></article></body></html>"""
    doc = parse_html(html, "https://www.primax.com.co/gana")
    assert doc.step_items == ["Ingresa a la página oficial", "Regístrate con tus datos", "Responde la trivia"]
    ex = extract(doc.text, step_items=doc.step_items)
    assert len(ex.steps) == 3


def test_canonical_url_removes_tracking():
    a = canonical_url("https://www.terpel.com/promo/?utm_source=x&utm_campaign=y#top")
    b = canonical_url("http://terpel.com/promo")
    assert a == b


def test_registrable_domain_colombia():
    assert registrable_domain("web.icetex.gov.co") == "icetex.gov.co"
    assert registrable_domain("www.primax.com.co") == "primax.com.co"


def test_organizer_lookup(registry):
    assert registry.by_domain("https://www.terpel.com/x").name == "Terpel"
    assert registry.is_gov("https://web.icetex.gov.co/es/becas")
    names = [o.name for o in registry.mentioned("Nequi y Bancolombia lanzan promoción")]
    assert "Nequi" in names and "Bancolombia" in names


def test_impersonation_detected(registry):
    terpel = registry.by_name("Terpel")
    risk = risk_assessment(registry, text="Reclama tu bono Terpel, paga el envío para recibir el premio",
                           urls=["https://terpel-bonos-gratis.xyz/reclamar"], organizer=terpel, mentioned=[terpel], source_is_news=False)
    codes = {f["code"] for f in risk["flags"]}
    assert "posible_suplantacion" in codes and "pago_oculto" in codes
    assert risk["level"] == "alto"


def test_financial_data_warning(registry):
    risk = risk_assessment(registry, text="Ingresa el número de tu tarjeta y el código OTP para ganar", urls=["https://ejemplo.com"],
                           organizer=None, mentioned=[], source_is_news=False)
    assert risk["sensitive_data_warning"] is True


def test_verification_states():
    st, _ = verification_status(end_date="2020-01-01", withdrawn=False, closed=False, link_ok=True, official_domain=True,
                                terms_found=True, section="concursos", organizer_known=True, has_dates=True, risk_level="bajo",
                                source_official=True, program_status="activa")
    assert st == "vencida"
    st, _ = verification_status(end_date="2099-01-01", withdrawn=False, closed=False, link_ok=True, official_domain=True,
                                terms_found=True, section="concursos", organizer_known=True, has_dates=True, risk_level="bajo",
                                source_official=False, program_status="activa")
    assert st == "verificada"
    st, _ = verification_status(end_date=None, withdrawn=False, closed=False, link_ok=None, official_domain=False,
                                terms_found=False, section="concursos", organizer_known=False, has_dates=False, risk_level="bajo",
                                source_official=False, program_status="sin_confirmar")
    assert st == "no_verificable"


def test_classification(taxonomy, registry):
    sec, cat, _ = taxonomy.classify(title="Participa y gana una moto AKT con Terpel", text="Sorteo de una moto 0 km", organizer=registry.by_name("Terpel"),
                                    url="https://terpel.com", hints={}, requires_purchase=None, discount_pct=None, is_gov=False)
    assert sec == "concursos" and cat == "motos"
    sec, cat, _ = taxonomy.classify(title="ICETEX abre convocatoria de becas", text="Inscripciones abiertas para becas de posgrado",
                                    organizer=registry.by_name("ICETEX"), url="https://web.icetex.gov.co", hints={}, requires_purchase=None,
                                    discount_pct=None, is_gov=True)
    assert sec == "estado" and cat == "becas"


def _op(**kw):
    base = {"title": "Gana un bono de gasolina", "section": "concursos", "category": "gasolina", "status": "activa",
            "prize": {"value_cop": 100000}, "cost": {"type": "gratis_registro", "requires_registration": True},
            "eligibility": {"coverage": "nacional"}, "verification": {"status": "verificada"}, "risk": {"level": "bajo"},
            "urls": {"terms": "https://x/t.pdf", "participate": "https://x/p"}, "dates": {"end": "2099-12-31"}, "steps": ["a", "b"],
            "organizer": {"name": "Terpel"}, "sources": [{"url": "https://x/p"}]}
    base.update(kw)
    return base


def test_score_free_verified_is_high():
    s = score(_op())
    assert s["level"] == "alta" and 0 <= s["score"] <= 100


def test_score_purchase_never_high():
    s = score(_op(cost={"type": "requiere_compra"}))
    assert s["level"] != "alta"


def test_score_risky_capped():
    s = score(_op(risk={"level": "alto"}))
    assert s["score"] <= 20


def test_dedupe_same_promo_different_news():
    a = _op(title="Terpel sortea 10 bonos de gasolina de $100.000", sources=[{"url": "https://eltiempo.com/a"}], urls={})
    b = _op(title="Terpel sortea bonos de gasolina de $100.000: así puede participar", sources=[{"url": "https://semana.com/b"}], urls={})
    assert same_opportunity(a, b)
    idx = DedupIndex([a])
    assert idx.find(b) is a


def test_next_scheduled_run_is_minute_17_on_even_utc_hour():
    nxt = next_scheduled_run()
    assert nxt.minute == 17
    from datetime import timezone

    assert nxt.astimezone(timezone.utc).hour % 2 == 0
