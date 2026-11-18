import { Fragment, useMemo, useState } from 'react'
import { Activity, AlertTriangle, CheckCircle2, ChevronDown, Database, ExternalLink, Globe, History, Loader2, XCircle } from 'lucide-react'
import { DurationChart, RunsChart } from '@/components/Charts'
import { eventLabel, RunStatusIcon, useWorkflowRuns } from '@/components/Research'
import { useEngineHealth } from '@/components/EngineBanner'
import { Badge, EmptyState, PageHeader, SectionTitle, StatTile } from '@/components/ui'
import { useData } from '@/lib/data'
import { ago, cn, fmtDateTime, fmtTime, hostOf } from '@/lib/format'
import { workflowUrl } from '@/lib/github'
import type { RunRecord, SourceInfo } from '@/lib/types'

const RUN_STATUS: Record<string, { label: string; tone: 'brand' | 'warn' | 'danger' | 'muted' | 'info' }> = {
  ok: { label: 'Completada', tone: 'brand' },
  sin_novedades: { label: 'Sin novedades', tone: 'info' },
  parcial: { label: 'Parcial', tone: 'warn' },
  error: { label: 'Error', tone: 'danger' },
  sin_fuentes_pendientes: { label: 'Solo mantenimiento', tone: 'muted' },
}
const TRIGGER: Record<string, string> = { schedule: 'Programada', manual: 'Manual', push: 'Despliegue', retry: 'Reintento', local: 'Local' }
const TYPE: Record<string, string> = { bing_news: 'Noticias (Bing)', gdelt: 'GDELT', rss: 'RSS oficial', page_links: 'Página oficial', news_feed: 'Feed de medio', wp_search: 'Búsqueda en medio', google_cse: 'Google CSE', brave: 'Brave Search', descubierta: 'Descubierta' }

function RunRow({ r }: { r: RunRecord }) {
  const [open, setOpen] = useState(false)
  const st = RUN_STATUS[r.status] ?? { label: r.status, tone: 'muted' as const }
  return (
    <Fragment>
      <tr className="border-b border-line/60 hover:bg-surface2/50">
        <td className="whitespace-nowrap px-3 py-2">{fmtDateTime(r.started_at)}</td>
        <td className="px-3 py-2">{TRIGGER[r.trigger] ?? r.trigger}{r.category ? ` · ${r.category}` : ''}{r.query ? ` · «${r.query}»` : ''}</td>
        <td className="px-3 py-2 tabular-nums">{r.sources_ok}/{r.sources_checked}</td>
        <td className="px-3 py-2 tabular-nums text-brand">{r.new}</td>
        <td className="px-3 py-2 tabular-nums">{r.updated}</td>
        <td className="px-3 py-2 tabular-nums text-muted">{r.discarded}</td>
        <td className="px-3 py-2 tabular-nums">{r.errors.length}</td>
        <td className="px-3 py-2 tabular-nums">{Math.round(r.duration_s)} s</td>
        <td className="px-3 py-2"><Badge tone={st.tone}>{st.label}</Badge></td>
        <td className="px-3 py-2 text-right">
          <button onClick={() => setOpen(!open)} className="btn-quiet p-1" aria-label="Ver detalle"><ChevronDown className={cn('h-4 w-4 transition', open && 'rotate-180')} /></button>
        </td>
      </tr>
      {open && (
        <tr className="border-b border-line/60 bg-surface2/40">
          <td colSpan={10} className="px-4 py-3 text-xs text-muted">
            <div className="grid gap-3 md:grid-cols-3">
              <div>
                <div className="label mb-1">Resumen</div>
                <div>Peticiones HTTP: {r.http_requests} · bloqueadas por robots.txt: {r.robots_blocked}</div>
                <div>Re-verificadas: {r.reverified} · vencidas: {r.expired} · archivadas: {r.archived}</div>
                <div>IA: {r.llm?.enabled ? `${r.llm.calls} llamadas (${r.llm.model})` : 'no configurada'}</div>
                {r.run_url && <a href={r.run_url} target="_blank" rel="noopener noreferrer" className="text-brand hover:underline">Ver en GitHub Actions</a>}
              </div>
              <div>
                <div className="label mb-1">Motivos de descarte</div>
                {Object.keys(r.discard_reasons ?? {}).length ? Object.entries(r.discard_reasons).map(([k, v]) => <div key={k}>{v} · {k}</div>) : 'Ninguno'}
              </div>
              <div>
                <div className="label mb-1">Errores</div>
                {r.errors.length ? r.errors.map((e, i) => <div key={i} className="text-danger/90">{e}</div>) : 'Sin errores'}
              </div>
            </div>
          </td>
        </tr>
      )}
    </Fragment>
  )
}

