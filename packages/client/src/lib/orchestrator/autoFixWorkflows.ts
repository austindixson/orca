/**
 * Auto-fix orchestrator workflows for common console and network issues
 * Provides automated debugging and fixing capabilities without user intervention
 */

import {
  DetectedIssue,
} from '../../lib/inspect/types'
import { executeOrchestratorTool, type OrchestratorToolContext } from './executeTools'
import { useOrchestratorActivityStore } from '../../store/orchestratorActivityStore'
import { useSettingsStore } from '../../store/settingsStore'

// ============================================================================
// RESULT TYPES
// ============================================================================

export interface AutoFixResult {
  fixed: boolean
  changes: string[]
  error?: string
}

export interface BatchAutoFixResult {
  fixed: number
  failed: number
  details: Array<{
    issueId: string
    success: boolean
    changes: string[]
    error?: string
  }>
}

// ============================================================================
// CONSOLE ERROR FIXING
// ============================================================================

/**
 * Fix console errors automatically
 * @param issue - The detected issue to fix
 * @param context - Orchestrator tool context
 * @returns Auto-fix result with success status and applied changes
 */
export async function fixConsoleError(
  issue: DetectedIssue,
  context: OrchestratorToolContext
): Promise<AutoFixResult> {
  const changes: string[] = []

  try {
    // Log fix attempt
    useOrchestratorActivityStore.getState().appendActivityLine(
      `◆ Auto-fixing console error: ${issue.title}`
    )

    switch (issue.type) {
      case 'console_error': {
        // Determine specific error type from message
        const errorMsg = issue.description.toLowerCase()

        if (errorMsg.includes('syntax') && errorMsg.includes('unexpected')) {
          return await fixSyntaxError(issue, context, changes)
        }

        if (errorMsg.includes('is not defined') || errorMsg.includes('undefined')) {
          return await fixUndefinedVariable(issue, context, changes)
        }

        if (errorMsg.includes('cannot read') && errorMsg.includes('undefined')) {
          return await fixPropertyAccess(issue, context, changes)
        }

        if (errorMsg.includes('import') && (errorMsg.includes('not found') || errorMsg.includes('unexpected'))) {
          return await fixImportError(issue, context, changes)
        }

        // React-specific errors
        if (errorMsg.includes('react') || errorMsg.includes('hook') || errorMsg.includes('component')) {
          return await fixReactError(issue, context, changes)
        }

        // Generic console error - add defensive code
        return await fixGenericConsoleError(issue, context, changes)
      }

      case 'unhandled_rejection': {
        return await fixUnhandledRejection(issue, context, changes)
      }

      default: {
        return {
          fixed: false,
          changes: [],
          error: `Unknown console error type: ${issue.type}`,
        }
      }
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error)
    useOrchestratorActivityStore.getState().appendActivityLine(
      `◆ Auto-fix failed: ${errorMsg}`
    )
    return {
      fixed: false,
      changes,
      error: errorMsg,
    }
  }
}

/**
 * Fix syntax errors in code files
 */
