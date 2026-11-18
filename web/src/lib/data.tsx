import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { ChangeRecord, EngineStatus, Opportunity, RunRecord, SourceInfo } from './types'

interface DataState {
  loading: boolean
  error: string | null
  items: Opportunity[]
  status: EngineStatus | null
  runs: RunRecord[]
  sources: SourceInfo[]
  changes: ChangeRecord[]
  loadedAt: Date | null
  reload: () => void
  byId: Map<string, Opportunity>
  loadArchive: () => Promise<Opportunity[]>
}

const Ctx = createContext<DataState | null>(null)
const base = import.meta.env.BASE_URL.replace(/\/?$/, '/')

async function getJson<T>(name: string): Promise<T | null> {
  const res = await fetch(`${base}data/${name}`, { cache: 'no-cache' })
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`)
  return (await res.json()) as T
}

export function DataProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<Omit<DataState, 'reload' | 'byId' | 'loadArchive'>>({
    loading: true, error: null, items: [], status: null, runs: [], sources: [], changes: [], loadedAt: null,
  })

  const load = useCallback(async () => {
    try {
      const [ops, status, runs, sources, changes] = await Promise.all([
        getJson<{ items: Opportunity[] }>('opportunities.json'),
        getJson<EngineStatus>('status.json'),
        getJson<{ runs: RunRecord[] }>('runs.json'),
        getJson<{ sources: SourceInfo[] }>('sources.json'),
        getJson<{ changes: ChangeRecord[] }>('changes.json'),
      ])
      setState({
        loading: false,
        error: null,
        items: ops?.items ?? [],
        status,
        runs: runs?.runs ?? [],
        sources: sources?.sources ?? [],
        changes: changes?.changes ?? [],
        loadedAt: new Date(),
      })
    } catch (e) {
      setState((s) => ({ ...s, loading: false, error: e instanceof Error ? e.message : String(e) }))
    }
  }, [])

  useEffect(() => {
    load()
    // Los datos cambian cuando GitHub Pages publica una nueva ejecución: se revisa cada 5 minutos.
    const t = window.setInterval(load, 5 * 60 * 1000)
    return () => window.clearInterval(t)
  }, [load])

  const byId = useMemo(() => new Map(state.items.map((o) => [o.id, o])), [state.items])
  const loadArchive = useCallback(async () => (await getJson<{ items: Opportunity[] }>('archive.json'))?.items ?? [], [])

  return <Ctx.Provider value={{ ...state, reload: load, byId, loadArchive }}>{children}</Ctx.Provider>
}

export const useData = () => {
  const v = useContext(Ctx)
  if (!v) throw new Error('useData fuera de DataProvider')
  return v
}
