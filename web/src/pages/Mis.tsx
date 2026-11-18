import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Heart, Trophy } from 'lucide-react'
import { OpportunityRow, useOpenDetail } from '@/components/OpportunityCard'
import { EmptyState, PageHeader } from '@/components/ui'
import { useData } from '@/lib/data'
import { TRACK_LABELS, usePersonal, type TrackStatus, type TrackedItem } from '@/lib/personal'
import { cn, fmtDay, fmtDateTime } from '@/lib/format'

type Tab = 'favoritas' | TrackStatus

const TABS: { id: Tab; label: string }[] = [
  { id: 'favoritas', label: 'Mis favoritas' },
  { id: 'quiero', label: TRACK_LABELS.quiero },
  { id: 'participando', label: TRACK_LABELS.participando },
  { id: 'reclamar', label: TRACK_LABELS.reclamar },
  { id: 'ganado', label: TRACK_LABELS.ganado },
  { id: 'descartado', label: TRACK_LABELS.descartado },
]

function OrphanRow({ it }: { it: TrackedItem }) {
  const open = useOpenDetail()
  return (
    <div className="card flex items-center gap-3 p-3 opacity-80">
      <div className="min-w-0 flex-1">
        <button onClick={() => open(it.id)} className="block truncate text-left font-display text-sm font-semibold hover:text-brand">{it.snapshot.title}</button>
        <div className="text-xs text-muted">{it.snapshot.organizer} · ya no está activa en el radar (vencida o archivada){it.snapshot.end ? ` · cierre ${fmtDay(it.snapshot.end)}` : ''}</div>
      </div>
      {it.snapshot.url && <a href={it.snapshot.url} target="_blank" rel="noopener noreferrer nofollow" className="btn-quiet text-xs">Abrir enlace</a>}
    </div>
  )
}

export default function MisPage() {
  const { byId } = useData()
  const personal = usePersonal()
  const [tab, setTab] = useState<Tab>('favoritas')
  const all = Object.values(personal.data.items)
  const count = (t: Tab) => all.filter((i) => (t === 'favoritas' ? i.favorite : i.status === t)).length
  const list = useMemo(
    () => all.filter((i) => (tab === 'favoritas' ? i.favorite : i.status === tab)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [all, tab],
  )
  const progress = (it: TrackedItem) => {
    const op = byId.get(it.id)
    const total = (op?.steps?.length ?? 0) + it.customSteps.length
    const done = Object.values(it.checklist).filter(Boolean).length
    return total ? `${Math.min(done, total)}/${total} pasos` : null
  }

  return (
    <div>
      <PageHeader title="Mis oportunidades" icon={Heart} description="Tu organización personal. El estado lo controlas tú: visitar un enlace no te marca como participante. Se guarda en este navegador (exporta una copia en Ajustes para usarla en otro dispositivo)." />
      <div className="-mx-1 mb-5 flex gap-2 overflow-x-auto px-1 pb-1">
        {TABS.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)} className={cn('chip shrink-0', tab === t.id && 'chip-on')}>
            {t.label} <span className="tabular-nums text-muted">{count(t.id)}</span>
          </button>
        ))}
      </div>
      {tab === 'ganado' && list.length > 0 && (
        <div className="card mb-4 flex items-center gap-3 border-brand/40 p-4">
          <Trophy className="h-6 w-6 text-brand" />
          <div className="text-sm">¡Felicitaciones! Has registrado <b className="text-brand">{list.length}</b> premio(s) ganado(s).</div>
        </div>
      )}
      {list.length === 0 ? (
        <EmptyState icon={Heart} title="Todavía no hay nada aquí" action={<Link to="/" className="btn-ghost">Explorar el radar</Link>}>
          Abre cualquier oportunidad y usa «Mi seguimiento» o el corazón para organizarla.
        </EmptyState>
      ) : (
        <div className="flex flex-col gap-2">
          {list.map((it) => {
            const op = byId.get(it.id)
            return (
              <div key={it.id}>
                {op ? <OpportunityRow op={op} /> : <OrphanRow it={it} />}
                <div className="mt-1 flex flex-wrap gap-3 px-2 text-[11px] text-muted">
                  {progress(it) && <span>Checklist: {progress(it)}</span>}
                  {it.prizeWon && <span className="text-brand">Premio: {it.prizeWon}</span>}
                  {it.notes && <span className="truncate">Nota: {it.notes.slice(0, 80)}</span>}
                  <span>Actualizado {fmtDateTime(it.updatedAt)}</span>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
