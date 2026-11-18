import { useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/format'

export function Badge({ children, tone = 'neutral', className, icon: Icon, title }: {
  children: ReactNode
  tone?: 'neutral' | 'brand' | 'warn' | 'danger' | 'info' | 'muted'
  className?: string
  icon?: LucideIcon
  title?: string
}) {
  const tones = {
    neutral: 'border-line bg-surface2 text-ink/90',
    brand: 'border-brand/40 bg-brand/10 text-brand',
    warn: 'border-warn/40 bg-warn/10 text-warn',
    danger: 'border-danger/40 bg-danger/10 text-danger',
    info: 'border-info/40 bg-info/10 text-info',
    muted: 'border-line bg-transparent text-muted',
  }
  return (
    <span title={title} className={cn('inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium', tones[tone], className)}>
      {Icon && <Icon className="h-3 w-3" aria-hidden />}
      {children}
    </span>
  )
}

export function StatTile({ label, value, hint, icon: Icon, accent, onClick }: {
  label: string
  value: ReactNode
  hint?: ReactNode
  icon?: LucideIcon
  accent?: boolean
  onClick?: () => void
}) {
  const Comp = onClick ? 'button' : 'div'
  return (
    <Comp
      onClick={onClick}
      className={cn('card group relative overflow-hidden p-4 text-left', onClick && 'card-hover cursor-pointer', accent && 'border-brand/40')}
    >
      {accent && <div className="pointer-events-none absolute -right-10 -top-10 h-28 w-28 rounded-full bg-brand/15 blur-2xl" />}
      <div className="flex items-center justify-between">
        <span className="label">{label}</span>
        {Icon && <Icon className={cn('h-4 w-4', accent ? 'text-brand' : 'text-muted group-hover:text-brand')} aria-hidden />}
      </div>
      <div className="h-display mt-2 text-3xl tabular-nums text-ink">{value}</div>
      {hint && <div className="mt-1 text-xs text-muted">{hint}</div>}
    </Comp>
  )
}

export function SectionTitle({ title, subtitle, icon: Icon, action }: { title: string; subtitle?: ReactNode; icon?: LucideIcon; action?: ReactNode }) {
  return (
    <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h2 className="h-display flex items-center gap-2 text-lg text-ink">
          {Icon && <Icon className="h-5 w-5 text-brand" aria-hidden />}
          {title}
        </h2>
        {subtitle && <p className="mt-0.5 text-sm text-muted">{subtitle}</p>}
      </div>
      {action}
    </div>
  )
}

export function PageHeader({ title, description, icon: Icon, children }: { title: string; description?: ReactNode; icon?: LucideIcon; children?: ReactNode }) {
  return (
    <header className="mb-6 flex flex-wrap items-start justify-between gap-4 animate-fade-up">
      <div className="min-w-0">
        <div className="flex items-center gap-3">
          {Icon && (
            <span className="grid h-10 w-10 place-items-center rounded-xl border border-brand/30 bg-brand/10 text-brand">
              <Icon className="h-5 w-5" aria-hidden />
            </span>
          )}
          <h1 className="h-display text-2xl text-ink sm:text-3xl">{title}</h1>
        </div>
        {description && <p className="mt-2 max-w-3xl text-sm text-muted">{description}</p>}
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </header>
  )
}

export function EmptyState({ icon: Icon, title, children, action }: { icon?: LucideIcon; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="card flex flex-col items-center justify-center px-6 py-12 text-center">
      {Icon && <Icon className="mb-3 h-8 w-8 text-muted" aria-hidden />}
      <h3 className="h-display text-base text-ink">{title}</h3>
      {children && <div className="mt-1 max-w-md text-sm text-muted">{children}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-xl bg-surface2', className)} />
}

export function Sheet({ open, onClose, children, label }: { open: boolean; onClose: () => void; children: ReactNode; label: string }) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [open, onClose])
  if (!open) return null
  return createPortal(
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label={label}>
      <button className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} aria-label="Cerrar" />
      <div className="relative h-full w-full max-w-3xl overflow-y-auto border-l border-line bg-bg shadow-2xl animate-slide-in">
        <button onClick={onClose} className="btn-quiet absolute right-3 top-3 z-10 rounded-full p-2" aria-label="Cerrar detalle">
          <X className="h-5 w-5" />
        </button>
        {children}
      </div>
    </div>,
    document.body,
  )
}

export function Modal({ open, onClose, children, title }: { open: boolean; onClose: () => void; children: ReactNode; title: string }) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])
  if (!open) return null
  return createPortal(
    <div className="fixed inset-0 z-50 grid place-items-center p-4" role="dialog" aria-modal="true" aria-label={title}>
      <button className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} aria-label="Cerrar" />
      <div className="card relative w-full max-w-lg p-5 animate-fade-up">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="h-display text-lg">{title}</h3>
          <button onClick={onClose} className="btn-quiet rounded-full p-1.5" aria-label="Cerrar">
            <X className="h-4 w-4" />
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  )
}

export function Segmented<T extends string>({ value, onChange, options, size = 'sm' }: {
  value: T
  onChange: (v: T) => void
  options: { value: T; label: ReactNode; title?: string }[]
  size?: 'sm' | 'md'
}) {
  return (
    <div className="inline-flex rounded-xl border border-line bg-surface2/60 p-0.5" role="radiogroup">
      {options.map((o) => (
        <button
          key={o.value}
          role="radio"
          aria-checked={value === o.value}
          title={o.title}
          onClick={() => onChange(o.value)}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-[10px] font-medium transition',
            size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-3 py-1.5 text-sm',
            value === o.value ? 'bg-brand/15 text-brand' : 'text-muted hover:text-ink',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Toggle({ checked, onChange, label, description }: { checked: boolean; onChange: (v: boolean) => void; label: string; description?: string }) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-4 py-2">
      <span>
        <span className="block text-sm text-ink">{label}</span>
        {description && <span className="block text-xs text-muted">{description}</span>}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cn('relative mt-0.5 h-6 w-11 shrink-0 rounded-full border transition', checked ? 'border-brand bg-brand/80' : 'border-line bg-surface2')}
      >
        <span className={cn('absolute top-0.5 h-4 w-4 rounded-full bg-ink transition', checked ? 'left-6' : 'left-1')} />
      </button>
    </label>
  )
}
