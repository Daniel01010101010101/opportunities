/**
 * Gráficos (Recharts). Paleta validada con el validador de dataviz para la superficie oscura #111A15:
 * serie 1 #00A86B, serie 2 #5B8DEF (lightness band, CVD ΔE ≥ 20, contraste ≥ 3:1).
 * Barras de una sola serie => sin leyenda; dos series => leyenda + etiquetas de texto.
 */
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { fmtDateTime } from '@/lib/format'
import type { RunRecord } from '@/lib/types'

export const SERIES = ['#00A86B', '#5B8DEF'] as const
const GRID = 'rgb(36 52 44 / 0.6)'
const AXIS = { fontSize: 11, fill: '#89958D' }

function TooltipBox({ active, payload, label, labelFormatter }: {
  active?: boolean
  payload?: { name: string; value: number; color: string }[]
  label?: string
  labelFormatter?: (l: string) => string
}) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-xl border border-line bg-bg/95 px-3 py-2 text-xs shadow-xl">
      <div className="mb-1 font-medium text-ink">{labelFormatter ? labelFormatter(String(label)) : label}</div>
      {payload.map((p) => (
        <div key={p.name} className="flex items-center gap-2 text-muted">
          <span className="h-2 w-2 rounded-sm" style={{ background: p.color }} />
          <span>{p.name}:</span>
          <span className="tabular-nums text-ink">{p.value}</span>
        </div>
      ))}
    </div>
  )
}

export function BarsByCategory({ data, height = 220 }: { data: { label: string; value: number }[]; height?: number }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} layout="vertical" margin={{ left: 8, right: 16, top: 4, bottom: 4 }} barCategoryGap={6}>
        <CartesianGrid horizontal={false} stroke={GRID} />
        <XAxis type="number" allowDecimals={false} tick={AXIS} axisLine={false} tickLine={false} />
        <YAxis type="category" dataKey="label" width={150} tick={{ ...AXIS, fill: '#C9D2CB' }} axisLine={false} tickLine={false} />
        <Tooltip cursor={{ fill: 'rgb(0 214 143 / 0.06)' }} content={<TooltipBox />} />
        <Bar dataKey="value" name="Oportunidades" fill={SERIES[0]} radius={[0, 4, 4, 0]} maxBarSize={18} />
      </BarChart>
    </ResponsiveContainer>
  )
}

export function RunsChart({ runs, height = 220 }: { runs: RunRecord[]; height?: number }) {
  const data = runs.slice(-30).map((r) => ({ t: r.started_at, Nuevas: r.new, Actualizadas: r.updated }))
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ left: -16, right: 8, top: 8, bottom: 0 }}>
        <defs>
          <linearGradient id="g1" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={SERIES[0]} stopOpacity={0.35} />
            <stop offset="100%" stopColor={SERIES[0]} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} stroke={GRID} />
        <XAxis dataKey="t" tick={AXIS} axisLine={false} tickLine={false} tickFormatter={(v) => new Date(v).toLocaleDateString('es-CO', { day: 'numeric', month: 'short' })} minTickGap={24} />
        <YAxis allowDecimals={false} tick={AXIS} axisLine={false} tickLine={false} />
        <Tooltip content={<TooltipBox labelFormatter={(l) => fmtDateTime(l)} />} cursor={{ stroke: '#89958D', strokeDasharray: 3 }} />
        <Legend iconType="square" wrapperStyle={{ fontSize: 12 }} formatter={(v) => <span style={{ color: '#C9D2CB' }}>{v}</span>} />
        <Area type="monotone" dataKey="Nuevas" stroke={SERIES[0]} strokeWidth={2} fill="url(#g1)" dot={false} activeDot={{ r: 4 }} />
        <Area type="monotone" dataKey="Actualizadas" stroke={SERIES[1]} strokeWidth={2} fill="transparent" dot={false} activeDot={{ r: 4 }} />
      </AreaChart>
    </ResponsiveContainer>
  )
}

export function DurationChart({ runs, height = 200 }: { runs: RunRecord[]; height?: number }) {
  const data = runs.slice(-30).map((r) => ({ t: r.started_at, Duración: Math.round(r.duration_s) }))
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ left: -16, right: 8, top: 8, bottom: 0 }} barCategoryGap={2}>
        <CartesianGrid vertical={false} stroke={GRID} />
        <XAxis dataKey="t" tick={AXIS} axisLine={false} tickLine={false} tickFormatter={(v) => new Date(v).toLocaleDateString('es-CO', { day: 'numeric', month: 'short' })} minTickGap={24} />
        <YAxis tick={AXIS} axisLine={false} tickLine={false} unit="s" />
        <Tooltip content={<TooltipBox labelFormatter={(l) => fmtDateTime(l)} />} cursor={{ fill: 'rgb(0 214 143 / 0.06)' }} />
        <Bar dataKey="Duración" fill={SERIES[0]} radius={[4, 4, 0, 0]} maxBarSize={14} />
      </BarChart>
    </ResponsiveContainer>
  )
}
