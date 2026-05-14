import { create } from 'zustand'

export type AgentStatus = 'idle' | 'working' | 'done' | 'error'
export type AgentType = 'claude' | 'codex' | 'gemini' | 'custom'

export interface Agent {
  id: string
  name: string
  type: AgentType
  command: string
  status: AgentStatus
  output: string[]
  taskQueue: string[]
  tileId: string | null
}

interface AgentState {
  agents: Map<string, Agent>
  
  addAgent: (agent: Omit<Agent, 'output' | 'taskQueue'>) => void
  updateAgent: (id: string, updates: Partial<Agent>) => void
  removeAgent: (id: string) => void
  appendOutput: (id: string, line: string) => void
  addTask: (id: string, task: string) => void
  clearOutput: (id: string) => void
}

export const useAgentStore = create<AgentState>((set, get) => ({
  agents: new Map(),

  addAgent: (agent) => {
    const { agents } = get()
    const newAgents = new Map(agents)
    newAgents.set(agent.id, { ...agent, output: [], taskQueue: [] })
    set({ agents: newAgents })
  },

  updateAgent: (id, updates) => {
    const { agents } = get()
    const agent = agents.get(id)
    if (!agent) return

    const newAgents = new Map(agents)
    newAgents.set(id, { ...agent, ...updates })
    set({ agents: newAgents })
  },

  removeAgent: (id) => {
    const { agents } = get()
    const newAgents = new Map(agents)
    newAgents.delete(id)
    set({ agents: newAgents })
  },

  appendOutput: (id, line) => {
    const { agents } = get()
    const agent = agents.get(id)
    if (!agent) return

    const newAgents = new Map(agents)
    const maxLines = 1000
    const output = [...agent.output, line].slice(-maxLines)
    newAgents.set(id, { ...agent, output })
    set({ agents: newAgents })
  },

  addTask: (id, task) => {
    const { agents } = get()
    const agent = agents.get(id)
    if (!agent) return

    const newAgents = new Map(agents)
    newAgents.set(id, { ...agent, taskQueue: [...agent.taskQueue, task] })
    set({ agents: newAgents })
  },

  clearOutput: (id) => {
    const { agents } = get()
    const agent = agents.get(id)
    if (!agent) return

    const newAgents = new Map(agents)
    newAgents.set(id, { ...agent, output: [] })
    set({ agents: newAgents })
  },
}))
