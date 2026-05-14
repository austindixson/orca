import { useEffect, useRef } from 'react'
import { CANVAS_THEMES, useSettingsStore } from '../../store/settingsStore'

/**
 * Minimal “NASA-style” ambient layer (inspired by particles.js NASA demo):
 * sparse points, very faint proximity lines, imperceptible drift — bespoke but quiet.
 * Screen-space only; does not affect pan/zoom math. Skips animation if prefers-reduced-motion.
 */
export function CanvasAmbientParticles() {
  const canvasTheme = useSettingsStore((s) => s.canvasTheme)
  const respectPrefersReducedMotion = useSettingsStore((s) => s.respectPrefersReducedMotion)
  const theme = CANVAS_THEMES[canvasTheme]
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const particlesRef = useRef<
    { x: number; y: number; vx: number; vy: number; phase: number }[]
  >([])
  const rafRef = useRef<number>(0)

  useEffect(() => {
    const canvas = canvasRef.current
    const wrap = wrapRef.current
    if (!canvas || !wrap) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const canvasEl = canvas
    const wrapEl = wrap
    const ctx2d = ctx

    const reducedMotion =
      respectPrefersReducedMotion &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches

    let w = 0
    let h = 0
    let dpr = 1

    // Keep links long but less dense/clustered.
    const LINK_DIST = 420
    const MAX_LINKS_PER_PARTICLE = 6
    const COUNT_CAP = 54

    function resize() {
      const rect = wrapEl.getBoundingClientRect()
      dpr = Math.min(window.devicePixelRatio || 1, 2)
      w = Math.max(1, Math.floor(rect.width))
      h = Math.max(1, Math.floor(rect.height))
      canvasEl.width = Math.floor(w * dpr)
      canvasEl.height = Math.floor(h * dpr)
      canvasEl.style.width = `${w}px`
      canvasEl.style.height = `${h}px`
      ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0)

      const area = w * h
      const n = Math.min(COUNT_CAP, Math.max(20, Math.floor(Math.sqrt(area) * 0.095)))
      if (particlesRef.current.length !== n) {
        particlesRef.current = Array.from({ length: n }, (_, i) => ({
          x: Math.random() * w,
          y: Math.random() * h,
          vx: (Math.random() - 0.5) * 0.045,
          vy: (Math.random() - 0.5) * 0.045,
          phase: (i / n) * Math.PI * 2,
        }))
      }
      if (reducedMotion) draw()
    }

    resize()
    const ro = new ResizeObserver(() => resize())
    ro.observe(wrap)

    function step() {
      if (reducedMotion) return
      const parts = particlesRef.current
      for (const p of parts) {
        p.x += p.vx
        p.y += p.vy
        if (p.x < -20) p.x = w + 20
        if (p.x > w + 20) p.x = -20
        if (p.y < -20) p.y = h + 20
        if (p.y > h + 20) p.y = -20
        p.phase += 0.0022
      }
    }

    function draw() {
      ctx2d.clearRect(0, 0, w, h)

      const parts = particlesRef.current
      const n = parts.length

      // Links (very subtle — NASA-like constellation)
      const linkCount = new Array<number>(n).fill(0)
      for (let i = 0; i < n; i++) {
        if (linkCount[i] >= MAX_LINKS_PER_PARTICLE) continue
        for (let j = i + 1; j < n; j++) {
          if (linkCount[i] >= MAX_LINKS_PER_PARTICLE) break
          if (linkCount[j] >= MAX_LINKS_PER_PARTICLE) continue
          const a = parts[i]
          const b = parts[j]
          const dx = a.x - b.x
          const dy = a.y - b.y
          const d = Math.hypot(dx, dy)
          if (d >= LINK_DIST) continue
          const t = 1 - d / LINK_DIST
          const alpha = t * t * 0.22
          ctx2d.strokeStyle = `rgba(${theme.particleLineRgb}, ${alpha})`
          ctx2d.lineWidth = 1.15
          ctx2d.beginPath()
          ctx2d.moveTo(a.x, a.y)
          ctx2d.lineTo(b.x, b.y)
          ctx2d.stroke()
          linkCount[i] += 1
          linkCount[j] += 1
        }
      }

      // Dots: cool white + rare teal accent
      for (let i = 0; i < n; i++) {
        const p = parts[i]
        const tw = 0.55 + Math.sin(p.phase) * 0.12
        const isAccent = i % 7 === 0
        ctx2d.fillStyle = isAccent
          ? `rgba(${theme.particleAccentRgb}, ${0.1 + tw * 0.06})`
          : `rgba(${theme.particleDotRgb}, ${0.08 + tw * 0.05})`
        ctx2d.beginPath()
        ctx2d.arc(p.x, p.y, isAccent ? 1.15 : 0.85, 0, Math.PI * 2)
        ctx2d.fill()
      }
    }

    function loop() {
      step()
      draw()
      rafRef.current = requestAnimationFrame(loop)
    }

    if (!reducedMotion) {
      rafRef.current = requestAnimationFrame(loop)
    }

    return () => {
      ro.disconnect()
      cancelAnimationFrame(rafRef.current)
    }
  }, [theme.particleAccentRgb, theme.particleDotRgb, theme.particleLineRgb, respectPrefersReducedMotion])

  return (
    <div
      ref={wrapRef}
      className="pointer-events-none absolute inset-0 z-0"
      aria-hidden
    >
      <canvas ref={canvasRef} className="block h-full w-full" />
    </div>
  )
}
