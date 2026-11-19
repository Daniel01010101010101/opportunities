import { AlertTriangle, Info, XCircle } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useData } from '@/lib/data'
import { ago, fmtDateTime } from '@/lib/format'

/** Advertencias visibles cuando el sistema no está al día. Nunca muestra una fecha inventada. */
export function useEngineHealth() {
  const { status, loading, error, runs } = useData()
  if (loading) return { level: 'loading' as const, text: '' }
  if (error) return { level: 'error' as const, text: `No se pudieron cargar los datos del radar (${error}).` }
  if (!status) {
    return { level: 'empty' as const, text: 'El motor todavía no ha completado su primera ejecución. Los datos aparecerán cuando GitHub Actions publique la primera búsqueda.' }
  }
  const hours = (Date.now() - new Date(status.generated_at).getTime()) / 3_600_000
  if (status.last_run?.status === 'error') {
    return { level: 'error' as const, text: `La última ejecución (${fmtDateTime(status.generated_at)}) no pudo consultar ninguna fuente. Última ejecución exitosa: ${status.last_success_at ? fmtDateTime(status.last_success_at) : 'ninguna'}.` }
  }
  const firstRun = runs.length ? new Date(runs[0].started_at).getTime() : Date.now()
  const lastScheduled = [...runs].reverse().find((r) => r.trigger === 'schedule' || r.trigger === 'retry')
  const hoursSinceScheduled = lastScheduled ? (Date.now() - new Date(lastScheduled.started_at).getTime()) / 3_600_000 : null
  if ((hoursSinceScheduled === null && (Date.now() - firstRun) / 3_600_000 > 4.5) || (hoursSinceScheduled !== null && hoursSinceScheduled > 6.5)) {
    return {
      level: 'stale' as const,
      text: `GitHub no está ejecutando la búsqueda automática cada 2 horas${lastScheduled ? ` (última programada: ${fmtDateTime(lastScheduled.started_at)})` : ' (todavía no ha corrido ninguna programada)'}. ` +
        'Solución: en GitHub → Settings → General → Default branch, elige «main». Mientras tanto usa «Investigar ahora». ' +
        `Última actualización real: ${fmtDateTime(status.generated_at)}.`,
    }
  }
  if (hours > 5) {
    return { level: 'stale' as const, text: `El radar no se ha actualizado desde ${fmtDateTime(status.generated_at)} (${ago(status.generated_at)}). Debería actualizarse cada 2 horas: revisa el estado en Monitoreo.` }
  }
  return { level: 'ok' as const, text: status.message }
}

export function EngineBanner() {
  const h = useEngineHealth()
  if (h.level === 'ok' || h.level === 'loading') return null
  const Icon = h.level === 'error' ? XCircle : h.level === 'empty' ? Info : AlertTriangle
  const cls = h.level === 'error' ? 'border-danger/40 bg-danger/10 text-danger' : h.level === 'empty' ? 'border-info/40 bg-info/10 text-info' : 'border-warn/40 bg-warn/10 text-warn'
  return (
    <div className={`mb-5 flex items-start gap-3 rounded-xl border p-3 text-sm ${cls}`} role="status">
      <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <p className="flex-1">{h.text}</p>
      <Link to="/monitoreo" className="shrink-0 underline-offset-2 hover:underline">Ver monitoreo</Link>
    </div>
  )
}
