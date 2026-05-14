import { useCallback, useRef, useState, type CSSProperties } from 'react'
import { useAgentAvatarStore, fileToAvatarDataUrl } from '../store/agentAvatarStore'
import { ProviderLogo } from '../lib/providerLogo'
import type { Provider } from '../store/settingsStore'

export interface AgentAvatarProps {
  /** Specialist display name (avatars are shared for the same base name across roles). */
  displayName: string
  /** Optional role label — does not split avatars; same base name shares one image. */
  role?: string
  /** Provider for the fallback monogram logo when no custom upload exists. */
  provider: Provider
  /** Pixel diameter — defaults to 24 (tile header row). */
  size?: number
  /** When true, clicking the avatar opens a file picker to upload/replace the image. */
  editable?: boolean
  className?: string
  style?: CSSProperties
  title?: string
}

/**
 * Circular avatar shown in agent tile headers and the Agent Team roster.
 *
 * - If `agentAvatarStore` has a custom upload for this specialist (same base
 *   name before ` — `, shared across roles), that image is used.
 * - Otherwise falls back to `<ProviderLogo provider={provider} />` so each
 *   agent's default visual identity matches the model it runs on (OpenAI
 *   green, Anthropic amber, Hermes teal, etc.).
 *
 * When `editable` is true, clicking the avatar opens a file picker and a
 * small "Remove" button appears on hover for clearing back to the default.
 */
export function AgentAvatar({
  displayName,
  role,
  provider,
  size = 24,
  editable = false,
  className,
  style,
  title,
}: AgentAvatarProps) {
  const customUrl = useAgentAvatarStore((s) => s.getAvatar(displayName, role))
  const setAvatar = useAgentAvatarStore((s) => s.setAvatar)
  const clearAvatar = useAgentAvatarStore((s) => s.clearAvatar)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [busy, setBusy] = useState(false)

  const onPick = useCallback(
    async (file: File | null) => {
      if (!file) return
      setBusy(true)
      try {
        const url = await fileToAvatarDataUrl(file)
        if (url) setAvatar(displayName, role, url)
      } finally {
        setBusy(false)
      }
    },
    [displayName, role, setAvatar]
  )

  const hasUpload = Boolean(customUrl)

  const visual = hasUpload ? (
    <img
      src={customUrl}
      alt={title ?? `${displayName} avatar`}
      draggable={false}
      style={{
        width: size,
        height: size,
        minWidth: size,
        borderRadius: '50%',
        objectFit: 'cover',
        boxShadow: '0 0 0 1px rgba(255,255,255,0.08) inset',
        display: 'block',
      }}
    />
  ) : (
    <ProviderLogo provider={provider} size={size} title={title ?? displayName} />
  )

  if (!editable) {
    return (
      <span className={className} style={{ display: 'inline-flex', ...style }}>
        {visual}
      </span>
    )
  }

  return (
    <span
      className={className}
      style={{ position: 'relative', display: 'inline-flex', ...style }}
      data-tooltip={title ?? `${displayName} — click to upload avatar`}
    >
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={busy}
        style={{
          padding: 0,
          border: 0,
          background: 'transparent',
          cursor: busy ? 'wait' : 'pointer',
          display: 'inline-flex',
          borderRadius: '50%',
        }}
        aria-label={hasUpload ? `Change ${displayName} avatar` : `Upload ${displayName} avatar`}
      >
        {visual}
      </button>
      {hasUpload && (
        <button
          type="button"
          onClick={() => clearAvatar(displayName, role)}
          data-tooltip="Reset to provider default"
          aria-label={`Reset ${displayName} avatar to default`}
          style={{
            position: 'absolute',
            top: -4,
            right: -4,
            width: 14,
            height: 14,
            borderRadius: '50%',
            border: '1px solid rgba(255,255,255,0.2)',
            background: 'rgba(17,24,39,0.9)',
            color: '#e5e7eb',
            fontSize: 9,
            lineHeight: '12px',
            padding: 0,
            cursor: 'pointer',
          }}
        >
          ×
        </button>
      )}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0] ?? null
          void onPick(f)
          e.target.value = ''
        }}
      />
    </span>
  )
}
