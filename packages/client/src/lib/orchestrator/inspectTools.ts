import type { ConsoleEntry, DetectedIssue, NetworkRequest, IssueSeverity } from '../../lib/inspect/types'

type ConsoleFilter = Record<string, unknown> & {
  level?: string[]
  text?: string
  query?: string
  since?: number
  limit?: number
}

type NetworkFilter = Record<string, unknown> & {
  status?: Array<string | number>
  text?: string
  query?: string
  since?: number
  limit?: number
}

type IssueFilter = Record<string, unknown> & {
  severity?: Array<IssueSeverity | string>
  limit?: number
}

export function getConsoleErrors(_opts: ConsoleFilter = {}): ConsoleEntry[] {
  return []
}

export function searchConsole(_opts: ConsoleFilter = {}): ConsoleEntry[] {
  return []
}

export function getNetworkFailures(_opts: NetworkFilter = {}): NetworkRequest[] {
  return []
}

export function searchNetwork(_opts: NetworkFilter = {}): NetworkRequest[] {
  return []
}

export function getDetectedIssues(_opts: IssueFilter = {}): DetectedIssue[] {
  return []
}

export function getIssueById(_issueId: string): DetectedIssue | null {
  return null
}

export function getInspectSummary(): {
  consoleCount: number
  errorCount: number
  warningCount: number
  networkCount: number
  networkFailureCount: number
  issueCount: number
  detectedIssueCount: number
  averageResponseTime: number
  lastErrorAt: number | null
  topErrors: Array<{ message: string; count: number }>
} {
  return {
    consoleCount: 0,
    errorCount: 0,
    warningCount: 0,
    networkCount: 0,
    networkFailureCount: 0,
    issueCount: 0,
    detectedIssueCount: 0,
    averageResponseTime: 0,
    lastErrorAt: null,
    topErrors: [],
  }
}

export function exportInspectData(): {
  timestamp: number
  timestampIso: string
  consoleEntries: ConsoleEntry[]
  networkRequests: NetworkRequest[]
  detectedIssues: DetectedIssue[]
  summary: ReturnType<typeof getInspectSummary>
} {
  const timestamp = Date.now()
  return {
    timestamp,
    timestampIso: new Date(timestamp).toISOString(),
    consoleEntries: [],
    networkRequests: [],
    detectedIssues: [],
    summary: getInspectSummary(),
  }
}
