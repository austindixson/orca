import type { ReactNode } from 'react'

/** One settings screen: title + optional intro (use once at top of each section). */
export function SettingsPageHeader({
  title,
  description,
}: {
  title: string
  description?: string
}) {
  return (
    <header className="mb-5 space-y-1 border-b border-tile-border/70 pb-4">
      <h1 className="text-base font-semibold text-gray-100">{title}</h1>
      {description ? (
        <p className="text-sm leading-relaxed text-gray-500">{description}</p>
      ) : null}
    </header>
  )
}

/** Groups related controls under a clear heading. */
export function SettingsBlock({
  title,
  description,
  children,
  className = '',
}: {
  title: string
  description?: string
  children: ReactNode
  className?: string
}) {
  return (
    <section className={`space-y-3 ${className}`}>
      <div>
        <h2 className="text-sm font-medium text-gray-200">{title}</h2>
        {description ? (
          <p className="mt-1 text-xs leading-relaxed text-gray-500">{description}</p>
        ) : null}
      </div>
      {children}
    </section>
  )
}
