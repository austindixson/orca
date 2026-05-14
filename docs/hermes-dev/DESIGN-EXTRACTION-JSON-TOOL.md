# Design Extraction JSON Tool

Goal: Add a workflow/tool that accepts a screenshot and outputs a structured JSON style-guide map of the full design, then supports controlled edit/regenerate loops.

## Why this matters
- Converts visual design into machine-editable structure.
- Improves granular control for image edits while preserving scene consistency.
- Enables reusable design intelligence for Orca workflows (tokens/components/layout extraction).

## Source pattern (video prompt trick)
1) Extraction prompt (Create Image OFF):
"Analyze this image and extract all the information from this image and convert it into structured JSON."

2) Modification prompt (Create Image ON):
"Now modify the image based on the following JSON data: [Paste your edited JSON block here]"

## Context-specific prompt variants from video
- Replace elements:
  "Analyze the image and extract all the element related information from this image and convert it into structured JSON."
- Weather/seasons:
  "Analyze this image and extract the information related to weather or season such as summer, winter, rain, or snowfall and convert it into structured JSON."
- Camera angles/perspective:
  "Please analyze the image and extract the information related to camera angle and perspective in structured JSON format."
- Add new object:
  "Modify the image and add a [object] based on the following JSON data: [JSON block]."

## Proposed Orca output schema (v0)
- `meta`: source, timestamp, model, confidence
- `global_style`: mood, visual_language, rendering_style, material_language
- `layout`: canvas_size, grid, alignment, whitespace_map, hierarchy
- `typography`: font_families, weights, scale, line_height, letter_spacing, usage_map
- `color_system`: palette, roles (bg/surface/text/accent/state), contrast notes
- `spacing_rhythm`: base_unit, spacing_scale, padding/margin patterns
- `components`: reusable UI blocks with states and variants
- `objects`: scene/object blocks (id, position, material, color, lighting, relationships)
- `lighting_environment`: light sources, intensity, time-of-day/weather effects
- `camera_perspective`: lens/angle/depth cues
- `interaction_semantics`: affordances, emphasis, user-flow hints
- `edit_targets`: independently editable blocks for low-drift modifications

## Acceptance criteria (initial)
- Screenshot in -> valid JSON out (schema-conformant).
- JSON supports block-level edits without broad style drift.
- Includes dedicated extraction presets (full, elements-only, weather-only, camera-only).
- Includes regenerate prompt templates tied to edited block(s).
- Includes quality checklist (style preservation, composition stability, token coherence).

## Planned implementation slices
1. Prompt-template pack + schema doc.
2. JSON validator + normalization pass.
3. UI flow: upload screenshot -> extraction mode -> JSON view/edit.
4. Regeneration flow: edited block -> constrained modify prompt.
5. Evaluation harness: drift and fidelity checks across 10+ samples.

## Open decisions
- Whether to target Gemini-only first or provider-agnostic extraction adapters.
- Strict JSON schema enforcement vs tolerant parser + repair pass.
- How to score style drift deterministically in harness tests.
