/**
 * Inspect workflow definitions for automated debugging
 * Provides structured workflows for common debugging scenarios
 */

import {
  DetectedIssue,
  ConsoleEntry,
  NetworkRequest,
  IssueSeverity,
} from '../../inspect/types'
import {
  getConsoleErrors,
  getNetworkFailures,
  getInspectSummary,
  getDetectedIssues,
  searchConsole,
  searchNetwork,
} from '../inspectTools'
import { runAutoFixBatch } from '../autoFixWorkflows'
import { useOrchestratorActivityStore } from '../../../store/orchestratorActivityStore'

// ============================================================================
// WORKFLOW RESULT TYPES
// ============================================================================

/**
 * Result from debug_and_fix_console_error workflow
 */
export interface ConsoleErrorWorkflowResult {
  /** Workflow execution status */
  status: 'success' | 'partial_success' | 'failed'
  /** Number of errors analyzed */
  errorsAnalyzed: number
  /** Root cause identified */
  rootCause: string | null
  /** Fix applied (if any) */
  fixApplied: {
    file: string | null
    changes: string[]
    successful: boolean
  }
  /** Verification result */
  verification: {
    errorCountBefore: number
    errorCountAfter: number
    resolved: boolean
  }
  /** Summary message */
  summary: string
  /** Recommended next steps */
  recommendations: string[]
}

/**
 * Result from debug_and_fix_api_failure workflow
 */
export interface APIFailureWorkflowResult {
  /** Workflow execution status */
  status: 'success' | 'partial_success' | 'failed'
  /** Number of failures analyzed */
  failuresAnalyzed: number
  /** Root cause identified */
  rootCause: string | null
  /** API endpoint affected */
  endpoint: string | null
  /** Fix applied (if any) */
  fixApplied: {
    type: 'code_fix' | 'config_change' | 'manual_action_required'
    description: string
    successful: boolean
  }
  /** Verification result */
  verification: {
    failureCountBefore: number
    failureCountAfter: number
    resolved: boolean
  }
  /** Summary message */
  summary: string
  /** Recommended next steps */
  recommendations: string[]
}

/**
 * Result from health_check_and_fix workflow
 */
export interface HealthCheckWorkflowResult {
  /** Overall health status */
  healthStatus: 'healthy' | 'degraded' | 'unhealthy'
  /** Issues found */
  issuesFound: {
    critical: number
    high: number
    medium: number
    low: number
  }
  /** Fixes applied */
  fixesApplied: {
    successful: number
    failed: number
    details: string[]
  }
  /** Verification result */
  verification: {
    healthBefore: string
    healthAfter: string
    improved: boolean
  }
  /** Summary message */
  summary: string
  /** Recommended next steps */
  recommendations: string[]
}

/**
 * Result from performance_optimization workflow
 */
export interface PerformanceOptimizationWorkflowResult {
  /** Workflow execution status */
  status: 'success' | 'partial_success' | 'failed'
  /** Performance metrics before */
  metricsBefore: {
    avgResponseTime: number
    successRate: number
    slowEndpointCount: number
  }
  /** Optimizations applied */
  optimizationsApplied: {
    caching: number
    retryLogic: number
    requestBundling: number
    codeOptimizations: number
  }
  /** Performance metrics after */
  metricsAfter: {
    avgResponseTime: number
    successRate: number
    slowEndpointCount: number
  }
  /** Improvement summary */
  improvement: {
    responseTimeImprovement: string
    successRateImprovement: string
  }
  /** Summary message */
  summary: string
  /** Recommended next steps */
  recommendations: string[]
}

// ============================================================================
// WORKFLOW IMPLEMENTATIONS
// ============================================================================

/**
 * Workflow: debug_and_fix_console_error
 *
 * Trigger: Console error detected or user reports console errors
 *
 * Steps:
 * 1. Get console errors with filters
 * 2. Analyze error pattern and frequency
 * 3. Identify root cause from stack traces
 * 4. Generate or apply fix
 * 5. Apply fix if auto-fixable
 * 6. Verify fix resolved issue
 * 7. Report result with recommendations
 *
 * @param options - Workflow options
 * @returns Console error debugging result
 */
