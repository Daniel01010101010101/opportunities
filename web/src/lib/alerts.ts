import type { Preferences } from './personal'
import type { Opportunity } from './types'

/** ¿La oportunidad cumple las preferencias de alertas del usuario? */
export function matchesPrefs(o: Opportunity, p: Preferences) {
  if (o.status === 'vencida' || o.status === 'retirada' || o.risk?.level === 'alto') return false
  if (p.alertSections.length && !p.alertSections.includes(o.section)) return false
  if (p.alertCategories.length && !p.alertCategories.includes(o.category)) return false
  if (p.alertOnlyFree && !o.cost?.free) return false
  return true
}
