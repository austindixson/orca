// Frontend test utility - tests UI components and interactions
import { useCanvasStore } from '../store/canvasStore'
import { useFocusStore } from '../store/focusStore'

interface TestResult {
  name: string
  passed: boolean
  error?: string
  duration: number
}

class FrontendTester {
  private results: TestResult[] = []

  async runAllTests(): Promise<TestResult[]> {
    this.results = []
    console.log('\n🎨 Starting Frontend Tests...\n')

    // Canvas store tests
    await this.test('addTile - terminal', () => this.testAddTile('terminal'))
    await this.test('addTile - editor', () => this.testAddTile('editor'))
    await this.test('addTile - browser', () => this.testAddTile('browser'))
    await this.test('addTile - todo', () => this.testAddTile('todo'))
    await this.test('addTile - diff', () => this.testAddTile('diff'))
    await this.test('addTile - agent', () => this.testAddTile('agent'))
    await this.test('addTile - changelog', () => this.testAddTile('changelog'))
    await this.test('addTile - orchestrator', () => this.testAddTile('orchestrator'))
    await this.test('updateTile', () => this.testUpdateTile())
    await this.test('bringToFront', () => this.testBringToFront())
    await this.test('setPan', () => this.testSetPan())
    await this.test('setZoom', () => this.testSetZoom())
    await this.test('removeTile', () => this.testRemoveTile())

    // Focus store tests
    await this.test('focus mode - enter', () => this.testEnterFocus())
    await this.test('focus mode - exit', () => this.testExitFocus())
    await this.test('selection mode', () => this.testSelectionMode())

    // UI element tests
    await this.test('UI - toolbar exists', () => this.testToolbarExists())
    await this.test('UI - sidebar exists', () => this.testSidebarExists())
    await this.test('UI - canvas exists', () => this.testCanvasExists())
    await this.test('UI - navigator exists', () => this.testNavigatorExists())

    this.printResults()
    return this.results
  }

  private async test(name: string, fn: () => Promise<void>): Promise<void> {
    const start = performance.now()
    try {
      await fn()
      const duration = performance.now() - start
      this.results.push({ name, passed: true, duration })
      console.log(`✅ ${name} (${duration.toFixed(2)}ms)`)
    } catch (e) {
      const duration = performance.now() - start
      const error = e instanceof Error ? e.message : String(e)
      this.results.push({ name, passed: false, error, duration })
      console.error(`❌ ${name}: ${error}`)
    }
  }

  private async testAddTile(
    type: 'terminal' | 'editor' | 'browser' | 'github' | 'todo' | 'diff' | 'agent' | 'changelog' | 'orchestrator'
  ): Promise<void> {
    const store = useCanvasStore.getState()
    const initialCount = store.tiles.size
    const id = store.addTile(type)
    
    const newStore = useCanvasStore.getState()
    if (newStore.tiles.size !== initialCount + 1) {
      throw new Error(`Expected ${initialCount + 1} tiles, got ${newStore.tiles.size}`)
    }
    
    const tile = newStore.tiles.get(id)
    if (!tile) throw new Error('Tile not found after creation')
    if (tile.type !== type) throw new Error(`Expected type ${type}, got ${tile.type}`)
  }

  private async testUpdateTile(): Promise<void> {
    const store = useCanvasStore.getState()
    const tile = Array.from(store.tiles.values())[0]
    if (!tile) throw new Error('No tiles to update')
    
    const newTitle = 'Updated Title ' + Date.now()
    store.updateTile(tile.id, { title: newTitle })
    
    const updated = useCanvasStore.getState().tiles.get(tile.id)
    if (updated?.title !== newTitle) {
      throw new Error(`Title not updated. Expected "${newTitle}", got "${updated?.title}"`)
    }
  }

