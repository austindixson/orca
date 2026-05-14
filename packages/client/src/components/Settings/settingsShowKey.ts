import type { Provider } from '../../store/settingsStore'
import { PROVIDER_INFO } from '../../store/settingsStore'

export function createEmptyShowKey(): Record<Provider, boolean> {
  return Object.fromEntries(
    (Object.keys(PROVIDER_INFO) as Provider[]).map((p) => [p, false])
  ) as Record<Provider, boolean>
}
