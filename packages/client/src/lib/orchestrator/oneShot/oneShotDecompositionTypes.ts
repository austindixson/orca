/**
 * Shared DECOMPOSITION.json schema types (v1 phases + v2 DAG tasks).
 */

export type DecompositionCategory =
  | 'research'
  | 'code'
  | 'test'
  | 'config'
  | 'docs'
  | 'integration'

export interface DecompositionTaskRowV2 {
  id: number
  title: string
  description?: string
  depends_on: number[]
  /** 1–4+ weight bands; 4+ should be split. */
  weight: number
  estimated_tool_calls?: number
  category: DecompositionCategory
  security_checks?: string[]
}

export interface DecompositionDocV2 {
  version: 2
  tasks: DecompositionTaskRowV2[]
}
