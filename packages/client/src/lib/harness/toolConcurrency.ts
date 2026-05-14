/**
 * Tool concurrency classes: readonly parallel vs serial writes vs exclusive.
 * Unlisted tools default to `unknown` so batches stay sequential unless opted in.
 */

export type ConcurrencyClass = 'readonly' | 'write' | 'exclusive' | 'unknown'

export const TOOL_CONCURRENCY: Record<string, ConcurrencyClass> = {
  read_file: 'readonly',
  list_directory: 'readonly',
  web_search: 'readonly',
  get_console_errors: 'readonly',
  get_network_failures: 'readonly',
  get_inspect_summary: 'readonly',
  search_console: 'readonly',
  search_network: 'readonly',
  get_detected_issues: 'readonly',
  find_available_port: 'readonly',
  canvas_list_modules: 'readonly',
  session_search: 'readonly',
  recall_session_history: 'readonly',
  query_codebase_graph: 'readonly',
  fetch_dev_telemetry_snapshot: 'readonly',
  list_merge_review_tickets: 'readonly',
  write_file: 'write',
  memory: 'write',
  delete_file: 'write',
  canvas_update_tile: 'write',
  create_project_skill: 'write',
  record_benchmark_session: 'write',
  run_auto_fix: 'write',
  run_auto_fix_batch: 'write',
  export_inspect_data: 'write',
  canvas_create_tile: 'exclusive',
  spawn_sub_agent: 'exclusive',
  /** Subprocess shell — can mutate workspace; do not parallelize blindly with writes */
  run_shell_command: 'write',
}

export function concurrencyClassForTool(name: string): ConcurrencyClass {
  return TOOL_CONCURRENCY[name] ?? 'unknown'
}

export const MAX_PARALLEL_READ_TOOLS = 10
