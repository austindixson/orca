# Proactive Orca harness

Orca’s **reactive** loop (user message → tools → reply) can be extended with a **proactive** loop: scheduled **heartbeat** runs that re-enter the same orchestrator with a synthetic user message, plus a separate **user model** (`USER.md`) and an **autonomy constitution** in the system prompt.

Design goal: **reactive loop + proactive loop + user model + autonomy policy + evaluation harness** — without mixing user facts into project memory.

---

## File taxonomy

| File | Role |
|------|------|
| **`soul.md`**, **`personality.md`** | Values, boundaries, tone — loaded via `orchestratorClaudeMd.ts` (workspace + user search paths). |
| **`.orca/MEMORY.md`** / **`~/.orca/MEMORY.md`** | **Project / environment** facts, lessons, recurring-signal context. See [`MEMORY_ARCHITECTURE.md`](MEMORY_ARCHITECTURE.md). |
| **`.orca/USER.md`** / **`~/.orca/USER.md`** | **Human** preferences, communication style, goals, habits — **never** substitute for MEMORY.md. |
| **`.orca/HEARTBEAT.md`** or **`HEARTBEAT.md`** (workspace root) | Proactive routines, loose ends, what to do on a tick. |
| **`~/.orca/HEARTBEAT.md`** | Optional user-global heartbeat overlay (merged after workspace files). |

---

## Settings (desktop)

**Settings → Agent data**

| Area | What it controls |
|------|------------------|
| **Context, memory & user profile** | Short-term budget; `MEMORY.md`; **Inject user profile (USER.md)**; source (workspace / user / both); cap; **User profile distiller (session end)**. |
| **Proactivity & autonomy** | **Enable orchestrator heartbeat**; **interval (minutes)**; **Autonomy mode** (standard vs broad). |

Defaults: heartbeat is **off** until you add `HEARTBEAT.md` content; autonomy **broad** is the product default in settings (explicit red lines still apply).

---

## Prompt layers

Orca splits the system prompt into:

1. **Static layers** (stable for the run assembly): project instructions (`orca.md` / `CLAUDE.md`), `MEMORY.md`, `USER.md`, soul/personality, recurring-issue block, harness candidate snippet, compaction summary — assembled in **`runOrchestrator.ts`** before the dynamic boundary.
2. **Dynamic overlays** (turn-specific): autonomy constitution, heartbeat/run context, task pressure — see **`orchestratorPromptLayers.ts`** and **`SYSTEM_PROMPT_DYNAMIC_BOUNDARY`**.

**Autonomy** (`orchestratorAutonomyPolicy.ts`):

- **Standard**: confirm before risky external effects.
- **Broad**: wide latitude for safe work; **ask first** for outbound comms, money, destructive/irreversible actions, and mishandling secrets (see the live prompt block for the full list).

---

## Heartbeat runtime

- **Bootstrap:** `startOrchestratorHeartbeatScheduler()` from **`orchestratorHeartbeat.ts`** runs on app mount (`App.tsx`).
- **Scheduler:** Chained `setTimeout`; interval from settings (clamped 1 minute … 24 hours). Subscribes to settings changes to reschedule.
- **Guards:** No tick while **heartbeat disabled**; **document hidden** (`visibilityState === 'hidden'`) → skip tick (avoid background surprise runs); **orchestrator already running** or **one-shot mode** → skip.
- **Entry:** Loads merged instructions via **`loadHeartbeatInstructionsMerged()`**; if non-empty, builds **`buildHeartbeatSyntheticUserMessage`** and calls **`orchestratorSessionStore.run()`** with **`source: 'heartbeat'`**.
- **Logging:** Heartbeat turns log as `[Heartbeat] …` instead of a user line.

---

## User profile distiller

- **Module:** `packages/client/src/lib/orchestrator/userProfileDistiller.ts`
- **When:** End of a normal orchestrator run (same lifecycle hook as the memory distiller), if **user profile distiller** and **inject user profile** are both enabled.
- **Skipped:** Aborted runs; very short sessions; **`source: 'heartbeat'`** (avoids distilling synthetic proactive text into USER.md).
- **Output:** Bullets under **`## Distilled user notes (auto)`** in `USER.md`.
- **Write target:** **Workspace** only when source is **both** (avoids auto-duplicating `~/.orca/USER.md`). **Workspace** or **user** source writes to the matching file; **`writeOrcaDataFile`** is used for `~/.orca/USER.md` (see `tauri.ts`).

Session-end **memory** distiller (`memoryDistiller.ts`) remains separate: signals → `.orca/MEMORY.signals.jsonl` and lessons → `.orca/MEMORY.md`.

---

## Harness eval (deterministic)

Proactive smoke tasks (no live LLM): **`packages/client/src/lib/orchestrator/harnessEval/tasks.proactive.json`**

```bash
npm run harness:eval --workspace=@agent-canvas/client -- --candidate <id> --split proactive
```

Checks include synthetic heartbeat message markers and autonomy constitution text for **standard** and **broad**. Scores land in `.agent-canvas/harness/candidates/<id>/scores.json` with **`split: "proactive"`**.

For recurring-memory cold/warm behavior, use **`--split memory`** (see [`MEMORY_ARCHITECTURE.md`](MEMORY_ARCHITECTURE.md)).

---

## Code map (quick reference)

| Concern | Primary files |
|--------|----------------|
| Run entry, `source: 'heartbeat'` | `store/orchestratorSessionStore.ts` |
| System prompt assembly | `lib/orchestrator/runOrchestrator.ts` |
| USER.md / MEMORY.md load | `lib/orchestrator/orcaMemory.ts` |
| Heartbeat load + scheduler | `lib/orchestrator/orchestratorHeartbeat.ts` |
| Dynamic preface | `lib/orchestrator/orchestratorPromptLayers.ts` |
| Autonomy markdown | `lib/orchestrator/orchestratorAutonomyPolicy.ts` |
| User distiller | `lib/orchestrator/userProfileDistiller.ts` |
| Memory distiller | `lib/orchestrator/memoryDistiller.ts` |
| Eval tasks | `lib/orchestrator/harnessEval/evaluateHarnessSuite.ts`, `tasks.proactive.json` |
| `~/.orca` writes | `lib/tauri.ts` (`readOrcaDataFile`, `writeOrcaDataFile`) |

---

## Related

- [`docs/MEMORY_ARCHITECTURE.md`](MEMORY_ARCHITECTURE.md) — MEMORY.md, memory distiller, recurring signals, `tasks.memory.json`.
- [`docs/skills/orca-meta-harness/SKILL.md`](skills/orca-meta-harness/SKILL.md) — harness traces, candidates, Pareto.
- [`AGENTS.md`](../AGENTS.md) — agent entry points and persistence overview.
