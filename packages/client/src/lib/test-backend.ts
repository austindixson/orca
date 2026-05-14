// Backend test utility - exposes test functions on window for manual testing
import * as tauri from './tauri'

interface TestResult {
  name: string
  passed: boolean
  error?: string
  duration: number
}

class BackendTester {
  private results: TestResult[] = []
  private testDir = '__test_dir__'
  private testFile = '__test_file__.txt'

  async runAllTests(): Promise<TestResult[]> {
    this.results = []
    console.log('\n🧪 Starting Backend Tests...\n')

    // Check if running in Tauri
    const inTauri = tauri.isTauri()
    if (!inTauri) {
      console.log('⚠️  Not running in Tauri - backend tests will use browser fallbacks')
      console.log('   Some tests may fail without the Node.js server running.\n')
    }

    // Workspace tests
    await this.test('setWorkspace', () => this.testSetWorkspace())
    await this.test('getWorkspace', () => this.testGetWorkspace(inTauri))

    // File system tests (only in Tauri or with server running)
    if (inTauri) {
      await this.test('createDirectory', () => this.testCreateDirectory())
      await this.test('readDirectory', () => this.testReadDirectory())
      await this.test('writeFile', () => this.testWriteFile())
      await this.test('readFile', () => this.testReadFile())
      await this.test('renamePath', () => this.testRenamePath())
      await this.test('deletePath', () => this.testDeletePath())
    } else {
      console.log('⏭️  Skipping file system tests (not in Tauri)')
    }

    // PTY tests (only meaningful in Tauri)
    if (inTauri) {
      await this.test('createPtySession', () => this.testCreatePtySession())
      await this.test('writeToPty', () => this.testWriteToPty())
      await this.test('resizePty', () => this.testResizePty())
      await this.test('closePtySession', () => this.testClosePtySession())
      // Cleanup
      await this.cleanup()
    } else {
      console.log('⏭️  Skipping PTY tests (not in Tauri)')
    }

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

  private async testSetWorkspace(): Promise<void> {
    const result = await tauri.setWorkspace('/tmp')
    if (!result.path || !result.name) {
      throw new Error('setWorkspace did not return expected structure')
    }
  }

  private async testGetWorkspace(inTauri: boolean): Promise<void> {
    const result = await tauri.getWorkspace()
    if (inTauri) {
      if (!result || result.path !== '/tmp') {
        throw new Error(`Expected workspace /tmp, got ${result?.path}`)
      }
    } else {
      // In browser mode, getWorkspace returns null (no native state)
      // This is expected behavior
    }
  }

  private async testCreateDirectory(): Promise<void> {
    await tauri.createDirectory(this.testDir)
  }

  private async testReadDirectory(): Promise<void> {
    const entries = await tauri.readDirectory('.')
    if (!Array.isArray(entries)) {
      throw new Error('readDirectory did not return an array')
    }
    const hasTestDir = entries.some(e => e.name === this.testDir)
    if (!hasTestDir) {
      throw new Error('Created test directory not found in listing')
    }
  }

  private async testWriteFile(): Promise<void> {
    const content = 'Hello, Orca Coder! Test: ' + Date.now()
    await tauri.writeFile(`${this.testDir}/${this.testFile}`, content)
  }

  private async testReadFile(): Promise<void> {
    const content = await tauri.readFile(`${this.testDir}/${this.testFile}`)
    if (!content.includes('Hello, Orca Coder!')) {
      throw new Error('File content does not match')
    }
  }

  private async testRenamePath(): Promise<void> {
    const newName = '__renamed_file__.txt'
    await tauri.renamePath(`${this.testDir}/${this.testFile}`, `${this.testDir}/${newName}`)
    
    // Verify rename worked
    const entries = await tauri.readDirectory(this.testDir)
    const hasRenamed = entries.some(e => e.name === newName)
    if (!hasRenamed) {
      throw new Error('Renamed file not found')
    }
  }

  private async testDeletePath(): Promise<void> {
    // Delete the renamed file
    await tauri.deletePath(`${this.testDir}/__renamed_file__.txt`)
    
    // Verify deletion
    const entries = await tauri.readDirectory(this.testDir)
    if (entries.length > 0) {
      throw new Error('File should have been deleted')
    }
  }

  private async testCreatePtySession(): Promise<void> {
    await tauri.createPtySession('test-pty-1')
  }

  private async testWriteToPty(): Promise<void> {
    await tauri.writeToPty('test-pty-1', 'echo "test"\n')
    // Give it a moment to process
    await new Promise(resolve => setTimeout(resolve, 100))
  }

  private async testResizePty(): Promise<void> {
    await tauri.resizePty('test-pty-1', 120, 40)
  }

  private async testClosePtySession(): Promise<void> {
    await tauri.closePtySession('test-pty-1')
  }

  private async cleanup(): Promise<void> {
    try {
      await tauri.deletePath(this.testDir)
    } catch {
      // Ignore cleanup errors
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
      console.log('🎉 All backend tests passed!')
    }
    console.log('='.repeat(50) + '\n')
  }
}

// Export for use
export const backendTester = new BackendTester()

// Expose on window for console testing
if (typeof window !== 'undefined') {
  ;(window as any).testBackend = () => backendTester.runAllTests()
  ;(window as any).tauri = tauri
  ;(window as any)._backendTester = backendTester
  console.log('🧪 Backend test utilities loaded. Run `testBackend()` in console to test.')
}
