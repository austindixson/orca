import * as tauri from '../tauri'

/**
 * Obsidian Brain uses the **Orca workspace folder** as the vault — there is no Obsidian plugin
 * or live sync to the Obsidian app. "Connected" means: Orca has opened the same folder as your vault.
 */

export function isPlaceholderWorkspace(rootPath: string, rootName: string): boolean {
  return rootPath === '.' || rootName === 'Workspace'
}

/**
 * True if the workspace contains Obsidian's config dir (we probe a small JSON file; `read_directory` hides dot folders).
 */
export async function workspaceHasObsidianConfig(): Promise<boolean> {
  const candidates = ['.obsidian/app.json', '.obsidian/appearance.json', '.obsidian/core-plugins.json']
  for (const path of candidates) {
    try {
      await tauri.readFile(path)
      return true
    } catch {
      /* try next */
    }
  }
  return false
}
