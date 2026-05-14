/**
 * Orchestrator skills for automatic debugging using inspect tools
 * High-level workflows that combine multiple inspect tool calls for comprehensive debugging
 */

import {
  getConsoleErrors,
  getNetworkFailures,
  getInspectSummary,
  searchConsole,
  searchNetwork,
  getDetectedIssues,
} from './inspectTools'
import {
  runAutoFix,
} from './autoFixWorkflows'
import {
  type ConsoleEntry,
  type NetworkRequest,
  type ConsoleSeverity,
} from '../../lib/inspect/types'
import { useOrchestratorActivityStore } from '../../store/orchestratorActivityStore'

// ============================================================================
// RESULT TYPES
// ============================================================================

export interface AutoDebugResult {
  summary: {
    totalErrors: number
    totalNetworkFailures: number
    totalDetectedIssues: number
    criticalIssues: number
  }
  fixesAttempted: number
  fixesApplied: number
  recommendations: string[]
}

export interface ConsoleErrorInvestigation {
  errorPattern: string
  occurrences: number
  firstSeen: number
  lastSeen: number
  examples: ConsoleEntry[]
  likelyCauses: string[]
  suggestedFixes: string[]
}

export interface NetworkFailureInvestigation {
  urlPattern: string
  failures: number
  statusCodes: number[]
  firstSeen: number
  lastSeen: number
  examples: NetworkRequest[]
  likelyCauses: string[]
  suggestedFixes: string[]
}

// ============================================================================
// AUTO DEBUG BROWSER WORKFLOW
// ============================================================================

/**
 * Automatically debug browser issues using inspect tools
 * This is a comprehensive workflow that analyzes and attempts to fix issues
 *
 * @param context - Orchestrator tool context for tool execution
 * @returns Complete debugging result with summary and fixes applied
 */
export async function autoDebugBrowser(
  context: { orchestratorTileId: string | null }
): Promise<AutoDebugResult> {
  const activity = useOrchestratorActivityStore.getState()

  activity.appendActivityLine('◆ Starting automatic browser debugging...')

  // Step 1: Get inspect summary
  const summary = getInspectSummary()
  activity.appendActivityLine(`◆ Found ${summary.errorCount} console errors, ${summary.networkFailureCount} network failures`)

  // Step 2: Check for critical issues
  const criticalIssues = getDetectedIssues({ severity: ['critical', 'high'] })
  activity.appendActivityLine(`◆ Found ${criticalIssues.length} critical/high priority issues`)

  // Step 3: Analyze error patterns
  const errors = getConsoleErrors({ limit: 50 })
  const networkFailures = getNetworkFailures({ limit: 50 })

  const recommendations: string[] = []

  // Analyze console errors
  if (errors.length > 0) {
    const errorPatterns = analyzeErrorPatterns(errors)
    for (const pattern of errorPatterns) {
      if (pattern.likelyCauses.length > 0) {
        recommendations.push(`Error pattern "${pattern.errorPattern}": ${pattern.likelyCauses[0]}`)
      }
    }
  }

  // Analyze network failures
  if (networkFailures.length > 0) {
    const networkPatterns = analyzeNetworkPatterns(networkFailures)
    for (const pattern of networkPatterns) {
      if (pattern.likelyCauses.length > 0) {
        recommendations.push(`Network pattern "${pattern.urlPattern}": ${pattern.likelyCauses[0]}`)
      }
    }
  }

  // Step 4: Run auto-fix for fixable issues
  let fixesAttempted = 0
  let fixesApplied = 0

  if (criticalIssues.length > 0) {
    activity.appendActivityLine('◆ Attempting automatic fixes for critical issues...')

    // Try to auto-fix each critical issue
    for (const issue of criticalIssues) {
      try {
        fixesAttempted++
        const result = await runAutoFix(issue, context)
        if (result.success) {
          fixesApplied++
          activity.appendActivityLine(`✓ Fixed: ${issue.title}`)
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error)
        activity.appendActivityLine(`✗ Fix failed: ${errorMsg}`)
      }
    }
  }

  return {
    summary: {
      totalErrors: summary.errorCount,
      totalNetworkFailures: summary.networkFailureCount,
      totalDetectedIssues: summary.detectedIssueCount,
      criticalIssues: criticalIssues.length,
    },
    fixesAttempted,
    fixesApplied,
    recommendations,
  }
}

