export enum ConsoleLevel {
  LOG = 'log',
  INFO = 'info',
  WARN = 'warn',
  ERROR = 'error',
  DEBUG = 'debug',
}

export type ConsoleSeverity = 'error' | 'warn' | 'info' | 'debug'

export enum NetworkStatus {
  PENDING = 'pending',
  SUCCESS = 'success',
  ERROR = 'error',
  ABORTED = 'aborted',
}

export enum IssueSeverity {
  CRITICAL = 'critical',
  HIGH = 'high',
  MEDIUM = 'medium',
  LOW = 'low',
}

export interface ConsoleEntry {
  id: string
  level: ConsoleLevel
  message: string
  timestamp: number
  source?: string
  stack?: string
  stackTrace?: string
  url?: string
}

export interface NetworkRequest {
  id: string
  method: string
  url: string
  timestamp: number
  durationMs?: number
  status: NetworkStatus
  statusCode?: number
  success?: boolean
  duration?: number
  requestHeaders?: Record<string, string>
  responseHeaders?: Record<string, string>
  error?: string
  errorMessage?: string
}

export interface DetectedIssue {
  id: string
  type: string
  title: string
  description: string
  severity: IssueSeverity
  timestamp: number
  source?: string
  sourceTileId?: string
  canAutoFix?: boolean
  resolved?: boolean
  filePath?: string
  line?: number
}
