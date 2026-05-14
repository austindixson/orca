import { create } from 'zustand'
import { nanoid } from 'nanoid'

export type ToastType = 'success' | 'error' | 'info' | 'warning'

/** After workspace snapshot finishes applying, keep suppressing toasts for this long (large projects). */
export const WORKSPACE_OPEN_TOAST_GRACE_MS = 10_000

export interface Toast {
  id: string
  type: ToastType
  title: string
  message?: string
  duration?: number
}

let workspaceSuppressionTimer: ReturnType<typeof setTimeout> | null = null

interface ToastState {
  toasts: Toast[]
  /** While true, `addToast` is a no-op (drops; not queued). */
  notificationsSuppressed: boolean
  addToast: (toast: Omit<Toast, 'id'>) => void
  removeToast: (id: string) => void
  /** Start of workspace switch: clear visible toasts and drop new ones until release. */
  beginWorkspaceOpenNotificationSuppression: () => void
  /** Call after `loadCanvasStateFromWorkspaceFile` completes; allows toasts again after grace period. */
  scheduleEndWorkspaceOpenNotificationSuppression: () => void
  /** If workspace open fails, re-enable toasts immediately. */
  endWorkspaceOpenNotificationSuppressionNow: () => void
}

export const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],
  notificationsSuppressed: false,

  beginWorkspaceOpenNotificationSuppression: () => {
    if (workspaceSuppressionTimer) {
      clearTimeout(workspaceSuppressionTimer)
      workspaceSuppressionTimer = null
    }
    set({ toasts: [], notificationsSuppressed: true })
  },

  scheduleEndWorkspaceOpenNotificationSuppression: () => {
    if (workspaceSuppressionTimer) {
      clearTimeout(workspaceSuppressionTimer)
      workspaceSuppressionTimer = null
    }
    workspaceSuppressionTimer = setTimeout(() => {
      workspaceSuppressionTimer = null
      set({ notificationsSuppressed: false })
    }, WORKSPACE_OPEN_TOAST_GRACE_MS)
  },

  endWorkspaceOpenNotificationSuppressionNow: () => {
    if (workspaceSuppressionTimer) {
      clearTimeout(workspaceSuppressionTimer)
      workspaceSuppressionTimer = null
    }
    set({ notificationsSuppressed: false })
  },

  addToast: (toast) => {
    if (get().notificationsSuppressed) return
    const id = nanoid()
    const newToast: Toast = { ...toast, id }

    set({ toasts: [...get().toasts, newToast] })

    const duration = toast.duration ?? 5000
    if (duration > 0) {
      setTimeout(() => {
        get().removeToast(id)
      }, duration)
    }
  },

  removeToast: (id) => {
    set({ toasts: get().toasts.filter((t) => t.id !== id) })
  },
}))
