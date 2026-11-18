"""Enriquecimiento OPCIONAL con Claude (solo si existe el secreto ANTHROPIC_API_KEY).

Extrae del texto de la fuente: si es una oportunidad real, requisitos, pasos, documentos, fechas y
traducción al español. Las instrucciones prohíben inventar: todo dato ausente vuelve como null / lista vacía.

Control de consumo: máximo LLM_MAX_ITEMS_PER_RUN llamadas por ejecución y caché por hash de contenido
(el mismo texto nunca se procesa dos veces). Modelo configurable con ANTHROPIC_MODEL."""
from __future__ import annotations

import json
import logging
import os

from .util import sha1

log = logging.getLogger("radar.llm")

DEFAULT_MODEL = "claude-opus-5-5"

SYSTEM = (
    "Eres un analista que extrae datos de promociones, concursos, bonos y programas públicos de Colombia. "
    "Responde SOLO con datos que aparezcan explícitamente en el texto de la fuente. Si un dato no aparece, usa null "
    "o una lista vacía; nunca lo deduzcas ni lo inventes. Los pasos deben reflejar instrucciones presentes en el texto, "
    "reformuladas en español claro y breve. Escribe todo en español de Colombia (traduce si la fuente está en otro idioma). "
    "Fechas en formato AAAA-MM-DD. Valores en pesos colombianos como número entero."
)

SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": [
        "is_opportunity", "reason", "title_es", "summary_es", "prize_es", "value_cop", "organizer", "requires_purchase",
        "purchase_condition_es", "requires_registration", "requires_social", "requires_activity", "requires_deposit_or_payment",
        "who_can_participate_es", "min_age", "coverage", "cities", "requirements_es", "documents_es", "steps_es",
        "start_date", "end_date", "draw_date", "winners", "odds_es", "asks_sensitive_financial_data", "original_language",
    ],
    "properties": {
        "is_opportunity": {"type": "boolean", "description": "true solo si describe una promoción, concurso, beneficio, subsidio, beca o convocatoria a la que una persona puede acceder"},
        "reason": {"type": "string"},
        "title_es": {"type": "string"},
        "summary_es": {"type": "string", "description": "máximo 2 frases"},
        "prize_es": {"type": ["string", "null"]},
        "value_cop": {"type": ["integer", "null"]},
        "organizer": {"type": ["string", "null"]},
        "requires_purchase": {"type": ["boolean", "null"]},
        "purchase_condition_es": {"type": ["string", "null"]},
        "requires_registration": {"type": ["boolean", "null"]},
        "requires_social": {"type": ["boolean", "null"]},
        "requires_activity": {"type": ["boolean", "null"]},
        "requires_deposit_or_payment": {"type": ["boolean", "null"]},
        "who_can_participate_es": {"type": ["string", "null"]},
        "min_age": {"type": ["integer", "null"]},
        "coverage": {"type": "string", "enum": ["nacional", "bogota", "regional", "internacional", "desconocida"]},
        "cities": {"type": "array", "items": {"type": "string"}},
        "requirements_es": {"type": "array", "items": {"type": "string"}},
        "documents_es": {"type": "array", "items": {"type": "string"}},
        "steps_es": {"type": "array", "items": {"type": "string"}},
        "start_date": {"type": ["string", "null"]},
        "end_date": {"type": ["string", "null"]},
        "draw_date": {"type": ["string", "null"]},
        "winners": {"type": ["integer", "null"]},
        "odds_es": {"type": ["string", "null"]},
        "asks_sensitive_financial_data": {"type": "boolean"},
        "original_language": {"type": "string"},
    },
}


class Enricher:
    def __init__(self, cache: dict):
        self.cache = cache
        self.enabled = bool(os.environ.get("ANTHROPIC_API_KEY"))
        self.model = os.environ.get("ANTHROPIC_MODEL", DEFAULT_MODEL)
        try:
            self.max_calls = int(os.environ.get("LLM_MAX_ITEMS_PER_RUN", "12"))
        except ValueError:
            self.max_calls = 12
        self.calls = 0
        self.errors = 0
        self.input_tokens = 0
        self.output_tokens = 0
        self._client = None
        if self.enabled:
            try:
                import anthropic

                self._anthropic = anthropic
                self._client = anthropic.Anthropic(max_retries=2, timeout=90.0)
            except Exception as exc:  # noqa: BLE001
                log.warning("No se pudo iniciar el cliente de Anthropic: %s", exc)
                self.enabled = False

    def summary(self) -> dict:
        return {"enabled": self.enabled, "model": self.model if self.enabled else None, "calls": self.calls,
                "errors": self.errors, "input_tokens": self.input_tokens, "output_tokens": self.output_tokens}

    def enrich(self, *, url: str, title: str, text: str) -> dict | None:
        if not self.enabled or not text:
            return None
        body = text[:14000]
        key = sha1(url + "\n" + body)
        if key in self.cache:
            return self.cache[key].get("data")
        if self.calls >= self.max_calls:
            return None
        self.calls += 1
        a = self._anthropic
        try:
            response = self._client.beta.messages.create(
                model=self.model,
                max_tokens=4000,
                system=SYSTEM,
                betas=["server-side-fallback-2026-07-01"],
                fallbacks="default",
                output_config={"effort": "low", "format": {"type": "json_schema", "schema": SCHEMA}},
                messages=[{
                    "role": "user",
                    "content": f"URL: {url}\nTÍTULO: {title}\n\nTEXTO DE LA FUENTE:\n<<<\n{body}\n>>>",
                }],
            )
        except a.RateLimitError as exc:
            self.errors += 1
            log.warning("Límite de la API de Claude: %s", exc)
            self.max_calls = self.calls  # no insistir en esta ejecución
            return None
        except a.APIStatusError as exc:
            self.errors += 1
            log.warning("Error de la API de Claude (%s): %s", exc.status_code, str(exc)[:200])
            return None
        except a.APIConnectionError as exc:
            self.errors += 1
            log.warning("Conexión con la API de Claude fallida: %s", exc)
            return None
        usage = getattr(response, "usage", None)
        if usage is not None:
            self.input_tokens += getattr(usage, "input_tokens", 0) or 0
            self.output_tokens += getattr(usage, "output_tokens", 0) or 0
        if response.stop_reason in ("refusal", "max_tokens"):
            self.cache[key] = {"data": None, "reason": response.stop_reason}
            return None
        text_out = next((b.text for b in response.content if getattr(b, "type", "") == "text"), "")
        try:
            data = json.loads(text_out)
        except json.JSONDecodeError:
            self.errors += 1
            return None
        self.cache[key] = {"data": data, "model": self.model}
        return data
