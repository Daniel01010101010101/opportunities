import { useMemo, useState, type ReactNode } from 'react'
import { LayoutGrid, List, SearchX, SlidersHorizontal } from 'lucide-react'
import { OpportunityCard, OpportunityRow } from './OpportunityCard'
import { EmptyState, Segmented } from './ui'
import { categoryById, icon } from '@/lib/taxonomy'
import { cn, daysUntil } from '@/lib/format'
import { usePersonal } from '@/lib/personal'
import type { Opportunity } from '@/lib/types'

export type SortKey = 'prioridad' | 'valor' | 'facil' | 'vencen' | 'recientes'

export const SORTS: { value: SortKey; label: string }[] = [
  { value: 'prioridad', label: 'Mayor prioridad' },
  { value: 'valor', label: 'Mayor valor económico' },
  { value: 'facil', label: 'Más fáciles de reclamar' },
  { value: 'vencen', label: 'Vencen pronto' },
  { value: 'recientes', label: 'Recién publicadas' },
]

const ease = (o: Opportunity) => o.priority?.breakdown?.facilidad?.points ?? 0

export function sortOps(items: Opportunity[], key: SortKey): Opportunity[] {
  const arr = [...items]
  const p = (o: Opportunity) => o.priority?.score ?? 0
  switch (key) {
    case 'valor':
      return arr.sort((a, b) => (b.prize?.value_cop ?? -1) - (a.prize?.value_cop ?? -1) || p(b) - p(a))
    case 'facil':
      return arr.sort((a, b) => ease(b) - ease(a) || Number(b.cost?.free) - Number(a.cost?.free) || p(b) - p(a))
    case 'vencen':
      return arr.sort((a, b) => (daysUntil(a.dates?.end) ?? 9999) - (daysUntil(b.dates?.end) ?? 9999) || p(b) - p(a))
    case 'recientes':
      return arr.sort((a, b) => (b.discovered_at || '').localeCompare(a.discovered_at || ''))
    default:
      return arr.sort((a, b) => p(b) - p(a))
  }
}

export interface ExplorerProps {
  items: Opportunity[]
  categories?: { id: string; label: string; icon: string }[]
  defaultSort?: SortKey
  forceFree?: boolean
  emptyHint?: ReactNode
  extraFilters?: ReactNode
}

