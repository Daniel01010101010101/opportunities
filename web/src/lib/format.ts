import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs))

const TZ = 'America/Bogota'

export const cop = (n: number | null | undefined) =>
  n == null ? '' : new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(n)

export const copShort = (n: number | null | undefined) => {
  if (n == null) return ''
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toLocaleString('es-CO', { maximumFractionDigits: 1 })} mil M`
  if (n >= 1_000_000) return `$${(n / 1_000_000).toLocaleString('es-CO', { maximumFractionDigits: 1 })} M`
  if (n >= 1_000) return `$${Math.round(n / 1_000).toLocaleString('es-CO')} mil`
  return cop(n)
}

export const parseDay = (d: string | null | undefined): Date | null => {
  if (!d) return null
  const [y, m, day] = d.slice(0, 10).split('-').map(Number)
  if (!y || !m || !day) return null
  return new Date(y, m - 1, day)
}

/** Fecha de hoy en Bogotá (a medianoche local del navegador, para comparar días). */
export const todayBogota = (): Date => {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
  return parseDay(parts)!
}

export const daysUntil = (d: string | null | undefined): number | null => {
  const day = parseDay(d)
  if (!day) return null
  return Math.round((day.getTime() - todayBogota().getTime()) / 86_400_000)
}

export const fmtDay = (d: string | null | undefined, opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' }) => {
  const day = parseDay(d)
  return day ? day.toLocaleDateString('es-CO', opts) : ''
}

export const fmtDateTime = (iso: string | null | undefined) => {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString('es-CO', { timeZone: TZ, day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
}

export const fmtTime = (iso: string | null | undefined) => {
  if (!iso) return ''
  const d = new Date(iso)
  return d.toLocaleTimeString('es-CO', { timeZone: TZ, hour: 'numeric', minute: '2-digit' })
}

export const ago = (iso: string | null | undefined) => {
  if (!iso) return ''
  const diff = (Date.now() - new Date(iso).getTime()) / 1000
  if (Number.isNaN(diff)) return ''
  const rtf = new Intl.RelativeTimeFormat('es', { numeric: 'auto' })
  const abs = Math.abs(diff)
  if (abs < 60) return rtf.format(-Math.round(diff), 'second')
  if (abs < 3600) return rtf.format(-Math.round(diff / 60), 'minute')
  if (abs < 86400) return rtf.format(-Math.round(diff / 3600), 'hour')
  return rtf.format(-Math.round(diff / 86400), 'day')
}

export const deadlineLabel = (end: string | null | undefined): { text: string; tone: 'danger' | 'warn' | 'ok' | 'muted' } => {
  const n = daysUntil(end)
  if (n == null) return { text: 'Sin fecha límite publicada', tone: 'muted' }
  if (n < 0) return { text: `Venció el ${fmtDay(end)}`, tone: 'muted' }
  if (n === 0) return { text: 'Vence hoy', tone: 'danger' }
  if (n === 1) return { text: 'Vence mañana', tone: 'danger' }
  if (n <= 7) return { text: `Vence en ${n} días`, tone: 'warn' }
  return { text: `Hasta el ${fmtDay(end, { day: 'numeric', month: 'short' })}`, tone: 'ok' }
}

export const hostOf = (url: string | null | undefined) => {
  if (!url) return ''
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

export const coverageLabel: Record<string, string> = {
  nacional: 'Toda Colombia',
  bogota: 'Bogotá',
  regional: 'Regional',
  internacional: 'Internacional',
  desconocida: 'Cobertura no informada',
}

export const statusLabel: Record<string, string> = {
  activa: 'Vigente',
  proxima: 'Próximamente',
  permanente: 'Permanente',
  vencida: 'Vencida',
  retirada: 'Retirada',
  sin_confirmar: 'Vigencia sin confirmar',
}

export const programStatusLabel: Record<string, string> = {
  abierta: 'Convocatoria abierta',
  proxima: 'Convocatoria próxima',
  permanente: 'Programa permanente',
  cerrada: 'Cerrada',
  sin_confirmar: 'Estado sin confirmar',
}
