# Orca Coder Remotion Video

This Remotion project creates an animated video showcasing the Orca Coder UI/UX based on the Swiss Modern presentation design.

## Project Structure

- `Root.tsx` - Main Remotion composition entry point
- `compositions/SwissModernPresentation.tsx` - Main presentation component with 9 slides
- `src/index.ts` - Entry point for Remotion CLI

## Features

- Swiss Modern design language with red accent (#e11d2e)
- Grid background with subtle opacity
- Smooth spring animations for text reveal
- 9 slides covering: Orca Coder overview, positioning, canvas features, modules, orchestrator, integrations, stack, workflow, and call-to-action
- 60 FPS animation at 1080p resolution (1920x1080)
- 2 seconds per slide with staggered element reveal

## Running

```bash
# Install dependencies
npm install

# Start Remotion Studio (interactive preview)
npm start

# Build the video
npm run build
```

## Customization

Edit `compositions/SwissModernPresentation.tsx` to:
- Change slide content in the SLIDES array
- Adjust timing (framesPerSlide variable)
- Modify colors, fonts, and spacing
- Add new slide types (cards, aside, etc.)

The video will be output to `out/video.mp4` when building.