async function fixSyntaxError(
  issue: DetectedIssue,
  context: OrchestratorToolContext,
  changes: string[]
): Promise<AutoFixResult> {
  try {
    // Extract file path from source if available
    const sourceInfo = extractSourceFile(issue)
    if (!sourceInfo.filePath) {
      return {
        fixed: false,
        changes,
        error: 'Could not determine file path for syntax error fix',
      }
    }

    // Read the file
    const readResult = await executeOrchestratorTool(
      'read_file',
      JSON.stringify({ path: sourceInfo.filePath }),
      context
    )

    if (!readResult.includes(`"ok":true`)) {
      return {
        fixed: false,
        changes,
        error: 'Failed to read file for syntax fix',
      }
    }

    // Parse file content
    const parsed = JSON.parse(readResult)
    const content = parsed.content as string

    // Apply common syntax fixes
    let fixedContent = content

    // Fix missing semicolons (common syntax error)
    fixedContent = fixedContent.replace(/^(\s+)([a-zA-Z_$][a-zA-Z0-9_$]*)\s*$/gm, '$1$2;')

    // Fix missing closing braces
    const openBraces = (fixedContent.match(/{/g) || []).length
    const closeBraces = (fixedContent.match(/}/g) || []).length
    if (openBraces > closeBraces) {
      fixedContent += '\n' + '}'.repeat(openBraces - closeBraces)
      changes.push(`Added ${openBraces - closeBraces} missing closing brace(s)`)
    }

    // Fix missing closing parentheses
    const openParens = (fixedContent.match(/\(/g) || []).length
    const closeParens = (fixedContent.match(/\)/g) || []).length
    if (openParens > closeParens) {
      fixedContent += ')'.repeat(openParens - closeParens)
      changes.push(`Added ${openParens - closeParens} missing closing parenthes(es)`)
    }

    // Write the fixed content
    const writeResult = await executeOrchestratorTool(
      'write_file',
      JSON.stringify({
        path: sourceInfo.filePath,
        content: fixedContent,
      }),
      context
    )

    if (writeResult.includes('\"ok\":true')) {
      changes.push(`Fixed syntax errors in ${sourceInfo.filePath}`)
      return { fixed: true, changes }
    }

    return {
      fixed: false,
      changes,
      error: 'Failed to write syntax fixes',
    }
  } catch (error) {
    return {
      fixed: false,
      changes,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

/**
 * Fix undefined variable references
 */
async function fixUndefinedVariable(
  issue: DetectedIssue,
  context: OrchestratorToolContext,
  changes: string[]
): Promise<AutoFixResult> {
  try {
    const sourceInfo = extractSourceFile(issue)
    if (!sourceInfo.filePath) {
      return {
        fixed: false,
        changes,
        error: 'Could not determine file path for undefined variable fix',
      }
    }

    const readResult = await executeOrchestratorTool(
      'read_file',
      JSON.stringify({ path: sourceInfo.filePath }),
      context
    )

    if (!readResult.includes(`"ok":true`)) {
      return {
        fixed: false,
        changes,
        error: 'Failed to read file for undefined variable fix',
      }
    }

    const parsed = JSON.parse(readResult)
    const content = parsed.content as string

    // Extract variable name from error message
    const varMatch = issue.description.match(/([a-zA-Z_$][a-zA-Z0-9_$]*) is not defined/)
    if (!varMatch) {
      return {
        fixed: false,
        changes,
        error: 'Could not extract variable name from error message',
      }
    }

    const varName = varMatch[1]
    let fixedContent = content

    // Check if it's a common misspelling of built-in globals
    const commonGlobals: Record<string, string> = {
      'console': 'console',
      'document': 'document',
      'window': 'window',
      'process': 'process',
      'require': 'require',
      'module': 'module',
      'exports': 'exports',
      'undefined': 'undefined',
      'NaN': 'NaN',
      'Infinity': 'Infinity',
    }

    if (commonGlobals[varName.toLowerCase()]) {
      // Fix capitalization
      const correctName = commonGlobals[varName.toLowerCase()]
      const regex = new RegExp(`\\b${varName}\\b`, 'g')
      fixedContent = fixedContent.replace(regex, correctName)
      changes.push(`Fixed capitalization of ${varName} to ${correctName}`)
    } else {
      // Add defensive check before variable usage
      const defensivePattern = new RegExp(`(\\b${varName}\\b)`, 'g')
      fixedContent = fixedContent.replace(
        defensivePattern,
        `(${varName} ?? undefined)`
      )
      changes.push(`Added defensive null check for ${varName}`)
    }

    const writeResult = await executeOrchestratorTool(
      'write_file',
      JSON.stringify({
        path: sourceInfo.filePath,
        content: fixedContent,
      }),
      context
    )

    if (writeResult.includes('\"ok\":true')) {
      return { fixed: true, changes }
    }

    return {
      fixed: false,
      changes,
      error: 'Failed to write undefined variable fixes',
    }
  } catch (error) {
    return {
      fixed: false,
      changes,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

/**
 * Fix property access errors on undefined objects
 */
async function fixPropertyAccess(
  issue: DetectedIssue,
  context: OrchestratorToolContext,
  changes: string[]
): Promise<AutoFixResult> {
  try {
    const sourceInfo = extractSourceFile(issue)
    if (!sourceInfo.filePath) {
      return {
        fixed: false,
        changes,
        error: 'Could not determine file path for property access fix',
      }
    }

    const readResult = await executeOrchestratorTool(
      'read_file',
      JSON.stringify({ path: sourceInfo.filePath }),
      context
    )

    if (!readResult.includes(`"ok":true`)) {
      return {
        fixed: false,
        changes,
        error: 'Failed to read file for property access fix',
      }
    }

    const parsed = JSON.parse(readResult)
    const content = parsed.content as string

    // Extract property chain from error message
    const propMatch = issue.description.match(/Cannot read properties of (undefined|null) \(reading '([^']+)'\)/)
    if (!propMatch) {
      return {
        fixed: false,
        changes,
        error: 'Could not extract property name from error message',
      }
    }

    const propName = propMatch[2]
    let fixedContent = content

    // Add optional chaining for the problematic property
    // This is a simple heuristic - in production, you'd want AST-based fixing
    const regex = new RegExp(`([a-zA-Z_$][a-zA-Z0-9_$]*)\\.${propName}`, 'g')
    const matches = content.match(regex)

    if (matches && matches.length > 0) {
      fixedContent = fixedContent.replace(regex, `$1?.${propName}`)
      changes.push(`Added optional chaining for property access '.${propName}'`)
    }

    const writeResult = await executeOrchestratorTool(
      'write_file',
      JSON.stringify({
        path: sourceInfo.filePath,
        content: fixedContent,
      }),
      context
    )

    if (writeResult.includes('\"ok\":true')) {
      return { fixed: true, changes }
    }

    return {
      fixed: false,
      changes,
      error: 'Failed to write property access fixes',
    }
  } catch (error) {
    return {
      fixed: false,
      changes,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

/**
 * Fix import/export errors
 */
async function fixImportError(
  issue: DetectedIssue,
  context: OrchestratorToolContext,
  changes: string[]
): Promise<AutoFixResult> {
  try {
    const sourceInfo = extractSourceFile(issue)
    if (!sourceInfo.filePath) {
      return {
        fixed: false,
        changes,
        error: 'Could not determine file path for import error fix',
      }
    }

    const readResult = await executeOrchestratorTool(
      'read_file',
      JSON.stringify({ path: sourceInfo.filePath }),
      context
    )

    if (!readResult.includes(`"ok":true`)) {
      return {
        fixed: false,
        changes,
        error: 'Failed to read file for import error fix',
      }
    }

    const parsed = JSON.parse(readResult)
    const content = parsed.content as string

    // Extract import path from error message
    const importMatch = issue.description.match(/from '([^']+)'/)
    if (!importMatch) {
      return {
        fixed: false,
        changes,
        error: 'Could not extract import path from error message',
      }
    }

    const importPath = importMatch[1]
    let fixedContent = content

    // Try to fix common import path issues
    if (importPath.startsWith('./') || importPath.startsWith('../')) {
      // Relative import - might need file extension
      if (!importPath.includes('.')) {
        const newImportPath = `${importPath}.js`
        fixedContent = fixedContent.replace(
          new RegExp(`from '${importPath.replace('/', '[/\\\\]')}'`, 'g'),
          `from '${newImportPath}'`
        )
        changes.push(`Added .js extension to import: ${importPath} -> ${newImportPath}`)
      }
    }

    const writeResult = await executeOrchestratorTool(
      'write_file',
      JSON.stringify({
        path: sourceInfo.filePath,
        content: fixedContent,
      }),
      context
    )

    if (writeResult.includes('\"ok\":true')) {
      return { fixed: true, changes }
    }

    return {
      fixed: false,
      changes,
      error: 'Failed to write import fixes',
    }
  } catch (error) {
    return {
      fixed: false,
      changes,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

/**
 * Fix React-specific errors (hooks, components, props)
 */
async function fixReactError(
  issue: DetectedIssue,
  context: OrchestratorToolContext,
  changes: string[]
): Promise<AutoFixResult> {
  try {
    const errorMsg = issue.description.toLowerCase()
    const sourceInfo = extractSourceFile(issue)

    if (!sourceInfo.filePath) {
      return {
        fixed: false,
        changes,
        error: 'Could not determine file path for React error fix',
      }
    }

    const readResult = await executeOrchestratorTool(
      'read_file',
      JSON.stringify({ path: sourceInfo.filePath }),
      context
    )

    if (!readResult.includes(`"ok":true`)) {
      return {
        fixed: false,
        changes,
        error: 'Failed to read file for React error fix',
      }
    }

    const parsed = JSON.parse(readResult)
    let content = parsed.content as string

    // Fix React Hook rules violations
    if (errorMsg.includes('hook') && errorMsg.includes('condition')) {
      // Move hooks outside conditional blocks
      changes.push('Detected React hooks rule violation - manual review needed')
      return {
        fixed: false,
        changes,
        error: 'React hooks violations require manual review',
      }
    }

    // Fix missing prop-types
    if (errorMsg.includes('prop')) {
      changes.push('Detected prop-type error - manual review needed')
      return {
        fixed: false,
        changes,
        error: 'Prop-type errors require manual review',
      }
    }

    // Fix missing key prop in lists
    if (errorMsg.includes('key')) {
      // Add key prop to map functions
      const mapPattern = /\.map\(([^)]+)\)\s*=>\s*<([a-zA-Z][a-zA-Z0-9]*)/g
      content = content.replace(
        mapPattern,
        '.map(($1, index) => <$2 key={"key-" + ($1.id || index)}'
      )
      changes.push('Added key prop to list rendering')
    }

    const writeResult = await executeOrchestratorTool(
      'write_file',
      JSON.stringify({
        path: sourceInfo.filePath,
        content,
      }),
      context
    )

    if (writeResult.includes('\"ok\":true')) {
      return { fixed: true, changes }
    }

    return {
      fixed: false,
      changes,
      error: 'Failed to write React fixes',
    }
  } catch (error) {
    return {
      fixed: false,
      changes,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

/**
 * Fix generic console errors with defensive programming
 */
async function fixGenericConsoleError(
  _issue: DetectedIssue,
  _context: OrchestratorToolContext,
  changes: string[]
): Promise<AutoFixResult> {
  changes.push('Generic console error - requires manual review')
  return {
    fixed: false,
    changes,
    error: 'Generic errors require manual review',
  }
}

/**
 * Fix unhandled promise rejections
 */
async function fixUnhandledRejection(
  issue: DetectedIssue,
  context: OrchestratorToolContext,
  changes: string[]
): Promise<AutoFixResult> {
  try {
    const sourceInfo = extractSourceFile(issue)
    if (!sourceInfo.filePath) {
      return {
        fixed: false,
        changes,
        error: 'Could not determine file path for unhandled rejection fix',
      }
    }

    const readResult = await executeOrchestratorTool(
      'read_file',
      JSON.stringify({ path: sourceInfo.filePath }),
      context
    )

    if (!readResult.includes(`"ok":true`)) {
      return {
        fixed: false,
        changes,
        error: 'Failed to read file for unhandled rejection fix',
      }
    }

    const parsed = JSON.parse(readResult)
    let content = parsed.content as string

    // Add catch blocks to promise chains without them
    const promisePattern = /\.then\(([^)]+)\)\s*(?!\.catch)/g
    const matches = content.match(promisePattern)

    if (matches && matches.length > 0) {
      content = content.replace(
        promisePattern,
        '.then($1).catch((error) => { console.error("Unhandled promise rejection:", error); })'
      )
      changes.push(`Added catch blocks to ${matches.length} promise chain(s)`)
    }

    const writeResult = await executeOrchestratorTool(
      'write_file',
      JSON.stringify({
        path: sourceInfo.filePath,
        content,
      }),
      context
    )

    if (writeResult.includes('\"ok\":true')) {
      return { fixed: true, changes }
    }

    return {
      fixed: false,
      changes,
      error: 'Failed to write unhandled rejection fixes',
    }
  } catch (error) {
    return {
      fixed: false,
      changes,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

// ============================================================================
// NETWORK ERROR FIXING
// ============================================================================

/**
 * Fix network failures automatically
 * @param issue - The detected issue to fix
 * @param context - Orchestrator tool context
 * @returns Auto-fix result with success status and applied changes
 */
export async function fixNetworkFailure(
  issue: DetectedIssue,
  context: OrchestratorToolContext
): Promise<AutoFixResult> {
  const changes: string[] = []

  try {
    useOrchestratorActivityStore.getState().appendActivityLine(
      `◆ Auto-fixing network failure: ${issue.title}`
    )

    // Extract status code from issue description if available
    const statusMatch = issue.description.match(/status (\d{3})/)
    const statusCode = statusMatch ? parseInt(statusMatch[1], 10) : 0

    if (statusCode === 401 || statusCode === 403) {
      return await fixAuthError(issue, context, changes)
    }

    if (statusCode === 404) {
      return await fixNotFoundError(issue, context, changes)
    }

    if (statusCode >= 500) {
      return await fixServerError(issue, context, changes)
    }

    if (issue.description.toLowerCase().includes('cors')) {
      return await fixCORSError(issue, context, changes)
    }

    if (issue.description.toLowerCase().includes('timeout')) {
      return await fixTimeoutError(issue, context, changes)
    }

    // Generic network failure
    return {
      fixed: false,
      changes,
      error: 'Unknown network failure type',
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error)
    useOrchestratorActivityStore.getState().appendActivityLine(
      `◆ Auto-fix failed: ${errorMsg}`
    )
    return {
      fixed: false,
      changes,
      error: errorMsg,
    }
  }
}

/**
 * Fix authentication errors (401, 403)
 */
async function fixAuthError(
  _issue: DetectedIssue,
  _context: OrchestratorToolContext,
  changes: string[]
): Promise<AutoFixResult> {
  changes.push('Authentication error - check API keys and auth tokens')
  return {
    fixed: false,
    changes,
    error: 'Authentication errors require manual credential check',
  }
}

/**
 * Fix not found errors (404)
 */
async function fixNotFoundError(
  issue: DetectedIssue,
  context: OrchestratorToolContext,
  changes: string[]
): Promise<AutoFixResult> {
  try {
    const sourceInfo = extractSourceFile(issue)
    if (!sourceInfo.filePath) {
      return {
        fixed: false,
        changes,
        error: 'Could not determine file path for 404 fix',
      }
    }

    const readResult = await executeOrchestratorTool(
      'read_file',
      JSON.stringify({ path: sourceInfo.filePath }),
      context
    )

    if (!readResult.includes(`"ok":true`)) {
      return {
        fixed: false,
        changes,
        error: 'Failed to read file for 404 fix',
      }
    }

    const parsed = JSON.parse(readResult)
    let content = parsed.content as string

    // Extract URL from issue description
    const urlMatch = issue.description.match(/https?:\/\/[^\s]+/)
    if (!urlMatch) {
      return {
        fixed: false,
        changes,
        error: 'Could not extract URL from error message',
      }
    }

    const url = urlMatch[0]

    // Try to fix common URL issues
    let fixedUrl = url

    // Fix trailing slash issues
    if (fixedUrl.endsWith('/') && !fixedUrl.endsWith('//')) {
      fixedUrl = fixedUrl.slice(0, -1)
      changes.push('Removed trailing slash from URL')
    }

    // Fix double slashes in path
    fixedUrl = fixedUrl.replace(/([^:])\/\//g, '$1/')
    if (fixedUrl !== url) {
      changes.push('Fixed double slashes in URL')
    }

    // Replace the URL in the file
    content = content.replace(url, fixedUrl)

    const writeResult = await executeOrchestratorTool(
      'write_file',
      JSON.stringify({
        path: sourceInfo.filePath,
        content,
      }),
      context
    )

    if (writeResult.includes('\"ok\":true')) {
      return { fixed: true, changes }
    }

    return {
      fixed: false,
      changes,
      error: 'Failed to write URL fixes',
    }
  } catch (error) {
    return {
      fixed: false,
      changes,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

/**
 * Fix server errors (5xx) with retry logic
 */
async function fixServerError(
  issue: DetectedIssue,
  context: OrchestratorToolContext,
  changes: string[]
): Promise<AutoFixResult> {
  try {
    const sourceInfo = extractSourceFile(issue)
    if (!sourceInfo.filePath) {
      return {
        fixed: false,
        changes,
        error: 'Could not determine file path for server error fix',
      }
    }

    const readResult = await executeOrchestratorTool(
      'read_file',
      JSON.stringify({ path: sourceInfo.filePath }),
      context
    )

    if (!readResult.includes(`"ok":true`)) {
      return {
        fixed: false,
        changes,
        error: 'Failed to read file for server error fix',
      }
    }

    const parsed = JSON.parse(readResult)
    let content = parsed.content as string

    // Add retry logic for fetch calls
    const fetchPattern = /fetch\s*\(\s*([^)]+)\)/g
    const matches = content.match(fetchPattern)

    if (matches && matches.length > 0) {
      const retryWrapper = `
// Auto-added retry logic for server errors
async function fetchWithRetry(url, options = {}, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetch(url, options);
      if (response.ok || response.status < 500) {
        return response;
      }
      if (i < retries - 1) {
        await new Promise(resolve => setTimeout(resolve, Math.pow(2, i) * 1000));
      }
    } catch (error) {
      if (i === retries - 1) throw error;
    }
  }
  throw new Error('Max retries reached');
}
`

      // Insert retry function at the top of the file
      content = retryWrapper + '\n\n' + content

      // Replace fetch calls with retry wrapper
      content = content.replace(fetchPattern, 'fetchWithRetry($1)')

      changes.push(`Added retry logic for ${matches.length} fetch call(s)`)
    }

    const writeResult = await executeOrchestratorTool(
      'write_file',
      JSON.stringify({
        path: sourceInfo.filePath,
        content,
      }),
      context
    )

    if (writeResult.includes('\"ok\":true')) {
      return { fixed: true, changes }
    }

    return {
      fixed: false,
      changes,
      error: 'Failed to write server error fixes',
    }
  } catch (error) {
    return {
      fixed: false,
      changes,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

/**
 * Fix CORS errors
 */
async function fixCORSError(
  _issue: DetectedIssue,
  _context: OrchestratorToolContext,
  changes: string[]
): Promise<AutoFixResult> {
  changes.push('CORS error - add CORS headers or use a proxy')
  return {
    fixed: false,
    changes,
    error: 'CORS errors require server-side configuration or proxy setup',
  }
}

/**
 * Fix timeout errors
 */
async function fixTimeoutError(
  issue: DetectedIssue,
  context: OrchestratorToolContext,
  changes: string[]
): Promise<AutoFixResult> {
  try {
    const sourceInfo = extractSourceFile(issue)
    if (!sourceInfo.filePath) {
      return {
        fixed: false,
        changes,
        error: 'Could not determine file path for timeout fix',
      }
    }

    const readResult = await executeOrchestratorTool(
      'read_file',
      JSON.stringify({ path: sourceInfo.filePath }),
      context
    )

    if (!readResult.includes(`"ok":true`)) {
      return {
        fixed: false,
        changes,
        error: 'Failed to read file for timeout fix',
      }
    }

    const parsed = JSON.parse(readResult)
    let content = parsed.content as string

    // Add timeout to fetch calls
    const fetchPattern = /fetch\s*\(\s*([^)]+)\)/g
    const matches = content.match(fetchPattern)

    if (matches && matches.length > 0) {
      // Add timeout wrapper
      const timeoutWrapper = `
// Auto-added timeout logic
async function fetchWithTimeout(url, options = {}, timeout = 30000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
}
`

      content = timeoutWrapper + '\n\n' + content
      content = content.replace(fetchPattern, 'fetchWithTimeout($1)')

      changes.push(`Added timeout handling to ${matches.length} fetch call(s)`)
    }

    const writeResult = await executeOrchestratorTool(
      'write_file',
      JSON.stringify({
        path: sourceInfo.filePath,
        content,
      }),
      context
    )

    if (writeResult.includes("ok")) {
      return { fixed: true, changes }
    }

    return {
      fixed: false,
      changes,
      error: 'Failed to write timeout fixes',
    }
  } catch (error) {
    return {
      fixed: false,
      changes,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

// ============================================================================
// API ERROR FIXING
// ============================================================================

/**
 * Fix API-specific issues (429, 400, malformed responses)
 * @param issue - The detected issue to fix
 * @param context - Orchestrator tool context
 * @returns Auto-fix result with success status and applied changes
 */
export async function fixAPIError(
  issue: DetectedIssue,
  context: OrchestratorToolContext
): Promise<AutoFixResult> {
  const changes: string[] = []

  try {
    useOrchestratorActivityStore.getState().appendActivityLine(
      `◆ Auto-fixing API error: ${issue.title}`
    )

    if (issue.description.includes('429') || issue.description.toLowerCase().includes('rate limit')) {
      return await fixRateLimitError(issue, context, changes)
    }

    if (issue.description.includes('400') || issue.description.toLowerCase().includes('bad request')) {
      return await fixBadRequestError(issue, context, changes)
    }

    if (issue.description.toLowerCase().includes('malformed') || issue.description.toLowerCase().includes('parse')) {
      return await fixMalformedResponse(issue, context, changes)
    }

    return {
      fixed: false,
      changes,
      error: 'Unknown API error type',
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error)
    useOrchestratorActivityStore.getState().appendActivityLine(
      `◆ Auto-fix failed: ${errorMsg}`
    )
    return {
      fixed: false,
      changes,
      error: errorMsg,
    }
  }
}

/**
 * Fix rate limit errors (429) with exponential backoff
 */
async function fixRateLimitError(
  issue: DetectedIssue,
  context: OrchestratorToolContext,
  changes: string[]
): Promise<AutoFixResult> {
  try {
    const sourceInfo = extractSourceFile(issue)
    if (!sourceInfo.filePath) {
      return {
        fixed: false,
        changes,
        error: 'Could not determine file path for rate limit fix',
      }
    }

    const readResult = await executeOrchestratorTool(
      'read_file',
      JSON.stringify({ path: sourceInfo.filePath }),
      context
    )

    if (!readResult.includes(`"ok":true`)) {
      return {
        fixed: false,
        changes,
        error: 'Failed to read file for rate limit fix',
      }
    }

    const parsed = JSON.parse(readResult)
    let content = parsed.content as string

    // Add exponential backoff logic
    const backoffWrapper = `
// Auto-added exponential backoff for rate limiting
async function fetchWithBackoff(url, options = {}, maxRetries = 5) {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const response = await fetch(url, options);
      if (response.status === 429) {
        const retryAfter = response.headers.get('Retry-After');
        const delay = retryAfter ? parseInt(retryAfter) * 1000 : Math.pow(2, attempt) * 1000;
        if (attempt < maxRetries - 1) {
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }
      }
      return response;
    } catch (error) {
      if (attempt === maxRetries - 1) throw error;
      await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000));
    }
  }
  throw new Error('Max retries reached with backoff');
}
`

    content = backoffWrapper + '\n\n' + content
    const fetchPattern = /fetch\s*\(\s*([^)]+)\)/g
    content = content.replace(fetchPattern, 'fetchWithBackoff($1)')

    changes.push('Added exponential backoff for rate limiting')

    const writeResult = await executeOrchestratorTool(
      'write_file',
      JSON.stringify({
        path: sourceInfo.filePath,
        content,
      }),
      context
    )

    if (writeResult.includes('\"ok\":true')) {
      return { fixed: true, changes }
    }

    return {
      fixed: false,
      changes,
      error: 'Failed to write rate limit fixes',
    }
  } catch (error) {
    return {
      fixed: false,
      changes,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

/**
 * Fix bad request errors (400) with validation
 */
async function fixBadRequestError(
  _issue: DetectedIssue,
  _context: OrchestratorToolContext,
  changes: string[]
): Promise<AutoFixResult> {
  changes.push('Bad request error - validate request body and parameters')
  return {
    fixed: false,
    changes,
    error: 'Bad request errors require manual request validation',
  }
}

/**
 * Fix malformed response errors
 */
async function fixMalformedResponse(
  issue: DetectedIssue,
  context: OrchestratorToolContext,
  changes: string[]
): Promise<AutoFixResult> {
  try {
    const sourceInfo = extractSourceFile(issue)
    if (!sourceInfo.filePath) {
      return {
        fixed: false,
        changes,
        error: 'Could not determine file path for malformed response fix',
      }
    }

    const readResult = await executeOrchestratorTool(
      'read_file',
      JSON.stringify({ path: sourceInfo.filePath }),
      context
    )

    if (!readResult.includes(`"ok":true`)) {
      return {
        fixed: false,
        changes,
        error: 'Failed to read file for malformed response fix',
      }
    }

    const parsed = JSON.parse(readResult)
    let content = parsed.content as string

    // Add response validation
    const validationWrapper = `
// Auto-added response validation
async function fetchWithValidation(url, options = {}) {
  const response = await fetch(url, options);
  if (!response.ok) {
    throw new Error(\`HTTP \${response.status}: \${response.statusText}\`);
  }
  const contentType = response.headers.get('content-type');
  if (contentType && contentType.includes('application/json')) {
    try {
      const data = await response.json();
      return { ...response, data };
    } catch (error) {
      console.error('Failed to parse JSON response:', error);
      throw new Error('Invalid JSON response');
    }
  }
  return response;
}
`

    content = validationWrapper + '\n\n' + content
    const fetchPattern = /fetch\s*\(\s*([^)]+)\)/g
    content = content.replace(fetchPattern, 'fetchWithValidation($1)')

    changes.push('Added response validation')

    const writeResult = await executeOrchestratorTool(
      'write_file',
      JSON.stringify({
        path: sourceInfo.filePath,
        content,
      }),
      context
    )

    if (writeResult.includes('\"ok\":true')) {
      return { fixed: true, changes }
    }

    return {
      fixed: false,
      changes,
      error: 'Failed to write response validation fixes',
    }
  } catch (error) {
    return {
      fixed: false,
      changes,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

// ============================================================================
// PERFORMANCE ISSUE FIXING
// ============================================================================

/**
 * Fix performance problems
 * @param issue - The detected issue to fix
 * @param context - Orchestrator tool context
 * @returns Auto-fix result with success status and applied changes
 */
export async function fixPerformanceIssue(
  issue: DetectedIssue,
  context: OrchestratorToolContext
): Promise<AutoFixResult> {
  const changes: string[] = []

  try {
    useOrchestratorActivityStore.getState().appendActivityLine(
      `◆ Auto-fixing performance issue: ${issue.title}`
    )

    if (issue.description.toLowerCase().includes('slow') || issue.description.toLowerCase().includes('latency')) {
      return await fixSlowRequest(issue, context, changes)
    }

    if (issue.description.toLowerCase().includes('large') || issue.description.toLowerCase().includes('size')) {
      return await fixLargePayload(issue, context, changes)
    }

    if (issue.description.toLowerCase().includes('memory') || issue.description.toLowerCase().includes('leak')) {
      return await fixMemoryLeak(issue, context, changes)
    }

    return {
      fixed: false,
      changes,
      error: 'Unknown performance issue type',
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error)
    useOrchestratorActivityStore.getState().appendActivityLine(
      `◆ Auto-fix failed: ${errorMsg}`
    )
    return {
      fixed: false,
      changes,
      error: errorMsg,
    }
  }
}

/**
 * Fix slow requests with caching
 */
async function fixSlowRequest(
  issue: DetectedIssue,
  context: OrchestratorToolContext,
  changes: string[]
): Promise<AutoFixResult> {
  try {
    const sourceInfo = extractSourceFile(issue)
    if (!sourceInfo.filePath) {
      return {
        fixed: false,
        changes,
        error: 'Could not determine file path for slow request fix',
      }
    }

    const readResult = await executeOrchestratorTool(
      'read_file',
      JSON.stringify({ path: sourceInfo.filePath }),
      context
    )

    if (!readResult.includes(`"ok":true`)) {
      return {
        fixed: false,
        changes,
        error: 'Failed to read file for slow request fix',
      }
    }

    const parsed = JSON.parse(readResult)
    let content = parsed.content as string

    // Add simple caching
    const cacheWrapper = `
// Auto-added request caching
const cache = new Map();
async function fetchWithCache(url, options = {}, cacheDuration = 60000) {
  const cacheKey = url + JSON.stringify(options);
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < cacheDuration) {
    return cached.data;
  }
  const response = await fetch(url, options);
  const data = await response.json();
  cache.set(cacheKey, { timestamp: Date.now(), data });
  return data;
}
`

    content = cacheWrapper + '\n\n' + content
    const fetchPattern = /fetch\s*\(\s*([^)]+)\)/g
    content = content.replace(fetchPattern, 'fetchWithCache($1)')

    changes.push('Added request caching to improve performance')

    const writeResult = await executeOrchestratorTool(
      'write_file',
      JSON.stringify({
        path: sourceInfo.filePath,
        content,
      }),
      context
    )

    if (writeResult.includes('\"ok\":true')) {
      return { fixed: true, changes }
    }

    return {
      fixed: false,
      changes,
      error: 'Failed to write caching fixes',
    }
  } catch (error) {
    return {
      fixed: false,
      changes,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

/**
 * Fix large payload issues
 */
async function fixLargePayload(
  _issue: DetectedIssue,
  _context: OrchestratorToolContext,
  changes: string[]
): Promise<AutoFixResult> {
  changes.push('Large payload detected - consider pagination or compression')
  return {
    fixed: false,
    changes,
    error: 'Large payload issues require manual optimization',
  }
}

/**
 * Fix memory leaks
 */
async function fixMemoryLeak(
  issue: DetectedIssue,
  context: OrchestratorToolContext,
  changes: string[]
): Promise<AutoFixResult> {
  try {
    const sourceInfo = extractSourceFile(issue)
    if (!sourceInfo.filePath) {
      return {
        fixed: false,
        changes,
        error: 'Could not determine file path for memory leak fix',
      }
    }

    const readResult = await executeOrchestratorTool(
      'read_file',
      JSON.stringify({ path: sourceInfo.filePath }),
      context
    )

    if (!readResult.includes(`"ok":true`)) {
      return {
        fixed: false,
        changes,
        error: 'Failed to read file for memory leak fix',
      }
    }

    const parsed = JSON.parse(readResult)
    let content = parsed.content as string

    // Add event listener cleanup helpers
    const cleanupWrapper = `
// Auto-added event listener cleanup helpers
const eventListeners = new Map();
function addEventListenerWithCleanup(element, event, handler) {
  element.addEventListener(event, handler);
  const listeners = eventListeners.get(element) || [];
  listeners.push({ event, handler });
  eventListeners.set(element, listeners);
}
function removeEventListeners(element) {
  const listeners = eventListeners.get(element);
  if (listeners) {
    listeners.forEach(({ event, handler }) => {
      element.removeEventListener(event, handler);
    });
    eventListeners.delete(element);
  }
}
`

    content = cleanupWrapper + '\n\n' + content

    changes.push('Added event listener cleanup helpers to prevent memory leaks')

    const writeResult = await executeOrchestratorTool(
      'write_file',
      JSON.stringify({
        path: sourceInfo.filePath,
        content,
      }),
      context
    )

    if (writeResult.includes('\"ok\":true')) {
      return { fixed: true, changes }
    }

    return {
      fixed: false,
      changes,
      error: 'Failed to write memory leak fixes',
    }
  } catch (error) {
    return {
      fixed: false,
      changes,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

// ============================================================================
// MAIN WORKFLOW ROUTER
// ============================================================================

/**
 * Main workflow router that routes to appropriate fix function
 * @param issue - The detected issue to fix
 * @param context - Orchestrator tool context
 * @returns Auto-fix result with success status and applied changes
 */
export async function runAutoFix(
  issue: DetectedIssue,
  context: OrchestratorToolContext
): Promise<{ success: boolean; message: string; changes: string[] }> {
  try {
    const gate = useSettingsStore.getState().harnessAutoFixGate !== false
    // Validate canAutoFix flag
    if (gate && !issue.canAutoFix) {
      useOrchestratorActivityStore.getState().appendActivityLine(
        `◆ Skipping ${issue.id}: cannot be auto-fixed`
      )
      return {
        success: false,
        message: 'Issue cannot be automatically fixed',
        changes: [],
      }
    }

    // Route to appropriate fix function based on issue type
    let result: AutoFixResult

    switch (issue.type) {
      case 'console_error':
      case 'unhandled_rejection':
        result = await fixConsoleError(issue, context)
        break

      case 'network_failure':
        result = await fixNetworkFailure(issue, context)
        break

      case 'api_error':
        result = await fixAPIError(issue, context)
        break

      case 'cors_error':
        result = await fixCORSError(issue, context, [])
        break

      case 'timeout':
        result = await fixTimeoutError(issue, context, [])
        break

      case 'performance':
        result = await fixPerformanceIssue(issue, context)
        break

      case 'memory_leak':
        result = await fixMemoryLeak(issue, context, [])
        break

      default:
        result = {
          fixed: false,
          changes: [],
          error: `Unknown issue type: ${issue.type}`,
        }
    }

    // Log result to orchestrator activity
    if (result.fixed) {
      useOrchestratorActivityStore.getState().appendActivityLine(
        `◆ Auto-fix successful: ${issue.title}`
      )
      useOrchestratorActivityStore.getState().appendActivityLine(
        `  Changes: ${result.changes.join(', ')}`
      )
    } else {
      useOrchestratorActivityStore.getState().appendActivityLine(
        `◆ Auto-fix failed: ${result.error || 'Unknown error'}`
      )
    }

    return {
      success: result.fixed,
      message: result.fixed ? 'Issue fixed successfully' : result.error || 'Fix failed',
      changes: result.changes,
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error)
    useOrchestratorActivityStore.getState().appendActivityLine(
      `◆ Auto-fix error: ${errorMsg}`
    )
    return {
      success: false,
      message: errorMsg,
      changes: [],
    }
  }
}

// ============================================================================
// BATCH FIXING
// ============================================================================

/**
 * Fix multiple issues in batch with priority handling
 * @param issues - Array of detected issues to fix
 * @param context - Orchestrator tool context
 * @returns Batch fix result with counts and details
 */
export async function runAutoFixBatch(
  issues: DetectedIssue[],
  context: OrchestratorToolContext
): Promise<BatchAutoFixResult> {
  const details: BatchAutoFixResult['details'] = []
  let fixed = 0
  let failed = 0

  useOrchestratorActivityStore.getState().appendActivityLine(
    `◆ Starting batch auto-fix for ${issues.length} issues`
  )

  // Sort issues by severity (critical first)
  const severityOrder = { critical: 0, high: 1, medium: 2, low: 3 }
  const sortedIssues = [...issues].sort((a, b) => {
    return severityOrder[a.severity] - severityOrder[b.severity]
  })

  const gate = useSettingsStore.getState().harnessAutoFixGate !== false
  // Fix issues one by one (handling dependencies would require more complex logic)
  for (const issue of sortedIssues) {
    if (gate && !issue.canAutoFix) {
      details.push({
        issueId: issue.id,
        success: false,
        changes: [],
        error: 'Cannot be auto-fixed',
      })
      failed++
      continue
    }

    try {
      const result = await runAutoFix(issue, context)
      details.push({
        issueId: issue.id,
        success: result.success,
        changes: result.changes,
        error: result.success ? undefined : result.message,
      })

      if (result.success) {
        fixed++
      } else {
        failed++
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error)
      details.push({
        issueId: issue.id,
        success: false,
        changes: [],
        error: errorMsg,
      })
      failed++
    }
  }

  useOrchestratorActivityStore.getState().appendActivityLine(
    `◆ Batch auto-fix complete: ${fixed} fixed, ${failed} failed`
  )

  return {
    fixed,
    failed,
    details,
  }
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Extract source file information from a detected issue
 */
interface SourceFileInfo {
  filePath: string | null
  lineNumber: number | null
}

function extractSourceFile(issue: DetectedIssue): SourceFileInfo {
  let filePath: string | null = null
  let lineNumber: number | null = null

  // Try to extract file path from description
  const pathMatch = issue.description.match(/at (.+?):(\d+):\d+/)
  if (pathMatch) {
    filePath = pathMatch[1]
    lineNumber = parseInt(pathMatch[2], 10)
  }

  // Try alternate pattern
  if (!filePath) {
    const altMatch = issue.description.match(/([\/\w\-_.]+\.[\w]+):(\d+)/)
    if (altMatch) {
      filePath = altMatch[1]
      lineNumber = parseInt(altMatch[2], 10)
    }
  }

  return { filePath, lineNumber }
}

// ============================================================================
// TOOL REGISTRATION
// ============================================================================

/**
 * Tool metadata for orchestrator routing matrix
 * Describes the auto-fix tool for automated issue resolution
 */
export const autoFixToolMetadata = {
  category: 'auto-fix' as const,
  tools: {
    run_auto_fix: {
      description: 'Automatically fix detected issues without user intervention. Routes to appropriate fix function based on issue type.',
      parameters: {
        issue_id: {
          type: 'string',
          required: true,
          description: 'ID of the detected issue to fix',
        },
      },
      returns: '{ success: boolean, message: string, changes: string[] }',
    },
    run_auto_fix_batch: {
      description: 'Fix multiple issues in batch with priority handling (critical first). Returns counts and detailed results.',
      parameters: {
        issue_ids: {
          type: 'array',
          items: 'string',
          required: true,
          description: 'Array of issue IDs to fix in batch',
        },
      },
      returns: '{ fixed: number, failed: number, details: Array<{issueId, success, changes, error}> }',
    },
  },
}

/**
 * Auto-fix orchestrator tools export
 * Provides easy integration with orchestrator routing system
 */
export const autoFixTools = {
  runAutoFix,
  runAutoFixBatch,
}

export default autoFixTools
