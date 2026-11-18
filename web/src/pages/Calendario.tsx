import { useMemo, useState } from 'react'
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react'
import { PageHeader, Segmented } from '@/components/ui'
import { useOpenDetail } from '@/components/OpportunityCard'
import { useData } from '@/lib/data'
import { cn, parseDay, todayBogota } from '@/lib/format'
import type { Opportunity } from '@/lib/types'

type EventType = 'cierre' | 'sorteo' | 'apertura'
interface CalEvent { date: Date; type: EventType; op: Opportunity }

const TYPE_META: Record<EventType, { label: string; cls: string; dot: string }> = {
  cierre: { label: 'Cierre / vence', cls: 'border-warn/40 bg-warn/10 text-warn', dot: 'bg-warn' },
  sorteo: { label: 'Sorteo', cls: 'border-brand/40 bg-brand/10 text-brand', dot: 'bg-brand' },
  apertura: { label: 'Apertura', cls: 'border-info/40 bg-info/10 text-info', dot: 'bg-info' },
}
const WEEKDAYS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']
const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
const startOfWeek = (d: Date) => {
  const x = new Date(d)
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7))
  return x
}

export default function CalendarioPage() {
  const { items } = useData()
  const open = useOpenDetail()
  const today = todayBogota()
  const [mode, setMode] = useState<'mes' | 'semana'>('mes')
  const [cursor, setCursor] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1))
  const [weekStart, setWeekStart] = useState(() => startOfWeek(today))
  const [types, setTypes] = useState<Record<EventType, boolean>>({ cierre: true, sorteo: true, apertura: true })
  const [onlyFree, setOnlyFree] = useState(false)

  const events = useMemo(() => {
    const out: CalEvent[] = []
    for (const op of items) {
      if (op.status === 'retirada') continue
      if (onlyFree && !op.cost?.free) continue
      const end = parseDay(op.dates?.end)
      const draw = parseDay(op.dates?.draw)
      const start = parseDay(op.dates?.start)
      if (end && types.cierre) out.push({ date: end, type: 'cierre', op })
      if (draw && types.sorteo) out.push({ date: draw, type: 'sorteo', op })
      if (start && types.apertura) out.push({ date: start, type: 'apertura', op })
    }
    return out
  }, [items, types, onlyFree])

  const days = useMemo(() => {
    if (mode === 'semana') return Array.from({ length: 7 }, (_, i) => new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + i))
    const first = startOfWeek(cursor)
    return Array.from({ length: 42 }, (_, i) => new Date(first.getFullYear(), first.getMonth(), first.getDate() + i))
  }, [mode, cursor, weekStart])

  const eventsOn = (d: Date) => events.filter((e) => sameDay(e.date, d))
  const upcoming = useMemo(() => events.filter((e) => e.date >= today).sort((a, b) => a.date.getTime() - b.date.getTime()).slice(0, 25), [events, today])

  const move = (n: number) => {
    if (mode === 'mes') setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + n, 1))
    else setWeekStart(new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + 7 * n))
  }
  const title = mode === 'mes'
    ? cursor.toLocaleDateString('es-CO', { month: 'long', year: 'numeric' })
    : `Semana del ${weekStart.toLocaleDateString('es-CO', { day: 'numeric', month: 'short' })}`

  return (
    <div>
      <PageHeader title="Calendario de oportunidades" icon={CalendarDays} description="Cierres de inscripción, fechas de sorteo y aperturas de convocatorias publicadas por las fuentes. Solo se muestran fechas que aparecen en la fuente.">
        <Segmented value={mode} onChange={setMode} options={[{ value: 'mes', label: 'Mes' }, { value: 'semana', label: 'Semana' }]} size="md" />
      </PageHeader>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <button className="btn-ghost p-2" onClick={() => move(-1)} aria-label="Anterior"><ChevronLeft className="h-4 w-4" /></button>
        <h2 className="h-display min-w-[200px] text-center text-lg capitalize">{title}</h2>
        <button className="btn-ghost p-2" onClick={() => move(1)} aria-label="Siguiente"><ChevronRight className="h-4 w-4" /></button>
        <button className="btn-quiet" onClick={() => { setCursor(new Date(today.getFullYear(), today.getMonth(), 1)); setWeekStart(startOfWeek(today)) }}>Hoy</button>
        <div className="ml-auto flex flex-wrap gap-2">
          {(Object.keys(TYPE_META) as EventType[]).map((t) => (
            <button key={t} onClick={() => setTypes({ ...types, [t]: !types[t] })} className={cn('chip', types[t] && 'chip-on')} aria-pressed={types[t]}>
              <span className={cn('h-2 w-2 rounded-full', TYPE_META[t].dot)} /> {TYPE_META[t].label}
            </button>
          ))}
          <button onClick={() => setOnlyFree(!onlyFree)} className={cn('chip', onlyFree && 'chip-on')} aria-pressed={onlyFree}>Solo gratis</button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="card overflow-hidden">
          <div className="grid grid-cols-7 border-b border-line text-center text-[11px] font-semibold uppercase tracking-wider text-muted">
            {WEEKDAYS.map((d) => <div key={d} className="py-2">{d}</div>)}
          </div>
          <div className="grid grid-cols-7">
            {days.map((d) => {
              const evs = eventsOn(d)
              const outside = mode === 'mes' && d.getMonth() !== cursor.getMonth()
              const isToday = sameDay(d, today)
              return (
                <div key={d.toISOString()} className={cn('min-h-[92px] border-b border-r border-line/60 p-1.5', mode === 'semana' && 'min-h-[260px]', outside && 'bg-bg/40 opacity-50')}>
                  <div className={cn('mb-1 inline-grid h-6 w-6 place-items-center rounded-full text-xs tabular-nums', isToday ? 'bg-brand font-bold text-[#04110B]' : 'text-muted')}>{d.getDate()}</div>
                  <div className="space-y-1">
                    {evs.slice(0, mode === 'semana' ? 12 : 3).map((e, i) => (
                      <button key={i} onClick={() => open(e.op.id)} className={cn('block w-full truncate rounded-md border px-1.5 py-0.5 text-left text-[10.5px] leading-tight', TYPE_META[e.type].cls)} title={`${TYPE_META[e.type].label}: ${e.op.title}`}>
                        {e.op.title}
                      </button>
                    ))}
                    {evs.length > (mode === 'semana' ? 12 : 3) && <div className="px-1 text-[10px] text-muted">+{evs.length - 3} más</div>}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
        <aside className="card p-4">
          <h3 className="h-display mb-3 text-base">Próximas fechas</h3>
          {upcoming.length === 0 ? <p className="text-sm text-muted">No hay fechas próximas publicadas.</p> : (
            <ul className="space-y-2">
              {upcoming.map((e, i) => (
                <li key={i}>
                  <button onClick={() => open(e.op.id)} className="flex w-full items-start gap-3 rounded-lg p-1.5 text-left hover:bg-surface2">
                    <div className="w-12 shrink-0 text-center">
                      <div className="text-[10px] uppercase text-muted">{e.date.toLocaleDateString('es-CO', { month: 'short' })}</div>
                      <div className="font-display text-lg leading-none">{e.date.getDate()}</div>
                    </div>
                    <div className="min-w-0">
                      <div className="truncate text-sm text-ink">{e.op.title}</div>
                      <div className={cn('mt-0.5 inline-flex rounded border px-1.5 text-[10px]', TYPE_META[e.type].cls)}>{TYPE_META[e.type].label}</div>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>
      </div>
    </div>
  )
}
