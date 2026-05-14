import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type MergeReviewStatus = 'pending' | 'approved' | 'rejected'

export interface MergeReviewTicket {
  id: string
  agentTileId: string
  status: MergeReviewStatus
  notes: string
  /** Agent worktree branch — used for optional `git merge` on Approve. */
  sourceBranch?: string | null
}

/** Persisted ticket cap (newest wins). */
export const MERGE_REVIEW_TICKETS_MAX = 100

function capTickets(tickets: MergeReviewTicket[]): MergeReviewTicket[] {
  if (tickets.length <= MERGE_REVIEW_TICKETS_MAX) return tickets
  return tickets.slice(-MERGE_REVIEW_TICKETS_MAX)
}

type MergeReviewState = {
  tickets: MergeReviewTicket[]
  enqueueMergeReview: (
    ticket: Omit<MergeReviewTicket, 'status'> & { status?: MergeReviewStatus }
  ) => string
  setMergeReviewStatus: (id: string, status: MergeReviewStatus) => void
  mergeReviewQueueSnapshot: () => MergeReviewTicket[]
}

export const useMergeReviewStore = create<MergeReviewState>()(
  persist(
    (set, get) => ({
      tickets: [],
      enqueueMergeReview: (ticket) => {
        const t: MergeReviewTicket = {
          ...ticket,
          status: ticket.status ?? 'pending',
        }
        set((s) => ({ tickets: capTickets([...s.tickets, t]) }))
        return ticket.id
      },
      setMergeReviewStatus: (id, status) => {
        set((s) => ({
          tickets: s.tickets.map((x) => (x.id === id ? { ...x, status } : x)),
        }))
      },
      mergeReviewQueueSnapshot: () => [...get().tickets],
    }),
    {
      name: 'orca-merge-reviews',
      partialize: (s) => ({ tickets: capTickets(s.tickets) }),
      merge: (persisted, current) => {
        const p =
          persisted && typeof persisted === 'object' && !Array.isArray(persisted)
            ? (persisted as Partial<MergeReviewState>)
            : {}
        const tickets = Array.isArray(p.tickets) ? p.tickets : current.tickets
        return {
          ...current,
          ...p,
          tickets: capTickets(tickets),
        }
      },
    }
  )
)
