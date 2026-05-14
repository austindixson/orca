/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./tray.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        canvas: {
          bg: 'rgb(var(--canvas-bg-rgb) / <alpha-value>)',
          dot: 'rgb(var(--canvas-dot-rgb) / <alpha-value>)',
        },
        tile: {
          bg: 'rgb(var(--tile-bg-rgb) / <alpha-value>)',
          border: 'rgb(var(--tile-border-rgb) / <alpha-value>)',
          header: 'rgb(var(--tile-header-rgb) / <alpha-value>)',
          hover: 'rgb(var(--tile-hover-rgb) / <alpha-value>)',
        },
        accent: {
          teal: 'rgb(var(--accent-teal-rgb) / <alpha-value>)',
          orange: 'rgb(var(--accent-orange-rgb) / <alpha-value>)',
          purple: 'rgb(var(--accent-purple-rgb) / <alpha-value>)',
          blue: 'rgb(var(--accent-blue-rgb) / <alpha-value>)',
          pink: 'rgb(var(--accent-pink-rgb) / <alpha-value>)',
        },
        status: {
          idle: '#fbbf24',
          working: '#3b82f6',
          done: '#10b981',
          error: '#ef4444',
        },
      },
      boxShadow: {
        'tile': '0 4px 20px rgba(0, 0, 0, 0.4)',
        'tile-hover': '0 8px 30px rgba(0, 0, 0, 0.5)',
        'glow-teal': '0 0 24px rgba(0, 212, 170, 0.22), 0 4px 20px rgba(0, 0, 0, 0.35)',
        'glow-blue': '0 0 24px rgba(59, 130, 246, 0.2), 0 4px 20px rgba(0, 0, 0, 0.35)',
        'glow-purple': '0 0 24px rgba(168, 85, 247, 0.2), 0 4px 20px rgba(0, 0, 0, 0.35)',
        'glow-orange': '0 0 24px rgba(255, 107, 53, 0.2), 0 4px 20px rgba(0, 0, 0, 0.35)',
        'glow-pink': '0 0 24px rgba(236, 72, 153, 0.18), 0 4px 20px rgba(0, 0, 0, 0.35)',
      },
      keyframes: {
        shimmer: {
          '0%': { backgroundPosition: '200% center' },
          '100%': { backgroundPosition: '-200% center' },
        },
        /** Quick orchestrator bar — soft breathing glow on the rim */
        'quick-input-edge-pulse': {
          '0%, 100%': {
            borderColor: 'rgb(var(--tile-border-rgb) / 0.55)',
            boxShadow:
              'inset 0 0 0 9999px rgba(0,0,0,0.08), 0 8px 32px rgba(0,0,0,0.55), 0 0 0 1px rgb(var(--tile-border-rgb) / 0.35), 0 0 20px rgb(var(--accent-teal-rgb) / 0.12)',
          },
          '50%': {
            borderColor: 'rgb(var(--accent-teal-rgb) / 0.42)',
            boxShadow:
              'inset 0 0 0 9999px rgba(0,0,0,0.08), 0 8px 32px rgba(0,0,0,0.55), 0 0 0 1px rgb(var(--accent-teal-rgb) / 0.45), 0 0 44px rgb(var(--accent-teal-rgb) / 0.32)',
          },
        },
      },
      animation: {
        shimmer: 'shimmer 3.6s ease-in-out infinite',
        'quick-input-edge-pulse': 'quick-input-edge-pulse 3.8s ease-in-out infinite',
      },
    },
  },
  plugins: [],
}
