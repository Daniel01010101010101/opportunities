import { useMemo } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  Activity, ArrowRight, BadgeCheck, CalendarClock, Flame, Gift, Hourglass, Landmark, Percent, Radar as RadarIcon, Sparkles, Trophy, Wallet, Zap,
} from 'lucide-react'
import { OpportunityCard, OpportunityRow } from '@/components/OpportunityCard'
import { BarsByCategory, RunsChart } from '@/components/Charts'
import { EmptyState, SectionTitle, Skeleton, StatTile } from '@/components/ui'
import { useData } from '@/lib/data'
import { usePersonal } from '@/lib/personal'
import { categoryById, sections } from '@/lib/taxonomy'
import { ago, daysUntil, fmtDateTime, fmtTime, nextScheduledRun } from '@/lib/format'
import { EXAMPLE_QUERIES } from '@/lib/search'
import type { Opportunity } from '@/lib/types'

const isActive = (o: Opportunity) => o.status !== 'vencida' && o.status !== 'retirada'

/** Destacadas: mayor valor, gratuitas, vigentes, verificadas y sin riesgo; máximo 3 por sección para dar variedad. */
function featured(items: Opportunity[]) {
  const pool = items
    .filter((o) => isActive(o) && o.cost?.free && o.risk?.level !== 'alto' && ['verificada', 'pendiente'].includes(o.verification?.status))
    .sort((a, b) => b.priority.score - a.priority.score)
  const per: Record<string, number> = {}
  const out: Opportunity[] = []
  for (const o of pool) {
    if ((per[o.section] ?? 0) >= 3) continue
    per[o.section] = (per[o.section] ?? 0) + 1
    out.push(o)
    if (out.length >= 6) break
  }
  return out
}

