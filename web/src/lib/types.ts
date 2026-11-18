// Tipos que reflejan exactamente los JSON generados por el motor (engine/radar/pipeline.py)

export type SectionId = 'concursos' | 'bonos' | 'ofertas' | 'estado'
export type CostType =
  | 'gratis'
  | 'gratis_registro'
  | 'gratis_actividad'
  | 'requiere_compra'
  | 'requiere_suscripcion'
  | 'requiere_condiciones'
  | 'desconocido'
export type VerificationStatus = 'verificada' | 'pendiente' | 'no_verificable' | 'vencida' | 'retirada'
export type OpStatus = 'activa' | 'proxima' | 'permanente' | 'vencida' | 'retirada' | 'sin_confirmar'
export type Coverage = 'nacional' | 'bogota' | 'regional' | 'internacional' | 'desconocida'
export type PriorityLevel = 'alta' | 'media' | 'baja'

export interface RiskFlag { code: string; label: string; level: 'bajo' | 'medio' | 'alto' }

export interface Opportunity {
  id: string
  title: string
  summary: string
  section: SectionId
  category: string
  tags: string[]
  mechanics?: string[]
  kind: string
  organizer: { name: string; type: string; domain: string | null; known: boolean }
  prize: {
    description: string | null
    value_cop: number | null
    value_text: string | null
    value_source: 'pagina_oficial' | 'noticia' | null
    winners: number | null
    odds_text: string | null
  }
  cost: {
    type: CostType
    label: string
    free: boolean
    certainty: 'explicito' | 'inferido' | 'desconocido'
    requires_purchase: boolean | null
    requires_registration: boolean
    requires_social: boolean
    requires_activity: boolean
    requires_subscription: boolean
    requires_deposit: boolean
    purchase_threshold_text: string | null
    notes: string[]
  }
  eligibility: { who: string | null; min_age: number | null; age_text: string | null; coverage: Coverage; cities: string[] }
  requirements: string[]
  documents: string[]
  steps: string[]
  steps_source: 'pagina_oficial' | 'fuente_secundaria' | 'ia_desde_texto_oficial' | null
  dates: { published: string | null; start: string | null; end: string | null; draw: string | null }
  status: OpStatus
  gov: { program_status: 'abierta' | 'proxima' | 'permanente' | 'cerrada' | 'sin_confirmar' | null; entity: string } | null
  offer: { discount_pct: number | null; original_price: number | null; promo_price: number | null; code: string | null; pct_verified: boolean } | null
  verification: {
    status: VerificationStatus
    reasons: string[]
    checked_at: string
    link_ok: boolean | null
    official_domain: boolean
    terms_found: boolean
    link_failures?: number
  }
  risk: { level: 'bajo' | 'medio' | 'alto'; flags: RiskFlag[]; sensitive_data_warning: boolean }
  urls: { source: string; participate: string | null; terms: string | null; official: string | null; image: string | null }
  sources: { url: string; name: string; type: string; seen_at: string }[]
  language: string
  translated: boolean
  extraction: { method: string; relevance: number; model: string | null }
  discovered_at: string
  updated_at: string
  last_verified: string
  last_seen: string
  history: { at: string; field: string; label: string; from: unknown; to: unknown }[]
  priority: {
    score: number
    level: PriorityLevel
    breakdown: Record<string, { points: number; max: number; note: string }>
  }
}

export interface RunRecord {
  id: string
  started_at: string
  finished_at: string
  duration_s: number
  trigger: string
  category: string | null
  query: string | null
  status: 'ok' | 'sin_novedades' | 'parcial' | 'error' | 'sin_fuentes_pendientes'
  sources_checked: number
  sources_ok: number
  sources_failed: { id: string; error: string }[]
  sources_skipped: { id: string; reason: string }[]
  new: number
  updated: number
  unchanged: number
  discarded: number
  discard_reasons: Record<string, number>
  expired: number
  reverified: number
  archived: number
  http_requests: number
  robots_blocked: number
  errors: string[]
  llm: { enabled: boolean; model: string | null; calls: number; errors: number }
  alerts: Record<string, unknown>
  git_sha: string | null
  run_url: string | null
}

export interface EngineStatus {
  engine_version: string
  generated_at: string
  timezone: string
  schedule: { cron_utc: string; description: string; next_run_at: string }
  last_run: Pick<RunRecord, 'id' | 'started_at' | 'finished_at' | 'duration_s' | 'status' | 'trigger' | 'new' | 'updated' | 'discarded' | 'sources_checked' | 'sources_ok' | 'run_url'>
  last_success_at: string | null
  last_new_opportunity_at: string | null
  sources: { configured: number; checked_last_run: number; ok_last_run: number; failed_last_run: number; discovered: number; with_errors: number }
  counts: {
    total: number
    active: number
    new_24h: number
    verified: number
    pending: number
    unverifiable: number
    expired: number
    withdrawn: number
    archived: number
    by_section: Record<SectionId, number>
    by_priority: Record<PriorityLevel, number>
    free: number
    expiring_7d: number
  }
  llm: { enabled: boolean; model: string | null }
  alerts_configured: { telegram: boolean; email: boolean }
  message: string
}

export interface SourceInfo {
  id: string
  name: string
  type: string
  url: string | null
  query?: string | null
  trust: string
  origin: 'configurada' | 'descubierta' | 'manual'
  every_hours?: number
  organizer?: string | null
  last_run_at?: string
  last_ok_at?: string
  last_status?: 'ok' | 'error' | 'omitida'
  last_error?: string | null
  last_items?: number
  last_ms?: number
  consecutive_failures?: number
  total_items?: number
  total_new?: number
  new_last_run?: number
  first_seen?: string
}

export interface ChangeRecord { at: string; field: string; label: string; from: unknown; to: unknown; id: string; title: string }

export interface TaxSection { id: SectionId; label: string; short: string; icon: string; description: string }
export interface TaxCategory { id: string; section: SectionId; label: string; icon: string }
