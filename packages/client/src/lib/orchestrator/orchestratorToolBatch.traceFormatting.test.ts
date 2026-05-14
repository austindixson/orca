import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  formatToolTraceStartLine,
  formatToolTraceEndLine,
} from './orchestratorToolBatch'

describe('orchestrator tool trace formatting', () => {
  it('includes read_file path and offset/limit details', () => {
    const line = formatToolTraceStartLine('read_file', '{"path":"packages/client/src/lib/orchestrator/runOrchestrator.ts","offset":1200,"limit":200}')
    assert.match(line, /^→ read_file\s+path=packages\/client\/src\/lib\/orchestrator\/runOrchestrator\.ts/)
    assert.match(line, /offset=1200/)
    assert.match(line, /limit=200/)
  })

  it('includes search_files target/pattern/path details', () => {
    const line = formatToolTraceStartLine('search_files', '{"pattern":"browser_navigate|_stdout_open","target":"content","path":"packages/client/src/lib/orchestrator"}')
    assert.match(line, /^→ search_files\s+target=content/)
    assert.match(line, /pattern=browser_navigate\|_stdout_open/)
    assert.match(line, /path=packages\/client\/src\/lib\/orchestrator/)
  })

  it('includes run_shell_command command snippet', () => {
    const line = formatToolTraceStartLine('run_shell_command', '{"command":"git status --short -- packages/client/src/lib/orchestrator/runOrchestrator.ts"}')
    assert.match(line, /^→ run_shell_command\s+\$ git status --short -- packages\/client\/src\/lib\/orchestrator\/runOrchestrator\.ts/)
  })

  it('formats end line with status and elapsed duration', () => {
    const ok = formatToolTraceEndLine('read_file', true, 912)
    assert.equal(ok, '← read_file ok 0.9s')

    const fail = formatToolTraceEndLine('browser_open', false, 128)
    assert.equal(fail, '← browser_open error 128ms')
  })
})
