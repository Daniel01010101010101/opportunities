import { useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Radar, Search, SearchX } from 'lucide-react'
import { OpportunityCard } from '@/components/OpportunityCard'
import { ResearchModal } from '@/components/Research'
import { EmptyState, PageHeader } from '@/components/ui'
import { sortOps, SORTS, type SortKey } from '@/components/Explorer'
import { useData } from '@/lib/data'
import { EXAMPLE_QUERIES, parseQuery, searchOpportunities } from '@/lib/search'

export default function BuscarPage() {
  const [params, setParams] = useSearchParams()
  const q = params.get('q') ?? ''
  const sort = (params.get('sort') as SortKey) || 'prioridad'
  const { items } = useData()
  const navigate = useNavigate()
  const [research, setResearch] = useState(false)
  const pq = useMemo(() => parseQuery(q), [q])
  const active = useMemo(() => items.filter((o) => o.status !== 'vencida' && o.status !== 'retirada'), [items])
  const results = useMemo(() => {
    const base = q.trim() ? searchOpportunities(active, pq) : active
    return q.trim() && sort === 'prioridad' ? base : sortOps(base, sort)
  }, [active, pq, q, sort])
  const researchCategory = pq.categories[0] && ['gasolina', 'carros', 'motos', 'becas', 'formacion', 'vivienda', 'eventos_gratis'].includes(pq.categories[0])
    ? pq.categories[0] : pq.section ?? 'todas'

  return (
    <div>
      <PageHeader title={q ? `Resultados para «${q}»` : 'Buscar oportunidades'} icon={Search} description="La búsqueda entiende frases como «quiero ganar un carro» o «becas abiertas en Bogotá» y consulta todos los datos recopilados por el radar.">
        <select value={sort} onChange={(e) => { const n = new URLSearchParams(params); n.set('sort', e.target.value); setParams(n) }} className="input h-10 w-auto" aria-label="Ordenar">
          {SORTS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
        <button className="btn-ghost h-10" onClick={() => setResearch(true)}><Radar className="h-4 w-4" /> Investigar en la web</button>
      </PageHeader>
      {pq.explanation.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-2 text-xs text-muted">
          Interpretado como: {pq.explanation.map((e) => <span key={e} className="chip chip-on">{e}</span>)}
        </div>
      )}
      <div className="mb-5 flex flex-wrap gap-2">
        {EXAMPLE_QUERIES.map((ex) => <button key={ex} className="chip" onClick={() => navigate(`/buscar?q=${encodeURIComponent(ex)}`)}>{ex}</button>)}
      </div>
      <div className="mb-3 text-xs text-muted">{results.length} resultado(s)</div>
      {results.length === 0 ? (
        <EmptyState
          icon={SearchX}
          title="No hay oportunidades que coincidan en los datos recopilados"
          action={<button className="btn-primary" onClick={() => setResearch(true)}><Radar className="h-4 w-4" /> Lanzar una investigación nueva</button>}
        >
          Puedes pedirle al motor que busque «{q}» ahora mismo en noticias y fuentes públicas. Los resultados llegan en unos minutos.
        </EmptyState>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {results.slice(0, 60).map((o, i) => <OpportunityCard key={o.id} op={o} index={i} />)}
        </div>
      )}
      <ResearchModal open={research} onClose={() => setResearch(false)} initialQuery={q} initialCategory={researchCategory} />
    </div>
  )
}