// ============================================================================
// CONSOLE ERROR INVESTIGATION WORKFLOW
// ============================================================================

/**
 * Deep dive investigation into console errors
 * Groups similar errors and provides root cause analysis
 *
 * @param options - Investigation options
 * @returns Detailed investigation results
 */
export function investigateConsoleErrors(options: {
  query?: string
  level?: ConsoleSeverity[]
  limit?: number
}): ConsoleErrorInvestigation[] {
  const activity = useOrchestratorActivityStore.getState()

  activity.appendActivityLine('◆ Investigating console errors...')

  // Get errors based on options
  let errors: ConsoleEntry[]

  if (options.query) {
    errors = searchConsole({
      query: options.query,
      caseSensitive: false,
    })
    activity.appendActivityLine(`◆ Found ${errors.length} errors matching "${options.query}"`)
  } else {
    errors = getConsoleErrors({
      level: options.level,
      limit: options.limit || 100,
    })
    activity.appendActivityLine(`◆ Analyzing ${errors.length} console errors`)
  }

  // Group errors by patterns
  const investigations = groupAndAnalyzeErrors(errors)

  for (const investigation of investigations) {
    activity.appendActivityLine(
      `◆ Pattern "${investigation.errorPattern}": ${investigation.occurrences} occurrences`
    )
  }

  return investigations
}

// ============================================================================
// NETWORK FAILURE INVESTIGATION WORKFLOW
// ============================================================================

/**
 * Deep dive investigation into network failures
 * Groups failures by URL patterns and provides root cause analysis
 *
 * @param options - Investigation options
 * @returns Detailed investigation results
 */
export function investigateNetworkFailures(options: {
  query?: string
  status?: number[]
  limit?: number
}): NetworkFailureInvestigation[] {
  const activity = useOrchestratorActivityStore.getState()

  activity.appendActivityLine('◆ Investigating network failures...')

  // Get failures based on options
  let failures: NetworkRequest[]

  if (options.query) {
    failures = searchNetwork({
      query: options.query,
      searchIn: ['url', 'method', 'error'],
    })
    activity.appendActivityLine(`◆ Found ${failures.length} failures matching "${options.query}"`)
  } else {
    failures = getNetworkFailures({
      status: options.status,
      limit: options.limit || 100,
    })
    activity.appendActivityLine(`◆ Analyzing ${failures.length} network failures`)
  }

  // Group failures by URL patterns
  const investigations = groupAndAnalyzeFailures(failures)

  for (const investigation of investigations) {
    activity.appendActivityLine(
      `◆ Pattern "${investigation.urlPattern}": ${investigation.failures} failures`
    )
  }

  return investigations
}

// ============================================================================
// ANALYSIS HELPERS
// ============================================================================

/**
 * Group console errors by pattern and analyze root causes
 */
function groupAndAnalyzeErrors(errors: ConsoleEntry[]): ConsoleErrorInvestigation[] {
  const errorGroups = new Map<string, ConsoleEntry[]>()

  // Group errors by normalized message
  for (const error of errors) {
    const normalizedMessage = normalizeErrorMessage(error.message)
    const group = errorGroups.get(normalizedMessage) || []
    group.push(error)
    errorGroups.set(normalizedMessage, group)
  }

  // Analyze each group
  return Array.from(errorGroups.entries()).map(([pattern, occurrences]) => {
    const firstSeen = Math.min(...occurrences.map((e) => e.timestamp))
    const lastSeen = Math.max(...occurrences.map((e) => e.timestamp))
    const examples = occurrences.slice(0, 3) // Show up to 3 examples

    const { likelyCauses, suggestedFixes } = analyzeErrorCauses(pattern, examples[0])

    return {
      errorPattern: pattern,
      occurrences: occurrences.length,
      firstSeen,
      lastSeen,
      examples,
      likelyCauses,
      suggestedFixes,
    }
  })
}

/**
 * Group network failures by URL pattern and analyze root causes
 */
