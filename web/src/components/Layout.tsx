import { useEffect, useState, type FormEvent } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import {
  Activity, Bell, CalendarDays, Gift, Heart, Landmark, LayoutDashboard, Menu, Percent, Radar, Search, Settings, Sparkles, Trophy, X,
} from 'lucide-react'
import { DetailHost } from './OpportunityDetail'
import { EngineBanner, useEngineHealth } from './EngineBanner'
import { ResearchModal } from './Research'
import { useData } from '@/lib/data'
import { usePersonal } from '@/lib/personal'
import { ago, cn, fmtTime } from '@/lib/format'

const NAV = [
  { group: 'Radar', items: [{ to: '/', label: 'Radar general', icon: LayoutDashboard, end: true }] },
  {
    group: 'Explorar',
    items: [
      { to: '/concursos', label: 'Concursos y sorteos', icon: Trophy, count: 'concursos' },
      { to: '/bonos', label: 'Bonos y beneficios', icon: Gift, count: 'bonos' },
      { to: '/ofertas', label: 'Ofertas y descuentos', icon: Percent, count: 'ofertas' },
      { to: '/estado', label: 'Beneficios del Estado', icon: Landmark, count: 'estado' },
      { to: '/sin-comprar', label: 'Sin comprar', icon: Sparkles, count: 'free' },
      { to: '/calendario', label: 'Calendario', icon: CalendarDays },
    ],
  },
  {
    group: 'Personal',
    items: [
      { to: '/mis', label: 'Mis oportunidades', icon: Heart, count: 'mine' },
      { to: '/alertas', label: 'Alertas', icon: Bell },
    ],
  },
  {
    group: 'Sistema',
    items: [
      { to: '/monitoreo', label: 'Monitoreo', icon: Activity },
      { to: '/ajustes', label: 'Ajustes', icon: Settings },
    ],
  },
] as const

