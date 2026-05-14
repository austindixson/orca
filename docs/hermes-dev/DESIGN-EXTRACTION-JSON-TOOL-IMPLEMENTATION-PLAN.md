# Design Extraction JSON Tool Implementation Plan

> For Hermes: Use subagent-driven-development skill to implement this plan task-by-task.

Goal: Build a screenshot-to-JSON extraction flow that outputs a complete style-guide map and supports block-level JSON edit/regenerate loops with low scene drift.

Architecture: Add a provider-agnostic extraction pipeline in client orchestrator utilities with a strict JSON schema + repair pass, then expose a compact UI workflow for upload -> extract mode -> JSON editor -> regenerate prompt. Start Gemini-first via prompt adapters but keep interfaces provider-neutral.

Tech Stack: TypeScript, Zod schema validation, existing Orca client stores/components, orchestrator tool path, markdown docs.

---

### Task 1: Define schema + mode contracts
Objective: Create typed schema contracts for extraction outputs and mode-specific subsets.

Files:
- Create: `packages/client/src/lib/designExtraction/schema.ts`
- Create: `packages/client/src/lib/designExtraction/types.ts`
- Test: `packages/client/src/lib/designExtraction/schema.test.ts`

Step 1: Write failing tests for schema acceptance/rejection.
Step 2: Run targeted test to confirm failure.
Step 3: Implement Zod schema + exported TS types.
Step 4: Re-run tests to green.
Step 5: Commit.

### Task 2: Add prompt-template builder
Objective: Encode extraction and modification prompts (full + specialized modes).

Files:
- Create: `packages/client/src/lib/designExtraction/prompts.ts`
- Test: `packages/client/src/lib/designExtraction/prompts.test.ts`

Step 1: Write failing tests for prompt text generation and mode routing.
Step 2: Run test to confirm failure.
Step 3: Implement builder with templates from `hermes-dev/DESIGN-EXTRACTION-JSON-TOOL.md`.
Step 4: Run tests to green.
Step 5: Commit.

### Task 3: Implement JSON normalization/repair pass
Objective: Recover tolerant model outputs into strict schema-conformant JSON.

Files:
- Create: `packages/client/src/lib/designExtraction/normalize.ts`
- Test: `packages/client/src/lib/designExtraction/normalize.test.ts`

Step 1: Write failing tests for common malformed cases (code fences, trailing text, missing optional fields).
Step 2: Run tests to verify failures.
Step 3: Implement parser/repair pass + schema validate.
Step 4: Run tests to green.
Step 5: Commit.

### Task 4: Add extraction orchestration API
Objective: Add a single entrypoint to run extraction and return validated JSON payload.

Files:
- Create: `packages/client/src/lib/designExtraction/extract.ts`
- Modify: `packages/client/src/lib/orchestrator/chatCompletion.ts`
- Test: `packages/client/src/lib/designExtraction/extract.test.ts`

Step 1: Write failing tests with mocked provider response.
Step 2: Confirm red.
Step 3: Implement extraction entrypoint and mode wiring.
Step 4: Re-run tests to green.
Step 5: Commit.

### Task 5: Build minimal UI flow
Objective: Add user-facing flow for upload, extraction mode, JSON inspect/edit, and regenerate prompt generation.

Files:
- Create: `packages/client/src/components/DesignExtraction/DesignExtractionPanel.tsx`
- Modify: `packages/client/src/components/Toolbar/CanvasToolbar.tsx` (entry point if desired)
- Modify: `packages/client/src/store/canvasStore.ts` (if new panel mode needed)
- Test: `packages/client/src/components/DesignExtraction/DesignExtractionPanel.test.tsx`

Step 1: Write failing UI state tests.
Step 2: Confirm red.
Step 3: Implement minimal panel and state transitions.
Step 4: Re-run tests.
Step 5: Commit.

### Task 6: Add evaluation harness fixtures
Objective: Evaluate style drift/fidelity on curated screenshots.

Files:
- Create: `packages/client/src/lib/designExtraction/eval/designExtractionEval.ts`
- Create: `packages/client/src/lib/designExtraction/eval/fixtures/*.json`
- Test: `packages/client/src/lib/designExtraction/eval/designExtractionEval.test.ts`

Step 1: Write failing evaluator tests.
Step 2: Confirm red.
Step 3: Implement baseline scoring (token preservation, composition stability markers).
Step 4: Re-run tests.
Step 5: Commit.

### Task 7: Documentation + operator checklist
Objective: Document runbook and quality checks.

Files:
- Modify: `hermes-dev/DESIGN-EXTRACTION-JSON-TOOL.md`
- Modify: `hermes-dev/WORKLOG.md`
- Modify: `hermes-dev/NEXT-STEPS.md`

Step 1: Add “How to run” and “Quality gate” checklist.
Step 2: Add troubleshooting notes for malformed JSON / high drift.
Step 3: Log completion entry.
Step 4: Commit.

---

Verification commands
- `node --import ./src/test/registerSvgStub.mjs --import ./src/test/registerLocalStorage.mjs --import tsx/esm --test src/lib/designExtraction/*.test.ts`
- `npm run build --workspace=packages/client`

Definition of done
- Screenshot extraction returns schema-valid JSON.
- All mode templates produce correct prompt variants.
- Edited block regenerate flow available and documented.
- Tests pass and docs are updated under `hermes-dev/`.
