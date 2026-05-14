import { useEffect, useMemo, useRef } from 'react'
import clsx from 'clsx'
import { filterSlashMenuByQuery, type SlashMenuItem } from '../../lib/skillCommands'

const SKILLS_PREVIEW = 8
const COMMANDS_PREVIEW = 6

export function OrchestratorSlashPalette({
  skills,
  commands,
  filter,
  loading,
  skillsShowAll,
  commandsShowAll,
  onToggleSkillsMore,
  onToggleCommandsMore,
  selectedIndex,
  onHoverIndex,
  onPick,
}: {
  skills: SlashMenuItem[]
  commands: SlashMenuItem[]
  filter: string
  loading: boolean
  skillsShowAll: boolean
  commandsShowAll: boolean
  onToggleSkillsMore: () => void
  onToggleCommandsMore: () => void
  selectedIndex: number
  onHoverIndex: (i: number) => void
  onPick: (item: SlashMenuItem) => void
}) {
  const fs = useMemo(() => filterSlashMenuByQuery(skills, filter), [skills, filter])
  const fc = useMemo(() => filterSlashMenuByQuery(commands, filter), [commands, filter])

  const skillVisible = skillsShowAll ? fs : fs.slice(0, SKILLS_PREVIEW)
  const skillHidden = Math.max(0, fs.length - skillVisible.length)

  const cmdVisible = commandsShowAll ? fc : fc.slice(0, COMMANDS_PREVIEW)
  const cmdHidden = Math.max(0, fc.length - cmdVisible.length)

  const rowRefs = useRef<(HTMLButtonElement | null)[]>([])

  useEffect(() => {
    const el = rowRefs.current[selectedIndex]
    if (el) el.scrollIntoView({ block: 'nearest' })
  }, [selectedIndex, skillVisible.length, cmdVisible.length])

  useEffect(() => {
    rowRefs.current = []
  }, [skillVisible.length, cmdVisible.length, filter])

  if (loading) {
    return (
      <div className="absolute bottom-full left-0 right-0 z-[80] mb-1 min-w-0 rounded-lg border border-tile-border/90 bg-[#14141a]/98 px-3 py-2.5 text-xs text-gray-400 shadow-xl backdrop-blur-md">
        Loading skills…
      </div>
    )
  }

  return (
    <div
      className="absolute bottom-full left-0 right-0 z-[80] mb-1 min-w-0 max-h-[min(42vh,340px)] overflow-y-auto rounded-lg border border-tile-border/90 bg-[#14141a]/98 py-1.5 shadow-xl backdrop-blur-md"
      onMouseDown={(e) => e.preventDefault()}
    >
      {fs.length > 0 && (
        <div className="border-b border-white/5 pb-1">
          <p className="px-2.5 pb-1 text-[10px] font-medium uppercase tracking-wide text-gray-500">Skills</p>
          <ul className="space-y-0.5">
            {skillVisible.map((item, i) => {
              const idx = i
              const active = selectedIndex === idx
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    ref={(el) => {
                      rowRefs.current[idx] = el
                    }}
                    onMouseEnter={() => onHoverIndex(idx)}
                    onClick={() => onPick(item)}
                    className={clsx(
                      'flex w-full flex-col gap-0.5 rounded-md px-2.5 py-1.5 text-left transition-colors',
                      active ? 'bg-indigo-500/25 ring-1 ring-indigo-400/35' : 'hover:bg-white/5'
                    )}
                  >
                    <span className="flex w-full min-w-0 items-start justify-between gap-2">
                      <span className="min-w-0 flex-1 break-words font-mono text-[13px] text-gray-100 [overflow-wrap:anywhere]">
                        /{item.name}
                      </span>
                      {active ? (
                        <span className="shrink-0 rounded border border-white/10 px-1 font-sans text-[9px] text-gray-500">
                          ↵
                        </span>
                      ) : null}
                    </span>
                    <span className="line-clamp-2 text-[11px] leading-snug text-gray-500">{item.description}</span>
                  </button>
                </li>
              )
            })}
          </ul>
          {skillHidden > 0 && (
            <button
              type="button"
              onClick={onToggleSkillsMore}
              className="mt-1 w-full px-2.5 py-1 text-left text-[11px] text-indigo-300/90 hover:text-indigo-200"
            >
              {skillsShowAll ? 'Show fewer' : `Show ${skillHidden} more`}
            </button>
          )}
        </div>
      )}

      {fc.length > 0 && (
        <div className={clsx('pt-1', fs.length > 0 && 'border-t border-white/5')}>
          <p className="px-2.5 pb-1 text-[10px] font-medium uppercase tracking-wide text-gray-500">Commands</p>
          <ul className="space-y-0.5">
            {cmdVisible.map((item, j) => {
              const idx = skillVisible.length + j
              const active = selectedIndex === idx
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    ref={(el) => {
                      rowRefs.current[idx] = el
                    }}
                    onMouseEnter={() => onHoverIndex(idx)}
                    onClick={() => onPick(item)}
                    className={clsx(
                      'flex w-full flex-col gap-0.5 rounded-md px-2.5 py-1.5 text-left transition-colors',
                      active ? 'bg-indigo-500/25 ring-1 ring-indigo-400/35' : 'hover:bg-white/5'
                    )}
                  >
                    <span className="flex w-full min-w-0 items-start justify-between gap-2">
                      <span className="min-w-0 flex-1 break-words font-mono text-[13px] text-gray-100 [overflow-wrap:anywhere]">
                        /{item.name}
                      </span>
                      {active ? (
                        <span className="shrink-0 rounded border border-white/10 px-1 font-sans text-[9px] text-gray-500">
          ↵
                        </span>
                      ) : null}
                    </span>
                    <span className="line-clamp-2 text-[11px] leading-snug text-gray-500">{item.description}</span>
                  </button>
                </li>
              )
            })}
          </ul>
          {cmdHidden > 0 && (
            <button
              type="button"
              onClick={onToggleCommandsMore}
              className="mt-1 w-full px-2.5 py-1 text-left text-[11px] text-indigo-300/90 hover:text-indigo-200"
            >
              {commandsShowAll ? 'Show fewer' : `Show ${cmdHidden} more`}
            </button>
          )}
        </div>
      )}

      {fs.length === 0 && fc.length === 0 && (
        <p className="px-2.5 py-3 text-[11px] text-gray-500">
          No skills or commands match “{filter}”. Add{' '}
          <code className="text-gray-400">.cursor/skills/</code>,{' '}
          <code className="text-gray-400">.claude/skills/</code>, or{' '}
          <code className="text-gray-400">.claude/&lt;slug&gt;/SKILL.md</code>; commands under{' '}
          <code className="text-gray-400">.cursor/commands/</code> or{' '}
          <code className="text-gray-400">.claude/commands/</code>.
        </p>
      )}
    </div>
  )
}

export function useSlashFlatLength(
  skills: SlashMenuItem[],
  commands: SlashMenuItem[],
  filter: string,
  skillsShowAll: boolean,
  commandsShowAll: boolean
): number {
  const fs = filterSlashMenuByQuery(skills, filter)
  const fc = filterSlashMenuByQuery(commands, filter)
  const sv = skillsShowAll ? fs : fs.slice(0, SKILLS_PREVIEW)
  const cv = commandsShowAll ? fc : fc.slice(0, COMMANDS_PREVIEW)
  return sv.length + cv.length
}

export function getSlashPickIndex(
  skills: SlashMenuItem[],
  commands: SlashMenuItem[],
  filter: string,
  skillsShowAll: boolean,
  commandsShowAll: boolean,
  flatIndex: number
): SlashMenuItem | null {
  const fs = filterSlashMenuByQuery(skills, filter)
  const fc = filterSlashMenuByQuery(commands, filter)
  const sv = skillsShowAll ? fs : fs.slice(0, SKILLS_PREVIEW)
  const cv = commandsShowAll ? fc : fc.slice(0, COMMANDS_PREVIEW)
  const rows = [...sv, ...cv]
  return rows[flatIndex] ?? null
}