  private async testBringToFront(): Promise<void> {
    const store = useCanvasStore.getState()
    const tiles = Array.from(store.tiles.values())
    if (tiles.length < 2) throw new Error('Need at least 2 tiles')
    
    const tile = tiles[0]
    const initialZ = tile.zIndex
    store.bringToFront(tile.id)
    
    const updated = useCanvasStore.getState().tiles.get(tile.id)
    if (!updated || updated.zIndex <= initialZ) {
      throw new Error('zIndex not increased')
    }
  }

  private async testSetPan(): Promise<void> {
    const store = useCanvasStore.getState()
    store.setPan({ x: 100, y: 200 })
    
    const { pan } = useCanvasStore.getState()
    if (pan.x !== 100 || pan.y !== 200) {
      throw new Error(`Pan not set correctly. Got ${JSON.stringify(pan)}`)
    }
    
    // Reset
    store.setPan({ x: 0, y: 0 })
  }

  private async testSetZoom(): Promise<void> {
    const store = useCanvasStore.getState()
    store.setZoom(1.5)
    
    const { zoom } = useCanvasStore.getState()
    if (zoom !== 1.5) {
      throw new Error(`Zoom not set correctly. Expected 1.5, got ${zoom}`)
    }
    
    // Test bounds
    store.setZoom(0.1)
    if (useCanvasStore.getState().zoom < 0.25) {
      throw new Error('Zoom should be clamped to minimum 0.25')
    }
    
    store.setZoom(3)
    if (useCanvasStore.getState().zoom > 2) {
      throw new Error('Zoom should be clamped to maximum 2')
    }
    
    // Reset
    store.setZoom(1)
  }

  private async testRemoveTile(): Promise<void> {
    const store = useCanvasStore.getState()
    const tile = Array.from(store.tiles.values())[0]
    if (!tile) throw new Error('No tiles to remove')
    
    const initialCount = store.tiles.size
    store.removeTile(tile.id)
    
    const newStore = useCanvasStore.getState()
    if (newStore.tiles.size !== initialCount - 1) {
      throw new Error(`Expected ${initialCount - 1} tiles, got ${newStore.tiles.size}`)
    }
  }

  private async testEnterFocus(): Promise<void> {
    const canvasStore = useCanvasStore.getState()
    const tiles = Array.from(canvasStore.tiles.values())
    if (tiles.length === 0) {
      canvasStore.addTile('terminal')
    }
    
    const focusStore = useFocusStore.getState()
    const tileIds = Array.from(useCanvasStore.getState().tiles.keys()).slice(0, 2)
    
    focusStore.enterFocus(tileIds)
    
    const { isActive, focusedTileIds } = useFocusStore.getState()
    if (!isActive) throw new Error('Focus mode not activated')
    if (focusedTileIds.length === 0) throw new Error('No tiles in focus')
  }

  private async testExitFocus(): Promise<void> {
    const focusStore = useFocusStore.getState()
    focusStore.exitFocus()
    
    const { isActive } = useFocusStore.getState()
    if (isActive) throw new Error('Focus mode not exited')
  }

  private async testSelectionMode(): Promise<void> {
    // Ensure we have at least one tile for selection mode
    const canvasStore = useCanvasStore.getState()
    if (canvasStore.tiles.size === 0) {
      canvasStore.addTile('terminal')
    }
    
    const tileId = Array.from(useCanvasStore.getState().tiles.keys())[0]
    const focusStore = useFocusStore.getState()
    
    focusStore.enterSelectionMode(tileId)
    if (!useFocusStore.getState().isSelectionMode) {
      throw new Error('Selection mode not activated')
    }
    
    focusStore.cancelSelectionMode()
    if (useFocusStore.getState().isSelectionMode) {
      throw new Error('Selection mode not deactivated')
    }
  }

  private async testToolbarExists(): Promise<void> {
    // Allow DOM to update
    await new Promise(r => setTimeout(r, 100))
    const toolbar = document.querySelector('[data-testid="canvas-toolbar"]')
    if (!toolbar) throw new Error('Toolbar not found in DOM')
  }