export default function RadarPage() {
  const { items, status, runs, loading } = useData()
  const personal = usePersonal()
  const navigate = useNavigate()
  const active = useMemo(() => items.filter(isActive), [items])
  const top = useMemo(() => featured(items), [items])
  const latest = useMemo(() => [...active].sort((a, b) => b.discovered_at.localeCompare(a.discovered_at)).slice(0, 6), [active])
  const ending = useMemo(
    () => active.filter((o) => { const d = daysUntil(o.dates?.end); return d != null && d >= 0 && d <= 10 }).sort((a, b) => (daysUntil(a.dates.end) ?? 0) - (daysUntil(b.dates.end) ?? 0)).slice(0, 6),
    [active],
  )
  const contests = useMemo(
    () => active.filter((o) => o.section === 'concursos' && o.risk?.level !== 'alto').sort((a, b) => b.priority.score - a.priority.score).slice(0, 6),
    [active],
  )
  const freeOnes = useMemo(() => active.filter((o) => o.cost?.free && o.risk?.level !== 'alto').sort((a, b) => b.priority.score - a.priority.score).slice(0, 6), [active])
  const valuable = useMemo(() => active.filter((o) => o.prize?.value_cop).sort((a, b) => (b.prize.value_cop ?? 0) - (a.prize.value_cop ?? 0)).slice(0, 6), [active])
  const sinceLast = useMemo(
    () => (personal.previousVisit ? active.filter((o) => o.discovered_at > personal.previousVisit!).length : null),
    [active, personal.previousVisit],
  )
  const byCategory = useMemo(() => {
    const m = new Map<string, number>()
    active.forEach((o) => m.set(o.category, (m.get(o.category) ?? 0) + 1))
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([id, value]) => ({ label: categoryById[id]?.label ?? id, value }))
  }, [active])

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-28" />
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-24" />)}</div>
      </div>
    )
  }

  const c = status?.counts
  const prizes = active.filter((o) => o.section === 'concursos').length
  return (
    <div className="space-y-8">
      {/* Héroe */}
      <section className="card relative overflow-hidden p-6 animate-fade-up">
        <div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full border border-brand/15" />
        <div className="pointer-events-none absolute -right-12 -top-12 h-48 w-48 rounded-full border border-brand/20" />
        <div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 overflow-hidden rounded-full"><div className="radar-sweep h-full w-full animate-sweep opacity-60" /></div>
        <div className="relative flex flex-wrap items-end justify-between gap-6">
          <div className="max-w-2xl">
            <div className="label flex items-center gap-2 text-brand"><RadarIcon className="h-3.5 w-3.5" /> Radar general</div>
            <h1 className="h-display mt-2 text-3xl leading-tight sm:text-4xl">
              {c ? <><span className="text-brand">{c.active}</span> oportunidades activas en Colombia</> : 'Radar de oportunidades en Colombia'}
            </h1>
            <p className="mt-2 text-sm text-muted">
              {status ? (
                <>Última actualización {fmtDateTime(status.generated_at)} ({ago(status.generated_at)}) · próxima búsqueda automática a las {fmtTime(nextScheduledRun(status.schedule.next_run_at).at)} (hora de Bogotá). {status.message}</>
              ) : 'Aún no hay ejecuciones publicadas del motor de búsqueda.'}
            </p>
            {sinceLast != null && sinceLast > 0 && (
              <p className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-brand/10 px-3 py-1 text-xs font-medium text-brand">
                <Zap className="h-3.5 w-3.5" /> {sinceLast} nuevas desde tu última visita
              </p>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {EXAMPLE_QUERIES.slice(0, 4).map((q) => (
              <button key={q} onClick={() => navigate(`/buscar?q=${encodeURIComponent(q)}`)} className="chip">{q}</button>
            ))}
          </div>
        </div>
      </section>

      {/* Indicadores */}
      <section className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatTile label="Total encontradas" value={c?.total ?? 0} hint={`${c?.active ?? 0} activas`} icon={RadarIcon} accent />
        <StatTile label="Nuevas 24 h" value={c?.new_24h ?? 0} hint="descubiertas hoy" icon={Zap} onClick={() => navigate('/buscar?q=&sort=recientes')} />
        <StatTile label="Concursos activos" value={prizes} hint="premios disponibles" icon={Trophy} onClick={() => navigate('/concursos')} />
        <StatTile label="Bonos gratis" value={c?.by_section?.bonos ?? 0} hint={`${c?.free ?? 0} gratuitas en total`} icon={Gift} onClick={() => navigate('/bonos')} />
        <StatTile label="Ofertas" value={c?.by_section?.ofertas ?? 0} hint="descuentos y promociones" icon={Percent} onClick={() => navigate('/ofertas')} />
        <StatTile label="Del Estado" value={c?.by_section?.estado ?? 0} hint="subsidios y convocatorias" icon={Landmark} onClick={() => navigate('/estado')} />
        <StatTile label="Vencen pronto" value={c?.expiring_7d ?? 0} hint="en los próximos 7 días" icon={Hourglass} onClick={() => navigate('/calendario')} />
        <StatTile label="Verificadas" value={c?.verified ?? 0} hint={`${c?.pending ?? 0} pendientes`} icon={BadgeCheck} onClick={() => navigate('/monitoreo')} />
        <StatTile label="Prioridad alta" value={c?.by_priority?.alta ?? 0} hint={`${c?.by_priority?.media ?? 0} media · ${c?.by_priority?.baja ?? 0} baja`} icon={Flame} />
        <StatTile label="Fuentes activas" value={status?.sources.ok_last_run ?? 0} hint={`${status?.sources.configured ?? 0} configuradas · ${status?.sources.discovered ?? 0} descubiertas`} icon={Sparkles} onClick={() => navigate('/monitoreo')} />
        <StatTile label="Próxima búsqueda" value={status ? fmtTime(nextScheduledRun(status.schedule.next_run_at).at) : '—'} hint={status && nextScheduledRun(status.schedule.next_run_at).overdue ? 'el turno anterior no se ejecutó' : 'automática cada 2 h'} icon={CalendarClock} />
        <StatTile label="Estado del motor" value={status ? ({ ok: 'Activo', sin_novedades: 'Sin novedades', parcial: 'Parcial', error: 'Con error', sin_fuentes_pendientes: 'Activo' } as Record<string, string>)[status.last_run.status] : '—'} hint={status ? `${status.last_run.sources_ok}/${status.last_run.sources_checked} fuentes OK` : 'sin datos'} icon={Activity} onClick={() => navigate('/monitoreo')} />
      </section>

      {/* Destacadas */}
      <section>
        <SectionTitle
          title="Oportunidades destacadas"
          subtitle="Gratuitas, vigentes, con fuente confiable y mayor prioridad. Variedad de máximo 3 por sección."
          icon={Flame}
          action={<Link to="/sin-comprar" className="btn-quiet">Ver todas las gratis <ArrowRight className="h-4 w-4" /></Link>}
        />
        {top.length ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">{top.map((o, i) => <OpportunityCard key={o.id} op={o} index={i} />)}</div>
        ) : (
          <EmptyState icon={Flame} title="Aún no hay oportunidades destacadas">Cuando el motor encuentre oportunidades gratuitas y verificadas aparecerán aquí.</EmptyState>
        )}
      </section>

      <section>
        <SectionTitle
          title="Concursos y sorteos activos"
          subtitle="Premios, retos, concursos gamer y creativos encontrados en medios y páginas oficiales"
          icon={Trophy}
          action={<Link to="/concursos" className="btn-quiet">Ver todos <ArrowRight className="h-4 w-4" /></Link>}
        />
        {contests.length ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">{contests.map((o, i) => <OpportunityCard key={o.id} op={o} index={i} />)}</div>
        ) : (
          <EmptyState icon={Trophy} title="No hay concursos activos en este momento">El radar revisa más de 200 fuentes en rotación cada 2 horas.</EmptyState>
        )}
      </section>

      <section className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <div>
          <SectionTitle title="Por finalizar" subtitle="Vencen en los próximos 10 días" icon={Hourglass} action={<Link to="/calendario" className="btn-quiet">Calendario <ArrowRight className="h-4 w-4" /></Link>} />
          <div className="flex flex-col gap-2">{ending.length ? ending.map((o) => <OpportunityRow key={o.id} op={o} />) : <EmptyState title="Nada vence en los próximos 10 días" />}</div>
        </div>
        <div>
          <SectionTitle title="Últimas encontradas" subtitle="Lo más reciente del radar" icon={Zap} />
          <div className="flex flex-col gap-2">{latest.length ? latest.map((o) => <OpportunityRow key={o.id} op={o} />) : <EmptyState title="Sin oportunidades todavía" />}</div>
        </div>
        <div>
          <SectionTitle title="Participación gratuita" subtitle="Sin compras, depósitos ni suscripciones" icon={Gift} action={<Link to="/sin-comprar" className="btn-quiet">Sin comprar <ArrowRight className="h-4 w-4" /></Link>} />
          <div className="flex flex-col gap-2">{freeOnes.length ? freeOnes.map((o) => <OpportunityRow key={o.id} op={o} />) : <EmptyState title="Sin oportunidades gratuitas por ahora" />}</div>
        </div>
        <div>
          <SectionTitle title="Mayor beneficio económico" subtitle="Solo con valor publicado en la fuente" icon={Wallet} />
          <div className="flex flex-col gap-2">{valuable.length ? valuable.map((o) => <OpportunityRow key={o.id} op={o} />) : <EmptyState title="Ninguna fuente publicó valores todavía" />}</div>
        </div>
      </section>

      <section className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <div className="card p-4">
          <SectionTitle title="Oportunidades activas por categoría" subtitle="Top 8 categorías" />
          {byCategory.length ? <BarsByCategory data={byCategory} height={260} /> : <p className="text-sm text-muted">Sin datos.</p>}
        </div>
        <div className="card p-4">
          <SectionTitle title="Descubrimientos por ejecución" subtitle="Últimas 30 ejecuciones del motor" />
          {runs.length ? <RunsChart runs={runs} height={260} /> : <p className="text-sm text-muted">Sin ejecuciones registradas.</p>}
        </div>
      </section>

      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {sections.map((s) => (
          <Link key={s.id} to={`/${s.id}`} className="card card-hover p-4">
            <div className="label">{s.short}</div>
            <div className="mt-1 font-display text-sm text-ink">{s.label}</div>
            <div className="mt-1 text-xs text-muted">{s.description}</div>
          </Link>
        ))}
      </section>
    </div>
  )
}
