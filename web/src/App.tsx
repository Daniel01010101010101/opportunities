import { lazy, Suspense, useEffect } from 'react'
import { HashRouter, Route, Routes } from 'react-router-dom'
import { Layout } from '@/components/Layout'
import { Skeleton } from '@/components/ui'
import { DataProvider, useData } from '@/lib/data'
import { PersonalProvider, usePersonal } from '@/lib/personal'
import { matchesPrefs } from '@/lib/alerts'
import RadarPage from '@/pages/Radar'

const SectionPage = lazy(() => import('@/pages/Section'))
const SinComprarPage = lazy(() => import('@/pages/SinComprar'))
const CalendarioPage = lazy(() => import('@/pages/Calendario'))
const MisPage = lazy(() => import('@/pages/Mis'))
const AlertasPage = lazy(() => import('@/pages/Alertas'))
const MonitoreoPage = lazy(() => import('@/pages/Monitoreo'))
const BuscarPage = lazy(() => import('@/pages/Buscar'))
const AjustesPage = lazy(() => import('@/pages/Ajustes'))

/** Notificaciones del navegador con la página abierta: novedades que cumplen las preferencias del usuario. */
function BrowserNotifier() {
  const { items } = useData()
  const personal = usePersonal()
  const { prefs, seenIds } = personal.data
  useEffect(() => {
    if (!items.length) return
    const seen = new Set(seenIds)
    const fresh = items.filter((o) => !seen.has(o.id))
    if (!fresh.length) return
    if (prefs.browserNotifications && 'Notification' in window && Notification.permission === 'granted' && seenIds.length > 0) {
      const matching = fresh.filter((o) => matchesPrefs(o, prefs) && o.priority.score >= prefs.alertMinPriority)
      matching.slice(0, 3).forEach((o) => {
        try {
          new Notification('OPORTUNIA RADAR: nueva oportunidad', { body: o.title, icon: `${import.meta.env.BASE_URL}favicon.svg`, tag: o.id })
        } catch {
          /* algunos navegadores móviles solo permiten notificaciones desde un service worker */
        }
      })
    }
    personal.markSeen(fresh.map((o) => o.id))
  }, [items]) // eslint-disable-line react-hooks/exhaustive-deps
  return null
}

const Fallback = () => <div className="space-y-4"><Skeleton className="h-16" /><Skeleton className="h-64" /></div>

export default function App() {
  return (
    <DataProvider>
      <PersonalProvider>
        <BrowserNotifier />
        <HashRouter>
          <Suspense fallback={<Fallback />}>
            <Routes>
              <Route element={<Layout />}>
                <Route index element={<RadarPage />} />
                <Route path="concursos" element={<SectionPage section="concursos" key="concursos" />} />
                <Route path="bonos" element={<SectionPage section="bonos" key="bonos" />} />
                <Route path="ofertas" element={<SectionPage section="ofertas" key="ofertas" />} />
                <Route path="estado" element={<SectionPage section="estado" key="estado" />} />
                <Route path="sin-comprar" element={<SinComprarPage />} />
                <Route path="calendario" element={<CalendarioPage />} />
                <Route path="mis" element={<MisPage />} />
                <Route path="alertas" element={<AlertasPage />} />
                <Route path="monitoreo" element={<MonitoreoPage />} />
                <Route path="buscar" element={<BuscarPage />} />
                <Route path="ajustes" element={<AjustesPage />} />
                <Route path="*" element={<RadarPage />} />
              </Route>
            </Routes>
          </Suspense>
        </HashRouter>
      </PersonalProvider>
    </DataProvider>
  )
}
