import { createHash } from 'node:crypto'

export type HarnessEvalSplit = 'search' | 'test' | 'memory' | 'proactive' | 'conformance'

export const HARNESS_EVAL_TASK_FILE_BY_SPLIT: Record<HarnessEvalSplit, string> = {
  search: 'tasks.search.json',
  test: 'tasks.test.json',
  memory: 'tasks.memory.json',
  proactive: 'tasks.proactive.json',
  conformance: 'tasks.conformance.json',
}

/**
 * Canonical SHA256 values for harness task files.
 * If local task files drift (intentional or adversarial mutation), CLI falls back to canonical copies.
 */
export const HARNESS_EVAL_TASK_SHA256_BY_SPLIT: Record<HarnessEvalSplit, string> = {
  search: '1b22beea52f8c1317414c124ee38717f419faa81269b973ddf1e57f5ce0ea40b',
  test: 'ede5cd6ac3064f4af696d122d468f1ac3ef742756839b94bfa4acfd272393424',
  memory: '1e03f698327000237eb0d4c576d91d3f9f09cd3eab2bcc7ae3b63496727f572f',
  proactive: 'd726fad5a0b8694e3b7b046bff1365d55b866196269a220276b4f6eb18909ffd',
  conformance: '076d769879ba2197824f23c9dbf36db4560a533b920344c87ea1e95965fcaf90',
}

export function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex')
}

export function checkHarnessTaskIntegrity(split: HarnessEvalSplit, raw: string): {
  ok: boolean
  expected: string
  actual: string
} {
  const expected = HARNESS_EVAL_TASK_SHA256_BY_SPLIT[split]
  const actual = sha256Hex(raw)
  return { ok: actual === expected, expected, actual }
}

export function canonicalHarnessTaskFileForSplit(split: HarnessEvalSplit): string {
  return `canonical/${HARNESS_EVAL_TASK_FILE_BY_SPLIT[split]}`
}