function SourceRow({ s }: { s: SourceInfo }) {
  const ok = s.last_status === 'ok'
  return (
    <tr className="border-b border-line/60">
      <td className="px-3 py-2">
        <div className="text-ink">{s.name}</div>
        <div className="max-w-[340px] truncate text-[11px] text-muted">{s.url ? hostOf(s.url) : s.query ? `«${s.query}»` : ''}</div>
      </td>
      <td className="px-3 py-2 text-xs">{TYPE[s.type] ?? s.type}</td>
      <td className="px-3 py-2 text-xs">{s.trust === 'official' ? <Badge tone="brand">Oficial</Badge> : s.trust === 'news' ? <Badge>Medio</Badge> : <Badge tone="muted">{s.trust}</Badge>}</td>
      <td className="px-3 py-2 text-xs">
        {s.last_status === 'error' ? <span className="inline-flex items-center gap-1 text-danger"><XCircle className="h-3.5 w-3.5" /> Error</span>
          : s.last_status === 'omitida' ? <span className="text-muted">Omitida</span>
          : ok ? <span className="inline-flex items-center gap-1 text-brand"><CheckCircle2 className="h-3.5 w-3.5" /> OK</span>
          : <span className="text-muted">Pendiente</span>}
        {s.last_error && <div className="max-w-[260px] truncate text-[11px] text-muted" title={s.last_error}>{s.last_error}</div>}
      </td>
      <td className="whitespace-nowrap px-3 py-2 text-xs text-muted">{s.last_run_at ? ago(s.last_run_at) : '—'}</td>
      <td className="px-3 py-2 text-xs tabular-nums">{s.last_items ?? s.total_items ?? 0}</td>
      <td className="px-3 py-2 text-xs tabular-nums text-brand">{s.total_new ?? 0}</td>
    </tr>
  )
}

