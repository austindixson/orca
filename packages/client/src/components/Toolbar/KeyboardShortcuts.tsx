import { useState, useEffect } from 'react'
import { OPEN_KEYBOARD_SHORTCUTS_EVENT } from '../../lib/uiEvents'

const SHORTCUTS = [
  { keys: ['⌘', '⇧', 'N'], description: 'New window (project picker)' },
  { keys: ['⌘', 'W'], description: 'Close this window' },
  { keys: ['⌘', 'Enter'], description: 'Toggle focus mode' },
  { keys: ['⌘', '1'], description: 'Add Agent tile' },
  { keys: ['⌘', '2'], description: 'Add Terminal tile' },
  { keys: ['⌘', '3'], description: 'Add Browser tile' },
  { keys: ['⌘', '4'], description: 'Add Todo tile' },
  { keys: ['⌘', '5'], description: 'Add Editor tile' },
  { keys: ['⌘', '6'], description: 'Add Diff tile' },
  { keys: ['⌘', '0'], description: 'Reset view' },
  { keys: ['Scroll'], description: 'Zoom in/out' },
  { keys: ['Drag'], description: 'Pan canvas' },
  { keys: ['Shift', '←↑↓→'], description: 'Switch active module (L/R: order; U/D: nearest above/below)' },
  { keys: ['Esc'], description: 'Exit focus mode' },
]

export function KeyboardShortcuts() {
  const [isOpen, setIsOpen] = useState(false)

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === '?' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        setIsOpen(!isOpen)
      }
      if (e.key === 'Escape' && isOpen) {
        setIsOpen(false)
      }
    }

    const handleOpenFromMenu = () => setIsOpen(true)

    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener(OPEN_KEYBOARD_SHORTCUTS_EVENT, handleOpenFromMenu)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener(OPEN_KEYBOARD_SHORTCUTS_EVENT, handleOpenFromMenu)
    }
  }, [isOpen])

  return (
    <>
      {/* Modal */}
      {isOpen && (
        <>
          <div 
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[60]"
            onClick={() => setIsOpen(false)}
          />
          <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 bg-tile-bg border border-tile-border rounded-2xl shadow-2xl z-[70] overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-tile-border">
              <h2 className="text-lg font-semibold text-white">Keyboard Shortcuts</h2>
              <button
                onClick={() => setIsOpen(false)}
                className="text-gray-500 hover:text-white transition-colors"
              >
                <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            <div className="p-4 max-h-96 overflow-auto">
              <div className="space-y-2">
                {SHORTCUTS.map((shortcut, i) => (
                  <div key={i} className="flex items-center justify-between py-2">
                    <span className="text-sm text-gray-300">{shortcut.description}</span>
                    <div className="flex items-center gap-1">
                      {shortcut.keys.map((key, j) => (
                        <kbd
                          key={j}
                          className="px-2 py-1 bg-canvas-bg border border-tile-border rounded text-xs text-gray-400 font-mono"
                        >
                          {key}
                        </kbd>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="px-5 py-3 bg-canvas-bg border-t border-tile-border">
              <p className="text-xs text-gray-600 text-center">
                Press <kbd className="px-1 bg-tile-bg border border-tile-border rounded text-gray-400">⌘</kbd> + <kbd className="px-1 bg-tile-bg border border-tile-border rounded text-gray-400">?</kbd> to toggle
              </p>
            </div>
          </div>
        </>
      )}
    </>
  )
}