export async function debugAndFixConsoleError(options: {
  /** Search query for specific error (optional) */
  searchQuery?: string
  /** Severity levels to analyze (default: all errors) */
  severity?: ('fatal' | 'error' | 'warning' | 'info')[]
  /** Whether to auto-fix if possible (default: true) */
  autoFix?: boolean
  /** Maximum number of errors to analyze (default: 50) */
  maxErrors?: number
}): Promise<ConsoleErrorWorkflowResult> {
  const {
    searchQuery,
    severity = ['fatal', 'error'],
    autoFix = true,
    maxErrors = 50,
  } = options

  useOrchestratorActivityStore.getState().appendActivityLine(
    `◆ Workflow: Debug and fix console error`
  )

  // Step 1: Get console errors
  let errors: ConsoleEntry[] = []
  if (searchQuery) {
    errors = searchConsole({ query: searchQuery })
    useOrchestratorActivityStore.getState().appendActivityLine(
      `✓ Found ${errors.length} errors matching "${searchQuery}"`
    )
  } else {
    errors = getConsoleErrors({ level: severity, limit: maxErrors })
    useOrchestratorActivityStore.getState().appendActivityLine(
      `✓ Found ${errors.length} console errors`
    )
  }

  if (errors.length === 0) {
    return {
      status: 'success',
      errorsAnalyzed: 0,
      rootCause: null,
      fixApplied: {
        file: null,
        changes: [],
        successful: false,
      },
      verification: {
        errorCountBefore: 0,
        errorCountAfter: 0,
        resolved: true,
      },
      summary: 'No console errors found - system is healthy',
      recommendations: ['Continue monitoring for errors'],
    }
  }

  // Step 2: Analyze error pattern
  const errorPattern = analyzeErrorPattern(errors)
  useOrchestratorActivityStore.getState().appendActivityLine(
    `✓ Pattern analysis: ${errorPattern.message} (occurs ${errorPattern.count} times)`
  )

  // Step 3: Identify root cause
  const rootCause = identifyRootCause(errors)
  useOrchestratorActivityStore.getState().appendActivityLine(
    `✓ Root cause: ${rootCause}`
  )

  // Step 4 & 5: Generate and apply fix
  let fixApplied = {
    file: null as string | null,
    changes: [] as string[],
    successful: false,
  }

  const errorCountBefore = errors.length

  if (autoFix) {
    // Get detected issues for auto-fixable items
    const detectedIssues = getDetectedIssues({ severity: ['critical', 'high', 'medium'] })
    const autoFixableIssues = detectedIssues
      .filter(issue =>
        issue.canAutoFix &&
        (issue.type === 'console_error' || issue.type === 'unhandled_rejection')
      )
      .slice(0, 5) // Limit to 5 issues

    if (autoFixableIssues.length > 0) {
      useOrchestratorActivityStore.getState().appendActivityLine(
        `◆ Applying auto-fix for ${autoFixableIssues.length} issues...`
      )

      const context = { orchestratorTileId: null }
      const batchResult = await runAutoFixBatch(autoFixableIssues, context)

      fixApplied.changes = batchResult.details
        .filter(d => d.success)
        .flatMap(d => d.changes)

      fixApplied.successful = batchResult.fixed > 0

      if (fixApplied.successful) {
        // Extract file path from first successful fix
        const firstSuccessful = batchResult.details.find(d => d.success)
        if (firstSuccessful) {
          const issue = autoFixableIssues.find(i => i.id === firstSuccessful.issueId)
          fixApplied.file = extractFilePathFromIssue(issue)
        }
      }

      useOrchestratorActivityStore.getState().appendActivityLine(
        `✓ Auto-fix complete: ${batchResult.fixed} fixed, ${batchResult.failed} failed`
      )
    }
  }

  // Step 6: Verify fix
  await new Promise(resolve => setTimeout(resolve, 2000)) // Wait for errors to propagate

  const errorsAfter = searchQuery
    ? searchConsole({ query: searchQuery })
    : getConsoleErrors({ level: severity, limit: maxErrors })

  const errorCountAfter = errorsAfter.length
  const resolved = errorCountAfter < errorCountBefore

  useOrchestratorActivityStore.getState().appendActivityLine(
    `✓ Verification: ${errorCountBefore} → ${errorCountAfter} errors (${resolved ? '✓ resolved' : '✗ not resolved'})`
  )

  // Step 7: Generate recommendations
  const recommendations = generateConsoleErrorRecommendations(
    errors,
    rootCause,
    resolved,
    fixApplied.successful
  )

  // Determine overall status
  let status: 'success' | 'partial_success' | 'failed'
  if (resolved && fixApplied.successful) {
    status = 'success'
  } else if (resolved || fixApplied.successful) {
    status = 'partial_success'
  } else {
    status = 'failed'
  }

  const summary = `Analyzed ${errors.length} console errors. ${fixApplied.successful ? 'Fix applied. ' : ''}${resolved ? 'Issue resolved.' : 'Issue persists.'}`

  return {
    status,
    errorsAnalyzed: errors.length,
    rootCause,
    fixApplied,
    verification: {
      errorCountBefore,
      errorCountAfter,
      resolved,
    },
    summary,
    recommendations,
  }
}

/**
 * Workflow: debug_and_fix_api_failure
 *
 * Trigger: Network failure detected or user reports API issues
 *
 * Steps:
 * 1. Get network failures with filters
 * 2. Analyze failure pattern by endpoint
 * 3. Check API configuration and authentication
 * 4. Generate or apply fix
 * 5. Apply fix if auto-fixable
 * 6. Verify fix resolved issue
 * 7. Report result with recommendations
 *
 * @param options - Workflow options
 * @returns API failure debugging result
 */
