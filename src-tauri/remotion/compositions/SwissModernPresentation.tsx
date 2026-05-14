import {
  AbsoluteFill,
  interpolate,
  Sequence,
  spring,
  useCurrentFrame,
  useVideoConfig,
  Audio,
} from "remotion";
import React from "react";

// Swiss Modern color palette
const SWISS_RED = "#e11d2e";
const BG_COLOR = "#fafafa";
const TEXT_COLOR = "#111";
const GRID_COLOR = "rgba(0,0,0,0.06)";

// Slide content
const SLIDES = [
  {
    id: 1,
    label: "Orca Coder",
    title: "Infinite canvas IDE for multi-agent coding",
    description: "Pan, zoom, and arrange agents, terminals, editors, and previews on one surface — with an orchestrator that drives tools against your repo.",
    aside: {
      title: "Swiss Modern",
      content: "Editorial grid · red rule · Archivo + Nunito",
    },
  },
  {
    id: 2,
    label: "Positioning",
    title: "One workspace, many agents",
    description: "Run Claude, Codex, Gemini, and your own flows in parallel without losing context — tiles keep outputs and files visually separated.",
    aside: null,
  },
  {
    id: 3,
    label: "Canvas",
    title: "Tiles, not tabs",
    description:
      "Infinite pan and zoom; focus mode for deep work\nZ-order, resize presets, and mission-control style overview\nOrchestrator reveals the active module as tools run",
    aside: {
      title: "Model",
      content: "Each tile has id, title, position, size, and meta — the orchestrator lists and updates them safely.",
    },
  },
  {
    id: 4,
    label: "Modules",
    title: "Six core tile types",
    cards: [
      { title: "Agent", desc: "Live model output" },
      { title: "Terminal", desc: "PTY + xterm.js" },
      { title: "Editor", desc: "Monaco" },
      { title: "Browser", desc: "Local / web preview" },
      { title: "Diff", desc: "Writes & review" },
      { title: "Todo", desc: "Tasks & handoff" },
    ],
    aside: null,
  },
  {
    id: 5,
    label: "Orchestrator",
    title: "Tool loop on your repo",
    description:
      "Read / write files, list directories, workspace switch\nCreate and update canvas modules from chat\nParallel tool batches when paths don't conflict",
    aside: {
      title: "Quality",
      content: "Large tool results can be compressed before they hit the model — less context blow-up on long sessions.",
    },
  },
  {
    id: 6,
    label: "Integrations",
    title: "Bring your own agent",
    description:
      "External runners (Hermes, Pi, OpenClaude-style adapters) can call the same tool contract over HTTP/WebSocket — the canvas executes tools while your UI stays in sync. GitHub research can use a dedicated GitHub (gh) module instead of fragile iframes.",
    aside: null,
  },
  {
    id: 7,
    label: "Stack",
    title: "Implementation",
    description:
      "React 18, TypeScript, Vite, Tailwind, Zustand\nCompanion server: Node, Express, WebSocket\nDesktop: Tauri + native shell where needed",
    aside: {
      title: "Dev",
      content: "npm install && npm run dev",
    },
  },
  {
    id: 8,
    label: "Workflow",
    title: "Keyboard-first",
    description: "⌘1–⌘6 — add Agent, Terminal, Browser, Todo, Editor, Diff\n⌘Enter — focus mode · Esc — exit · ⌘0 — reset view",
    aside: null,
  },
  {
    id: 9,
    label: "Orca Coder",
    title: "Ship faster with a visible multi-agent desk",
    description: "MIT License · customize theme via CSS variables: --swiss-red, fonts, grid opacity.",
    aside: null,
  },
];

// Grid background component
const GridBackground: React.FC<{ opacity?: number }> = ({ opacity = 0.35 }) => {
  return (
    <AbsoluteFill
      style={{
        backgroundImage: `
          linear-gradient(to right, ${GRID_COLOR} 1px, transparent 1px),
          linear-gradient(to bottom, ${GRID_COLOR} 1px, transparent 1px)
        `,
        backgroundSize: "calc(100% / 12) 100%, 100% 64px",
        opacity,
      }}
    />
  );
};

// Red rule component
const RedRule: React.FC = () => {
  return (
    <div
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        height: 6,
        backgroundColor: SWISS_RED,
        zIndex: 10,
      }}
    />
  );
};

// Label component
const Label: React.FC<{ children: React.ReactNode; opacity?: number }> = ({
  children,
  opacity = 1,
}) => {
  return (
    <p
      style={{
        fontFamily: "Arial, sans-serif",
        fontWeight: "bold",
        fontSize: 18,
        letterSpacing: "0.14em",
        textTransform: "uppercase" as const,
        color: SWISS_RED,
        margin: 0,
        marginBottom: 32,
        opacity,
      }}
    >
      {children}
    </p>
  );
};

// Title component
const Title: React.FC<{ children: React.ReactNode; opacity?: number }> = ({
  children,
  opacity = 1,
}) => {
  return (
    <h1
      style={{
        fontFamily: "Arial, sans-serif",
        fontWeight: "bold",
        fontSize: String(children ?? "").length > 50 ? 48 : 64,
        lineHeight: 1.08,
        letterSpacing: "-0.03em",
        margin: 0,
        marginBottom: 32,
        color: TEXT_COLOR,
        opacity,
      }}
    >
      {children}
    </h1>
  );
};

// Subtitle component
const Subtitle: React.FC<{ children: React.ReactNode; opacity?: number }> = ({
  children,
  opacity = 1,
}) => {
  return (
    <h2
      style={{
        fontFamily: "Arial, sans-serif",
        fontWeight: "bold",
        fontSize: 40,
        lineHeight: 1.15,
        letterSpacing: "-0.02em",
        margin: 0,
        marginBottom: 32,
        color: TEXT_COLOR,
        opacity,
      }}
    >
      {children}
    </h2>
  );
};

