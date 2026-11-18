import { useMemo, useState } from 'react'
import { Explorer } from '@/components/Explorer'
import { PageHeader } from '@/components/ui'
import { useData } from '@/lib/data'
import { categoriesOf, icon, sectionById } from '@/lib/taxonomy'
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
  const scoped = useMemo(
    () => items.filter((o) => o.section === section && (!program || o.gov?.program_status === program)),
    [items, section, program],
  )
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
      <Explorer items={scoped} categories={categoriesOf(section)} extraFilters={extra} />
    </div>
  )
}