export async function debugAndFixAPIFailure(options: {
  /** Search query for specific endpoint (optional) */
  searchQuery?: string
  /** HTTP status codes to analyze (default: all failures) */
  statusCodes?: number[]
  /** Whether to auto-fix if possible (default: true) */
  autoFix?: boolean
  /** Maximum number of failures to analyze (default: 50) */
  maxFailures?: number
}): Promise<APIFailureWorkflowResult> {
  const {
    searchQuery,
    statusCodes,
    autoFix = true,
    maxFailures = 50,
  } = options

  useOrchestratorActivityStore.getState().appendActivityLine(
    `◆ Workflow: Debug and fix API failure`
  )

  // Step 1: Get network failures
  let failures: NetworkRequest[] = []
  if (searchQuery) {
    failures = searchNetwork({ query: searchQuery })
    useOrchestratorActivityStore.getState().appendActivityLine(
      `✓ Found ${failures.length} failures matching "${searchQuery}"`
    )
  } else {
    failures = getNetworkFailures({ status: statusCodes, limit: maxFailures })
    useOrchestratorActivityStore.getState().appendActivityLine(
      `✓ Found ${failures.length} network failures`
    )
  }

  if (failures.length === 0) {
    return {
      status: 'success',
      failuresAnalyzed: 0,
      rootCause: null,
      endpoint: null,
      fixApplied: {
        type: 'manual_action_required',
        description: 'No failures found',
        successful: false,
      },
      verification: {
        failureCountBefore: 0,
        failureCountAfter: 0,
        resolved: true,
      },
      summary: 'No network failures found - API is healthy',
      recommendations: ['Continue monitoring for failures'],
    }
  }

  // Step 2: Analyze failure pattern
  const failurePattern = analyzeFailurePattern(failures)
  useOrchestratorActivityStore.getState().appendActivityLine(
    `✓ Pattern analysis: ${failurePattern.endpoint} (${failurePattern.count} failures)`
  )

  // Step 3: Identify root cause
  const rootCause = identifyAPIRootCause(failures)
  useOrchestratorActivityStore.getState().appendActivityLine(
    `✓ Root cause: ${rootCause}`
  )

  // Step 4 & 5: Generate and apply fix
  let fixApplied = {
    type: 'manual_action_required' as 'code_fix' | 'config_change' | 'manual_action_required',
    description: '',
    successful: false,
  }

  const failureCountBefore = failures.length

  if (autoFix) {
    // Get detected issues for auto-fixable items
    const detectedIssues = getDetectedIssues({ severity: ['critical', 'high', 'medium'] })
    const autoFixableIssues = detectedIssues
      .filter(issue =>
        issue.canAutoFix &&
        (issue.type === 'network_failure' || issue.type === 'api_error' || issue.type === 'cors_error')
      )
      .slice(0, 5) // Limit to 5 issues

    if (autoFixableIssues.length > 0) {
      useOrchestratorActivityStore.getState().appendActivityLine(
        `◆ Applying auto-fix for ${autoFixableIssues.length} issues...`
      )

      const context = { orchestratorTileId: null }
      const batchResult = await runAutoFixBatch(autoFixableIssues, context)

      fixApplied.type = 'code_fix'
      fixApplied.description = `Applied ${batchResult.fixed} automated fixes`
      fixApplied.successful = batchResult.fixed > 0

      useOrchestratorActivityStore.getState().appendActivityLine(
        `✓ Auto-fix complete: ${batchResult.fixed} fixed, ${batchResult.failed} failed`
      )
    }
  }

  // Step 6: Verify fix
  await new Promise(resolve => setTimeout(resolve, 2000)) // Wait for failures to propagate

  const failuresAfter = searchQuery
    ? searchNetwork({ query: searchQuery })
    : getNetworkFailures({ status: statusCodes, limit: maxFailures })

  const failureCountAfter = failuresAfter.length
  const resolved = failureCountAfter < failureCountBefore

  useOrchestratorActivityStore.getState().appendActivityLine(
    `✓ Verification: ${failureCountBefore} → ${failureCountAfter} failures (${resolved ? '✓ resolved' : '✗ not resolved'})`
  )

  // Step 7: Generate recommendations
  const recommendations = generateAPIFailureRecommendations(
    failures,
    rootCause,
    resolved,
    fixApplied.successful
  )

  // Determine overall status
  let status: 'success' | 'partial_success' | 'failed'
  if (resolved && fixApplied.successful) {
    status = 'success'
  } else if (resolved || fixApplied.successful) {
    status = 'partial_success'
  } else {
    status = 'failed'
  }

  const summary = `Analyzed ${failures.length} API failures. ${fixApplied.successful ? 'Fix applied. ' : ''}${resolved ? 'Issue resolved.' : 'Issue persists.'}`

  return {
    status,
    failuresAnalyzed: failures.length,
    rootCause,
    endpoint: failurePattern.endpoint,
    fixApplied,
    verification: {
      failureCountBefore,
      failureCountAfter,
      resolved,
    },
    summary,
    recommendations,
  }
}

