# Hermes Any-App Hybrid — GUI/UX Spec

## Goal
Define the primary interaction surfaces so users can access Hermes workflows from anywhere on desktop, with fast input and robust file/image ingestion.

## Settings parity note
- Include Orca-style model/provider settings so users can connect multiple LLMs (hosted, OpenAI-compatible, local gateways), pick defaults, and switch per run.

## Interaction modes (user-selectable)

### Mode A: Desktop sidebar (persistent, expandable)
Behavior:
- Sidebar is available system-wide while user is in any app.
- User can open/close quickly; when open, it occupies ~25% of screen width by default.
- Host app area is responsively resized/squished rather than overlaid (push layout).
- Sidebar supports chat, run history, workflow-pack picker, and current task state.

Requirements:
- Default width target: 25% of active display (configurable min/max).
- Smooth open/close animations; preserve app focus rules.
- Remembers last open width and pinned/unpinned state.
- Must be keyboard navigable.

### Mode B: Spotlight-style command launcher
Behavior:
- Global shortcut (default: Control+Space) opens Apple/Spotlight-style quick input.
- Lightweight, centered, always-on-top momentary input surface.
- Supports single-command natural language execution and quick context selection.

Requirements:
- Shortcut is user-configurable.
- Must open in <150ms target on warm start.
- Supports suggestion list (packs, recent commands, recent files).
- Enter runs; Escape closes without side effects.

## Chat + composer capabilities
Required in both modes:
- Natural-language prompt input.
- Workflow pack resolution (explicit or contextual).
- Risk tier preview before execution.
- Inline confirmation UI for destructive actions.

## File/photo ingestion requirements

### Drag and drop
- User can drag files/photos into chat composer or sidebar dropzone.
- App resolves dropped items to absolute local file paths.
- Paths become structured attachments for command resolution.

### Paste image behavior
- On image paste from clipboard:
  - Save image to local temp/session attachment folder.
  - Auto-insert generated local path attachment into composer.
  - Show small attachment chip/preview with file name + size.

### Paste text truncation behavior
- On large text paste, do immediate smart truncation in composer.
- Replace oversized content with compact placeholder token style used by coding agents.

Recommended placeholder format:
- `[TRUNCATED: <kept_lines>/<total_lines> lines, <kept_chars>/<total_chars> chars]`

Policy defaults:
- Keep first N lines + last M lines, drop middle.
- Preserve original in attachment store (optional toggle), never silently lost.
- User can expand preview before send.

## Local path handling
- Always prefer local absolute paths for attachments.
- Normalize and validate paths before invocation.
- For inaccessible/missing paths, show immediate inline error and remediation.

## Accessibility and ergonomics
- Full keyboard flow for open, compose, attach, send, and confirm.
- High-contrast compatible theme.
- Clear focus ring and ARIA labels for sidebar/launcher controls.

## Performance targets
- Sidebar open/close animation: <200ms perceived.
- Spotlight open: <150ms warm.
- Paste/drop attach chip render: <100ms for normal payloads.

## Acceptance criteria
1) User can switch between persistent sidebar and spotlight input modes.
2) Sidebar pushes/squishes screen region with ~25% default width.
3) Global shortcut opens spotlight launcher consistently.
4) User can drag/drop files and photos; local paths are attached.
5) Image paste auto-creates local file path attachment.
6) Large text paste is immediately truncated with clear token + counts.
7) User can inspect/expand truncated preview before sending.
