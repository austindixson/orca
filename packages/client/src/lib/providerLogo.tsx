import type { CSSProperties } from 'react'
import claudeSvg from '../assets/agents/claude-color.svg'
import hermesAgentPng from '../assets/agents/hermes-agent.png'
import googleAgentPng from '../assets/agents/google-agent.png'
import openaiAgentPng from '../assets/agents/openai-agent.png'
import zaiAgentPng from '../assets/agents/zai-agent.png'
import { PROVIDER_INFO, type Provider } from '../store/settingsStore'

/**
 * Bundled default avatars (where we have artwork). Everyone else uses the
 * monogram below. Users can override with a custom upload via `agentAvatarStore`.
 */
const PROVIDER_DEFAULT_AVATAR: Partial<Record<Provider, string>> = {
  openai: openaiAgentPng,
  anthropic: claudeSvg,
  google: googleAgentPng,
  googleVertex: googleAgentPng,
  hermes: hermesAgentPng,
  zai: zaiAgentPng,
}

/**
 * Short monogram when no bundled avatar exists. Kept readable at 20–32px.
 */
const PROVIDER_MONOGRAM: Record<Provider, string> = {
  openai: 'AI',
  openaiCodex: 'Cx',
  anthropic: 'C',
  ollama: 'O',
  openrouter: 'OR',
  google: 'G',
  xai: 'x',
  zai: 'Z',
  llamacpp: 'Ll',
  mistral: 'M',
  azureOpenai: 'Az',
  githubCopilot: 'Co',
  googleVertex: 'Vx',
  bedrock: 'Br',
  hermes: 'H',
}

export interface ProviderLogoProps {
  provider: Provider
  /** Avatar diameter in pixels. Defaults to 24 — matches tile header row. */
  size?: number
  /** Optional className passthrough (for ring/shadow variants). */
  className?: string
  style?: CSSProperties
  title?: string
}

/**
 * Circular provider avatar: bundled image for Anthropic (Claude) and Hermes,
 * otherwise a coloured monogram using `PROVIDER_INFO[provider].color`.
 */
export function ProviderLogo({
  provider,
  size = 24,
  className,
  style,
  title,
}: ProviderLogoProps) {
  const info = PROVIDER_INFO[provider]
  const assetSrc = PROVIDER_DEFAULT_AVATAR[provider]

  if (assetSrc) {
    return (
      <span
        role="img"
        aria-label={title ?? `${info.name} logo`}
        data-tooltip={title ?? info.name}
        className={className}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: size,
          height: size,
          minWidth: size,
          flexShrink: 0,
          borderRadius: '50%',
          overflow: 'hidden',
          backgroundColor: info.color,
          boxShadow: '0 0 0 1px rgba(255,255,255,0.08) inset',
          userSelect: 'none',
          ...style,
        }}
      >
        <img
          src={assetSrc}
          alt=""
          draggable={false}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            display: 'block',
          }}
        />
      </span>
    )
  }

  const bg = info.color
  const fg = readableForeground(bg)
  const label = PROVIDER_MONOGRAM[provider] ?? info.name.slice(0, 1)
  const fontSize = Math.round(size * (label.length > 1 ? 0.42 : 0.5))

  return (
    <span
      role="img"
      aria-label={title ?? `${info.name} logo`}
      data-tooltip={title ?? info.name}
      className={className}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: size,
        height: size,
        minWidth: size,
        borderRadius: '50%',
        backgroundColor: bg,
        color: fg,
        fontWeight: 700,
        fontSize,
        lineHeight: 1,
        letterSpacing: label.length > 1 ? '-0.02em' : 0,
        boxShadow: '0 0 0 1px rgba(255,255,255,0.08) inset',
        userSelect: 'none',
        ...style,
      }}
    >
      {label}
    </span>
  )
}

/** Return '#fff' or '#111' depending on which has better contrast vs `hex`. */
function readableForeground(hex: string): string {
  const h = hex.replace('#', '').trim()
  if (h.length !== 3 && h.length !== 6) return '#fff'
  const v =
    h.length === 3
      ? h
          .split('')
          .map((c) => c + c)
          .join('')
      : h
  const r = parseInt(v.slice(0, 2), 16)
  const g = parseInt(v.slice(2, 4), 16)
  const b = parseInt(v.slice(4, 6), 16)
  // Rec. 601 luma — cheap and good enough for avatar legibility.
  const luma = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  return luma > 0.62 ? '#111' : '#fff'
}
