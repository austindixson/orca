import { useEffect, useState } from 'react'
import type { CursorPosition } from './agentBrowserClient'
import {
  PRESENTATION_CLICK_FEEDBACK_MS,
  PRESENTATION_DEFAULT_TRANSITION_MS,
} from './agentBrowserPresentation'

interface CursorOverlayProps {
  position: CursorPosition
  viewport: {
    deviceWidth: number
    deviceHeight: number
    displayWidth: number
    displayHeight: number
  }
  /** Device-space move transition duration (ms). 0 = instant. */
  pointerTransitionMs?: number
  /** Post-click ripple / pulse length (ms). */
  clickFeedbackMs?: number
  /** Shorten or remove motion when the user prefers reduced motion. */
  reducedMotion?: boolean
}

export function CursorOverlay({
  position,
  viewport,
  pointerTransitionMs = PRESENTATION_DEFAULT_TRANSITION_MS,
  clickFeedbackMs = PRESENTATION_CLICK_FEEDBACK_MS,
  reducedMotion = false,
}: CursorOverlayProps) {
  const [showRipple, setShowRipple] = useState(false)
  const moveMs = reducedMotion ? 0 : pointerTransitionMs
  const feedbackMs = reducedMotion ? 120 : clickFeedbackMs
  const pulseMs = Math.max(80, Math.round(feedbackMs * 0.35))

  // Scale cursor position to match viewport scaling
  const scaleX = viewport.displayWidth / viewport.deviceWidth
  const scaleY = viewport.displayHeight / viewport.deviceHeight
  const scaledX = position.x * scaleX
  const scaledY = position.y * scaleY

  // Trigger ripple animation on click
  useEffect(() => {
    if (position.isClicking) {
      setShowRipple(true)
      const timer = setTimeout(() => setShowRipple(false), feedbackMs)
      return () => clearTimeout(timer)
    }
  }, [position.isClicking, feedbackMs])

  if (!position.visible) return null

  return (
    <div
      className="absolute pointer-events-none z-50"
      style={{
        left: scaledX,
        top: scaledY,
        transform: 'translate(-2px, -2px)',
        transition:
          moveMs > 0
            ? `left ${moveMs}ms ease-out, top ${moveMs}ms ease-out`
            : 'none',
      }}
    >
      {/* Cursor pointer SVG */}
      <svg
        width="24"
        height="24"
        viewBox="0 0 24 24"
        className="drop-shadow-lg"
        style={{
          filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.3))',
        }}
      >
        <path
          d="M5.5 3.5L19 12L12 13L9 21L5.5 3.5Z"
          fill="#0ea5e9"
          stroke="#ffffff"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
      </svg>

      {/* Click ripple effect */}
      {showRipple && (
        <div
          className="absolute rounded-full bg-accent-teal/40"
          style={{
            width: 32,
            height: 32,
            left: -4,
            top: -4,
            animation: `cursor-ripple ${feedbackMs}ms ease-out forwards`,
          }}
        />
      )}

      {/* Pulse indicator when clicking */}
      {position.isClicking && (
        <div
          className="absolute rounded-full bg-accent-teal/60"
          style={{
            width: 12,
            height: 12,
            left: 6,
            top: 6,
            animation: `pulse ${pulseMs}ms ease-in-out`,
          }}
        />
      )}

      <style>{`
        @keyframes cursor-ripple {
          0% {
            transform: scale(0.5);
            opacity: 0.6;
          }
          100% {
            transform: scale(2);
            opacity: 0;
          }
        }
        @keyframes pulse {
          0%, 100% {
            transform: scale(1);
          }
          50% {
            transform: scale(1.3);
          }
        }
      `}</style>
    </div>
  )
}

interface ViewportCanvasProps {
  frame: string | null
  onMouseDown?: (x: number, y: number) => void
  onMouseUp?: (x: number, y: number) => void
  onMouseMove?: (x: number, y: number) => void
  onKeyDown?: (key: string, code: string) => void
  viewport: {
    deviceWidth: number
    deviceHeight: number
  }
}

export function ViewportCanvas({
  frame,
  onMouseDown,
  onMouseUp,
  onMouseMove,
  onKeyDown,
  viewport,
}: ViewportCanvasProps) {
  const handleMouseEvent = (
    e: React.MouseEvent<HTMLImageElement>,
    handler?: (x: number, y: number) => void
  ) => {
    if (!handler) return
    const rect = e.currentTarget.getBoundingClientRect()
    const x = ((e.clientX - rect.left) / rect.width) * viewport.deviceWidth
    const y = ((e.clientY - rect.top) / rect.height) * viewport.deviceHeight
    handler(x, y)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!onKeyDown) return
    e.preventDefault()
    onKeyDown(e.key, e.code)
  }

  if (!frame) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-black/40 text-gray-500 text-sm">
        <div className="text-center space-y-2">
          <div className="text-2xl">🌐</div>
          <div>Waiting for browser stream...</div>
          <div className="text-xs text-gray-600">Navigate to a URL to start</div>
        </div>
      </div>
    )
  }

  return (
    <img
      src={`data:image/jpeg;base64,${frame}`}
      alt="Browser viewport"
      className="w-full h-full object-contain cursor-pointer focus:outline-none"
      tabIndex={0}
      onMouseDown={(e) => handleMouseEvent(e, onMouseDown)}
      onMouseUp={(e) => handleMouseEvent(e, onMouseUp)}
      onMouseMove={(e) => handleMouseEvent(e, onMouseMove)}
      onKeyDown={handleKeyDown}
      draggable={false}
    />
  )
}
