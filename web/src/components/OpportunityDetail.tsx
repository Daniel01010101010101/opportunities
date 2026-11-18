import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  AlertTriangle, ArrowUpRight, BadgeCheck, Building2, CalendarDays, CheckCircle2, Circle, ClipboardList, FileText, Gift, Heart,
  HelpCircle, Info, Link2, ListChecks, MapPin, NotebookPen, Plus, ShieldAlert, Trash2, Trophy, Users, Wallet, History,
} from 'lucide-react'
import { CostBadge, DeadlineBadge, PriorityLabel, RiskBadge, ScoreRing, VerificationBadge } from './badges'
import { OppImage } from './OpportunityCard'
import { Badge, Sheet } from './ui'
import { useData } from '@/lib/data'
import { TRACK_LABELS, usePersonal, type TrackStatus } from '@/lib/personal'
import { categoryById, costTypes, mechanicsMeta } from '@/lib/taxonomy'
import { ago, cn, cop, coverageLabel, fmtDateTime, fmtDay, hostOf, programStatusLabel, statusLabel } from '@/lib/format'
import type { Opportunity } from '@/lib/types'

const NOT_INFORMED = 'No informado por la fuente'

function Q({ n, title, icon: Icon, children }: { n: number; title: string; icon: typeof Gift; children: React.ReactNode }) {
  return (
    <section className="card p-4">
      <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-ink">
        <span className="grid h-6 w-6 place-items-center rounded-lg bg-brand/10 text-[11px] font-bold text-brand">{n}</span>
        <Icon className="h-4 w-4 text-brand" aria-hidden />
        {title}
      </h3>
      <div className="text-sm leading-relaxed text-ink/85">{children}</div>
    </section>
  )
}

const Missing = ({ children = NOT_INFORMED }: { children?: React.ReactNode }) => (
  <span className="inline-flex items-center gap-1.5 text-muted"><HelpCircle className="h-3.5 w-3.5" aria-hidden />{children}</span>
)

export function DetailHost() {
  const [params, setParams] = useSearchParams()
  const id = params.get('op')
  const { byId, loadArchive, loading } = useData()
  const [archived, setArchived] = useState<Opportunity | null>(null)
  const op = (id && byId.get(id)) || (archived?.id === id ? archived : null)

  useEffect(() => {
    if (id && !loading && !byId.get(id)) {
      loadArchive().then((items) => setArchived(items.find((x) => x.id === id) ?? null)).catch(() => setArchived(null))
    }
  }, [id, byId, loading, loadArchive])

  const close = () => {
    const next = new URLSearchParams(params)
    next.delete('op')
    setParams(next)
  }
  return (
    <Sheet open={Boolean(id)} onClose={close} label="Detalle de la oportunidad">
      {op ? <Detail op={op} /> : (
        <div className="p-8 text-sm text-muted">{loading ? 'Cargando…' : 'Esta oportunidad ya no está en la base de datos (puede haber sido archivada).'}</div>
      )}
    </Sheet>
  )
}