/**
 * Workflow: health_check_and_fix
 *
 * Trigger: Periodic health check or user requests health status
 *
 * Steps:
 * 1. Run comprehensive health check
 * 2. Identify all issues by severity
 * 3. Prioritize and auto-fix what's possible
 * 4. Verify health improvement
 * 5. Report status with recommendations
 *
 * @param options - Workflow options
 * @returns Health check and fix result
 */
export async function healthCheckAndFix(options: {
  /** Minimum severity to fix (default: 'high') */
  minSeverity?: IssueSeverity
  /** Whether to auto-fix issues (default: true) */
  autoFix?: boolean
  /** Maximum number of issues to fix (default: 10) */
  maxIssues?: number
}): Promise<HealthCheckWorkflowResult> {
  const {
    minSeverity = 'high',
    autoFix = true,
    maxIssues = 10,
  } = options

  useOrchestratorActivityStore.getState().appendActivityLine(
    `◆ Workflow: Health check and fix`
  )

  // Step 1: Run health check
  const summaryBefore = getInspectSummary()
  const detectedIssuesBefore = getDetectedIssues()

  const healthBefore = determineHealthStatus(summaryBefore, detectedIssuesBefore)
  useOrchestratorActivityStore.getState().appendActivityLine(
    `✓ Health status before: ${healthBefore.toUpperCase()}`
  )

  // Step 2: Identify issues by severity
  const issuesBySeverity = {
    critical: detectedIssuesBefore.filter(i => i.severity === 'critical').length,
    high: detectedIssuesBefore.filter(i => i.severity === 'high').length,
    medium: detectedIssuesBefore.filter(i => i.severity === 'medium').length,
    low: detectedIssuesBefore.filter(i => i.severity === 'low').length,
  }

  useOrchestratorActivityStore.getState().appendActivityLine(
    `✓ Issues found: ${issuesBySeverity.critical} critical, ${issuesBySeverity.high} high, ${issuesBySeverity.medium} medium, ${issuesBySeverity.low} low`
  )

  // Step 3: Auto-fix what's possible
  let fixesApplied = {
    successful: 0,
    failed: 0,
    details: [] as string[],
  }

  if (autoFix) {
    const severityOrder = { critical: 4, high: 3, medium: 2, low: 1 }
    const fixableIssues = detectedIssuesBefore
      .filter(issue =>
        issue.canAutoFix &&
        severityOrder[issue.severity] >= severityOrder[minSeverity]
      )
      .slice(0, maxIssues)

    if (fixableIssues.length > 0) {
      useOrchestratorActivityStore.getState().appendActivityLine(
        `◆ Auto-fixing ${fixableIssues.length} issues (${minSeverity}+ severity)...`
      )

      const context = { orchestratorTileId: null }
      const batchResult = await runAutoFixBatch(fixableIssues, context)

      fixesApplied.successful = batchResult.fixed
      fixesApplied.failed = batchResult.failed
      fixesApplied.details = batchResult.details
        .filter(d => d.success)
        .flatMap(d => d.changes)

      useOrchestratorActivityStore.getState().appendActivityLine(
        `✓ Auto-fix complete: ${batchResult.fixed} fixed, ${batchResult.failed} failed`
      )
    } else {
      useOrchestratorActivityStore.getState().appendActivityLine(
        `✓ No auto-fixable issues found`
      )
    }
  }

  // Step 4: Verify health improvement
  await new Promise(resolve => setTimeout(resolve, 2000)) // Wait for fixes to propagate

  const summaryAfter = getInspectSummary()
  const detectedIssuesAfter = getDetectedIssues()

  const healthAfter = determineHealthStatus(summaryAfter, detectedIssuesAfter)
  const improved = isHealthImproved(healthBefore, healthAfter)

  useOrchestratorActivityStore.getState().appendActivityLine(
    `✓ Health status after: ${healthAfter.toUpperCase()} (${improved ? '✓ improved' : '✗ no change'})`
  )

  // Step 5: Generate recommendations
  const recommendations = generateHealthCheckRecommendations(
    healthAfter,
    detectedIssuesAfter,
    fixesApplied
  )

  const summary = `Health check: ${healthBefore.toUpperCase()} → ${healthAfter.toUpperCase()}. ${fixesApplied.successful} fixes applied.`

  return {
    healthStatus: healthAfter,
    issuesFound: issuesBySeverity,
    fixesApplied,
    verification: {
      healthBefore,
      healthAfter,
      improved,
    },
    summary,
    recommendations,
  }
}