function groupAndAnalyzeFailures(failures: NetworkRequest[]): NetworkFailureInvestigation[] {
  const failureGroups = new Map<string, NetworkRequest[]>()

  // Group failures by URL pattern
  for (const failure of failures) {
    const urlPattern = extractUrlPattern(failure.url)
    const group = failureGroups.get(urlPattern) || []
    group.push(failure)
    failureGroups.set(urlPattern, group)
  }

  // Analyze each group
  return Array.from(failureGroups.entries()).map(([pattern, occurrences]) => {
    const firstSeen = Math.min(...occurrences.map((f) => f.timestamp))
    const lastSeen = Math.max(...occurrences.map((f) => f.timestamp))
    const statusCodes = [...new Set(occurrences.map((f) => f.statusCode).filter(Boolean))] as number[]
    const examples = occurrences.slice(0, 3) // Show up to 3 examples

    const { likelyCauses, suggestedFixes } = analyzeFailureCauses(pattern, examples[0])

    return {
      urlPattern: pattern,
      failures: occurrences.length,
      statusCodes,
      firstSeen,
      lastSeen,
      examples,
      likelyCauses,
      suggestedFixes,
    }
  })
}

/**
 * Analyze console error patterns and suggest causes
 */
function analyzeErrorCauses(
  errorMessage: string,
  _example: ConsoleEntry
): { likelyCauses: string[]; suggestedFixes: string[] } {
  const causes: string[] = []
  const fixes: string[] = []

  const lowerError = errorMessage.toLowerCase()

  // Syntax errors
  if (lowerError.includes('syntax') && lowerError.includes('unexpected')) {
    causes.push('Syntax error - code structure is invalid')
    fixes.push('Check for typos, missing brackets, or invalid syntax in the referenced file')
  }

  // Undefined variables/properties
  if (lowerError.includes('undefined')) {
    if (lowerError.includes('cannot read')) {
      causes.push('Attempting to access property on undefined/null object')
      fixes.push('Add null checks before accessing nested properties')
      fixes.push('Use optional chaining (?.) for safe property access')
    } else {
      causes.push('Variable or function is not defined')
      fixes.push('Check variable spelling and scope')
      fixes.push('Ensure the variable/function is declared before use')
    }
  }

  // Import/require errors
  if (lowerError.includes('import') && (lowerError.includes('not found') || lowerError.includes('unexpected'))) {
    causes.push('Module import error - file or package not found')
    fixes.push('Check file path in import statement')
    fixes.push('Ensure the package is installed in package.json')
    fixes.push('Check for circular dependencies')
  }

  // React-specific errors
  if (lowerError.includes('react') || lowerError.includes('hook') || lowerError.includes('component')) {
    if (lowerError.includes('hook')) {
      causes.push('React hook rule violation')
      fixes.push('Ensure hooks are called at the top level of components')
      fixes.push('Check that hooks are not called conditionally')
    } else if (lowerError.includes('render')) {
      causes.push('React rendering error')
      fixes.push('Check component return values')
      fixes.push('Verify JSX syntax and component structure')
    }
  }

  // Network-related errors in console
  if (lowerError.includes('network') || lowerError.includes('fetch') || lowerError.includes('api')) {
    causes.push('Network request failed')
    fixes.push('Check API endpoint availability')
    fixes.push('Verify network connection and CORS configuration')
    fixes.push('Check authentication credentials')
  }

  // Default analysis if no specific patterns matched
  if (causes.length === 0) {
    causes.push('Unknown error - needs manual investigation')
    fixes.push('Review the error message and stack trace for clues')
    fixes.push('Check recent code changes that might have introduced this error')
  }

  return { likelyCauses: causes, suggestedFixes: fixes }
}

/**
 * Analyze network failure patterns and suggest causes
 */
