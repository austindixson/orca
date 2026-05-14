import { useMemo, useState } from 'react'
import clsx from 'clsx'

interface ExpandableTextProps {
  text: string
  maxChars?: number
  className?: string
  buttonClassName?: string
  moreLabel?: string
  lessLabel?: string
  stopToggleClickPropagation?: boolean
}

export function ExpandableText({
  text,
  maxChars = 220,
  className,
  buttonClassName,
  moreLabel = 'Read more',
  lessLabel = 'Show less',
  stopToggleClickPropagation = false,
}: ExpandableTextProps) {
  const [expanded, setExpanded] = useState(false)
  const normalized = (text || '').trim()
  const shouldTruncate = normalized.length > maxChars

  const preview = useMemo(() => {
    if (!shouldTruncate) return normalized
    return `${normalized.slice(0, maxChars).trimEnd()}…`
  }, [normalized, shouldTruncate, maxChars])

  return (
    <div className="min-w-0">
      <span className={clsx('block min-w-0 break-words', className)}>{expanded ? normalized : preview}</span>
      {shouldTruncate ? (
        <button
          type="button"
          onClick={(e) => {
            if (stopToggleClickPropagation) e.stopPropagation()
            setExpanded((v) => !v)
          }}
          onKeyDown={(e) => {
            if (stopToggleClickPropagation) e.stopPropagation()
          }}
          className={clsx(
            'mt-1 text-[10px] font-medium text-accent-teal/90 hover:text-accent-teal',
            buttonClassName
          )}
        >
          {expanded ? lessLabel : moreLabel}
        </button>
      ) : null}
    </div>
  )
}
