import { useMemPalaceStore } from '../../store/memPalaceStore'
import { useToastStore } from '../../store/toastStore'
import { useWorkspaceStore } from '../../store/workspaceStore'

/**
 * One-click Obsidian-style integration: open sidebar → Obsidian brain, scan markdown graph.
 * Treats the current workspace folder as the vault (File → Open Folder).
 */
export async function runObsidianIntegrationOneClick(): Promise<void> {
  const { sidebarCollapsed, expandSidebar, setActivePanel, rootPath, rootName } = useWorkspaceStore.getState()
  if (sidebarCollapsed) expandSidebar()
  setActivePanel('brain')

  await useMemPalaceStore.getState().scan()

  const err = useMemPalaceStore.getState().error
  const graph = useMemPalaceStore.getState().graph
  const addToast = useToastStore.getState().addToast

  if (err) {
    addToast({
      type: 'warning',
      title: 'Obsidian brain',
      message: err,
    })
    return
  }

  const n = graph?.nodes.length ?? 0
  const noVaultFolder = rootPath === '.' || rootName === 'Workspace'

  addToast({
    type: 'info',
    title: 'Obsidian',
    message: noVaultFolder
      ? n
        ? `Brain ready — ${n} notes in the current folder. Use File → Open Folder… to open your vault.`
        : 'Brain open — use File → Open Folder… to choose your Obsidian vault, then click Obsidian again.'
      : n
        ? `Vault graph ready — ${n} markdown notes in ${rootName}.`
        : 'Brain open — no markdown in this workspace yet. Add .md files or open another folder.',
  })
}