function analyzeFailureCauses(
  urlPattern: string,
  example: NetworkRequest
): { likelyCauses: string[]; suggestedFixes: string[] } {
  const causes: string[] = []
  const fixes: string[] = []

  const statusCode = example.statusCode
  const lowerUrl = urlPattern.toLowerCase()
  const lowerError = (example.error || example.errorMessage || '').toLowerCase()

  // 4xx errors
  if (statusCode && statusCode >= 400 && statusCode < 500) {
    if (statusCode === 401 || statusCode === 403) {
      causes.push('Authentication/authorization failure')
      fixes.push('Check API credentials and authentication tokens')
      fixes.push('Verify user permissions for the requested resource')
    } else if (statusCode === 404) {
      causes.push('Resource not found')
      fixes.push('Verify API endpoint URL is correct')
      fixes.push('Check if the resource exists or the ID is valid')
    } else if (statusCode === 429) {
      causes.push('Rate limiting - too many requests')
      fixes.push('Implement request throttling and retry logic')
      fixes.push('Check API rate limits and implement backoff strategy')
    } else {
      causes.push(`Client error ${statusCode}`)
      fixes.push('Review request parameters and payload format')
      fixes.push('Check API documentation for required parameters')
    }
  }

  // 5xx errors
  if (statusCode && statusCode >= 500 && statusCode < 600) {
    causes.push('Server error - API or backend failure')
    fixes.push('Check API service status and logs')
    fixes.push('Verify backend deployment and configuration')
    fixes.push('Report the issue to API provider if persistent')
  }

  // CORS errors
  if (lowerError.includes('cors') || lowerError.includes('cross-origin')) {
    causes.push('CORS (Cross-Origin Resource Sharing) error')
    fixes.push('Configure CORS headers on the API server')
    fixes.push('Ensure the API allows requests from your domain')
    fixes.push('Consider using a proxy for development')
  }

  // Network/connection errors
  if (lowerError.includes('network') || lowerError.includes('connection') || lowerError.includes('timeout')) {
    causes.push('Network connectivity issue')
    fixes.push('Check internet connection and VPN settings')
    fixes.push('Verify API server is reachable')
    fixes.push('Implement retry logic for transient failures')
  }

  // API-specific patterns
  if (lowerUrl.includes('api') || lowerUrl.includes('rest')) {
    if (!statusCode) {
      causes.push('API request failed without status code')
      fixes.push('Check if API server is running')
      fixes.push('Verify network connectivity to the API')
      fixes.push('Check browser console for additional error details')
    }
  }

  // Default analysis if no specific patterns matched
  if (causes.length === 0) {
    causes.push('Unknown network failure')
    fixes.push('Review network request details in browser DevTools')
    fixes.push('Check API server logs for error details')
    fixes.push('Verify request format and parameters')
  }

  return { likelyCauses: causes, suggestedFixes: fixes }
}

/**
 * Normalize error message for grouping
 */
function normalizeErrorMessage(message: string): string {
  // Remove file paths, line numbers, and timestamps for better grouping
  return message
    .replace(/\/[\w\-./]+/g, '<path>')
    .replace(/\d+/g, '<n>')
    .replace(/\[.*?\]/g, '<>')
    .trim()
    .slice(0, 100) // Limit to 100 chars for grouping
}

/**
 * Extract URL pattern for grouping network failures
 */
function extractUrlPattern(url: string): string {
  try {
    const urlObj = new URL(url)
    const pathParts = urlObj.pathname.split('/').filter(Boolean)

    // Normalize path segments
    const normalizedPath = pathParts
      .map((segment) => {
        // Replace IDs and UUIDs with placeholders
        if (/^\d+$/.test(segment)) return ':id'
        if (/^[0-9a-f-]{36}$/.test(segment)) return ':uuid'
        if (segment.includes('.')) return ':file'
        return segment
      })
      .join('/')

    return `${urlObj.protocol}//${urlObj.host}/${normalizedPath}`
  } catch {
    // Fallback for invalid URLs
    return url.split('?')[0] // Remove query string
  }
}

// ============================================================================
// ANALYSIS UTILITIES
// ============================================================================

/**
 * Analyze console error patterns from a list of errors
 */
function analyzeErrorPatterns(errors: ConsoleEntry[]): ConsoleErrorInvestigation[] {
  const groups = groupAndAnalyzeErrors(errors)
  return groups.sort((a, b) => b.occurrences - a.occurrences) // Sort by frequency
}

/**
 * Analyze network failure patterns from a list of failures
 */
function analyzeNetworkPatterns(failures: NetworkRequest[]): NetworkFailureInvestigation[] {
  const groups = groupAndAnalyzeFailures(failures)
  return groups.sort((a, b) => b.failures - a.failures) // Sort by frequency
}

// ============================================================================
// EXPORTS
// ============================================================================

export const inspectDebugSkills = {
  autoDebugBrowser,
  investigateConsoleErrors,
  investigateNetworkFailures,
}

export default inspectDebugSkills