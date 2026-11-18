import { useEffect, useMemo, useState } from 'react'
import { Bell, BellRing, Copy, ExternalLink, Mail, Save, Send } from 'lucide-react'
import { OpportunityRow } from '@/components/OpportunityCard'
import { Badge, EmptyState, PageHeader, SectionTitle, Toggle } from '@/components/ui'
import { useData } from '@/lib/data'
import { usePersonal } from '@/lib/personal'
import { categoriesOf, sections } from '@/lib/taxonomy'
import { cn, daysUntil } from '@/lib/format'
import { editFileUrl, getToken, saveRepoFile } from '@/lib/github'
import type { SectionId } from '@/lib/types'
import { matchesPrefs } from '@/lib/alerts'

const base = import.meta.env.BASE_URL.replace(/\/?$/, '/')

export default function AlertasPage() {
  const { items, status } = useData()
  const personal = usePersonal()
  const prefs = personal.data.prefs
  const [perm, setPerm] = useState<NotificationPermission | 'unsupported'>(() => ('Notification' in window ? Notification.permission : 'unsupported'))
  const [serverCfg, setServerCfg] = useState<Record<string, unknown> | null>(null)
  const [saveMsg, setSaveMsg] = useState('')

  useEffect(() => {
    fetch(`${base}data/alerts-config.json`, { cache: 'no-cache' }).then((r) => (r.ok ? r.json() : null)).then(setServerCfg).catch(() => setServerCfg(null))
  }, [])

  const since = personal.previousVisit
  const fresh = useMemo(() => items.filter((o) => matchesPrefs(o, prefs) && (!since || o.discovered_at > since) && o.priority.score >= prefs.alertMinPriority), [items, prefs, since])
  const expiring = useMemo(() => items.filter((o) => { const d = daysUntil(o.dates?.end); return matchesPrefs(o, prefs) && d != null && d >= 0 && d <= 1 }), [items, prefs])

  const cfgJson = JSON.stringify({
    enabled: true,
    channels: { telegram: true, email: true },
    min_priority: prefs.alertMinPriority,
    sections: prefs.alertSections,
    categories: prefs.alertCategories,
    only_free: prefs.alertOnlyFree,
    notify_new_high_priority: true,
    notify_expiring_hours: 24,
    notify_gasoline: true,
    notify_opening_calls: true,
    max_per_run: 10,
  }, null, 2)

  const toggleSection = (s: SectionId) =>
    personal.setPrefs({ alertSections: prefs.alertSections.includes(s) ? prefs.alertSections.filter((x) => x !== s) : [...prefs.alertSections, s] })
  const toggleCat = (c: string) =>
    personal.setPrefs({ alertCategories: prefs.alertCategories.includes(c) ? prefs.alertCategories.filter((x) => x !== c) : [...prefs.alertCategories, c] })

  const enableBrowser = async (on: boolean) => {
    if (!on) return personal.setPrefs({ browserNotifications: false })
    if (!('Notification' in window)) return
    const p = await Notification.requestPermission()
    setPerm(p)
    personal.setPrefs({ browserNotifications: p === 'granted' })
  }

  const saveToRepo = async () => {
    setSaveMsg('Guardando…')
    try {
      await saveRepoFile('config/alerts.json', cfgJson + '\n', 'Actualizar preferencias de alertas desde OPORTUNIA RADAR')
      setSaveMsg('Guardado en config/alerts.json. Se aplicará desde la próxima ejecución del motor.')
    } catch (e) {
      setSaveMsg(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div className="space-y-8">
      <PageHeader title="Alertas y notificaciones" icon={Bell} description="Elige qué quieres recibir. Las alertas por Telegram o correo las envía el motor desde GitHub Actions usando secretos del repositorio: ningún token queda expuesto en esta página." />

      <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="card p-4">
          <SectionTitle title="Qué quiero recibir" subtitle="Se guarda en este navegador y puedes publicarlo para el motor" />
          <div className="label mb-2">Secciones</div>
          <div className="mb-4 flex flex-wrap gap-2">
            {sections.map((s) => <button key={s.id} onClick={() => toggleSection(s.id)} className={cn('chip', prefs.alertSections.includes(s.id) && 'chip-on')}>{s.short}</button>)}
          </div>
          <div className="label mb-2">Categorías específicas (opcional; vacío = todas)</div>
          <div className="mb-4 max-h-44 overflow-y-auto">
            {sections.map((s) => (
              <div key={s.id} className="mb-2 flex flex-wrap gap-1.5">
                {categoriesOf(s.id).map((c) => <button key={c.id} onClick={() => toggleCat(c.id)} className={cn('chip px-2 py-0.5 text-[11px]', prefs.alertCategories.includes(c.id) && 'chip-on')}>{c.label}</button>)}
              </div>
            ))}
          </div>
          <Toggle checked={prefs.alertOnlyFree} onChange={(v) => personal.setPrefs({ alertOnlyFree: v })} label="Solo oportunidades gratuitas" />
          <label className="block py-2">
            <span className="flex justify-between text-sm"><span>Prioridad mínima</span><span className="tabular-nums text-brand">{prefs.alertMinPriority}</span></span>
            <input type="range" min={0} max={100} step={5} value={prefs.alertMinPriority} onChange={(e) => personal.setPrefs({ alertMinPriority: Number(e.target.value) })} className="mt-2 w-full accent-[#00D68F]" />
          </label>
          <p className="text-xs text-muted">Siempre se avisa además de: bonos de gasolina gratuitos nuevos, convocatorias que abren y oportunidades que vencen en 24 horas.</p>
        </div>

        <div className="space-y-4">
          <div className="card p-4">
            <SectionTitle title="Notificaciones del navegador" icon={BellRing} />
            <Toggle
              checked={prefs.browserNotifications && perm === 'granted'}
              onChange={enableBrowser}
              label="Avisarme en este dispositivo"
              description={perm === 'unsupported' ? 'Este navegador no soporta notificaciones.' : perm === 'denied' ? 'Bloqueaste las notificaciones para este sitio; actívalas en la configuración del navegador.' : 'Al abrir la página se te avisa de las novedades que coinciden con tus preferencias (no funciona con la página cerrada; para eso usa Telegram o correo).'}
            />
          </div>
          <div className="card p-4">
            <SectionTitle title="Telegram y correo (desde el servidor)" icon={Send} />
            <div className="mb-3 flex flex-wrap gap-2">
              <Badge tone={status?.alerts_configured?.telegram ? 'brand' : 'muted'} icon={Send}>Telegram {status?.alerts_configured?.telegram ? 'configurado' : 'sin configurar'}</Badge>
              <Badge tone={status?.alerts_configured?.email ? 'brand' : 'muted'} icon={Mail}>Correo {status?.alerts_configured?.email ? 'configurado' : 'sin configurar'}</Badge>
            </div>
            <ol className="list-decimal space-y-1 pl-5 text-[13px] text-ink/85">
              <li>Telegram: crea un bot con <b>@BotFather</b>, copia el token y obtén tu chat ID (envía un mensaje al bot y consulta <code className="text-brand">getUpdates</code>).</li>
              <li>En GitHub → Settings → Secrets and variables → Actions, crea <code className="text-brand">TELEGRAM_BOT_TOKEN</code> y <code className="text-brand">TELEGRAM_CHAT_ID</code>.</li>
              <li>Correo (opcional): <code className="text-brand">SMTP_HOST</code>, <code className="text-brand">SMTP_USER</code>, <code className="text-brand">SMTP_PASSWORD</code>, <code className="text-brand">ALERT_EMAIL_TO</code> (y <code className="text-brand">SMTP_PORT</code> si no es 465).</li>
              <li>Publica tus preferencias en <code className="text-brand">config/alerts.json</code> con el botón de abajo.</li>
            </ol>
            <div className="mt-3 flex flex-wrap gap-2">
              <button className="btn-primary" onClick={saveToRepo} disabled={!getToken()} title={getToken() ? '' : 'Requiere token en Ajustes'}><Save className="h-4 w-4" /> Guardar en el repositorio</button>
              <button className="btn-ghost" onClick={() => navigator.clipboard?.writeText(cfgJson).then(() => setSaveMsg('JSON copiado. Pégalo en config/alerts.json.'))}><Copy className="h-4 w-4" /> Copiar JSON</button>
              {editFileUrl('config/alerts.json') && <a className="btn-ghost" href={editFileUrl('config/alerts.json')} target="_blank" rel="noopener noreferrer">Editar en GitHub <ExternalLink className="h-4 w-4" /></a>}
            </div>
            {saveMsg && <p className="mt-2 text-xs text-brand">{saveMsg}</p>}
            {serverCfg && (
              <details className="mt-3 text-xs text-muted">
                <summary className="cursor-pointer">Configuración activa en el motor</summary>
                <pre className="mt-2 overflow-x-auto rounded-lg bg-surface2 p-2">{JSON.stringify(serverCfg, null, 2)}</pre>
              </details>
            )}
          </div>
        </div>
      </section>

      <section>
        <SectionTitle title="Novedades para ti" subtitle={since ? 'Nuevas desde tu última visita que cumplen tus preferencias' : 'Primera visita: oportunidades que cumplen tus preferencias'} icon={BellRing} />
        {fresh.length ? <div className="flex flex-col gap-2">{fresh.slice(0, 20).map((o) => <OpportunityRow key={o.id} op={o} />)}</div> : <EmptyState title="Sin novedades con tus preferencias" />}
      </section>
      <section>
        <SectionTitle title="Vencen en 24 horas" icon={Bell} />
        {expiring.length ? <div className="flex flex-col gap-2">{expiring.map((o) => <OpportunityRow key={o.id} op={o} />)}</div> : <EmptyState title="Nada de tus categorías vence en las próximas 24 horas" />}
      </section>
    </div>
  )
}