/**
 * Workflow: performance_optimization
 *
 * Trigger: Slow performance detected or user reports slowness
 *
 * Steps:
 * 1. Analyze current performance metrics
 * 2. Identify bottlenecks (slow endpoints, large payloads)
 * 3. Apply optimizations (caching, retry logic, etc.)
 * 4. Measure performance improvement
 * 5. Report results with recommendations
 *
 * @param options - Workflow options
 * @returns Performance optimization result
 */
export async function performanceOptimization(options: {
  /** Target response time in ms (default: 2000) */
  targetResponseTime?: number
  /** Whether to apply optimizations (default: true) */
  applyOptimizations?: boolean
}): Promise<PerformanceOptimizationWorkflowResult> {
  const {
    targetResponseTime = 2000,
    applyOptimizations = true,
  } = options

  useOrchestratorActivityStore.getState().appendActivityLine(
    `◆ Workflow: Performance optimization`
  )

  // Step 1: Analyze current performance
  const summaryBefore = getInspectSummary()
  const allRequests = getNetworkFailures({ status: [], limit: 1000 })

  const metricsBefore = {
    avgResponseTime: summaryBefore.averageResponseTime || 0,
    successRate: calculateSuccessRate(allRequests),
    slowEndpointCount: countSlowEndpoints(allRequests, targetResponseTime),
  }

  useOrchestratorActivityStore.getState().appendActivityLine(
    `✓ Current metrics: ${metricsBefore.avgResponseTime.toFixed(0)}ms avg, ${metricsBefore.successRate.toFixed(1)}% success, ${metricsBefore.slowEndpointCount} slow endpoints`
  )

  // Step 2: Identify bottlenecks
  const slowEndpoints = identifySlowEndpoints(allRequests, targetResponseTime)
  useOrchestratorActivityStore.getState().appendActivityLine(
    `✓ Identified ${slowEndpoints.length} bottlenecks`
  )

  // Step 3: Apply optimizations
  let optimizationsApplied = {
    caching: 0,
    retryLogic: 0,
    requestBundling: 0,
    codeOptimizations: 0,
  }

  if (applyOptimizations) {
    // Get detected performance issues
    const detectedIssues = getDetectedIssues({ severity: ['high', 'medium'] })
    const performanceIssues = detectedIssues
      .filter(issue =>
        issue.canAutoFix &&
        issue.type === 'performance'
      )
      .slice(0, 5)

    if (performanceIssues.length > 0) {
      useOrchestratorActivityStore.getState().appendActivityLine(
        `◆ Applying ${performanceIssues.length} performance optimizations...`
      )

      const context = { orchestratorTileId: null }
      const batchResult = await runAutoFixBatch(performanceIssues, context)

      // Count optimization types
      for (const detail of batchResult.details) {
        if (detail.success) {
          if (detail.changes.some(c => c.includes('cache'))) optimizationsApplied.caching++
          if (detail.changes.some(c => c.includes('retry'))) optimizationsApplied.retryLogic++
          if (detail.changes.some(c => c.includes('bundl'))) optimizationsApplied.requestBundling++
          if (detail.changes.some(c => c.includes('optimi'))) optimizationsApplied.codeOptimizations++
        }
      }

      useOrchestratorActivityStore.getState().appendActivityLine(
        `✓ Optimizations applied: ${optimizationsApplied.caching} caching, ${optimizationsApplied.retryLogic} retry, ${optimizationsApplied.requestBundling} bundling, ${optimizationsApplied.codeOptimizations} code`
      )
    }
  }

  // Step 4: Measure improvement
  await new Promise(resolve => setTimeout(resolve, 3000)) // Wait for optimizations to take effect

  const summaryAfter = getInspectSummary()
  const allRequestsAfter = getNetworkFailures({ status: [], limit: 1000 })

  const metricsAfter = {
    avgResponseTime: summaryAfter.averageResponseTime || 0,
    successRate: calculateSuccessRate(allRequestsAfter),
    slowEndpointCount: countSlowEndpoints(allRequestsAfter, targetResponseTime),
  }

  useOrchestratorActivityStore.getState().appendActivityLine(
    `✓ New metrics: ${metricsAfter.avgResponseTime.toFixed(0)}ms avg, ${metricsAfter.successRate.toFixed(1)}% success, ${metricsAfter.slowEndpointCount} slow endpoints`
  )

  // Calculate improvements
  const responseTimeImprovement = metricsBefore.avgResponseTime > 0
    ? `${((1 - metricsAfter.avgResponseTime / metricsBefore.avgResponseTime) * 100).toFixed(0)}%`
    : 'N/A'

  const successRateImprovement = metricsBefore.successRate > 0
    ? `${((metricsAfter.successRate - metricsBefore.successRate) / (100 - metricsBefore.successRate) * 100).toFixed(0)}%`
    : 'N/A'

  // Step 5: Generate recommendations
  const recommendations = generatePerformanceRecommendations(
    metricsAfter,
    targetResponseTime
  )

  const summary = `Performance optimization: ${metricsBefore.avgResponseTime.toFixed(0)}ms → ${metricsAfter.avgResponseTime.toFixed(0)}ms avg response time (${responseTimeImprovement} improvement).`

  return {
    status: metricsAfter.avgResponseTime < targetResponseTime ? 'success' : 'partial_success',
    metricsBefore,
    optimizationsApplied,
    metricsAfter,
    improvement: {
      responseTimeImprovement,
      successRateImprovement,
    },
    summary,
    recommendations,
  }
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Analyze error pattern from console errors
 */
function analyzeErrorPattern(errors: ConsoleEntry[]): {
  message: string
  count: number
  firstSeen: number
  lastSeen: number
} {
  // Group by normalized message
  const groups = new Map<string, ConsoleEntry[]>()

  for (const error of errors) {
    const normalized = error.message
      .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/g, '[TIMESTAMP]')
      .replace(/\b[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\b/gi, '[UUID]')
      .replace(/\b\d+\b/g, '[NUMBER]')
      .toLowerCase()
      .trim()
      .slice(0, 200)

    if (!groups.has(normalized)) {
      groups.set(normalized, [])
    }
    groups.get(normalized)!.push(error)
  }

  // Find the most common pattern
  let maxCount = 0
  let mostCommon: ConsoleEntry[] = []

  for (const group of groups.values()) {
    if (group.length > maxCount) {
      maxCount = group.length
      mostCommon = group
    }
  }

  return {
    message: mostCommon[0]?.message || 'Unknown error',
    count: mostCommon.length,
    firstSeen: Math.min(...mostCommon.map(e => e.timestamp)),
    lastSeen: Math.max(...mostCommon.map(e => e.timestamp)),
  }
}

/**
 * Identify root cause from console errors
 */
function identifyRootCause(errors: ConsoleEntry[]): string {
  if (errors.length === 0) return 'No errors found'

  const error = errors[0]
  const message = error.message.toLowerCase()

  // Check for common patterns
  if (message.includes('is not defined')) {
    return 'Undefined variable or missing import'
  }

  if (message.includes('cannot read') && message.includes('undefined')) {
    return 'Property access on undefined object'
  }

  if (message.includes('syntax') && message.includes('unexpected')) {
    return 'Syntax error in code'
  }

  if (message.includes('import') && (message.includes('not found') || message.includes('unexpected'))) {
    return 'Import/export error'
  }

  if (message.includes('network') || message.includes('fetch')) {
    return 'Network request failed'
  }

  // Check stack trace for file location
  if (error.stackTrace) {
    const fileMatch = error.stackTrace.match(/at (.+?):(\d+):\d+/)
    if (fileMatch) {
      return `Error in ${fileMatch[1]}:${fileMatch[2]}`
    }
  }

  return 'Unknown root cause - manual investigation needed'
}

/**
 * Extract file path from detected issue
 */
function extractFilePathFromIssue(issue: DetectedIssue | undefined): string | null {
  if (!issue) return null

  const pathMatch = issue.description.match(/at (.+?):(\d+):\d+/)
  if (pathMatch) {
    return pathMatch[1]
  }

  return null
}

/**
 * Generate console error recommendations
 */
function generateConsoleErrorRecommendations(
  errors: ConsoleEntry[],
  rootCause: string,
  resolved: boolean,
  fixApplied: boolean
): string[] {
  const recommendations: string[] = []

  if (!resolved) {
    recommendations.push(`Manual investigation required: ${rootCause}`)
  }

  if (errors.length > 10) {
    recommendations.push(`${errors.length} errors detected - systematic issue needs attention`)
  }

  if (!fixApplied && !resolved) {
    recommendations.push('Consider adding error handling or defensive checks')
  }

  if (resolved) {
    recommendations.push('Issue resolved - continue monitoring for recurrence')
    recommendations.push('Add unit tests to prevent regression')
  }

  return recommendations
}

/**
 * Analyze failure pattern from network failures
 */
function analyzeFailurePattern(failures: NetworkRequest[]): {
  endpoint: string
  count: number
  methods: string[]
  statusCodes: number[]
} {
  // Group by normalized URL
  const groups = new Map<string, NetworkRequest[]>()

  for (const failure of failures) {
    const normalized = failure.url
      .replace(/\d+[a-z0-9\-]*/gi, '[ID]')
      .replace(/\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/gi, '/[UUID]')

    if (!groups.has(normalized)) {
      groups.set(normalized, [])
    }
    groups.get(normalized)!.push(failure)
  }

  // Find the most common endpoint
  let maxCount = 0
  let mostCommon: NetworkRequest[] = []

  for (const group of groups.values()) {
    if (group.length > maxCount) {
      maxCount = group.length
      mostCommon = group
    }
  }

  return {
    endpoint: mostCommon[0]?.url || 'Unknown endpoint',
    count: mostCommon.length,
    methods: [...new Set(mostCommon.map(f => f.method))],
    statusCodes: [...new Set(mostCommon.map(f => f.statusCode).filter((code): code is number => Boolean(code)))],
  }
}

/**
 * Identify API failure root cause
 */
function identifyAPIRootCause(failures: NetworkRequest[]): string {
  if (failures.length === 0) return 'No failures found'

  const failure = failures[0]
  const statusCode = failure.statusCode

  if (statusCode === 401 || statusCode === 403) {
    return 'Authentication or authorization error'
  }

  if (statusCode === 404) {
    return 'API endpoint not found (404)'
  }

  if (statusCode && statusCode >= 500) {
    return 'Server error - check API service status'
  }

  if (statusCode === 429) {
    return 'Rate limiting - too many requests'
  }

  if (failure.errorMessage?.toLowerCase().includes('cors')) {
    return 'CORS error - cross-origin request blocked'
  }

  if (failure.errorMessage?.toLowerCase().includes('timeout')) {
    return 'Request timeout - server or network issue'
  }

  return 'Unknown API failure - manual investigation needed'
}

/**
 * Generate API failure recommendations
 */
function generateAPIFailureRecommendations(
  failures: NetworkRequest[],
  rootCause: string,
  resolved: boolean,
  _fixApplied: boolean
): string[] {
  const recommendations: string[] = []

  if (!resolved) {
    recommendations.push(`Manual investigation required: ${rootCause}`)
  }

  if (failures.length > 5) {
    recommendations.push(`${failures.length} failures to same endpoint - systematic issue`)
  }

  if (rootCause.includes('Authentication')) {
    recommendations.push('Check token refresh logic and API credentials')
  }

  if (rootCause.includes('CORS')) {
    recommendations.push('Configure CORS headers on server or use a proxy')
  }

  if (rootCause.includes('timeout')) {
    recommendations.push('Implement retry logic with exponential backoff')
  }

  if (resolved) {
    recommendations.push('Issue resolved - monitor for recurrence')
  }

  return recommendations
}

/**
 * Determine health status from summary and issues
 */
function determineHealthStatus(
  summary: { errorCount: number; networkFailureCount: number },
  issues: DetectedIssue[]
): 'healthy' | 'degraded' | 'unhealthy' {
  const criticalIssues = issues.filter(i => i.severity === 'critical').length

  if (criticalIssues > 0 || summary.errorCount > 50) {
    return 'unhealthy'
  }

  if (summary.errorCount > 10 || summary.networkFailureCount > 5 || issues.length > 0) {
    return 'degraded'
  }

  return 'healthy'
}

/**
 * Check if health status improved
 */
function isHealthImproved(before: string, after: string): boolean {
  const order = { unhealthy: 0, degraded: 1, healthy: 2 }
  return order[after as keyof typeof order] > order[before as keyof typeof order]
}

/**
 * Generate health check recommendations
 */
function generateHealthCheckRecommendations(
  healthStatus: string,
  issues: DetectedIssue[],
  fixesApplied: { successful: number; failed: number }
): string[] {
  const recommendations: string[] = []

  if (healthStatus === 'unhealthy') {
    recommendations.push('CRITICAL: Immediate attention required')
    const criticalIssues = issues.filter(i => i.severity === 'critical')
    criticalIssues.forEach(issue => {
      recommendations.push(`- ${issue.title}`)
    })
  }

  if (healthStatus === 'degraded') {
    recommendations.push('Warning: System performance is degraded')
    recommendations.push('Review detected issues and prioritize fixes')
  }

  if (fixesApplied.successful > 0) {
    recommendations.push(`${fixesApplied.successful} fixes applied - monitor for stability`)
  }

  if (fixesApplied.failed > 0) {
    recommendations.push(`${fixesApplied.failed} fixes failed - manual intervention needed`)
  }

  if (healthStatus === 'healthy') {
    recommendations.push('System is healthy - continue monitoring')
  }

  return recommendations
}

/**
 * Calculate success rate from network requests
 */
function calculateSuccessRate(requests: NetworkRequest[]): number {
  if (requests.length === 0) return 100

  const successful = requests.filter(r => r.success).length
  return (successful / requests.length) * 100
}

/**
 * Count slow endpoints
 */
function countSlowEndpoints(requests: NetworkRequest[], threshold: number): number {
  const slowRequests = requests.filter(r =>
    r.duration !== undefined && r.duration > threshold
  )

  // Group by endpoint
  const endpoints = new Set<string>()
  for (const req of slowRequests) {
    const normalized = req.url
      .replace(/\d+[a-z0-9\-]*/gi, '[ID]')
      .replace(/\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/gi, '/[UUID]')
    endpoints.add(normalized)
  }

  return endpoints.size
}

/**
 * Identify slow endpoints
 */
function identifySlowEndpoints(requests: NetworkRequest[], threshold: number): Array<{
  url: string
  avgDuration: number
  count: number
}> {
  const endpointStats = new Map<string, {
    durations: number[]
    count: number
  }>()

  for (const req of requests) {
    if (req.duration === undefined || req.duration <= threshold) continue

    const normalized = req.url
      .replace(/\d+[a-z0-9\-]*/gi, '[ID]')
      .replace(/\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/gi, '/[UUID]')

    if (!endpointStats.has(normalized)) {
      endpointStats.set(normalized, { durations: [], count: 0 })
    }

    const stats = endpointStats.get(normalized)!
    stats.durations.push(req.duration)
    stats.count++
  }

  return Array.from(endpointStats.entries())
    .map(([url, stats]) => ({
      url,
      avgDuration: stats.durations.reduce((a, b) => a + b, 0) / stats.durations.length,
      count: stats.count,
    }))
    .sort((a, b) => b.avgDuration - a.avgDuration)
    .slice(0, 5)
}

/**
 * Generate performance recommendations
 */
function generatePerformanceRecommendations(
  metrics: { avgResponseTime: number; successRate: number; slowEndpointCount: number },
  targetResponseTime: number
): string[] {
  const recommendations: string[] = []

  if (metrics.avgResponseTime > targetResponseTime) {
    recommendations.push(`Average response time (${metrics.avgResponseTime.toFixed(0)}ms) exceeds target (${targetResponseTime}ms)`)
    recommendations.push('Implement caching, optimize queries, or consider CDN')
  }

  if (metrics.successRate < 99) {
    recommendations.push(`Success rate (${metrics.successRate.toFixed(1)}%) is below target (99%)`)
    recommendations.push('Investigate and fix failing requests')
  }

  if (metrics.slowEndpointCount > 0) {
    recommendations.push(`${metrics.slowEndpointCount} slow endpoints identified`)
    recommendations.push('Profile and optimize slow endpoints')
  }

  if (metrics.avgResponseTime <= targetResponseTime && metrics.successRate >= 99) {
    recommendations.push('Performance is good - continue monitoring')
  }

  return recommendations
}

// ============================================================================
// WORKFLOW METADATA
// ============================================================================

/**
 * Metadata about inspect workflows for orchestrator routing
 */
export const inspectWorkflowsMetadata = {
  debug_and_fix_console_error: {
    name: 'debug_and_fix_console_error',
    description: 'Comprehensive workflow for debugging and fixing console errors',
    trigger: 'Console error detected or user reports errors',
    category: 'debugging',
    parameters: {
      searchQuery: {
        type: 'string',
        optional: true,
        description: 'Search query for specific error',
      },
      severity: {
        type: 'array',
        items: ['fatal', 'error', 'warning', 'info'],
        optional: true,
        default: ['fatal', 'error'],
      },
      autoFix: {
        type: 'boolean',
        optional: true,
        default: true,
      },
      maxErrors: {
        type: 'number',
        optional: true,
        default: 50,
      },
    },
    returns: 'ConsoleErrorWorkflowResult',
  },
  debug_and_fix_api_failure: {
    name: 'debug_and_fix_api_failure',
    description: 'Comprehensive workflow for debugging and fixing API failures',
    trigger: 'Network failure detected or user reports API issues',
    category: 'debugging',
    parameters: {
      searchQuery: {
        type: 'string',
        optional: true,
        description: 'Search query for specific endpoint',
      },
      statusCodes: {
        type: 'array',
        items: 'number',
        optional: true,
        description: 'HTTP status codes to analyze',
      },
      autoFix: {
        type: 'boolean',
        optional: true,
        default: true,
      },
      maxFailures: {
        type: 'number',
        optional: true,
        default: 50,
      },
    },
    returns: 'APIFailureWorkflowResult',
  },
  health_check_and_fix: {
    name: 'health_check_and_fix',
    description: 'Run health check and auto-fix detected issues',
    trigger: 'Periodic health check or user requests health status',
    category: 'monitoring',
    parameters: {
      minSeverity: {
        type: 'string',
        enum: ['critical', 'high', 'medium', 'low'],
        optional: true,
        default: 'high',
      },
      autoFix: {
        type: 'boolean',
        optional: true,
        default: true,
      },
      maxIssues: {
        type: 'number',
        optional: true,
        default: 10,
      },
    },
    returns: 'HealthCheckWorkflowResult',
  },
  performance_optimization: {
    name: 'performance_optimization',
    description: 'Analyze and optimize application performance',
    trigger: 'Slow performance detected or user reports slowness',
    category: 'optimization',
    parameters: {
      targetResponseTime: {
        type: 'number',
        optional: true,
        default: 2000,
        description: 'Target response time in ms',
      },
      applyOptimizations: {
        type: 'boolean',
        optional: true,
        default: true,
      },
    },
    returns: 'PerformanceOptimizationWorkflowResult',
  },
}

/**
 * Inspect workflows export for orchestrator
 */
export const inspectWorkflows = {
  debugAndFixConsoleError,
  debugAndFixAPIFailure,
  healthCheckAndFix,
  performanceOptimization,
}

export default inspectWorkflows