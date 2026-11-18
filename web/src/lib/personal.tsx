/**
 * Datos personales del usuario (favoritas, estados, checklist, notas, preferencias de alertas).
 *
 * Persistencia: localStorage del navegador, detrás de la interfaz `PersonalBackend` para poder
 * conectar más adelante una sincronización (Gist privado, Supabase, etc.) sin tocar la interfaz.
 * Nunca se guardan contraseñas, tarjetas, códigos OTP ni datos bancarios.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Opportunity } from './types'

export type TrackStatus = 'quiero' | 'participando' | 'reclamar' | 'ganado' | 'descartado'

export const TRACK_LABELS: Record<TrackStatus, string> = {
  quiero: 'Quiero participar',
  participando: 'Participando',
  reclamar: 'Por reclamar',
  ganado: 'Ganado',
  descartado: 'Descartado',
}

export interface TrackedItem {
  id: string
  favorite: boolean
  status: TrackStatus | null
  checklist: Record<string, boolean>
  customSteps: string[]
  notes: string
  prizeWon?: string
  updatedAt: string
  snapshot: { title: string; organizer: string; end: string | null; url: string | null; section: string; image: string | null }
}

export interface Preferences {
  alertSections: string[]
  alertCategories: string[]
  alertOnlyFree: boolean
  alertMinPriority: number
  browserNotifications: boolean
  lastVisit: string | null
  view: 'grid' | 'list'
}

interface PersonalData {
  version: 1
  items: Record<string, TrackedItem>
  prefs: Preferences
  seenIds: string[]
}

export interface PersonalBackend {
  load(): PersonalData | null
  save(data: PersonalData): void
}

const KEY = 'oportunia:v1:personal'
const localBackend: PersonalBackend = {
  load() {
    try {
      const raw = window.localStorage.getItem(KEY)
      return raw ? (JSON.parse(raw) as PersonalData) : null
    } catch {
      return null
    }
  },
  save(data) {
    try {
      window.localStorage.setItem(KEY, JSON.stringify(data))
    } catch {
      /* almacenamiento no disponible (modo privado): la app sigue funcionando sin persistencia */
    }
  },
}

const DEFAULT: PersonalData = {
  version: 1,
  items: {},
  prefs: {
    alertSections: ['concursos', 'bonos', 'ofertas', 'estado'],
    alertCategories: [],
    alertOnlyFree: false,
    alertMinPriority: 70,
    browserNotifications: false,
    lastVisit: null,
    view: 'grid',
  },
  seenIds: [],
}

interface Ctx {
  data: PersonalData
  previousVisit: string | null
  get: (id: string) => TrackedItem | undefined
  toggleFavorite: (op: Opportunity) => void
  setStatus: (op: Opportunity, status: TrackStatus | null) => void
  toggleStep: (op: Opportunity, key: string) => void
  addCustomStep: (op: Opportunity, text: string) => void
  removeCustomStep: (op: Opportunity, index: number) => void
  setNotes: (op: Opportunity, notes: string) => void
  setPrizeWon: (op: Opportunity, text: string) => void
  setPrefs: (p: Partial<Preferences>) => void
  markSeen: (ids: string[]) => void
  exportJson: () => string
  importJson: (raw: string) => { ok: boolean; message: string }
  clearAll: () => void
}

const PersonalCtx = createContext<Ctx | null>(null)

const snapshotOf = (op: Opportunity): TrackedItem['snapshot'] => ({
  title: op.title,
  organizer: op.organizer?.name ?? '',
  end: op.dates?.end ?? null,
  url: op.urls?.participate || op.urls?.source || null,
  section: op.section,
  image: op.urls?.image ?? null,
})

export function PersonalProvider({ children, backend = localBackend }: { children: ReactNode; backend?: PersonalBackend }) {
  const [data, setData] = useState<PersonalData>(() => {
    const loaded = backend.load()
    return loaded ? { ...DEFAULT, ...loaded, prefs: { ...DEFAULT.prefs, ...loaded.prefs } } : DEFAULT
  })
  const [previousVisit] = useState<string | null>(() => data.prefs.lastVisit)

  useEffect(() => {
    // registrar la visita actual (la anterior se conserva para "Novedades desde tu última visita")
    setData((d) => ({ ...d, prefs: { ...d.prefs, lastVisit: new Date().toISOString() } }))
  }, [])

  useEffect(() => backend.save(data), [data, backend])

  const update = useCallback((op: Opportunity, fn: (it: TrackedItem) => TrackedItem) => {
    setData((d) => {
      const cur: TrackedItem = d.items[op.id] ?? {
        id: op.id, favorite: false, status: null, checklist: {}, customSteps: [], notes: '', updatedAt: '', snapshot: snapshotOf(op),
      }
      const next = { ...fn({ ...cur }), snapshot: snapshotOf(op), updatedAt: new Date().toISOString() }
      const items = { ...d.items }
      const empty = !next.favorite && !next.status && !next.notes && !next.customSteps.length && !Object.values(next.checklist).some(Boolean)
      if (empty) delete items[op.id]
      else items[op.id] = next
      return { ...d, items }
    })
  }, [])

  const value = useMemo<Ctx>(() => ({
    data,
    previousVisit,
    get: (id) => data.items[id],
    toggleFavorite: (op) => update(op, (it) => ({ ...it, favorite: !it.favorite })),
    setStatus: (op, status) => update(op, (it) => ({ ...it, status })),
    toggleStep: (op, key) => update(op, (it) => ({ ...it, checklist: { ...it.checklist, [key]: !it.checklist[key] } })),
    addCustomStep: (op, text) => update(op, (it) => ({ ...it, customSteps: [...it.customSteps, text.slice(0, 200)] })),
    removeCustomStep: (op, index) => update(op, (it) => ({ ...it, customSteps: it.customSteps.filter((_, i) => i !== index) })),
    setNotes: (op, notes) => update(op, (it) => ({ ...it, notes: notes.slice(0, 4000) })),
    setPrizeWon: (op, text) => update(op, (it) => ({ ...it, prizeWon: text.slice(0, 300) })),
    setPrefs: (p) => setData((d) => ({ ...d, prefs: { ...d.prefs, ...p } })),
    markSeen: (ids) => setData((d) => ({ ...d, seenIds: Array.from(new Set([...d.seenIds, ...ids])).slice(-3000) })),
    exportJson: () => JSON.stringify({ ...data, exportedAt: new Date().toISOString() }, null, 2),
    importJson: (raw) => {
      try {
        const parsed = JSON.parse(raw) as PersonalData
        if (!parsed || typeof parsed !== 'object' || !parsed.items) return { ok: false, message: 'El archivo no tiene el formato de OPORTUNIA RADAR.' }
        setData((d) => ({
          ...d,
          items: { ...d.items, ...parsed.items },
          prefs: { ...d.prefs, ...(parsed.prefs || {}) },
          seenIds: Array.from(new Set([...d.seenIds, ...(parsed.seenIds || [])])),
        }))
        return { ok: true, message: `Importadas ${Object.keys(parsed.items).length} oportunidades guardadas.` }
      } catch {
        return { ok: false, message: 'No se pudo leer el archivo JSON.' }
      }
    },
    clearAll: () => setData({ ...DEFAULT, prefs: { ...DEFAULT.prefs, lastVisit: new Date().toISOString() } }),
  }), [data, previousVisit, update])

  return <PersonalCtx.Provider value={value}>{children}</PersonalCtx.Provider>
}

export const usePersonal = () => {
  const v = useContext(PersonalCtx)
  if (!v) throw new Error('usePersonal fuera de PersonalProvider')
  return v
}