export default function MonitoreoPage() {
  const { status, runs, sources, changes, items } = useData()
  const health = useEngineHealth()
  const { runs: ghRuns, error: ghError } = useWorkflowRuns(true)
  const [srcFilter, setSrcFilter] = useState<'todas' | 'error' | 'descubiertas' | 'productivas'>('todas')
  const running = ghRuns?.find((r) => r.status !== 'completed')
  const lastFound = useMemo(() => [...items].sort((a, b) => b.discovered_at.localeCompare(a.discovered_at))[0], [items])
  const failedSources = sources.filter((s) => s.last_status === 'error')
  const shownSources = sources
    .filter((s) => srcFilter === 'todas' || (srcFilter === 'error' ? s.last_status === 'error' : srcFilter === 'productivas' ? (s.total_new ?? 0) > 0 : s.origin === 'descubierta'))
    .sort((a, b) => (b.total_new ?? 0) - (a.total_new ?? 0))

  return (
    <div className="space-y-8">
      <PageHeader title="Monitoreo del sistema" icon={Activity} description="Transparencia total: cuándo se ejecutó el motor, qué fuentes consultó, qué encontró, qué descartó y qué falló. Todas las fechas provienen de ejecuciones reales.">
        {workflowUrl && <a href={workflowUrl} target="_blank" rel="noopener noreferrer" className="btn-ghost">GitHub Actions <ExternalLink className="h-4 w-4" /></a>}
      </PageHeader>

      {health.level !== 'ok' && health.level !== 'loading' && (
        <div className="flex items-start gap-3 rounded-xl border border-warn/40 bg-warn/10 p-3 text-sm text-warn"><AlertTriangle className="mt-0.5 h-4 w-4" /> {health.text}</div>
      )}
      {running && (
        <div className="flex items-center gap-3 rounded-xl border border-brand/40 bg-brand/10 p-3 text-sm text-brand">
          <Loader2 className="h-4 w-4 animate-spin" /> Hay una ejecución en curso ({eventLabel(running.event)}, iniciada {ago(running.created_at)}).
          <a href={running.html_url} target="_blank" rel="noopener noreferrer" className="ml-auto underline">Ver en vivo</a>
        </div>
      )}

      <section className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <StatTile label="Última ejecución exitosa" value={status?.last_success_at ? fmtTime(status.last_success_at) : '—'} hint={status?.last_success_at ? `${fmtDateTime(status.last_success_at)} · ${ago(status.last_success_at)}` : 'ninguna todavía'} icon={CheckCircle2} accent />
        <StatTile label="Próxima programada" value={status ? fmtTime(status.schedule.next_run_at) : '—'} hint={status ? `${status.schedule.description} · cron ${status.schedule.cron_utc} (UTC)` : ''} icon={History} />
        <StatTile label="Fuentes activas" value={status?.sources.ok_last_run ?? 0} hint={`${status?.sources.configured ?? 0} configuradas · ${status?.sources.discovered ?? 0} descubiertas`} icon={Globe} />
        <StatTile label="Fuentes con fallas" value={failedSources.length} hint={failedSources.slice(0, 2).map((s) => s.name).join(', ') || 'ninguna'} icon={XCircle} />
        <StatTile label="Tiempo de ejecución" value={status ? `${Math.round(status.last_run.duration_s)} s` : '—'} hint="última ejecución" icon={Activity} />
        <StatTile label="Activas" value={status?.counts.active ?? 0} hint={`${status?.counts.total ?? 0} en la base`} icon={Database} />
        <StatTile label="Verificadas" value={status?.counts.verified ?? 0} hint="fuente oficial + condiciones" icon={CheckCircle2} />
        <StatTile label="Pendientes de revisión" value={status?.counts.pending ?? 0} hint={`${status?.counts.unverifiable ?? 0} no verificables`} icon={AlertTriangle} />
        <StatTile label="Vencidas" value={status?.counts.expired ?? 0} hint={`${status?.counts.withdrawn ?? 0} retiradas · ${status?.counts.archived ?? 0} archivadas`} icon={History} />
        <StatTile label="Última encontrada" value={lastFound ? ago(lastFound.discovered_at) : '—'} hint={lastFound?.title.slice(0, 48)} icon={Activity} />
      </section>

      {status && <p className="text-sm text-muted">Resultado de la última ejecución: <span className="text-ink">{status.message}</span></p>}

      <section className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <div className="card p-4"><SectionTitle title="Nuevas y actualizadas por ejecución" />{runs.length ? <RunsChart runs={runs} /> : <p className="text-sm text-muted">Sin datos.</p>}</div>
        <div className="card p-4"><SectionTitle title="Duración de cada ejecución" />{runs.length ? <DurationChart runs={runs} /> : <p className="text-sm text-muted">Sin datos.</p>}</div>
      </section>

      <section>
        <SectionTitle title="Ejecuciones en GitHub Actions" subtitle="Estado en vivo (API pública de GitHub)" />
        <div className="card divide-y divide-line/60">
          {ghError && <p className="p-3 text-xs text-muted">No se pudo consultar GitHub: {ghError}</p>}
          {(ghRuns ?? []).map((r) => (
            <a key={r.id} href={r.html_url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-surface2/50">
              <RunStatusIcon run={r} />
              <span className="truncate">{r.display_title}</span>
              <span className="ml-auto shrink-0 text-xs text-muted">{eventLabel(r.event)} · {fmtDateTime(r.created_at)}</span>
            </a>
          ))}
          {ghRuns && ghRuns.length === 0 && <p className="p-3 text-xs text-muted">Sin ejecuciones.</p>}
        </div>
      </section>

      <section>
        <SectionTitle title="Historial de ejecuciones del motor" subtitle={`${runs.length} ejecuciones registradas`} icon={History} />
        {runs.length ? (
          <div className="card overflow-x-auto">
            <table className="w-full min-w-[860px] text-left text-sm">
              <thead className="border-b border-line text-[11px] uppercase tracking-wider text-muted">
                <tr>{['Fecha y hora', 'Disparador', 'Fuentes OK', 'Nuevas', 'Actualizadas', 'Descartadas', 'Errores', 'Duración', 'Estado', ''].map((h) => <th key={h} className="px-3 py-2 font-semibold">{h}</th>)}</tr>
              </thead>
              <tbody>{[...runs].reverse().slice(0, 60).map((r) => <RunRow key={r.id} r={r} />)}</tbody>
            </table>
          </div>
        ) : <EmptyState title="Aún no hay ejecuciones registradas" />}
      </section>

      <section>
        <SectionTitle
          title="Fuentes"
          subtitle="Configuradas, descubiertas automáticamente y su estado"
          icon={Globe}
          action={
            <div className="flex gap-2">
              {(['todas', 'error', 'descubiertas', 'productivas'] as const).map((f) => <button key={f} onClick={() => setSrcFilter(f)} className={cn('chip', srcFilter === f && 'chip-on')}>{f === 'todas' ? 'Todas' : f === 'error' ? 'Con error' : f === 'descubiertas' ? 'Descubiertas' : 'Con hallazgos'}</button>)}
            </div>
          }
        />
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="border-b border-line text-[11px] uppercase tracking-wider text-muted">
              <tr>{['Fuente', 'Tipo', 'Confianza', 'Estado', 'Última consulta', 'Resultados', 'Nuevas (total)'].map((h) => <th key={h} className="px-3 py-2 font-semibold">{h}</th>)}</tr>
            </thead>
            <tbody>{shownSources.map((s) => <SourceRow key={s.id} s={s} />)}</tbody>
          </table>
        </div>
      </section>

      <section>
        <SectionTitle title="Cambios importantes recientes" subtitle="Fechas, estados, valores y enlaces que cambiaron" icon={History} />
        {changes.length ? (
          <div className="card divide-y divide-line/60 text-sm">
            {[...changes].reverse().slice(0, 30).map((c, i) => (
              <div key={i} className="flex flex-wrap items-center gap-2 px-4 py-2">
                <span className="text-xs text-muted">{fmtDateTime(c.at)}</span>
                <span className="truncate text-ink">{c.title}</span>
                <span className="text-xs text-muted">{c.label}: {String(c.from ?? '—')} → <span className="text-brand">{String(c.to ?? '—')}</span></span>
              </div>
            ))}
          </div>
        ) : <EmptyState title="Sin cambios registrados todavía" />}
      </section>
    </div>
  )
}
