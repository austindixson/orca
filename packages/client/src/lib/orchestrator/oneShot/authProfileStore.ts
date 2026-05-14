export type AuthLaneType = 'oauth' | 'browser_session' | 'hybrid'
export type AuthHealthState = 'healthy' | 'expiring' | 'invalid'

export interface OAuthLaneProfile {
  tokenRef: string
  scopeFingerprint?: string
  lastRefreshAt?: string
}

export interface BrowserSessionLaneProfile {
  sessionBundleRef: string
  runtimeFingerprintRef: string
  domainBindings: string[]
  healthState: AuthHealthState
  lastHealthCheckAt?: string
}

export interface HybridLaneProfile {
  preferredOrder: Array<'oauth' | 'browser_session'>
}

export interface AuthProfileRecord {
  id: string
  appId: string
  lane: AuthLaneType
  createdAt: string
  updatedAt: string
  oauth?: OAuthLaneProfile
  browserSession?: BrowserSessionLaneProfile
  hybrid?: HybridLaneProfile
}

export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

const STORAGE_KEY = 'orca.hybrid.auth_profiles.v1'

function nowIso(): string {
  return new Date().toISOString()
}

function normalizeRef(input?: string): string {
  return String(input ?? '').trim()
}

function uniqueNonEmpty(values: string[]): string[] {
  const out = new Set(values.map((v) => v.trim()).filter(Boolean))
  return Array.from(out)
}

export function validateAuthProfile(profile: AuthProfileRecord): string[] {
  const errors: string[] = []
  if (!profile.id.trim()) errors.push('id is required')
  if (!profile.appId.trim()) errors.push('appId is required')

  if (profile.lane === 'oauth' || profile.lane === 'hybrid') {
    if (!profile.oauth || !normalizeRef(profile.oauth.tokenRef)) {
      errors.push('oauth.tokenRef is required for oauth/hybrid lanes')
    }
  }

  if (profile.lane === 'browser_session' || profile.lane === 'hybrid') {
    if (!profile.browserSession || !normalizeRef(profile.browserSession.sessionBundleRef)) {
      errors.push('browserSession.sessionBundleRef is required for browser_session/hybrid lanes')
    }
    if (!profile.browserSession || !normalizeRef(profile.browserSession.runtimeFingerprintRef)) {
      errors.push('browserSession.runtimeFingerprintRef is required for browser_session/hybrid lanes')
    }
    if (!profile.browserSession || uniqueNonEmpty(profile.browserSession.domainBindings).length === 0) {
      errors.push('browserSession.domainBindings must include at least one domain')
    }
  }

  if (profile.lane === 'hybrid') {
    const order = profile.hybrid?.preferredOrder ?? []
    if (order.length === 0) {
      errors.push('hybrid.preferredOrder is required for hybrid lane')
    }
  }

  return errors
}

function safeParseArray(raw: string | null): AuthProfileRecord[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter((row): row is AuthProfileRecord => {
      return !!row && typeof row === 'object' && typeof (row as AuthProfileRecord).id === 'string'
    })
  } catch {
    return []
  }
}

function getDefaultStorage(): StorageLike | null {
  if (typeof window === 'undefined') return null
  return window.localStorage
}

export function loadAuthProfiles(storage?: StorageLike | null): AuthProfileRecord[] {
  const target = storage ?? getDefaultStorage()
  if (!target) return []
  return safeParseArray(target.getItem(STORAGE_KEY))
}

export function saveAuthProfiles(profiles: AuthProfileRecord[], storage?: StorageLike | null): void {
  const target = storage ?? getDefaultStorage()
  if (!target) return
  target.setItem(STORAGE_KEY, JSON.stringify(profiles))
}

export function upsertAuthProfile(
  profile: AuthProfileRecord,
  existing: AuthProfileRecord[]
): { next: AuthProfileRecord[]; errors: string[] } {
  const normalized: AuthProfileRecord = {
    ...profile,
    id: profile.id.trim(),
    appId: profile.appId.trim(),
    createdAt: profile.createdAt || nowIso(),
    updatedAt: nowIso(),
    browserSession: profile.browserSession
      ? {
          ...profile.browserSession,
          sessionBundleRef: normalizeRef(profile.browserSession.sessionBundleRef),
          runtimeFingerprintRef: normalizeRef(profile.browserSession.runtimeFingerprintRef),
          domainBindings: uniqueNonEmpty(profile.browserSession.domainBindings),
        }
      : undefined,
  }

  const errors = validateAuthProfile(normalized)
  if (errors.length > 0) return { next: existing, errors }

  const withoutCurrent = existing.filter((row) => row.id !== normalized.id)
  const next = [normalized, ...withoutCurrent].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  return { next, errors: [] }
}

export function resolveLaneForCommand(
  profile: AuthProfileRecord,
  command: string,
  targetType: 'official_api' | 'browser_ui' | 'hybrid'
): 'oauth' | 'browser_session' | 'per_step' {
  const normalized = command.trim().toLowerCase()
  if (normalized.startsWith('gdrive.')) return 'oauth'
  if (normalized.startsWith('x.')) return 'browser_session'

  if (profile.lane === 'oauth') return 'oauth'
  if (profile.lane === 'browser_session') return 'browser_session'

  if (targetType === 'official_api') return 'oauth'
  if (targetType === 'browser_ui') return 'browser_session'

  return 'per_step'
}
