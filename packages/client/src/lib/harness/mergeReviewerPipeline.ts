/**
 * Merge / reviewer pipeline — delegates to `mergeReviewStore` for UI + future automation.
 */

import * as tauri from '../tauri'
import { useSettingsStore } from '../../store/settingsStore'
import type { MergeReviewStatus, MergeReviewTicket } from '../../store/mergeReviewStore'
import { useMergeReviewStore } from '../../store/mergeReviewStore'

export type { MergeReviewStatus, MergeReviewTicket }

async function gitMergeSourceBranch(sourceBranch: string | null | undefined): Promise<void> {
  const b = sourceBranch?.trim()
  if (!b || !tauri.isTauri()) return
  try {
    const r = await tauri.gitMergeBranch(b)
    if (r && !r.ok) console.warn('[merge]', r.stderr || r.stdout)
  } catch (e) {
    console.warn('[merge]', e)
  }
}

/** Merge worktree branch when possible, then mark ticket approved (sidebar + agent menu use this). */
export async function approveMergeReviewTicket(id: string): Promise<void> {
  const ticket = useMergeReviewStore.getState().tickets.find((x) => x.id === id)
  if (!ticket || ticket.status !== 'pending') return
  await gitMergeSourceBranch(ticket.sourceBranch)
  useMergeReviewStore.getState().setMergeReviewStatus(id, 'approved')
}

export async function approveAllPendingMergeReviews(): Promise<void> {
  const pending = useMergeReviewStore.getState().tickets.filter((t) => t.status === 'pending')
  for (const t of pending) {
    await approveMergeReviewTicket(t.id)
  }
}

export function enqueueMergeReview(
  ticket: Omit<MergeReviewTicket, 'status'> & { status?: MergeReviewStatus }
) {
  const id = useMergeReviewStore.getState().enqueueMergeReview(ticket)
  if (useSettingsStore.getState().autoApproveMergeReviews) {
    void approveMergeReviewTicket(id)
  }
  return id
}

export function mergeReviewQueueSnapshot() {
  return useMergeReviewStore.getState().mergeReviewQueueSnapshot()
}
