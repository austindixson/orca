/**
 * Hook points for PreToolUse / PostToolUse (extension surface). Wire from executeTools when needed.
 */
export type ToolHookContext = { toolName: string; argsJson: string }

const preToolUse: Array<(ctx: ToolHookContext) => void | Promise<void>> = []
const postToolUse: Array<(ctx: ToolHookContext & { resultJson: string }) => void | Promise<void>> =
  []

export function registerPreToolUse(fn: (ctx: ToolHookContext) => void | Promise<void>): void {
  preToolUse.push(fn)
}

export function registerPostToolUse(
  fn: (ctx: ToolHookContext & { resultJson: string }) => void | Promise<void>
): void {
  postToolUse.push(fn)
}

export async function runPreToolUseHooks(ctx: ToolHookContext): Promise<void> {
  for (const fn of preToolUse) {
    await fn(ctx)
  }
}

export async function runPostToolUseHooks(
  ctx: ToolHookContext & { resultJson: string }
): Promise<void> {
  for (const fn of postToolUse) {
    await fn(ctx)
  }
}
