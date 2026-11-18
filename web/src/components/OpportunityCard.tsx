import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ArrowUpRight, Heart, MapPin, Building2 } from 'lucide-react'
import { CostBadge, DeadlineBadge, RiskBadge, ScoreRing, VerificationBadge } from './badges'
import { categoryById, icon, mechanicsMeta, sectionById } from '@/lib/taxonomy'
import { coverageLabel, cn, copShort } from '@/lib/format'
import { usePersonal, TRACK_LABELS } from '@/lib/personal'
import type { Opportunity } from '@/lib/types'

export function useOpenDetail() {
  const [params, setParams] = useSearchParams()
  return (id: string) => {
    const next = new URLSearchParams(params)
    next.set('op', id)
    setParams(next)
  }
}

export function OppImage({ op, className }: { op: Opportunity; className?: string }) {
  const [failed, setFailed] = useState(false)
  const Icon = icon(categoryById[op.category]?.icon || sectionById[op.section]?.icon)
  if (op.urls?.image && !failed) {
    return (
      <img
        src={op.urls.image}
        alt=""
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
        className={cn('h-full w-full object-cover', className)}
      />
    )
  }
  return (
    <div className={cn('grid h-full w-full place-items-center bg-gradient-to-br from-brand/20 via-surface2 to-bg', className)}>
      <Icon className="h-9 w-9 text-brand/80" aria-hidden />
    </div>
  )
}

const valueText = (op: Opportunity) => {
  if (op.prize?.value_cop) return copShort(op.prize.value_cop)
  if (op.offer?.discount_pct) return `-${op.offer.discount_pct}%`
  return null
}

const shortReqs = (op: Opportunity) => {
  const r: string[] = []
  if (op.cost?.requires_registration) r.push('Registro')
  if (op.cost?.requires_social) r.push('Redes sociales')
  else if (op.cost?.requires_activity) r.push('Actividad')
  if (op.cost?.requires_purchase) r.push('Compra')
  if (op.eligibility?.min_age) r.push(`+${op.eligibility.min_age} años`)
  if (op.documents?.length) r.push(`${op.documents.length} documento(s)`)
  return r
}

