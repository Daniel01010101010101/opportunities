import { useRef, useState } from 'react'
import { Download, ExternalLink, KeyRound, Settings, Trash2, Upload } from 'lucide-react'
import { PageHeader, SectionTitle } from '@/components/ui'
import { usePersonal } from '@/lib/personal'
import { useData } from '@/lib/data'
import { getToken, REPO, repoUrl, setToken, workflowUrl } from '@/lib/github'
import { fmtDateTime } from '@/lib/format'

export default function AjustesPage() {
  const personal = usePersonal()
  const { status } = useData()
  const [token, setTok] = useState(getToken())
  const [msg, setMsg] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const saved = Boolean(getToken())

  const exportData = () => {
    const blob = new Blob([personal.exportJson()], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `oportunia-radar-respaldo-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Ajustes" icon={Settings} description="Conexión opcional con GitHub para lanzar búsquedas desde aquí y respaldo de tus datos personales." />

      <section className="card p-5">
        <SectionTitle title="Lanzar búsquedas desde la página (opcional)" icon={KeyRound} />
        <div className="space-y-2 text-sm text-ink/85">
          <p>Para que el botón «Investigar ahora» ejecute el motor directamente, crea un <b>token fine-grained</b> en GitHub:</p>
          <ol className="list-decimal space-y-1 pl-5 text-[13px]">
            <li>GitHub → Settings → Developer settings → Personal access tokens → <b>Fine-grained tokens</b> → Generate new token.</li>
            <li>Repository access: <b>Only select repositories</b> → {REPO || 'tu repositorio'}.</li>
            <li>Permisos: <b>Actions: Read and write</b> y (para guardar alertas) <b>Contents: Read and write</b>. Nada más.</li>
            <li>Ponle fecha de expiración y pégalo aquí.</li>
          </ol>
          <p className="text-xs text-muted">El token se guarda solo en el almacenamiento local de este navegador y se envía únicamente a api.github.com. No se publica en el sitio ni en el repositorio. Sin token, el botón abre GitHub para lanzar la búsqueda allí.</p>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <input type="password" value={token} onChange={(e) => setTok(e.target.value)} placeholder="github_pat_…" className="input max-w-md" autoComplete="off" aria-label="Token de GitHub" />
          <button className="btn-primary" onClick={() => { setToken(token); setMsg(token ? 'Token guardado en este navegador.' : 'Token eliminado.') }}>Guardar</button>
          {saved && <button className="btn-ghost" onClick={() => { setToken(''); setTok(''); setMsg('Token eliminado.') }}><Trash2 className="h-4 w-4" /> Eliminar</button>}
        </div>
        {msg && <p className="mt-2 text-xs text-brand">{msg}</p>}
      </section>

      <section className="card p-5">
        <SectionTitle title="Mis datos personales" icon={Download} subtitle="Favoritas, estados, checklist, notas y preferencias" />
        <p className="mb-3 text-sm text-muted">
          Se guardan en este navegador (localStorage). Para usarlos en otro dispositivo, exporta un respaldo e impórtalo allá.
          La arquitectura está preparada para una sincronización futura (por ejemplo, un Gist privado o Supabase) sin cambiar la interfaz.
        </p>
        <div className="flex flex-wrap gap-2">
          <button className="btn-ghost" onClick={exportData}><Download className="h-4 w-4" /> Exportar respaldo</button>
          <button className="btn-ghost" onClick={() => fileRef.current?.click()}><Upload className="h-4 w-4" /> Importar respaldo</button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json"
            className="hidden"
            onChange={async (e) => {
              const f = e.target.files?.[0]
              if (!f) return
              const r = personal.importJson(await f.text())
              setMsg(r.message)
              e.target.value = ''
            }}
          />
          <button className="btn-ghost text-danger" onClick={() => { if (window.confirm('¿Borrar todos tus datos personales de este navegador?')) { personal.clearAll(); setMsg('Datos personales borrados.') } }}>
            <Trash2 className="h-4 w-4" /> Borrar mis datos
          </button>
        </div>
      </section>

      <section className="card p-5 text-sm">
        <SectionTitle title="Acerca del sistema" />
        <ul className="space-y-1 text-ink/85">
          <li>Repositorio: {repoUrl ? <a href={repoUrl} className="text-brand hover:underline" target="_blank" rel="noopener noreferrer">{REPO} <ExternalLink className="inline h-3 w-3" /></a> : 'no detectado'}</li>
          <li>Workflow del motor: {workflowUrl ? <a href={workflowUrl} className="text-brand hover:underline" target="_blank" rel="noopener noreferrer">radar.yml</a> : '—'}</li>
          <li>Datos generados: {status ? fmtDateTime(status.generated_at) : 'sin datos'} · motor v{status?.engine_version ?? '—'}</li>
          <li>Extracción con IA: {status?.llm?.enabled ? `activa (${status.llm.model})` : 'no configurada (solo reglas automáticas)'}</li>
          <li>Build del sitio: {__BUILD_SHA__ || 'local'}</li>
        </ul>
      </section>
    </div>
  )
}
