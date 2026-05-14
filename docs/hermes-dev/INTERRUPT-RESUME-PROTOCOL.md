# Interrupt-Resume Protocol (Conversation Harness Behavior)

Date: 2026-04-20 17:19:23 PDT
Owner: Hermes

## Why this matters
Users frequently interrupt active execution with a new question. A strong agent should:
1) answer the interruption immediately,
2) preserve progress context,
3) explicitly offer seamless resumption.

This behavior increases trust, perceived intelligence, and task continuity.

## The protocol

Step 1: Detect interruption intent
- New user message changes topic or asks clarification while work is in progress.

Step 2: Snapshot active work state
- Keep current todo/in-progress task IDs and latest checkpoint in memory/session state.

Step 3: Pivot instantly
- Answer the interruption directly with no friction and no blame.

Step 4: Offer explicit resume handoff
- After answering, include a concise line:
  - "Want me to continue where I left off on X?"
- If prior task is high-priority, default to continuing unless user says stop.

Step 5: Resume deterministically
- Continue from last checkpoint, not from scratch.
- Reconfirm current objective in one short line, then execute.

## UX rules
- Never punish interruption.
- Never lose previous work silently.
- Never make the user restate prior context if it is already known.
- Keep the resume offer concise (single sentence).

## Orca implementation mapping

Primary points:
- `packages/client/src/store/orchestratorSessionStore.ts`
  - Keep explicit `interruptionCheckpoint` state for active run.
  - Track paused task + resumable action summary.

- `packages/client/src/lib/orchestrator/runOrchestrator.ts`
  - Add an interruption policy branch in turn orchestration:
    - immediate-answer mode for interruption turn
    - append resumable continuation hint

- `packages/client/src/lib/orchestrator/orchestratorPromptLayers.ts`
  - Add a short policy block describing interruption handling order.

- `packages/client/src/lib/orchestrator/harnessEval/evaluateHarnessSuite.ts`
  - Add deterministic evaluator:
    - `interruption_answer_then_resume_offer`

## Suggested conformance tasks
1) `interruption_answer_then_resume_offer`
- Input: active task in progress + user asks unrelated question.
- Expect:
  - direct answer to interruption
  - explicit offer to resume prior task

2) `resume_uses_checkpoint_not_restart`
- Input: user says "continue" after interruption.
- Expect:
  - continuation from stored checkpoint
  - no duplicate re-execution of already completed substeps

3) `interrupt_does_not_drop_todo_state`
- Input: interruption during in-progress todo.
- Expect:
  - todo remains in_progress/pending correctly
  - no silent cancellation

## Minimal response template
- "[Direct answer to interruption]."
- "I can continue the previous task from [checkpoint]; want me to keep going?"

## Definition of done
- Interruption handling is deterministic and test-covered.
- Users can interrupt freely without context loss.
- Resume flows are one-step and checkpoint-accurate.