export function OpportunityCard({ op, index = 0 }: { op: Opportunity; index?: number }) {
  const open = useOpenDetail()
  const personal = usePersonal()
  const tracked = personal.get(op.id)
  const cat = categoryById[op.category]
  const value = valueText(op)
  const reqs = shortReqs(op)
  return (
    <article
      className="card card-hover group flex flex-col overflow-hidden animate-fade-up"
      style={{ animationDelay: `${Math.min(index, 12) * 30}ms` }}
    >
      <button onClick={() => open(op.id)} className="relative h-36 w-full overflow-hidden text-left" aria-label={`Ver detalles: ${op.title}`}>
        <OppImage op={op} className="transition duration-500 group-hover:scale-[1.03]" />
        <div className="absolute inset-0 bg-gradient-to-t from-surface via-surface/20 to-transparent" />
        <div className="absolute left-3 top-3 flex flex-wrap gap-1.5">
          <span className="rounded-full bg-black/60 px-2 py-0.5 text-[11px] font-medium text-ink backdrop-blur">{cat?.label ?? op.kind}</span>
          {tracked?.status && <span className="rounded-full bg-brand/90 px-2 py-0.5 text-[11px] font-semibold text-[#04110B]">{TRACK_LABELS[tracked.status]}</span>}
        </div>
        {value && (
          <div className="absolute bottom-2 left-3 rounded-lg bg-black/60 px-2 py-0.5 font-display text-sm font-semibold text-brand backdrop-blur">
            {value}
          </div>
        )}
      </button>
      <div className="flex flex-1 flex-col gap-3 p-4">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <h3 className="line-clamp-2 font-display text-[15px] font-semibold leading-snug text-ink">
              <button onClick={() => open(op.id)} className="text-left hover:text-brand">{op.title}</button>
            </h3>
            <p className="mt-1 flex items-center gap-1 truncate text-xs text-muted">
              <Building2 className="h-3 w-3 shrink-0" aria-hidden />
              <span className="truncate">{op.organizer?.name}</span>
            </p>
          </div>
          <ScoreRing score={op.priority?.score ?? 0} level={op.priority?.level ?? 'baja'} />
        </div>
        {(op.prize?.description || op.summary) && (
          <p className="line-clamp-2 text-[13px] leading-relaxed text-ink/75">{op.prize?.description || op.summary}</p>
        )}
        <div className="flex flex-wrap gap-1.5">
          <CostBadge op={op} />
          <VerificationBadge op={op} />
          <RiskBadge op={op} />
          {(op.mechanics ?? []).filter((m) => m !== 'compra' && m !== 'sorteo').slice(0, 2).map((m) => {
            const Icon = icon(mechanicsMeta[m]?.icon)
            return (
              <span key={m} className="inline-flex items-center gap-1 rounded-full border border-info/40 bg-info/10 px-2 py-0.5 text-[11px] font-medium text-info">
                <Icon className="h-3 w-3" aria-hidden /> {mechanicsMeta[m]?.label ?? m}
              </span>
            )
          })}
        </div>
        <div className="mt-auto flex items-center justify-between gap-2 border-t border-line/60 pt-3 text-xs text-muted">
          <div className="flex min-w-0 flex-col gap-1">
            <DeadlineBadge op={op} />
            <span className="flex items-center gap-1 truncate">
              <MapPin className="h-3 w-3 shrink-0" aria-hidden />
              {coverageLabel[op.eligibility?.coverage ?? 'desconocida']}
              {reqs.length > 0 && <span className="truncate"> · {reqs.join(' · ')}</span>}
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <button
              onClick={() => personal.toggleFavorite(op)}
              className={cn('btn-quiet rounded-full p-2', tracked?.favorite && 'text-brand')}
              aria-label={tracked?.favorite ? 'Quitar de favoritas' : 'Guardar en favoritas'}
              title={tracked?.favorite ? 'Quitar de favoritas' : 'Guardar en favoritas'}
            >
              <Heart className={cn('h-4 w-4', tracked?.favorite && 'fill-brand')} />
            </button>
            <button onClick={() => open(op.id)} className="btn-ghost px-3 py-1.5 text-xs">
              Ver detalles <ArrowUpRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>
    </article>
  )
}

export function OpportunityRow({ op }: { op: Opportunity }) {
  const open = useOpenDetail()
  const personal = usePersonal()
  const tracked = personal.get(op.id)
  const value = valueText(op)
  return (
    <div className="card card-hover flex items-center gap-3 p-3 animate-fade-up">
      <button onClick={() => open(op.id)} className="h-14 w-14 shrink-0 overflow-hidden rounded-xl" aria-label={`Ver detalles: ${op.title}`}>
        <OppImage op={op} />
      </button>
      <div className="min-w-0 flex-1">
        <button onClick={() => open(op.id)} className="block w-full truncate text-left font-display text-sm font-semibold text-ink hover:text-brand">
          {op.title}
        </button>
        <div className="mt-0.5 truncate text-xs text-muted">
          {op.organizer?.name} · {categoryById[op.category]?.label ?? op.kind} · {coverageLabel[op.eligibility?.coverage ?? 'desconocida']}
        </div>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          <CostBadge op={op} />
          <VerificationBadge op={op} />
          <DeadlineBadge op={op} />
          <RiskBadge op={op} />
        </div>
      </div>
      {value && <div className="hidden w-24 text-right font-display text-sm font-semibold text-brand sm:block">{value}</div>}
      <button
        onClick={() => personal.toggleFavorite(op)}
        className={cn('btn-quiet hidden rounded-full p-2 sm:inline-flex', tracked?.favorite && 'text-brand')}
        aria-label={tracked?.favorite ? 'Quitar de favoritas' : 'Guardar en favoritas'}
      >
        <Heart className={cn('h-4 w-4', tracked?.favorite && 'fill-brand')} />
      </button>
      <ScoreRing score={op.priority?.score ?? 0} level={op.priority?.level ?? 'baja'} size={40} />
    </div>
  )
}
