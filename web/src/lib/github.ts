/**
 * Integración con GitHub Actions desde el navegador.
 *
 * - Lectura pública (sin token): estado de las ejecuciones del workflow.
 * - Lanzar una búsqueda manual / guardar preferencias de alertas: requiere un token personal
 *   (fine-grained, SOLO para este repositorio, permisos "Actions: write" y "Contents: write").
 *   El token se guarda únicamente en el almacenamiento local de TU navegador; nunca se publica
 *   en el sitio ni en el repositorio. Sin token, los botones abren la página de GitHub para hacerlo allí.
 */
const TOKEN_KEY = 'oportunia:gh-token'
export const WORKFLOW_FILE = 'radar.yml'

function detectRepo(): string {
  if (__GITHUB_REPO__) return __GITHUB_REPO__
  const { hostname, pathname } = window.location
  const m = hostname.match(/^([^.]+)\.github\.io$/)
  const repo = pathname.split('/').filter(Boolean)[0]
  return m && repo ? `${m[1]}/${repo}` : ''
}

export const REPO = detectRepo()
export const repoUrl = REPO ? `https://github.com/${REPO}` : ''
export const workflowUrl = REPO ? `${repoUrl}/actions/workflows/${WORKFLOW_FILE}` : ''

export const getToken = (): string => {
  try {
    return window.localStorage.getItem(TOKEN_KEY) || ''
  } catch {
    return ''
  }
}
export const setToken = (t: string) => {
  try {
    if (t) window.localStorage.setItem(TOKEN_KEY, t.trim())
    else window.localStorage.removeItem(TOKEN_KEY)
  } catch {
    /* sin almacenamiento */
  }
}

const api = async (path: string, init: RequestInit = {}, auth = true) => {
  const headers: Record<string, string> = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' }
  const token = getToken()
  if (auth && token) headers.Authorization = `Bearer ${token}`
  return fetch(`https://api.github.com${path}`, { ...init, headers: { ...headers, ...(init.headers as Record<string, string>) } })
}

export interface WorkflowRun {
  id: number
  status: 'queued' | 'in_progress' | 'completed' | 'waiting' | 'requested' | 'pending'
  conclusion: string | null
  event: string
  created_at: string
  updated_at: string
  html_url: string
  display_title: string
  run_started_at?: string
}

export async function latestRuns(limit = 6): Promise<WorkflowRun[]> {
  if (!REPO) return []
  const res = await api(`/repos/${REPO}/actions/workflows/${WORKFLOW_FILE}/runs?per_page=${limit}`, {}, Boolean(getToken()))
  if (!res.ok) throw new Error(`GitHub respondió ${res.status}`)
  const data = await res.json()
  return data.workflow_runs ?? []
}

let defaultBranchCache = ''
async function defaultBranch(): Promise<string> {
  if (defaultBranchCache) return defaultBranchCache
  const res = await api(`/repos/${REPO}`)
  if (!res.ok) throw new Error(`No se pudo leer el repositorio (${res.status})`)
  defaultBranchCache = (await res.json()).default_branch
  return defaultBranchCache
}

export async function dispatchResearch(inputs: { category?: string; query?: string; full?: boolean }) {
  if (!REPO) throw new Error('No se pudo identificar el repositorio de GitHub.')
  if (!getToken()) throw new Error('Configura un token en Ajustes para lanzar búsquedas desde aquí.')
  const ref = await defaultBranch()
  const body = {
    ref,
    inputs: {
      category: inputs.category || 'todas',
      query: (inputs.query || '').slice(0, 120),
      full: inputs.full ? 'true' : 'false',
    },
  }
  const res = await api(`/repos/${REPO}/actions/workflows/${WORKFLOW_FILE}/dispatches`, { method: 'POST', body: JSON.stringify(body) })
  if (res.status === 204) return true
  const msg = await res.text()
  if (res.status === 401 || res.status === 403) throw new Error('El token no tiene permiso "Actions: write" sobre este repositorio.')
  throw new Error(`GitHub respondió ${res.status}: ${msg.slice(0, 160)}`)
}

const b64 = (s: string) => btoa(unescape(encodeURIComponent(s)))

export async function saveRepoFile(path: string, content: string, message: string) {
  if (!getToken()) throw new Error('Configura un token en Ajustes para guardar en el repositorio.')
  const ref = await defaultBranch()
  const cur = await api(`/repos/${REPO}/contents/${path}?ref=${ref}`)
  const sha = cur.ok ? (await cur.json()).sha : undefined
  const res = await api(`/repos/${REPO}/contents/${path}`, {
    method: 'PUT',
    body: JSON.stringify({ message, content: b64(content), branch: ref, sha }),
  })
  if (!res.ok) {
    if (res.status === 401 || res.status === 403 || res.status === 404) throw new Error('El token no tiene permiso "Contents: write" sobre este repositorio.')
    throw new Error(`GitHub respondió ${res.status}`)
  }
  return true
}

export const editFileUrl = (path: string) => (REPO ? `${repoUrl}/edit/HEAD/${path}` : '')
