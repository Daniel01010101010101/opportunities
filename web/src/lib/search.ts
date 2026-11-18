/**
 * Búsqueda en lenguaje natural sobre los datos recopilados.
 * Ej.: "Quiero ganar un carro", "Becas abiertas en Bogotá", "Regalos sin comprar", "Promociones de Primax".
 */
import { categoryById } from './taxonomy'
import { daysUntil } from './format'
import type { Opportunity, SectionId } from './types'

const strip = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

const STOP = new Set(
  'quiero busco buscar ganar gana ganarme un una unos unas el la los las de del en para por con y o a al mi me que como hay donde ver todos todas algo cosas oportunidades oportunidad colombia'.split(' '),
)

/** sinónimos -> categoría */
const CATEGORY_SYNONYMS: [RegExp, string[]][] = [
  [/\b(carro|carros|auto|automovil|vehiculo|camioneta)\b/, ['carros']],
  [/\b(moto|motos|motocicleta)\b/, ['motos']],
  [/\b(dinero|plata|efectivo|millones|cash)\b/, ['dinero', 'cashback', 'ayudas']],
  [/\b(gasolina|combustible|tanqueo|terpel|primax|biomax|texaco)\b/, ['gasolina', 'bono_gasolina', 'of_transporte']],
  [/\b(viaje|viajes|vuelo|tiquetes|vacaciones)\b/, ['viajes', 'of_viajes']],
  [/\b(celular|iphone|telefono)\b/, ['celulares']],
  [/\b(computador|portatil|laptop|tablet)\b/, ['computadores']],
  [/\b(televisor|tv)\b/, ['televisores']],
  [/\b(nevera|lavadora|electrodomestico)/, ['electrodomesticos']],
  [/\b(bici|bicicleta)/, ['bicicletas']],
  [/\b(entradas|boletas|concierto|conciertos|cine|evento|eventos)\b/, ['entradas', 'eventos_gratis', 'of_entretenimiento']],
  [/\b(mercado|supermercado)\b/, ['supermercado', 'of_supermercados']],
  [/\b(beca|becas|estudiar|universidad)\b/, ['becas']],
  [/\b(curso|cursos|sena|formacion)\b/, ['formacion']],
  [/\b(vivienda|casa|arriendo)\b/, ['vivienda']],
  [/\b(empleo|trabajo)\b/, ['empleo']],
  [/\b(emprender|emprendimiento|negocio)\b/, ['emprendimiento']],
  [/\b(muestra|muestras)\b/, ['muestras']],
  [/\b(cumpleanos|cumple)\b/, ['cumpleanos']],
  [/\b(restaurante|comida)\b/, ['restaurantes', 'of_restaurantes']],
]
const SECTION_SYNONYMS: [RegExp, SectionId][] = [
  [/\b(concurso|concursos|sorteo|sorteos|premio|premios|rifa)\b/, 'concursos'],
  [/\b(bono|bonos|regalo|regalos|cashback|beneficio|beneficios gratis)\b/, 'bonos'],
  [/\b(oferta|ofertas|descuento|descuentos|promocion|promociones|2x1|black friday|dia sin iva)\b/, 'ofertas'],
  [/\b(gobierno|estado|subsidio|subsidios|convocatoria|convocatorias|alcaldia|ayuda|ayudas|publico|publicos)\b/, 'estado'],
]

export interface ParsedQuery {
  raw: string
  terms: string[]
  categories: string[]
  section: SectionId | null
  onlyFree: boolean
  bogota: boolean
  national: boolean
  openOnly: boolean
  expiringSoon: boolean
  explanation: string[]
}

export function parseQuery(q: string): ParsedQuery {
  const s = strip(q)
  const cats = new Set<string>()
  CATEGORY_SYNONYMS.forEach(([re, ids]) => { if (re.test(s)) ids.forEach((i) => cats.add(i)) })
  let section: SectionId | null = null
  for (const [re, id] of SECTION_SYNONYMS) if (re.test(s)) { section = id; break }
  const onlyFree = /\b(gratis|gratuit[oa]s?|sin comprar|sin compra|sin pagar|free|regalo|regalos)\b/.test(s)
  const bogota = /\bbogota\b/.test(s)
  const national = /\b(toda colombia|nacional|todo el pais)\b/.test(s)
  const openOnly = /\b(abierta|abiertas|abierto|vigente|vigentes|activas?)\b/.test(s)
  const expiringSoon = /\b(vence|vencen|ultima hora|pronto|urgente)\b/.test(s)
  const terms = s
    .replace(/[^a-z0-9ñ\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP.has(w))
  const explanation: string[] = []
  if (section) explanation.push(`Sección: ${section}`)
  if (cats.size) explanation.push(`Categorías: ${[...cats].map((c) => categoryById[c]?.label ?? c).join(', ')}`)
  if (onlyFree) explanation.push('Solo gratis')
  if (bogota) explanation.push('Disponible en Bogotá')
  if (national) explanation.push('Toda Colombia')
  if (openOnly) explanation.push('Vigentes / abiertas')
  if (expiringSoon) explanation.push('Vencen pronto')
  return { raw: q, terms, categories: [...cats], section, onlyFree, bogota, national, openOnly, expiringSoon, explanation }
}

const haystack = (o: Opportunity) =>
  strip([o.title, o.summary, o.organizer?.name, o.prize?.description, o.category, categoryById[o.category]?.label, o.tags?.join(' '),
    o.requirements?.join(' '), o.eligibility?.cities?.join(' ')].filter(Boolean).join(' '))

export function searchOpportunities(items: Opportunity[], pq: ParsedQuery): Opportunity[] {
  const scored: { o: Opportunity; s: number }[] = []
  for (const o of items) {
    if (pq.onlyFree && !o.cost?.free) continue
    if (pq.bogota && !['bogota', 'nacional'].includes(o.eligibility?.coverage)) continue
    if (pq.national && o.eligibility?.coverage !== 'nacional') continue
    if (pq.openOnly && !['activa', 'permanente'].includes(o.status)) continue
    if (pq.expiringSoon) {
      const d = daysUntil(o.dates?.end)
      if (d == null || d < 0 || d > 7) continue
    }
    const h = haystack(o)
    let s = 0
    if (pq.categories.length) s += pq.categories.includes(o.category) ? 6 : 0
    if (pq.section) s += o.section === pq.section ? 3 : 0
    let termHits = 0
    for (const t of pq.terms) if (h.includes(t)) termHits++
    s += termHits * 2
    const structured = pq.categories.length > 0 || pq.section !== null
    if (structured ? s < 3 : termHits === 0 && pq.terms.length > 0) continue
    s += (o.priority?.score ?? 0) / 25
    scored.push({ o, s })
  }
  return scored.sort((a, b) => b.s - a.s).map((x) => x.o)
}

export const EXAMPLE_QUERIES = [
  'Quiero ganar un carro',
  'Busco bonos de gasolina',
  'Concursos gratuitos en Colombia',
  'Quiero ganar dinero',
  'Promociones de Primax',
  'Regalos sin comprar',
  'Becas abiertas en Bogotá',
  'Beneficios del Gobierno',
  'Sorteos de motos',
]
