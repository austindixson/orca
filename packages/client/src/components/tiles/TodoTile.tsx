import { useMemo, useState } from 'react'
import { TileComponentProps } from '../Canvas/TileRegistry'
import { useTodoStore, type TodoStatus } from '../../store/todoStore'
import { AgentTaskIndicator } from '../tasks/AgentTaskIndicator'
import { ExpandableText } from '../common/ExpandableText'

export function TodoTile({}: TileComponentProps) {
  const [newTodo, setNewTodo] = useState('')
  const tasks = useTodoStore((s) => s.tasks)
  const addTask = useTodoStore((s) => s.addTask)
  const setTaskStatus = useTodoStore((s) => s.setTaskStatus)
  const removeTask = useTodoStore((s) => s.removeTask)
  const updateTaskText = useTodoStore((s) => s.updateTaskText)
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null)
  const [editingText, setEditingText] = useState('')

  const addTodo = (e: React.FormEvent) => {
    e.preventDefault()
    if (!newTodo.trim()) return
    addTask(newTodo, 'user', 'pending')
    setNewTodo('')
  }

  const cycleStatus = (id: string, current: TodoStatus) => {
    const next: TodoStatus =
      current === 'pending'
        ? 'in_progress'
        : current === 'in_progress'
          ? 'completed'
          : current === 'completed'
            ? 'pending'
            : 'pending'
    setTaskStatus(id, next)
  }

  const beginEdit = (id: string, text: string) => {
    setEditingTaskId(id)
    setEditingText(text)
  }

  const commitEdit = () => {
    if (!editingTaskId) return
    if (editingText.trim()) {
      updateTaskText(editingTaskId, editingText)
    }
    setEditingTaskId(null)
    setEditingText('')
  }

  const sortedTasks = useMemo(
    () =>
      [...tasks].sort((a, b) => {
        const weight = (s: TodoStatus) =>
          s === 'in_progress' ? 0 : s === 'pending' ? 1 : s === 'completed' ? 2 : 3
        return weight(a.status) - weight(b.status) || a.createdAt - b.createdAt
      }),
    [tasks]
  )

  return (
    <div className="w-full h-full flex flex-col bg-canvas-bg">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-tile-border">
        <span className="text-xs text-gray-500 uppercase tracking-wider">Tasks</span>
        <span className="text-[11px] text-gray-500">Click status icon to cycle</span>
      </div>

      {/* Add Task */}
      <form onSubmit={addTodo} className="p-3 border-b border-tile-border">
        <div className="flex gap-2">
          <div className="flex-1 flex items-center gap-2 px-3 py-2 bg-tile-bg border border-tile-border rounded-lg focus-within:border-accent-teal transition-colors">
            <span className="text-gray-600">○</span>
            <input
              type="text"
              value={newTodo}
              onChange={(e) => setNewTodo(e.target.value)}
              placeholder="add task..."
              className="flex-1 bg-transparent text-sm text-white placeholder-gray-600 focus:outline-none"
            />
          </div>
        </div>
      </form>

      {/* Task List */}
      <div className="flex-1 overflow-auto">
        {sortedTasks.map((todo) => {
          const isDone = todo.status === 'completed'
          const statusGlyph =
            todo.status === 'completed'
              ? '●'
              : todo.status === 'in_progress'
                ? '◐'
                : todo.status === 'cancelled'
                  ? '✕'
                  : todo.status === 'failed'
                    ? '!'
                    : '○'
          const statusColor =
            todo.status === 'completed'
              ? 'text-accent-teal'
              : todo.status === 'in_progress'
                ? 'text-amber-300'
                : todo.status === 'cancelled'
                  ? 'text-red-400'
                  : todo.status === 'failed'
                    ? 'text-red-300'
                    : 'text-gray-500'

          return (
            <div key={todo.id} className="group relative">
              <div className="flex flex-col gap-2 px-3 py-3 hover:bg-tile-hover border-b border-tile-border/30 transition-colors">
                <div className="flex items-center gap-3 min-w-0">
                  <button
                    onClick={() => cycleStatus(todo.id, todo.status)}
                    className={`w-6 h-6 rounded-md border border-tile-border flex items-center justify-center transition-all flex-shrink-0 ${statusColor}`}
                    data-tooltip={`Status: ${todo.status}`}
                  >
                    {statusGlyph}
                  </button>
                  {todo.source === 'orchestrator' ? (
                    <AgentTaskIndicator status={todo.status} agentName={todo.assignedAgentName} />
                  ) : (
                    <span
                      className="rounded border border-tile-border/60 bg-black/20 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-gray-500"
                      data-tooltip="Your task"
                    >
                      You
                    </span>
                  )}
                  <button
                    onClick={() => removeTask(todo.id)}
                    className="ml-auto p-1.5 rounded-lg hover:bg-red-900/30 text-gray-500 hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100 shrink-0"
                  >
                    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                </div>
                {editingTaskId === todo.id ? (
                  <input
                    value={editingText}
                    onChange={(e) => setEditingText(e.target.value)}
                    onBlur={commitEdit}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitEdit()
                      if (e.key === 'Escape') {
                        setEditingTaskId(null)
                        setEditingText('')
                      }
                    }}
                    className="w-full rounded bg-black/20 px-2 py-1 text-sm text-gray-100 outline-none ring-1 ring-accent-teal/40"
                    autoFocus
                  />
                ) : (
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => beginEdit(todo.id, todo.text)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        beginEdit(todo.id, todo.text)
                      }
                    }}
                    className={`w-full text-left text-sm transition-colors break-words ${
                      isDone ? 'text-gray-600 line-through' : 'text-gray-200'
                    }`}
                    data-tooltip="Click to edit"
                  >
                    <ExpandableText
                      text={todo.text}
                      maxChars={220}
                      className="text-inherit"
                      buttonClassName="text-[10px]"
                      stopToggleClickPropagation
                    />
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* Footer */}
      <div className="px-3 py-2 border-t border-tile-border flex items-center justify-between text-xs text-gray-500">
        <span>{tasks.filter((t) => t.status === 'pending' || t.status === 'in_progress').length} remaining</span>
        <span>{tasks.length} total</span>
      </div>
    </div>
  )
}
