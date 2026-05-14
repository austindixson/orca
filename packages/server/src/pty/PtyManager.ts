import * as pty from 'node-pty'
import { EventEmitter } from 'events'

export interface PtySession {
  id: string
  pty: pty.IPty
  cols: number
  rows: number
}

export class PtyManager extends EventEmitter {
  private sessions: Map<string, PtySession> = new Map()
  private sessionCounter = 0

  spawn(shell?: string, cwd?: string, cols = 80, rows = 24): string {
    const id = `pty-${++this.sessionCounter}`
    const shellPath = shell || process.env.SHELL || '/bin/zsh'
    
    const ptyProcess = pty.spawn(shellPath, [], {
      name: 'xterm-256color',
      cols,
      rows,
      cwd: cwd || process.env.HOME || '/',
      env: process.env as Record<string, string>,
    })

    const session: PtySession = {
      id,
      pty: ptyProcess,
      cols,
      rows,
    }

    ptyProcess.onData((data) => {
      this.emit('data', id, data)
    })

    ptyProcess.onExit(({ exitCode, signal }) => {
      this.emit('exit', id, exitCode, signal)
      this.sessions.delete(id)
    })

    this.sessions.set(id, session)
    console.log(`[PTY] Spawned session ${id} with shell ${shellPath}`)
    
    return id
  }

  write(sessionId: string, data: string): boolean {
    const session = this.sessions.get(sessionId)
    if (!session) return false
    session.pty.write(data)
    return true
  }

  resize(sessionId: string, cols: number, rows: number): boolean {
    const session = this.sessions.get(sessionId)
    if (!session) return false
    session.pty.resize(cols, rows)
    session.cols = cols
    session.rows = rows
    return true
  }

  kill(sessionId: string): boolean {
    const session = this.sessions.get(sessionId)
    if (!session) return false
    session.pty.kill()
    this.sessions.delete(sessionId)
    console.log(`[PTY] Killed session ${sessionId}`)
    return true
  }

  getSession(sessionId: string): PtySession | undefined {
    return this.sessions.get(sessionId)
  }

  getAllSessions(): string[] {
    return Array.from(this.sessions.keys())
  }
}

export const ptyManager = new PtyManager()
