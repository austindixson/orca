import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'

/**
 * Custom avatar image (data URL) keyed by **specialist identity** — the display
 * name before the first ` — ` / ` – ` / ` - ` (so "Mei", "Sora", "Hana" share one
 * face across tiles and roles). Legacy keys `${displayName}::${role}` are still
 * read for migration. If no custom upload exists, consumers fall back to
 * `<ProviderLogo provider={…} />`.
 *
 * NOTE: We deliberately store avatars as data URLs (base64) rather than
 * object URLs because object URLs are tied to the current document and
 * wouldn't survive a reload. Large images are downscaled by the uploader.
 */
interface AgentAvatarState {
  /** Map: identity key (see {@link normalizeAgentAvatarIdentity}) → data URL. */
  avatars: Record<string, string>
  /** Set (or replace) the avatar for this display name (shared across roles). */
  setAvatar: (displayName: string, role: string | undefined, dataUrl: string) => void
  /** Remove the custom avatar for this specialist — all tiles with the same identity. */
  clearAvatar: (displayName: string, role: string | undefined) => void
  /** Lookup helper; returns `undefined` when no custom avatar exists. */
  getAvatar: (displayName: string, role: string | undefined) => string | undefined
}

/**
 * Stable face identity for a worker: trim, then take the segment before the first
 * dash (em/en/hyphen). "Mei — deps scan" → "Mei"; "Sora" → "Sora".
 */
export function normalizeAgentAvatarIdentity(displayName: string): string {
  const t = (displayName || '').trim()
  if (!t) return ''
  const first = t.split(/\s*[—–-]\s*/)[0]?.trim() ?? t
  return first || t
}

/** Primary persistence key — same for all roles sharing a specialist name. */
export function agentAvatarStorageKey(displayName: string): string {
  return normalizeAgentAvatarIdentity(displayName)
}

/** @deprecated Legacy lookup only — was `${trim(displayName)}::${role}`. */
export function agentAvatarLegacyKey(displayName: string, role: string | undefined): string {
  const n = (displayName || '').trim()
  const r = (role || '').trim()
  return r ? `${n}::${r}` : n
}

/** @deprecated Use {@link agentAvatarStorageKey} or {@link normalizeAgentAvatarIdentity}. */
export function agentAvatarKey(displayName: string, role: string | undefined): string {
  return agentAvatarLegacyKey(displayName, role)
}

export const useAgentAvatarStore = create<AgentAvatarState>()(
  persist(
    (set, get) => ({
      avatars: {},

      setAvatar: (displayName, _role, dataUrl) => {
        const primary = normalizeAgentAvatarIdentity(displayName)
        if (!primary || !dataUrl) return
        set({ avatars: { ...get().avatars, [primary]: dataUrl } })
      },

      clearAvatar: (displayName, role) => {
        const primary = normalizeAgentAvatarIdentity(displayName)
        const copy = { ...get().avatars }
        let changed = false
        if (primary && copy[primary]) {
          delete copy[primary]
          changed = true
        }
        if (primary) {
          const prefix = `${primary}::`
          for (const k of Object.keys(copy)) {
            if (k.startsWith(prefix)) {
              delete copy[k]
              changed = true
            }
          }
        }
        const leg = agentAvatarLegacyKey(displayName, role)
        if (leg && copy[leg]) {
          delete copy[leg]
          changed = true
        }
        if (changed) set({ avatars: copy })
      },

      getAvatar: (displayName, role) => {
        const a = get().avatars
        const primary = normalizeAgentAvatarIdentity(displayName)
        if (primary && a[primary]) return a[primary]
        const r = (role || '').trim()
        if (primary && r) {
          const byPrimaryRole = `${primary}::${r}`
          if (a[byPrimaryRole]) return a[byPrimaryRole]
        }
        const leg = agentAvatarLegacyKey(displayName, role)
        return leg ? a[leg] : undefined
      },
    }),
    {
      name: 'agent-avatar-store',
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ avatars: s.avatars }),
    }
  )
)

/**
 * Downscale an image `File` to a reasonable avatar size (256×256 max) and
 * re-encode as JPEG data URL. Keeps the persisted store small even when the
 * user uploads a giant PNG. Returns `null` if the browser can't decode.
 */
export async function fileToAvatarDataUrl(file: File, maxEdge = 256): Promise<string | null> {
  const bitmap = await tryCreateImageBitmap(file)
  if (!bitmap) return null
  const { width, height } = bitmap
  const scale = Math.min(1, maxEdge / Math.max(width, height))
  const w = Math.max(1, Math.round(width * scale))
  const h = Math.max(1, Math.round(height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.drawImage(bitmap, 0, 0, w, h)
  try {
    return canvas.toDataURL('image/jpeg', 0.88)
  } catch {
    return null
  }
}

async function tryCreateImageBitmap(file: File): Promise<ImageBitmap | null> {
  try {
    return await createImageBitmap(file)
  } catch {
    return null
  }
}
