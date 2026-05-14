# Scope parity (Orca vs Hermes / Meta-Harness / claw-code)

This file is a **thin developer overview** of what Orca Coder mirrors on purpose versus what lives in other projects.

| Capability | Orca Coder (this repo) | Hermes ([hermes-agent](https://github.com/NousResearch/hermes-agent)) | Meta-Harness (paper) | claw-code ([ultraworkers/claw-code](https://github.com/ultraworkers/claw-code)) |
|------------|-------------------------|----------------------------------------------------------------------|-------------------------|--------------------------------------------------------------------------------|
| Canvas + tiles UI | Yes (Tauri + web client) | No (Python gateway & integrations) | N/A | No (Rust CLI harness) |
| Tool execution against workspace | Yes — orchestrator + bridge | Via merge of HTTP canvas tools | N/A | Via its CLI/runtime |
| Session FTS recall (`recall_session_history`) | Desktop Tauri path | Hermes ecosystem varies | N/A | N/A |
| Long-term `MEMORY.md` | Workspace + user paths | Documented Hermes flow | N/A | N/A |
| Outer-loop harness search / Pareto over programs | Not implemented | N/A | Research focus | Different CLI scope |
| Raw harness traces + experiment folders | `.agent-canvas/harness/traces`, `.agent-canvas/harness/experiments/<id>/` | N/A | Inspired by trace-backed eval | N/A |

**Bridge:** Hermes (or any agent) can merge **`GET /api/canvas/tools`** and call **`POST /api/canvas/execute`** — see [CANVAS_AGENT_BRIDGE.md](CANVAS_AGENT_BRIDGE.md) and `npm run bridge:smoke`.

**Local DX:** `node scripts/orca-doctor.mjs` (see `npm run doctor`) checks bridge HTTP health and common file hints.

Orca does **not** ship the Hermes Python gateway or claw-code’s Rust runtime; integration is **HTTP + docs**, not a single merged binary.
