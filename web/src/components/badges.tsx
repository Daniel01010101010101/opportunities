import { AlertTriangle, BadgeCheck, CircleDashed, Clock, HelpCircle, ShieldAlert, Ban, Archive } from 'lucide-react'
import { Badge } from './ui'
import { cn, deadlineLabel } from '@/lib/format'
import { costTypes, verificationLabels } from '@/lib/taxonomy'
import type { Opportunity } from '@/lib/types'

export function VerificationBadge({ op }: { op: Opportunity }) {
  const s = op.verification?.status ?? 'no_verificable'
  const map = {
    verificada: { tone: 'brand', icon: BadgeCheck },
    pendiente: { tone: 'info', icon: CircleDashed },
    no_verificable: { tone: 'muted', icon: HelpCircle },
    vencida: { tone: 'muted', icon: Archive },
    retirada: { tone: 'danger', icon: Ban },
  } as const
  const m = map[s]
  return (
    <Badge tone={m.tone} icon={m.icon} title={verificationLabels[s]?.description}>
      {verificationLabels[s]?.label ?? s}
    </Badge>
  )
}

export function CostBadge({ op }: { op: Opportunity }) {
  const t = op.cost?.type ?? 'desconocido'
  const free = costTypes[t]?.free
  return (
    <Badge tone={free ? 'brand' : t === 'desconocido' ? 'muted' : 'warn'} title={costTypes[t]?.description}>
      {costTypes[t]?.label ?? t}
      {free && op.cost.certainty === 'inferido' ? ' *' : ''}
    </Badge>
  )
}

export function DeadlineBadge({ op }: { op: Opportunity }) {
  if (op.status === 'permanente') return <Badge tone="info" icon={Clock}>Permanente</Badge>
  if (op.status === 'proxima') return <Badge tone="info" icon={Clock}>Abre pronto</Badge>
  const d = deadlineLabel(op.dates?.end)
  const tone = d.tone === 'ok' ? 'neutral' : d.tone
  return <Badge tone={tone} icon={Clock}>{d.text}</Badge>
}

export function RiskBadge({ op }: { op: Opportunity }) {
  if (!op.risk || op.risk.level === 'bajo') {
    return op.risk?.sensitive_data_warning ? <Badge tone="warn" icon={AlertTriangle}>Datos sensibles</Badge> : null
  }
  return (
    <Badge tone={op.risk.level === 'alto' ? 'danger' : 'warn'} icon={ShieldAlert} title={op.risk.flags.map((f) => f.label).join('\n')}>
      {op.risk.level === 'alto' ? 'Posible estafa' : 'Revisar con cuidado'}
    </Badge>
  )
}

export function ScoreRing({ score, level, size = 44 }: { score: number; level: string; size?: number }) {
  const r = (size - 6) / 2
  const c = 2 * Math.PI * r
  const color = level === 'alta' ? '#00D68F' : level === 'media' ? '#F5B83D' : '#89958D'
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} title={`Prioridad de revisión ${score}/100 (${level}). No es probabilidad de ganar.`}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} stroke="rgb(36 52 44)" strokeWidth={4} fill="none" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={color}
          strokeWidth={4}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${(score / 100) * c} ${c}`}
        />
      </svg>
      <span className={cn('absolute inset-0 grid place-items-center font-display text-[13px] font-semibold tabular-nums')} style={{ color }}>
        {score}
      </span>
    </div>
  )
}

export function PriorityLabel({ level }: { level: string }) {
  const tone = level === 'alta' ? 'brand' : level === 'media' ? 'warn' : 'muted'
  return <Badge tone={tone}>Prioridad {level}</Badge>
}
