import * as pty from 'node-pty'
import { EventEmitter } from 'events'

export type AgentType = 'claude' | 'codex' | 'gemini' | 'custom'
export type AgentStatus = 'idle' | 'working' | 'done' | 'error'

export interface AgentConfig {
  id: string
  name: string
  type: AgentType
  command: string
  args?: string[]
  cwd?: string
}

const AGENT_COMMANDS: Record<AgentType, { command: string; args: string[] }> = {
  claude: { command: 'claude', args: [] },
  codex: { command: 'codex', args: [] },
  gemini: { command: 'gemini', args: [] },
  custom: { command: 'bash', args: [] },
}

export class AgentProcess extends EventEmitter {
  public readonly id: string
  public readonly name: string
  public readonly type: AgentType
  public status: AgentStatus = 'idle'
  
  private pty: pty.IPty | null = null
  private outputBuffer: string[] = []
  private command: string
  private args: string[]
  private cwd: string

  constructor(config: AgentConfig) {
    super()
    this.id = config.id
    this.name = config.name
    this.type = config.type
    
    const defaultCmd = AGENT_COMMANDS[config.type]
    this.command = config.command || defaultCmd.command
    this.args = config.args || defaultCmd.args
    this.cwd = config.cwd || process.env.HOME || '/'
  }

  start(): void {
    if (this.pty) {
      console.log(`[Agent ${this.id}] Already running`)
      return
    }

    console.log(`[Agent ${this.id}] Starting ${this.command} ${this.args.join(' ')}`)
    
    this.pty = pty.spawn(this.command, this.args, {
      name: 'xterm-256color',
      cols: 120,
      rows: 40,
      cwd: this.cwd,
      env: process.env as Record<string, string>,
    })

    this.status = 'idle'
    this.emit('status', this.status)

    this.pty.onData((data) => {
      this.outputBuffer.push(data)
      if (this.outputBuffer.length > 5000) {
        this.outputBuffer = this.outputBuffer.slice(-4000)
      }
      this.emit('data', data)
    })

    this.pty.onExit(({ exitCode }) => {
      this.status = exitCode === 0 ? 'done' : 'error'
      this.emit('status', this.status)
      this.emit('exit', exitCode)
      this.pty = null
    })
  }

  sendInput(data: string): void {
    if (!this.pty) {
      console.log(`[Agent ${this.id}] Not running, cannot send input`)
      return
    }
    this.status = 'working'
    this.emit('status', this.status)
    this.pty.write(data)
  }

  sendTask(task: string): void {
    this.sendInput(task + '\n')
  }

  resize(cols: number, rows: number): void {
    this.pty?.resize(cols, rows)
  }

  stop(): void {
    if (this.pty) {
      this.pty.kill()
      this.pty = null
      this.status = 'idle'
      this.emit('status', this.status)
    }
  }

  getOutput(): string[] {
    return [...this.outputBuffer]
  }

  clearOutput(): void {
    this.outputBuffer = []
  }

  toJSON() {
    return {
      id: this.id,
      name: this.name,
      type: this.type,
      status: this.status,
      command: this.command,
    }
  }
}