function Logo() {
  return (
    <div className="flex items-center gap-3">
      <div className="relative grid h-10 w-10 place-items-center overflow-hidden rounded-xl border border-brand/40 bg-surface2">
        <div className="radar-sweep absolute inset-0 animate-sweep rounded-full" />
        <div className="absolute h-6 w-6 rounded-full border border-brand/40" />
        <Radar className="relative h-5 w-5 text-brand" aria-hidden />
      </div>
      <div className="leading-tight">
        <div className="font-display text-[15px] font-bold tracking-[0.14em] text-ink">OPORTUNIA</div>
        <div className="font-display text-[11px] font-semibold tracking-[0.42em] text-brand">RADAR</div>
      </div>
    </div>
  )
}

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const { status } = useData()
  const personal = usePersonal()
  const health = useEngineHealth()
  const mine = Object.values(personal.data.items).filter((i) => i.favorite || (i.status && i.status !== 'descartado')).length
  const counts: Record<string, number | undefined> = {
    concursos: status?.counts.by_section.concursos,
    bonos: status?.counts.by_section.bonos,
    ofertas: status?.counts.by_section.ofertas,
    estado: status?.counts.by_section.estado,
    free: status?.counts.free,
    mine,
  }
  const dot = health.level === 'ok' ? 'bg-brand' : health.level === 'stale' || health.level === 'empty' ? 'bg-warn' : health.level === 'error' ? 'bg-danger' : 'bg-muted'
  return (
    <div className="flex h-full flex-col">
      <div className="px-5 pb-6 pt-5"><Logo /></div>
      <nav className="flex-1 space-y-5 overflow-y-auto px-3" aria-label="Navegación principal">
        {NAV.map((g) => (
          <div key={g.group}>
            <div className="label mb-1.5 px-3">{g.group}</div>
            <ul className="space-y-0.5">
              {g.items.map((it) => {
                const Icon = it.icon
                const n = 'count' in it ? counts[it.count] : undefined
                return (
                  <li key={it.to}>
                    <NavLink
                      to={it.to}
                      end={'end' in it ? it.end : false}
                      onClick={onNavigate}
                      className={({ isActive }) =>
                        cn(
                          'group flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition',
                          isActive ? 'bg-brand/10 text-brand shadow-[inset_2px_0_0_0_#00D68F]' : 'text-ink/75 hover:bg-surface2 hover:text-ink',
                        )
                      }
                    >
                      <Icon className="h-4 w-4 shrink-0" aria-hidden />
                      <span className="flex-1 truncate">{it.label}</span>
                      {n != null && n > 0 && <span className="rounded-md bg-surface2 px-1.5 text-[11px] tabular-nums text-muted group-hover:text-ink">{n}</span>}
                    </NavLink>
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
      </nav>
      <NavLink to="/monitoreo" onClick={onNavigate} className="m-3 rounded-xl border border-line bg-surface2/60 p-3 text-xs hover:border-brand/40">
        <div className="flex items-center gap-2 font-medium text-ink">
          <span className={cn('h-2 w-2 rounded-full', dot, health.level === 'ok' && 'animate-pulse')} />
          Motor de búsqueda
        </div>
        {status ? (
          <div className="mt-1.5 space-y-0.5 text-muted">
            <div>Actualizado {ago(status.generated_at)}</div>
            <div>Próxima: {fmtTime(status.schedule.next_run_at)} (Bogotá)</div>
          </div>
        ) : <div className="mt-1.5 text-muted">Sin ejecuciones publicadas todavía</div>}
      </NavLink>
    </div>
  )
}

export function Layout() {
  const [menu, setMenu] = useState(false)
  const [research, setResearch] = useState(false)
  const [q, setQ] = useState('')
  const navigate = useNavigate()
  const location = useLocation()

  useEffect(() => {
    window.scrollTo({ top: 0 })
    setMenu(false)
  }, [location.pathname])

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (q.trim()) navigate(`/buscar?q=${encodeURIComponent(q.trim())}`)
  }

  return (
    <div className="min-h-full">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 border-r border-line/70 bg-bg/80 backdrop-blur-xl lg:block">
        <SidebarContent />
      </aside>
      {menu && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button className="absolute inset-0 bg-black/60" onClick={() => setMenu(false)} aria-label="Cerrar menú" />
          <aside className="relative h-full w-72 border-r border-line bg-bg animate-slide-in">
            <button className="btn-quiet absolute right-2 top-4 rounded-full p-2" onClick={() => setMenu(false)} aria-label="Cerrar menú"><X className="h-5 w-5" /></button>
            <SidebarContent onNavigate={() => setMenu(false)} />
          </aside>
        </div>
      )}
      <div className="lg:pl-64">
        <header className="sticky top-0 z-20 border-b border-line/60 bg-bg/75 backdrop-blur-xl">
          <div className="mx-auto flex max-w-[1500px] items-center gap-3 px-4 py-3 sm:px-6">
            <button className="btn-quiet rounded-xl p-2 lg:hidden" onClick={() => setMenu(true)} aria-label="Abrir menú"><Menu className="h-5 w-5" /></button>
            <form onSubmit={submit} className="relative flex-1" role="search">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Busca: «quiero ganar un carro», «bonos de gasolina», «becas abiertas en Bogotá»…"
                className="input h-10 pl-9"
                aria-label="Búsqueda global"
              />
            </form>
            <button className="btn-primary h-10 shrink-0" onClick={() => setResearch(true)}>
              <Radar className="h-4 w-4" /> <span className="hidden sm:inline">Investigar ahora</span>
            </button>
          </div>
        </header>
        <main className="mx-auto max-w-[1500px] px-4 py-6 sm:px-6">
          <EngineBanner />
          <Outlet />
        </main>
        <footer className="mx-auto max-w-[1500px] px-4 pb-8 text-xs text-muted sm:px-6">
          OPORTUNIA RADAR · Datos públicos recopilados automáticamente. La puntuación indica prioridad de revisión, no probabilidad de ganar.
          Verifica siempre las condiciones en el sitio oficial. {__BUILD_SHA__ && <span>· build {__BUILD_SHA__}</span>}
        </footer>
      </div>
      <DetailHost />
      <ResearchModal open={research} onClose={() => setResearch(false)} />
    </div>
  )
}
