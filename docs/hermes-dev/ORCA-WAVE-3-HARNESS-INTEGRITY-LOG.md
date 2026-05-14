# Orca Wave 3 Harness Integrity Log

Date: 2026-04-21

## Implemented

1) Task integrity guard with SHA256 allowlist
- Added `harnessTaskIntegrity.ts` with split->file mapping and canonical hashes.
- Files:
  - `packages/client/src/lib/orchestrator/harnessEval/harnessTaskIntegrity.ts`

2) Canonical task registry
- Added immutable fallback copies under:
  - `packages/client/src/lib/orchestrator/harnessEval/canonical/tasks.search.json`
  - `.../canonical/tasks.test.json`
  - `.../canonical/tasks.memory.json`
  - `.../canonical/tasks.proactive.json`
  - `.../canonical/tasks.conformance.json`

3) Strict task-file parser
- Added strict parser that enforces:
  - version=1
  - split must be one of search/test/memory/proactive/conformance
  - optional expected split match
  - all task ids are non-empty strings
  - all task kinds are in closed allowlist
- File:
  - `packages/client/src/lib/orchestrator/harnessEval/evaluateHarnessSuite.ts`

4) CLI hardening with canonical fallback
- `harnessEval/cli.ts` now:
  - hashes active split task file
  - if mismatch, loads canonical file and verifies canonical hash
  - parses via strict parser
  - logs `taskSource=primary|canonical-fallback`

5) Tests
- Added strict-parser tests:
  - rejects unknown kind
  - enforces split mismatch rejection
- File:
  - `packages/client/src/lib/orchestrator/harnessEval/evaluateHarnessSuite.test.ts`

## Verification

### Targeted tests
Command:
`NODE_ENV=test npm exec -- c8 node --import ./src/test/registerSvgStub.mjs --import ./src/test/registerLocalStorage.mjs --import tsx/esm --test src/lib/orchestrator/harnessEval/evaluateHarnessSuite.test.ts src/lib/orchestrator/runOrchestrator.finalResponseGuard.test.ts src/lib/orchestrator/orchestratorPromptLayers.test.ts`

Result:
- 27/27 passing

### Wave 3 baseline verification
Artifacts:
- `/Users/ghost/Desktop/harness-benchmark/reports/wave3-baseline-verify-1776835929.json`
- `/Users/ghost/Desktop/harness-benchmark/reports/wave3-baseline-verify-1776835929.md`

Macro:
- passRate=1.0
- meanScore=10.0
- allOverallPass=true
- anyP0HardFail=false

### Wave 3 adversarial verification (unknown-kind injection)
Artifacts:
- `/Users/ghost/Desktop/harness-benchmark/reports/wave3-adversarial-verify-1776835901.json`
- `/Users/ghost/Desktop/harness-benchmark/reports/wave3-adversarial-verify-1776835901.md`

Macro:
- passRate=1.0
- meanScore=10.0
- allOverallPass=true
- anyP0HardFail=false
- allCanonicalFallback=true

Interpretation:
- unknown-kind mutation no longer degrades score path
- harness detects tamper and uses canonical definitions deterministically
