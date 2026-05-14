import { useState, type ReactNode } from 'react'

export function SettingsSurface({
  children,
  className = '',
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <div
      className={`rounded-xl border border-tile-border bg-canvas-bg p-4 motion-safe:transition-colors ${className}`}
    >
      {children}
    </div>
  )
}

/** Accessible accordion using native details/summary (keyboard + screen readers). */
export function SettingsAccordion({
  id,
  title,
  description,
  defaultOpen = false,
  children,
}: {
  id: string
  title: string
  description?: string
  defaultOpen?: boolean
  children: ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <details
      id={id}
      className="group rounded-xl border border-tile-border bg-canvas-bg open:border-accent-teal/30"
      open={open}
      onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}
    >
      <summary className="cursor-pointer list-none px-4 py-3 text-sm font-medium text-gray-200 outline-none ring-accent-teal/40 focus-visible:ring-2 [&::-webkit-details-marker]:hidden">
        <span className="flex items-center justify-between gap-2">
          <span>{title}</span>
          <span
            className="text-gray-500 motion-safe:transition-transform group-open:rotate-180"
            aria-hidden
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M6 9l6 6 6-6" />
            </svg>
          </span>
        </span>
        {description ? <p className="mt-1 text-xs font-normal text-gray-500">{description}</p> : null}
      </summary>
      <div className="border-t border-tile-border/80 px-4 pb-4 pt-3">{children}</div>
    </details>
  )
}

export function SettingsToggleRow({
  label,
  hint,
  checked,
  onChange,
  disabled,
}: {
  label: string
  hint?: string
  checked: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
}) {
  return (
    <label
      className={`flex cursor-pointer items-start justify-between gap-3 rounded-lg border border-tile-border/60 bg-black/10 px-3 py-2 ${
        disabled ? 'cursor-not-allowed opacity-40' : ''
      }`}
    >
      <span className="min-w-0">
        <span className="text-sm text-gray-200">{label}</span>
        {hint ? <p className="mt-0.5 text-xs text-gray-500">{hint}</p> : null}
      </span>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-4 w-4 shrink-0 accent-accent-teal"
      />
    </label>
  )
}

export function SettingsSwitchRow({
  title,
  description,
  checked,
  onChange,
}: {
  title: string
  description?: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <div className="text-sm font-medium text-gray-200">{title}</div>
        {description ? <p className="mt-1 text-xs text-gray-500">{description}</p> : null}
      </div>
      <label className="relative inline-flex shrink-0 cursor-pointer items-center">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="peer sr-only"
        />
        <span className="h-6 w-11 rounded-full bg-gray-700 peer-checked:bg-accent-teal peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent-teal/60 after:absolute after:start-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:bg-white after:transition-all peer-checked:after:translate-x-full" />
      </label>
    </div>
  )
}
