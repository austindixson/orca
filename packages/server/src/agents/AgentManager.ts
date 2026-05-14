import { EventEmitter } from 'events'
import { AgentProcess, AgentConfig, AgentType, AgentStatus } from './AgentProcess.js'

export class AgentManager extends EventEmitter {
  private agents: Map<string, AgentProcess> = new Map()
  private agentCounter = 0

  createAgent(type: AgentType, name?: string, command?: string, cwd?: string): AgentProcess {
    const id = `agent-${++this.agentCounter}`
    const agentName = name || `${type.charAt(0).toUpperCase() + type.slice(1)} ${this.agentCounter}`
    
    const config: AgentConfig = {
      id,
      name: agentName,
      type,
      command: command || '',
      cwd,
    }

    const agent = new AgentProcess(config)
    
    agent.on('data', (data: string) => {
      this.emit('agent:data', id, data)
    })

    agent.on('status', (status: AgentStatus) => {
      this.emit('agent:status', id, status)
    })

    agent.on('exit', (exitCode: number) => {
      this.emit('agent:exit', id, exitCode)
    })

    this.agents.set(id, agent)
    console.log(`[AgentManager] Created agent ${id}: ${agentName}`)
    
    return agent
  }

  startAgent(id: string): boolean {
    const agent = this.agents.get(id)
    if (!agent) return false
    agent.start()
    return true
  }

  sendInput(id: string, data: string): boolean {
    const agent = this.agents.get(id)
    if (!agent) return false
    agent.sendInput(data)
    return true
  }

  sendTask(id: string, task: string): boolean {
    const agent = this.agents.get(id)
    if (!agent) return false
    agent.sendTask(task)
    return true
  }

  stopAgent(id: string): boolean {
    const agent = this.agents.get(id)
    if (!agent) return false
    agent.stop()
    return true
  }

  removeAgent(id: string): boolean {
    const agent = this.agents.get(id)
    if (!agent) return false
    agent.stop()
    this.agents.delete(id)
    console.log(`[AgentManager] Removed agent ${id}`)
    return true
  }

  getAgent(id: string): AgentProcess | undefined {
    return this.agents.get(id)
  }

  getAllAgents(): AgentProcess[] {
    return Array.from(this.agents.values())
  }

  getAgentList() {
    return this.getAllAgents().map(a => a.toJSON())
  }
}

export const agentManager = new AgentManager()