export function Explorer({ items, categories, defaultSort = 'prioridad', forceFree, emptyHint, extraFilters }: ExplorerProps) {
  const personal = usePersonal()
  const [cat, setCat] = useState<string>('')
  const [sort, setSort] = useState<SortKey>(defaultSort)
  const [onlyFree, setOnlyFree] = useState(Boolean(forceFree))
  const [where, setWhere] = useState<'todas' | 'bogota' | 'nacional'>('todas')
  const [verifiedOnly, setVerifiedOnly] = useState(false)
  const [level, setLevel] = useState<'' | 'alta' | 'media' | 'baja'>('')
  const [showExpired, setShowExpired] = useState(false)
  const [showDiscarded, setShowDiscarded] = useState(false)
  const [text, setText] = useState('')
  const [limit, setLimit] = useState(24)
  const view = personal.data.prefs.view

  const filtered = useMemo(() => {
    const t = text.trim().toLowerCase()
    const out = items.filter((o) => {
      if (!showExpired && (o.status === 'vencida' || o.status === 'retirada')) return false
      if (!showDiscarded && personal.get(o.id)?.status === 'descartado') return false
      if (cat && o.category !== cat) return false
      if ((onlyFree || forceFree) && !o.cost?.free) return false
      if (where === 'bogota' && !['bogota', 'nacional'].includes(o.eligibility?.coverage)) return false
      if (where === 'nacional' && o.eligibility?.coverage !== 'nacional') return false
      if (verifiedOnly && o.verification?.status !== 'verificada') return false
      if (level && o.priority?.level !== level) return false
      if (t && !`${o.title} ${o.summary} ${o.organizer?.name}`.toLowerCase().includes(t)) return false
      return true
    })
    return sortOps(out, sort)
  }, [items, cat, sort, onlyFree, forceFree, where, verifiedOnly, level, showExpired, showDiscarded, text, personal])

  const catCounts = useMemo(() => {
    const m = new Map<string, number>()
    items.forEach((o) => {
      if (o.status !== 'vencida' && o.status !== 'retirada') m.set(o.category, (m.get(o.category) ?? 0) + 1)
    })
    return m
  }, [items])

  return (
    <div>
      {categories && categories.length > 0 && (
        <div className="-mx-1 mb-4 flex gap-2 overflow-x-auto px-1 pb-1">
          <button onClick={() => setCat('')} className={cn('chip shrink-0', !cat && 'chip-on')}>Todas</button>
          {categories.map((c) => {
            const Icon = icon(c.icon)
            const n = catCounts.get(c.id) ?? 0
            return (
              <button key={c.id} onClick={() => setCat(cat === c.id ? '' : c.id)} className={cn('chip shrink-0', cat === c.id && 'chip-on', n === 0 && 'opacity-50')}>
                <Icon className="h-3.5 w-3.5" aria-hidden /> {c.label}
                <span className="tabular-nums text-muted">{n}</span>
              </button>
            )
          })}
        </div>
      )}

      <div className="card mb-5 flex flex-wrap items-center gap-2 p-3">
        <SlidersHorizontal className="ml-1 h-4 w-4 text-muted" aria-hidden />
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Filtrar por texto…" className="input h-9 w-full max-w-[220px] py-1.5" aria-label="Filtrar por texto" />
        <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} className="input h-9 w-auto py-1.5" aria-label="Ordenar">
          {SORTS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
        {!forceFree && (
          <button onClick={() => setOnlyFree(!onlyFree)} className={cn('chip', onlyFree && 'chip-on')} aria-pressed={onlyFree}>Solo 100% gratis</button>
        )}
        <Segmented
          value={where}
          onChange={setWhere}
          options={[
            { value: 'todas', label: 'Todo' },
            { value: 'bogota', label: 'Disponibles en Bogotá', title: 'Bogotá o toda Colombia' },
            { value: 'nacional', label: 'Toda Colombia' },
          ]}
        />
        <button onClick={() => setVerifiedOnly(!verifiedOnly)} className={cn('chip', verifiedOnly && 'chip-on')} aria-pressed={verifiedOnly}>Solo verificadas</button>
        <select value={level} onChange={(e) => setLevel(e.target.value as typeof level)} className="input h-9 w-auto py-1.5" aria-label="Prioridad">
          <option value="">Toda prioridad</option>
          <option value="alta">Prioridad alta</option>
          <option value="media">Prioridad media</option>
          <option value="baja">Prioridad baja</option>
        </select>
        {extraFilters}
        <div className="ml-auto flex items-center gap-2">
          <button onClick={() => setShowExpired(!showExpired)} className={cn('chip', showExpired && 'chip-on')} aria-pressed={showExpired}>Incluir vencidas</button>
          <button onClick={() => setShowDiscarded(!showDiscarded)} className={cn('chip', showDiscarded && 'chip-on')} aria-pressed={showDiscarded}>Incluir descartadas</button>
          <Segmented
            value={view}
            onChange={(v) => personal.setPrefs({ view: v })}
            options={[
              { value: 'grid', label: <LayoutGrid className="h-4 w-4" aria-label="Tarjetas" />, title: 'Vista de tarjetas' },
              { value: 'list', label: <List className="h-4 w-4" aria-label="Lista" />, title: 'Vista de lista' },
            ]}
          />
        </div>
      </div>

      <div className="mb-3 text-xs text-muted">
        {filtered.length} resultado(s){cat && ` en ${categoryById[cat]?.label ?? cat}`}
      </div>

      {filtered.length === 0 ? (
        <EmptyState icon={SearchX} title="No hay oportunidades con estos filtros">
          {emptyHint ?? 'Prueba quitando filtros. El radar busca nuevas oportunidades automáticamente cada 2 horas.'}
        </EmptyState>
      ) : view === 'grid' ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {filtered.slice(0, limit).map((o, i) => <OpportunityCard key={o.id} op={o} index={i} />)}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {filtered.slice(0, limit).map((o) => <OpportunityRow key={o.id} op={o} />)}
        </div>
      )}
      {filtered.length > limit && (
        <div className="mt-6 flex justify-center">
          <button className="btn-ghost" onClick={() => setLimit(limit + 24)}>Ver más ({filtered.length - limit} restantes)</button>
        </div>
      )}
    </div>
  )
}
