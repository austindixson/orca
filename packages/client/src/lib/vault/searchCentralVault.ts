/**
 * Keyword search in the central Obsidian vault (cross-project memory).
 */

import { invoke } from '@tauri-apps/api/core'
import * as tauri from '../tauri'
import { useSettingsStore } from '../../store/settingsStore'
import { getEffectiveCentralVaultPath } from './centralBrainMirror'
import type { WikiSearchHit } from './searchProjectWiki'

export async function searchCentralVaultMarkdown(
  query: string,
  maxHits: number
): Promise<{ hits: WikiSearchHit[]; scanned_files: number }> {
  if (!tauri.isTauri()) return { hits: [], scanned_files: 0 }
  if (!useSettingsStore.getState().centralBrainEnabled) return { hits: [], scanned_files: 0 }
  const q = query.trim()
  if (!q) return { hits: [], scanned_files: 0 }
  const vr = await getEffectiveCentralVaultPath()
  try {
    const rows = await invoke<Array<{ relPath: string; snippet: string }>>('central_brain_search_markdown', {
      vaultRoot: vr,
      query: q,
      prefix: null,
      maxHits,
    })
    return {
      hits: rows.map((r) => ({
        path: `central:${r.relPath}`,
        snippet: r.snippet,
      })),
      scanned_files: rows.length,
    }
  } catch {
    return { hits: [], scanned_files: 0 }
  }
}

export async function searchCentralPlaybooksMarkdown(
  query: string,
  maxHits: number
): Promise<{ hits: WikiSearchHit[]; scanned_files: number }> {
  if (!tauri.isTauri()) return { hits: [], scanned_files: 0 }
  if (!useSettingsStore.getState().centralBrainEnabled) return { hits: [], scanned_files: 0 }
  const q = query.trim()
  if (!q) return { hits: [], scanned_files: 0 }
  const vr = await getEffectiveCentralVaultPath()
  try {
    const rows = await invoke<Array<{ relPath: string; snippet: string }>>('central_brain_search_markdown', {
      vaultRoot: vr,
      query: q,
      prefix: 'playbooks/',
      maxHits,
    })
    return {
      hits: rows.map((r) => ({
        path: `central:${r.relPath}`,
        snippet: r.snippet,
      })),
      scanned_files: rows.length,
    }
  } catch {
    return { hits: [], scanned_files: 0 }
  }
}