// Description component
const Description: React.FC<{ children: React.ReactNode; opacity?: number }> = ({
  children,
  opacity = 1,
}) => {
  const isMultiline = typeof children === "string" && children.includes("\n");
  const content = isMultiline
    ? children.toString().split("\n").map((line, i) => (
        <React.Fragment key={i}>
          {line}
          {i < (children.toString().match(/\n/g)?.length || 0) && <br />}
        </React.Fragment>
      ))
    : children;

  return (
    <p
      style={{
        fontFamily: "Arial, sans-serif",
        fontSize: 24,
        lineHeight: 1.55,
        color: "#333",
        margin: 0,
        maxWidth: 640,
        opacity,
      }}
    >
      {content}
    </p>
  );
};

// Aside component
const Aside: React.FC<{
  title: string;
  content: string;
  opacity?: number;
}> = ({ title, content, opacity = 1 }) => {
  return (
    <aside
      style={{
        borderLeft: "3px solid #111",
        paddingLeft: 28,
        fontFamily: "Arial, sans-serif",
        fontSize: 18,
        lineHeight: 1.5,
        color: "#444",
        opacity,
      }}
    >
      <strong
        style={{
          display: "block",
          fontFamily: "Arial, sans-serif",
          fontWeight: "bold",
          fontSize: 20,
          color: "#111",
          marginBottom: 12,
        }}
      >
        {title}
      </strong>
      {content}
    </aside>
  );
};

// Cards grid component
const CardsGrid: React.FC<{
  cards: Array<{ title: string; desc: string }>;
  opacity?: number;
}> = ({ cards, opacity = 1 }) => {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(3, 1fr)",
        gap: 20,
        marginTop: 32,
        maxWidth: 720,
        opacity,
      }}
    >
      {cards.map((card, i) => (
        <div
          key={i}
          style={{
            border: "1px solid rgba(0,0,0,0.1)",
            padding: 20,
            background: "rgba(255,255,255,0.7)",
            fontFamily: "Arial, sans-serif",
            fontSize: 18,
            lineHeight: 1.4,
            color: "#222",
          }}
        >
          <b
            style={{
              fontFamily: "Arial, sans-serif",
              fontWeight: "bold",
              display: "block",
              fontSize: 20,
              marginBottom: 8,
              color: "#111",
            }}
          >
            {card.title}
          </b>
          {card.desc}
        </div>
      ))}
    </div>
  );
};

// Slide component
const Slide: React.FC<{
  slide: typeof SLIDES[0];
  isActive: boolean;
  frame: number;
}> = ({ slide, isActive, frame }) => {
  const slideProgress = Math.min(frame / 30, 1);

  const labelOpacity = spring({
    frame,
    fps: 60,
    config: { damping: 15, stiffness: 100 },
  });

  const titleOpacity = spring({
    frame: Math.max(0, frame - 8),
    fps: 60,
    config: { damping: 15, stiffness: 100 },
  });

  const contentOpacity = spring({
    frame: Math.max(0, frame - 16),
    fps: 60,
    config: { damping: 15, stiffness: 100 },
  });

  return (
    <AbsoluteFill style={{ background: BG_COLOR }}>
      <GridBackground />
      <RedRule />
      <AbsoluteFill
        style={{
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: 80,
          paddingTop: 100,
        }}
      >
        {slide.description ? (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: slide.aside ? "1fr min(38%, 300px)" : "1fr",
              gap: 56,
              alignItems: "center",
            }}
          >
            <div>
              <Label opacity={labelOpacity}>{slide.label}</Label>
              {slide.title.length > 50 ? (
                <Subtitle opacity={titleOpacity}>{slide.title}</Subtitle>
              ) : (
                <Title opacity={titleOpacity}>{slide.title}</Title>
              )}
              <Description opacity={contentOpacity}>{slide.description}</Description>
            </div>
            {slide.aside && <Aside {...slide.aside} opacity={contentOpacity} />}
          </div>
        ) : slide.cards ? (
          <div>
            <Label opacity={labelOpacity}>{slide.label}</Label>
            <Subtitle opacity={titleOpacity}>{slide.title}</Subtitle>
            <CardsGrid cards={slide.cards} opacity={contentOpacity} />
          </div>
        ) : (
          <div>
            <Label opacity={labelOpacity}>{slide.label}</Label>
            {slide.title.length > 50 ? (
              <Subtitle opacity={titleOpacity}>{slide.title}</Subtitle>
            ) : (
              <Title opacity={titleOpacity}>{slide.title}</Title>
            )}
            <Description opacity={contentOpacity}>{slide.description}</Description>
          </div>
        )}
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

// Main presentation component
export const SwissModernPresentation: React.FC<{
  slideCount: number;
}> = ({ slideCount }) => {
  const { fps } = useVideoConfig();
  const frame = useCurrentFrame();

  const framesPerSlide = 120; // 2 seconds per slide at 60fps
  const currentSlideIndex = Math.min(
    Math.floor(frame / framesPerSlide),
    slideCount - 1
  );

  return (
    <AbsoluteFill style={{ background: BG_COLOR }}>
      {SLIDES.slice(0, slideCount).map((slide, i) => (
        <Sequence
          key={slide.id}
          from={i * framesPerSlide}
          durationInFrames={framesPerSlide}
        >
          <Slide
            slide={slide}
            isActive={i === currentSlideIndex}
            frame={frame - i * framesPerSlide}
          />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
};