  private async testSidebarExists(): Promise<void> {
    const sidebar = document.querySelector('[data-testid="sidebar"]')
    if (!sidebar) throw new Error('Sidebar not found in DOM')
  }

  private async testCanvasExists(): Promise<void> {
    const canvas = document.querySelector('[data-testid="infinite-canvas"]')
    if (!canvas) throw new Error('Canvas not found in DOM')
  }

  private async testNavigatorExists(): Promise<void> {
    // Allow DOM to update after adding tiles
    await new Promise(r => setTimeout(r, 100))
    const navigator = document.querySelector('[data-testid="canvas-navigator"]')
    const tiles = useCanvasStore.getState().tiles
    // Navigator is always rendered now, but may be hidden visually when no tiles
    if (tiles.size > 0 && !navigator) {
      throw new Error('Navigator should be visible when tiles exist')
    }
  }

  private printResults(): void {
    const passed = this.results.filter(r => r.passed).length
    const failed = this.results.filter(r => !r.passed).length
    const total = this.results.length

    console.log('\n' + '='.repeat(50))
    console.log(`📊 Test Results: ${passed}/${total} passed`)
    if (failed > 0) {
      console.log(`❌ ${failed} tests failed:`)
      this.results.filter(r => !r.passed).forEach(r => {
        console.log(`   - ${r.name}: ${r.error}`)
      })
    } else {
      console.log('🎉 All frontend tests passed!')
    }
    console.log('='.repeat(50) + '\n')
  }

  // Cleanup helper
  clearAllTiles(): void {
    const store = useCanvasStore.getState()
    const n = store.tiles.size
    const fs = useFocusStore.getState()
    if (fs.isActive) fs.exitFocus()
    if (fs.isSelectionMode) fs.cancelSelectionMode()
    if (fs.isDeleteSelectionMode) fs.cancelDeleteSelectionMode()
    store.clearAllTiles()
    console.log(`Cleared ${n} tiles`)
  }
}

// Export for use
export const frontendTester = new FrontendTester()

// Expose on window for console testing
if (typeof window !== 'undefined') {
  ;(window as any).testFrontend = () => frontendTester.runAllTests()
  ;(window as any).clearTiles = () => frontendTester.clearAllTiles()
  ;(window as any).canvasStore = useCanvasStore
  ;(window as any).focusStore = useFocusStore
  ;(window as any)._frontendTester = frontendTester
  console.log('🎨 Frontend test utilities loaded. Run `testFrontend()` in console to test.')

  // Auto-run tests if URL has ?test parameter
  if (window.location.search.includes('test=all')) {
    setTimeout(async () => {
      console.log('\n' + '='.repeat(60))
      console.log('🚀 AGENT CANVAS - AUTOMATED TEST SUITE')
      console.log('='.repeat(60) + '\n')

      console.log('📦 Running Backend Tests...\n')
      const backendResults = await (window as any).testBackend()

      console.log('\n📦 Running Frontend Tests...\n')
      const frontendResults = await (window as any).testFrontend()

      const allResults = [...backendResults, ...frontendResults]
      const passed = allResults.filter((r: any) => r.passed).length
      const failed = allResults.filter((r: any) => !r.passed).length

      console.log('\n' + '='.repeat(60))
      console.log('📊 FINAL SUMMARY')
      console.log('='.repeat(60))
      console.log(`Total: ${allResults.length} | Passed: ${passed} | Failed: ${failed}`)

      if (failed === 0) {
        console.log('\n🎉 ALL TESTS PASSED! 🎉\n')
      } else {
        console.log('\n❌ Some tests failed:\n')
        allResults.filter((r: any) => !r.passed).forEach((r: any) => {
          console.log(`  - ${r.name}: ${r.error}`)
        })
      }
      console.log('='.repeat(60) + '\n')
    }, 2000)
  }
}
