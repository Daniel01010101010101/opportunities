import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ExternalLink, Loader2, Radar, CheckCircle2, XCircle, Clock } from 'lucide-react'
import { Modal } from './ui'
import { dispatchResearch, getToken, latestRuns, workflowUrl, type WorkflowRun } from '@/lib/github'
import { ago } from '@/lib/format'

export const RESEARCH_CATEGORIES: { value: string; label: string }[] = [
  { value: 'todas', label: 'Todas las fuentes pendientes' },
  { value: 'concursos', label: 'Concursos y sorteos' },
  { value: 'bonos', label: 'Bonos y beneficios gratis' },
  { value: 'ofertas', label: 'Ofertas y descuentos' },
  { value: 'estado', label: 'Beneficios del Estado' },
  { value: 'gasolina', label: 'Bonos de gasolina' },
  { value: 'carros', label: 'Sorteos de carros' },
  { value: 'motos', label: 'Sorteos de motos' },
  { value: 'becas', label: 'Becas' },
  { value: 'formacion', label: 'Formación / SENA' },
  { value: 'vivienda', label: 'Vivienda' },
  { value: 'eventos_gratis', label: 'Eventos gratis' },
]

export function useWorkflowRuns(poll = false) {
  const [runs, setRuns] = useState<WorkflowRun[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const refresh = useCallback(async () => {
    try {
      setRuns(await latestRuns())
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [])
  useEffect(() => {
    refresh()
    if (!poll) return
    const t = window.setInterval(refresh, 20000)
    return () => window.clearInterval(t)
  }, [refresh, poll])
  return { runs, error, refresh }
}

export function RunStatusIcon({ run }: { run: WorkflowRun }) {
  if (run.status !== 'completed') return <Loader2 className="h-4 w-4 animate-spin text-brand" aria-label="En ejecución" />
  if (run.conclusion === 'success') return <CheckCircle2 className="h-4 w-4 text-brand" aria-label="Exitosa" />
  if (run.conclusion === 'cancelled' || run.conclusion === 'skipped') return <Clock className="h-4 w-4 text-muted" aria-label="Cancelada" />
  return <XCircle className="h-4 w-4 text-danger" aria-label="Fallida" />
}

const EVENT_LABEL: Record<string, string> = { schedule: 'Programada', workflow_dispatch: 'Manual', push: 'Despliegue', workflow_run: 'Reintento' }
export const eventLabel = (e: string) => EVENT_LABEL[e] ?? e

export function ResearchModal({ open, onClose, initialQuery = '', initialCategory = 'todas' }: {
  open: boolean
  onClose: () => void
  initialQuery?: string
  initialCategory?: string
}) {
  const [category, setCategory] = useState(initialCategory)
  const [query, setQuery] = useState(initialQuery)
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')
  const [msg, setMsg] = useState('')
  const { runs, error, refresh } = useWorkflowRuns(open)
  const hasToken = Boolean(getToken())

  useEffect(() => {
    if (open) {
      setQuery(initialQuery)
      setCategory(initialCategory)
      setState('idle')
      setMsg('')
    }
  }, [open, initialQuery, initialCategory])

  const launch = async () => {
    setState('sending')
    try {
      await dispatchResearch({ category, query })
      setState('sent')
      setMsg('Búsqueda enviada a GitHub Actions. Tarda entre 3 y 10 minutos; la página se actualizará sola cuando se publiquen los resultados.')
      window.setTimeout(refresh, 4000)
    } catch (e) {
      setState('error')
      setMsg(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Investigar ahora">
      <div className="space-y-4 text-sm">
        <p className="text-muted">
          Lanza una ejecución real del motor de investigación en GitHub Actions (además de la automática cada 2 horas).
        </p>
        <label className="block">
          <span className="label">Categoría</span>
          <select className="input mt-1" value={category} onChange={(e) => setCategory(e.target.value)}>
            {RESEARCH_CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="label">Búsqueda libre (opcional)</span>
          <input className="input mt-1" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Ej.: sorteo moto Yamaha, bono gasolina Terpel…" maxLength={120} />
        </label>
        {hasToken ? (
          <button className="btn-primary w-full" onClick={launch} disabled={state === 'sending'}>
            {state === 'sending' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Radar className="h-4 w-4" />} Lanzar búsqueda
          </button>
        ) : (
          <div className="rounded-xl border border-line bg-surface2/60 p-3 text-[13px] text-muted">
            Para lanzarla desde aquí, configura un token en <Link to="/ajustes" onClick={onClose} className="text-brand hover:underline">Ajustes</Link>.
            También puedes lanzarla en GitHub: abre el workflow, pulsa <b className="text-ink">Run workflow</b> y escribe la categoría o búsqueda.
            {workflowUrl && (
              <a href={workflowUrl} target="_blank" rel="noopener noreferrer" className="btn-ghost mt-2 w-full">
                Abrir en GitHub Actions <ExternalLink className="h-4 w-4" />
              </a>
            )}
          </div>
        )}
        {msg && <p className={state === 'error' ? 'text-danger' : 'text-brand'}>{msg}</p>}
        <div>
          <div className="label mb-1.5">Ejecuciones recientes</div>
          {error && <p className="text-xs text-muted">No se pudo consultar GitHub ({error}).</p>}
          <ul className="space-y-1">
            {(runs ?? []).slice(0, 5).map((r) => (
              <li key={r.id} className="flex items-center gap-2 text-[13px]">
                <RunStatusIcon run={r} />
                <a href={r.html_url} target="_blank" rel="noopener noreferrer" className="truncate hover:text-brand">{r.display_title}</a>
                <span className="ml-auto shrink-0 text-xs text-muted">{eventLabel(r.event)} · {ago(r.created_at)}</span>
              </li>
            ))}
            {runs && runs.length === 0 && <li className="text-xs text-muted">Aún no hay ejecuciones registradas.</li>}
          </ul>
        </div>
      </div>
    </Modal>
  )
}
