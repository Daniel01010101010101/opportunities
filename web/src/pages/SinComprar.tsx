import { useMemo } from 'react'
import { Sparkles } from 'lucide-react'
import { Explorer } from '@/components/Explorer'
import { PageHeader } from '@/components/ui'
import { useData } from '@/lib/data'
import { costTypes } from '@/lib/taxonomy'

export default function SinComprarPage() {
  const { items } = useData()
  const free = useMemo(() => items.filter((o) => o.cost?.free && o.risk?.level !== 'alto'), [items])
  return (
    <div>
      <PageHeader
        title="Oportunidades sin comprar"
        icon={Sparkles}
        description="Solo oportunidades 100% gratuitas: se excluyen automáticamente las que exigen compras, depósitos, pagos de inscripción o suscripciones pagadas, y las que tienen señales de estafa."
      />
      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        {(['gratis', 'gratis_registro', 'gratis_actividad'] as const).map((k) => (
          <div key={k} className="card p-3">
            <div className="text-sm font-medium text-brand">{costTypes[k].label}</div>
            <div className="text-xs text-muted">{costTypes[k].description}</div>
          </div>
        ))}
      </div>
      <p className="mb-4 text-xs text-muted">
        * «inferido»: la página oficial no menciona ninguna condición de compra, pero tampoco dice explícitamente «sin compra». Confírmalo en los términos.
        Si hay condiciones indirectas (registro, redes sociales, actividades), se explican en la ficha.
      </p>
      <Explorer items={free} forceFree emptyHint="No hay oportunidades 100% gratuitas con estos filtros en este momento." />
    </div>
  )
}
