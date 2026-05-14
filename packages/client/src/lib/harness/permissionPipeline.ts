/**
 * Future: enterprise → project → user → session permission layers + glob rules (claw-code style).
 * Today: workspace path checks live in permissionEnforcer / assertSafeWorkspacePath.
 */

import { assertSafeWorkspacePath } from './permissionEnforcer'

export type PermissionStage = 'read' | 'write' | 'bash' | 'network'

export function evaluateWorkspacePathForStage(
  relativePath: string,
  _stage: PermissionStage
): void {
  assertSafeWorkspacePath(relativePath)
}
