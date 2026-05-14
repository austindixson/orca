# Hermes Error-Catching Best Practices

## Purpose
Capture the operational pattern Hermes should follow when a command fails mid-task: treat errors as routing signals, branch quickly, and still complete the user goal.

## Core Principle
Errors are data, not dead ends.

A non-zero exit code should trigger diagnosis + fallback routing, not abandonment or guesswork.

## Standard Error-Handling Loop
1. Preflight check first
- Run the smallest command that validates prerequisites before doing expensive work.
- Example: `git rev-parse --is-inside-work-tree` before commit/push workflows.

2. Read structured failure signal
- Use `exit_code`, stderr text, and command context.
- Categorize failure type:
  - environment missing (e.g., not a git repo)
  - auth missing
  - dependency missing
  - permission/path mismatch
  - transient/network

3. Verify root cause with one quick probe
- Confirm assumptions with a direct check.
- Example probes:
  - repo existence: search for `.git`
  - auth readiness: `gh auth status`
  - remote readiness: `git remote -v`

4. Branch to deterministic fallback
- Choose a fallback path based on category.
- Example decision logic:
  - if not git repo -> `git init -b main` + commit
  - if no remote -> create/set `origin`
  - if remote exists -> `git push origin main`

5. Re-verify completion state
- Validate final state explicitly; do not assume success from one command.
- Example:
  - `git rev-parse --short HEAD`
  - `git status --short`
  - `git remote -v`

6. Resume the original objective immediately
- After the error is fixed and prerequisites are green, continue the user’s original task from the exact interrupted step.
- Do not stop at “fixed the error.” Complete the requested outcome.
- Example:
  - after fixing git bootstrap/auth, proceed to commit + push and confirm remote tracking.

## Example: Commit + Push Request
Observed sequence that successfully recovered from initial failure:
- Initial preflight failed: `fatal: not a git repository`
- Verified no existing repo metadata
- Initialized repository and created root commit
- Confirmed GitHub auth via `gh auth status`
- Conditional push:
  - existing origin -> push
  - missing origin -> create repo + set origin + push
- Verified clean state and tracking remote after push

## Implementation Rules for Hermes/Orca
- Always branch on non-zero exit codes.
- Never continue the same path after a prerequisite failure.
- Prefer short probe commands over speculative fixes.
- Maintain idempotent fallback chains (safe to re-run).
- End with explicit state verification tailored to user ask.

## Hermes Lead Runtime Error-Catching (Orca implementation)
This is the concrete layered error-catching path currently used in Orca Hermes Lead mode.

1. Provider/API layer (`packages/client/src/lib/orchestrator/chatCompletion.ts`)
- Catches network errors, aborts/timeouts, HTTP failures, parse failures, and empty provider payloads.
- Applies retry budgets for retryable statuses (e.g. 429/408/502/529 and some 503 overload cases).
- Avoids retry storms on non-retryable contract errors (e.g. 400 input contract failures).
- Hermes Responses path injects a continuation user turn when needed to satisfy provider input contract.

2. Responses normalization layer (`packages/client/src/lib/orchestrator/openaiResponsesAdapter.ts`)
- Filters stale/replayed `function_call` entries when matching `function_call_output.call_id` already exists.
- Prevents replay cascades and downstream follow-up failures.

3. Orchestrator loop layer (`packages/client/src/lib/orchestrator/runOrchestrator.ts`)
- Guarantees user-turn invariant before each follow-up call.
- Detects empty tool rounds and performs staged recovery:
  - retry same model
  - retry with `parallel_tool_calls` disabled
  - provider/model fallback hop when configured
- Quarantines repeated empty-tool reply models for a short window.
- On terminal failure, emits structured run-end error traces and rethrows to session layer.

4. Tool execution layer (`packages/client/src/lib/orchestrator/executeTools.ts`)
- Converts tool validation/runtime failures into structured `jsonErr(...)` payloads (`{ ok:false, error }`).
- Applies path/safety/policy guards before side effects.
- Uses final catch to normalize unexpected exceptions into tool error payloads.

5. Session/UI layer (`packages/client/src/store/orchestratorSessionStore.ts`)
- Catches orchestrator run failures and classifies outcomes (abort, restart, structured error).
- Emits user-facing logs + toasts, tile status updates, and telemetry ingest.
- Preserves a friendly error message for known failure classes while retaining raw diagnostics in logs/telemetry.

## Quick Template
Use this template in future workflows:

1) Preflight -> 2) Capture error -> 3) Validate cause -> 4) Fallback branch -> 5) Verify done

Keep this pattern consistent across git workflows, local runtime checks, API integration setup, and deployment tasks.