function Detail({ op }: { op: Opportunity }) {
  const personal = usePersonal()
  const tracked = personal.get(op.id)
  const [newStep, setNewStep] = useState('')
  const [notes, setNotes] = useState(tracked?.notes ?? '')
  useEffect(() => setNotes(tracked?.notes ?? ''), [op.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const participate = op.urls?.participate || op.urls?.official
  const steps = op.steps ?? []
  const free = op.cost?.free
  const risky = op.risk?.level === 'alto'

  return (
    <div className="pb-16">
      <div className="relative h-52 w-full overflow-hidden sm:h-60">
        <OppImage op={op} />
        <div className="absolute inset-0 bg-gradient-to-t from-bg via-bg/50 to-transparent" />
        <div className="absolute bottom-4 left-5 right-5">
          <div className="mb-2 flex flex-wrap gap-1.5">
            <Badge tone="neutral">{categoryById[op.category]?.label ?? op.kind}</Badge>
            <VerificationBadge op={op} />
            <CostBadge op={op} />
            <DeadlineBadge op={op} />
            <RiskBadge op={op} />
          </div>
          <h2 className="h-display text-xl leading-tight text-ink sm:text-2xl">{op.title}</h2>
          <p className="mt-1 flex items-center gap-1.5 text-sm text-muted">
            <Building2 className="h-4 w-4" aria-hidden /> {op.organizer?.name}
            {op.organizer?.domain && <span className="text-muted/70">· {op.organizer.domain}</span>}
          </p>
        </div>
      </div>

      <div className="space-y-4 px-5 pt-4">
        {risky && (
          <div className="rounded-xl border border-danger/40 bg-danger/10 p-3 text-sm text-danger">
            <div className="flex items-center gap-2 font-semibold"><ShieldAlert className="h-4 w-4" /> Señales de posible estafa: no se recomienda</div>
            <ul className="mt-1 list-disc pl-6 text-danger/90">{op.risk.flags.map((f) => <li key={f.code}>{f.label}</li>)}</ul>
          </div>
        )}
        {!risky && op.risk?.sensitive_data_warning && (
          <div className="rounded-xl border border-warn/40 bg-warn/10 p-3 text-sm text-warn">
            <div className="flex items-center gap-2 font-semibold"><AlertTriangle className="h-4 w-4" /> Esta actividad solicita información personal sensible</div>
            <p className="mt-1 text-warn/90">Compártela solo en el sitio oficial del organizador. Nunca entregues contraseñas, códigos OTP ni datos completos de tarjetas.</p>
          </div>
        )}
        {!risky && op.risk?.flags?.length > 0 && op.risk.level !== 'bajo' && (
          <div className="rounded-xl border border-warn/40 bg-warn/10 p-3 text-sm text-warn">
            <div className="flex items-center gap-2 font-semibold"><AlertTriangle className="h-4 w-4" /> Revisa con cuidado</div>
            <ul className="mt-1 list-disc pl-6">{op.risk.flags.map((f) => <li key={f.code}>{f.label}</li>)}</ul>
          </div>
        )}

        {/* Acciones principales */}
        <div className="flex flex-wrap gap-2">
          {participate ? (
            <a href={participate} target="_blank" rel="noopener noreferrer nofollow" className={cn(risky ? 'btn-ghost' : 'btn-primary')}>
              Ir a participar <ArrowUpRight className="h-4 w-4" />
            </a>
          ) : (
            <a href={op.urls.source} target="_blank" rel="noopener noreferrer nofollow" className="btn-primary">
              Ver fuente <ArrowUpRight className="h-4 w-4" />
            </a>
          )}
          {op.urls?.terms ? (
            <a href={op.urls.terms} target="_blank" rel="noopener noreferrer nofollow" className="btn-ghost">
              <FileText className="h-4 w-4" /> Términos y condiciones
            </a>
          ) : (
            <span className="btn-ghost cursor-default opacity-60" title="La fuente no enlaza términos y condiciones">
              <FileText className="h-4 w-4" /> Términos no enlazados
            </span>
          )}
          <button onClick={() => personal.toggleFavorite(op)} className={cn('btn-ghost', tracked?.favorite && 'border-brand/50 text-brand')}>
            <Heart className={cn('h-4 w-4', tracked?.favorite && 'fill-brand')} /> {tracked?.favorite ? 'En favoritas' : 'Favorita'}
          </button>
        </div>
        <p className="text-xs text-muted">
          Visitar el enlace no te inscribe automáticamente. Marca tú mismo el estado de tu participación más abajo.
        </p>

        {/* Las 8 preguntas */}
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <Q n={1} title="¿Qué puedo ganar u obtener?" icon={Trophy}>
            <p>{op.prize?.description || op.summary || <Missing />}</p>
            {op.prize?.winners ? <p className="mt-1 text-muted">Ganadores/cupos publicados: <b className="text-ink">{op.prize.winners}</b></p> : null}
            {op.prize?.odds_text && <p className="mt-1 text-muted">Probabilidad publicada: {op.prize.odds_text}</p>}
          </Q>
          <Q n={2} title="¿Cuánto vale?" icon={Wallet}>
            {op.prize?.value_cop ? (
              <>
                <p className="font-display text-xl font-semibold text-brand">{cop(op.prize.value_cop)}</p>
                <p className="text-xs text-muted">Según {op.prize.value_source === 'pagina_oficial' ? 'la página oficial' : 'una noticia (confírmalo en la fuente oficial)'}{op.prize.value_text ? `: «${op.prize.value_text}»` : ''}.</p>
              </>
            ) : op.offer?.discount_pct ? (
              <>
                <p className="font-display text-xl font-semibold text-brand">{op.offer.discount_pct}% de descuento</p>
                {op.offer.original_price && op.offer.promo_price ? (
                  <p className="text-xs text-muted">Antes {cop(op.offer.original_price)} → ahora {cop(op.offer.promo_price)} (porcentaje calculado con ambos precios)</p>
                ) : <p className="text-xs text-muted">Porcentaje tomado del texto de la fuente; precios no verificables.</p>}
                {op.offer.code && <p className="mt-1">Código: <code className="rounded bg-surface2 px-1.5 py-0.5 text-brand">{op.offer.code}</code></p>}
              </>
            ) : <Missing>Valor no publicado por una fuente confiable</Missing>}
          </Q>
          <Q n={3} title="¿Es gratis?" icon={Gift}>
            <div className="flex items-center gap-2">
              <CostBadge op={op} />
              {op.cost?.certainty === 'inferido' && <span className="text-xs text-muted">(inferido)</span>}
            </div>
            <p className="mt-1.5 text-xs text-muted">{costTypes[op.cost?.type]?.description}</p>
            {op.cost?.notes?.length > 0 && <ul className="mt-1.5 list-disc space-y-0.5 pl-5 text-[13px]">{op.cost.notes.map((n) => <li key={n}>{n}</li>)}</ul>}
            {!free && op.cost?.type !== 'desconocido' && <p className="mt-1.5 text-xs text-warn">No se presenta como gratuita porque exige una condición económica.</p>}
          </Q>
          <Q n={4} title="¿Quién puede participar?" icon={Users}>
            {op.eligibility?.who ? <p>{op.eligibility.who}</p> : null}
            <ul className="space-y-0.5">
              <li><MapPin className="mr-1 inline h-3.5 w-3.5 text-muted" />{coverageLabel[op.eligibility?.coverage ?? 'desconocida']}{op.eligibility?.cities?.filter((c) => !(op.eligibility.coverage === 'bogota' && c === 'Bogotá')).length ? ` · ${op.eligibility.cities.filter((c) => !(op.eligibility.coverage === 'bogota' && c === 'Bogotá')).join(', ')}` : ''}</li>
              <li>Edad: {op.eligibility?.min_age ? `${op.eligibility.min_age}+ años` : op.eligibility?.age_text || <Missing />}</li>
            </ul>
            {op.section === 'estado' && <p className="mt-1.5 text-xs text-muted">Nadie es beneficiario automáticamente: verifica los criterios de elegibilidad en la entidad.</p>}
          </Q>
          <Q n={5} title="¿Qué necesito?" icon={ClipboardList}>
            {op.requirements?.length ? (
              <ul className="list-disc space-y-1 pl-5">{op.requirements.map((r) => <li key={r}>{r}</li>)}</ul>
            ) : <Missing>Requisitos no detallados en la fuente</Missing>}
            <div className="mt-2 flex flex-wrap gap-1.5">
              {op.cost?.requires_registration && <Badge>Registro</Badge>}
              {op.cost?.requires_social && <Badge>Seguir/comentar en redes</Badge>}
              {op.cost?.requires_activity && !op.cost?.requires_social && <Badge>Actividad (trivia, reto, puntos)</Badge>}
              {op.cost?.requires_purchase && <Badge tone="warn">Compra</Badge>}
              {op.cost?.requires_subscription && <Badge tone="warn">Suscripción</Badge>}
              {op.cost?.requires_deposit && <Badge tone="warn">Depósito / saldo</Badge>}
              {(op.mechanics ?? []).map((m) => <Badge key={m} tone="info">{mechanicsMeta[m]?.label ?? m}</Badge>)}
            </div>
            {op.documents?.length > 0 && (
              <p className="mt-2 text-[13px]"><b>Documentos mencionados:</b> {op.documents.join(', ')}</p>
            )}
          </Q>
          <Q n={7} title="¿Hasta cuándo tengo tiempo?" icon={CalendarDays}>
            <ul className="space-y-0.5">
              <li>Estado: <b className="text-ink">{op.gov?.program_status ? programStatusLabel[op.gov.program_status] : statusLabel[op.status]}</b></li>
              <li>Inicio: {op.dates?.start ? fmtDay(op.dates.start) : <Missing />}</li>
              <li>Cierre: {op.dates?.end ? <b className="text-ink">{fmtDay(op.dates.end)}</b> : <Missing />}</li>
              {op.dates?.draw && <li>Fecha del sorteo: <b className="text-ink">{fmtDay(op.dates.draw)}</b></li>}
            </ul>
          </Q>
        </div>

        <Q n={6} title="¿Cómo participo? (tu checklist)" icon={ListChecks}>
          {steps.length > 0 ? (
            <>
              <p className="mb-2 text-xs text-muted">
                Pasos tomados de {op.steps_source === 'pagina_oficial' ? 'la página oficial' : op.steps_source === 'ia_desde_texto_oficial' ? 'el texto oficial (resumidos con IA, sin agregar pasos)' : 'una fuente secundaria (confírmalos en la página oficial)'}.
                Marca los que vayas completando.
              </p>
              <ol className="space-y-1.5">
                {steps.map((s, i) => {
                  const key = `s${i}`
                  const done = tracked?.checklist?.[key]
                  return (
                    <li key={key}>
                      <button onClick={() => personal.toggleStep(op, key)} className="flex w-full items-start gap-2 rounded-lg p-1.5 text-left hover:bg-surface2">
                        {done ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-brand" /> : <Circle className="mt-0.5 h-4 w-4 shrink-0 text-muted" />}
                        <span className={cn(done && 'text-muted line-through')}><b className="text-brand">Paso {i + 1}:</b> {s}</span>
                      </button>
                    </li>
                  )
                })}
              </ol>
            </>
          ) : (
            <div className="rounded-lg border border-line bg-surface2/50 p-3">
              <p className="flex items-center gap-1.5 font-medium text-ink"><Info className="h-4 w-4 text-info" /> La fuente no publica pasos detallados.</p>
              <p className="mt-1 text-xs text-muted">Recomendación general (no son pasos oficiales): abre el enlace oficial, lee los términos y condiciones completos, confirma fechas y requisitos, y guarda el comprobante de tu inscripción.</p>
            </div>
          )}
          {/* pasos propios */}
          {tracked?.customSteps?.length ? (
            <ul className="mt-3 space-y-1">
              {tracked.customSteps.map((s, i) => {
                const key = `c${i}`
                const done = tracked.checklist?.[key]
                return (
                  <li key={key} className="flex items-center gap-2">
                    <button onClick={() => personal.toggleStep(op, key)} className="flex flex-1 items-start gap-2 rounded-lg p-1.5 text-left hover:bg-surface2">
                      {done ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-brand" /> : <Circle className="mt-0.5 h-4 w-4 shrink-0 text-muted" />}
                      <span className={cn(done && 'text-muted line-through')}>{s}</span>
                    </button>
                    <button onClick={() => personal.removeCustomStep(op, i)} className="btn-quiet rounded-full p-1.5" aria-label="Eliminar paso"><Trash2 className="h-3.5 w-3.5" /></button>
                  </li>
                )
              })}
            </ul>
          ) : null}
          <form
            className="mt-3 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              if (newStep.trim()) {
                personal.addCustomStep(op, newStep.trim())
                setNewStep('')
              }
            }}
          >
            <input value={newStep} onChange={(e) => setNewStep(e.target.value)} placeholder="Agregar un paso propio a tu checklist…" className="input h-9 py-1.5" />
            <button className="btn-ghost h-9 px-3" type="submit" aria-label="Agregar paso"><Plus className="h-4 w-4" /></button>
          </form>
        </Q>

        <Q n={8} title="¿Dónde participo?" icon={Link2}>
          <ul className="space-y-1.5 break-all text-[13px]">
            <li><b>Participación:</b> {participate ? <a className="text-brand hover:underline" href={participate} target="_blank" rel="noopener noreferrer nofollow">{participate}</a> : <Missing>Sin enlace oficial de participación identificado</Missing>}</li>
            <li><b>Términos:</b> {op.urls?.terms ? <a className="text-brand hover:underline" href={op.urls.terms} target="_blank" rel="noopener noreferrer nofollow">{op.urls.terms}</a> : <Missing>No enlazados</Missing>}</li>
            <li><b>Fuente original:</b> <a className="text-brand hover:underline" href={op.urls.source} target="_blank" rel="noopener noreferrer nofollow">{hostOf(op.urls.source)}</a></li>
          </ul>
        </Q>

        {/* Seguimiento personal */}
        <section className="card p-4">
          <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold"><NotebookPen className="h-4 w-4 text-brand" /> Mi seguimiento</h3>
          <div className="flex flex-wrap gap-2">
            {(Object.keys(TRACK_LABELS) as TrackStatus[]).map((s) => (
              <button key={s} onClick={() => personal.setStatus(op, tracked?.status === s ? null : s)} className={cn('chip', tracked?.status === s && 'chip-on')}>
                {TRACK_LABELS[s]}
              </button>
            ))}
          </div>
          {tracked?.status === 'ganado' && (
            <input
              className="input mt-3"
              placeholder="¿Qué ganaste? (ej.: bono de $100.000)"
              defaultValue={tracked.prizeWon ?? ''}
              onBlur={(e) => personal.setPrizeWon(op, e.target.value)}
            />
          )}
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            onBlur={() => personal.setNotes(op, notes)}
            placeholder="Notas personales (se guardan solo en este navegador)…"
            className="input mt-3 min-h-[80px]"
          />
          <p className="mt-1 text-[11px] text-muted">No escribas contraseñas, números de tarjeta ni códigos de verificación.</p>
        </section>

        {/* Verificación y prioridad */}
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <section className="card p-4">
            <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold"><BadgeCheck className="h-4 w-4 text-brand" /> Verificación</h3>
            <div className="mb-2"><VerificationBadge op={op} /></div>
            <ul className="list-disc space-y-0.5 pl-5 text-[13px] text-ink/80">{op.verification?.reasons?.map((r) => <li key={r}>{r}</li>)}</ul>
            <p className="mt-2 text-xs text-muted">Última verificación: {fmtDateTime(op.last_verified)} ({ago(op.last_verified)})</p>
            <p className="text-xs text-muted">Descubierta: {fmtDateTime(op.discovered_at)} · Extracción: {op.extraction?.method === 'heuristica' ? 'automática por reglas' : 'reglas + IA'}</p>
          </section>
          <section className="card p-4">
            <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold">Prioridad de revisión</h3>
            <div className="mb-2 flex items-center gap-3">
              <ScoreRing score={op.priority.score} level={op.priority.level} size={52} />
              <div>
                <PriorityLabel level={op.priority.level} />
                <p className="mt-1 text-[11px] text-muted">Indica qué revisar primero. No es la probabilidad de ganar.</p>
              </div>
            </div>
            <ul className="space-y-1">
              {Object.entries(op.priority.breakdown).map(([k, v]) => (
                <li key={k} className="text-[12px]">
                  <div className="flex justify-between"><span className="capitalize text-ink/85">{k}</span><span className="tabular-nums text-muted">{v.points}/{v.max}</span></div>
                  <div className="mt-0.5 h-1.5 overflow-hidden rounded-full bg-surface2">
                    <div className="h-full rounded-full bg-brand-600" style={{ width: `${(v.points / v.max) * 100}%` }} />
                  </div>
                </li>
              ))}
            </ul>
          </section>
        </div>

        {(op.sources?.length > 1 || op.history?.length > 0) && (
          <section className="card p-4">
            <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold"><History className="h-4 w-4 text-brand" /> Fuentes e historial</h3>
            <ul className="space-y-1 text-[13px]">
              {op.sources.map((s) => (
                <li key={s.url} className="truncate">
                  <a href={s.url} target="_blank" rel="noopener noreferrer nofollow" className="text-brand hover:underline">{hostOf(s.url)}</a>
                  <span className="text-muted"> · {s.name} · {fmtDateTime(s.seen_at)}</span>
                </li>
              ))}
            </ul>
            {op.history?.length > 0 && (
              <ul className="mt-3 space-y-1 border-t border-line pt-3 text-[12px] text-muted">
                {[...op.history].reverse().slice(0, 10).map((h, i) => (
                  <li key={i}>{fmtDateTime(h.at)} · {h.label}: <span className="text-ink/70">{String(h.from ?? '—')}</span> → <span className="text-ink">{String(h.to ?? '—')}</span></li>
                ))}
              </ul>
            )}
          </section>
        )}
      </div>
    </div>
  )
}
