import { useMemo, useState } from 'react'
import { Explorer } from '@/components/Explorer'
import { PageHeader } from '@/components/ui'
import { useData } from '@/lib/data'
import { categoriesOf, icon, mechanicsMeta, sectionById } from '@/lib/taxonomy'
import { cn } from '@/lib/format'
import type { SectionId } from '@/lib/types'

const COPY: Record<SectionId, string> = {
  concursos: 'Concursos y sorteos para ganar carros, motos, dinero, viajes, tecnología y más. Las fichas destacan si puedes participar sin pagar nada.',
  bonos: 'Bonos, regalos, cashback y beneficios. Se diferencia claramente lo que es gratis de lo que exige compra, suscripción u otras condiciones.',
  ofertas: 'Promociones comerciales: descuentos, 2x1, cupones y envíos gratis. El porcentaje solo se calcula cuando ambos precios son verificables.',
  estado: 'Subsidios, becas, formación gratuita y convocatorias públicas. Nadie es beneficiario automáticamente: revisa los criterios de cada entidad.',
}

export default function SectionPage({ section }: { section: SectionId }) {
  const { items } = useData()
  const meta = sectionById[section]
  const [program, setProgram] = useState<'' | 'abierta' | 'proxima' | 'permanente' | 'cerrada'>('')
  const [mech, setMech] = useState('')
  const scoped = useMemo(
    () => items.filter((o) => o.section === section && (!program || o.gov?.program_status === program) && (!mech || (o.mechanics ?? []).includes(mech))),
    [items, section, program, mech],
  )
  const mechCounts = useMemo(() => {
    const m = new Map<string, number>()
    items.forEach((o) => {
      if (o.section === section && o.status !== 'vencida' && o.status !== 'retirada') (o.mechanics ?? []).forEach((x) => m.set(x, (m.get(x) ?? 0) + 1))
    })
    return m
  }, [items, section])
  const extra =
    section === 'estado' ? (
      <select value={program} onChange={(e) => setProgram(e.target.value as typeof program)} className={cn('input h-9 w-auto py-1.5', program && 'border-brand/60')} aria-label="Estado de la convocatoria">
        <option value="">Todas las convocatorias</option>
        <option value="abierta">Abiertas</option>
        <option value="proxima">Próximas</option>
        <option value="permanente">Programas permanentes</option>
        <option value="cerrada">Cerradas</option>
      </select>
    ) : null
  return (
    <div>
      <PageHeader title={meta.label} description={COPY[section]} icon={icon(meta.icon)} />
      {(section === 'concursos' || section === 'bonos') && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span className="label mr-1">¿Cómo se participa?</span>
          <button onClick={() => setMech('')} className={cn('chip', !mech && 'chip-on')}>Cualquier forma</button>
          {Object.entries(mechanicsMeta).map(([id, m]) => {
            const Icon = icon(m.icon)
            return (
              <button key={id} onClick={() => setMech(mech === id ? '' : id)} className={cn('chip', mech === id && 'chip-on', !mechCounts.get(id) && 'opacity-50')}>
                <Icon className="h-3.5 w-3.5" aria-hidden /> {m.label} <span className="tabular-nums text-muted">{mechCounts.get(id) ?? 0}</span>
              </button>
            )
          })}
        </div>
      )}
      <Explorer items={scoped} categories={categoriesOf(section)} extraFilters={extra} />
    </div>
  )
}
