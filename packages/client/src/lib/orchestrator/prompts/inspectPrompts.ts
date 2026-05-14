/**
 * Orchestrator prompts for inspect module integration
 * Provides system prompt additions and few-shot examples for effective inspect tool usage
 */

// ============================================================================
// SYSTEM PROMPT ADDITIONS
// ============================================================================

/**
 * System prompt additions for inspect module capabilities
 * Add this to the main orchestrator system prompt to enable inspect tool usage
 */
export const INSPECT_SYSTEM_PROMPT_ADDITIONS = `
## Automated Debugging with Inspect Tools

You have access to powerful automated debugging tools that monitor console errors, network failures, and performance issues in real-time. Use these tools proactively when:

1. **Errors are detected**: The user reports errors, or you see errors in console/network output
2. **Performance issues**: Slow page loads, API timeouts, or sluggish UI
3. **API failures**: 4xx/5xx errors, CORS issues, authentication problems
4. **Proactive monitoring**: Before deploying changes, after feature completion

### Available Inspect Tools

#### Diagnostic Tools
- **getConsoleErrors({level, limit, since})**: Get console errors filtered by severity
  - Use for: Investigating error messages, stack traces, undefined variables
  - Levels: 'fatal', 'error', 'warning', 'info'

- **getNetworkFailures({status, limit, since})**: Get failed network requests
  - Use for: API failures, CORS issues, timeouts, authentication errors
  - Status codes: 4xx (client errors), 5xx (server errors)

- **getInspectSummary()**: Get overall health statistics
  - Use for: Quick health check, error counts, network success rate

- **getDetectedIssues({severity})**: Get auto-detected issues
  - Use for: Finding systematic problems, patterns, recurring failures
  - Returns issues grouped by severity with fix suggestions

#### Search Tools
- **searchConsole({query, caseSensitive})**: Search console entries
  - Use for: Finding specific error types, debugging specific components

- **searchNetwork({query, searchIn})**: Search network requests
  - Use for: Finding specific API calls, debugging endpoints

### Automated Fixing

The orchestrator can automatically fix many common issues:

- **runAutoFix({issue_id})**: Fix a single detected issue
- **runAutoFixBatch({issue_ids})**: Fix multiple issues with priority handling

Auto-fixable issues include:
- Syntax errors (missing brackets, semicolons)
- Undefined variables (defensive checks)
- Import/export errors (path fixes)
- Network timeouts (retry logic)
- Rate limiting (exponential backoff)
- Missing error handling (try-catch blocks)
- Performance issues (caching, optimization)

### Best Practices

1. **Start with getInspectSummary()** for quick overview before deep diving
2. **Use getDetectedIssues()** to find systematic problems rather than one-off errors
3. **Prioritize by severity**: critical > high > medium > low
4. **Always verify fixes** by re-running diagnostic tools after applying fixes
5. **Search before batching**: Use search tools to scope issues before batch operations
6. **Log activity**: The orchestrator activity log tracks all debugging operations

### Error Investigation Workflow

When investigating errors:
1. Call getInspectSummary() - check error counts and network health
2. Call getDetectedIssues() - find systematic problems
3. Call getConsoleErrors() or getNetworkFailures() - get detailed data
4. Analyze patterns - group by message, endpoint, severity
5. Run auto-fix if canAutoFix is true
6. Verify by re-checking inspect data
7. Report findings to user with recommendations

### Example Usage Patterns

**Quick Health Check:**
\`\`\`
getInspectSummary() → Check overall health
If errors > 0: getDetectedIssues({severity: ['critical', 'high']})
\`\`\`

**Debug Specific Error:**
\`\`\`
searchConsole({query: 'undefined variable'})
getConsoleErrors({level: ['error'], limit: 50})
Analyze stack traces and patterns
\`\`\`

**Fix API Failures:**
\`\`\`
getNetworkFailures({status: [500, 502, 503]})
getDetectedIssues() → Find auto-fixable issues
runAutoFixBatch({issue_ids: [...]})
\`\`\`

**Performance Investigation:**
\`\`\`
getInspectSummary() → Check avgResponseTime
getNetworkFailures() → Find slow endpoints
searchNetwork({query: '/api/slow-endpoint'})
Analyze and optimize
\`\`\`

### Interpretation Guide

**Console Errors:**
- **fatal**: App crashes, unhandled exceptions - immediate attention
- **error**: Exceptions, failed operations - investigate and fix
- **warning**: Deprecated usage, potential issues - monitor
- **info**: General logging - informational only

**Network Status Codes:**
- **200-299**: Success - normal operation
- **400-499**: Client errors - fix request format, auth, validation
- **500-599**: Server errors - retry, check service status
- **0**: Network error, CORS, timeout - check connectivity

**Issue Severity:**
- **critical**: App crashes, data loss, security issues - drop everything
- **high**: Feature failures, major UX problems - prioritize
- **medium**: Degraded performance, edge cases - schedule fix
- **low**: Minor issues, nice-to-have fixes - backlog

### Integration with Canvas

When debugging issues:
1. Consider creating a **diff** tile to see code changes
2. Use a **browser** tile to test fixes live
3. Add a **terminal** tile for running tests/builds
4. The orchestrator activity log shows all debugging operations

The inspect module runs automatically in the background, capturing errors and failures as they happen. You can query this data at any time to diagnose and fix issues without user intervention.
`

// ============================================================================
// FEW-SHOT EXAMPLES
// ============================================================================

/**
 * Few-shot examples for inspect tool usage
 * These examples demonstrate effective debugging patterns
 */
export const INSPECT_FEW_SHOT_EXAMPLES = [
  // Example 1: Console error with undefined variable
  {
    scenario: 'Console error with undefined variable',
    userMessage: 'I\'m getting "ReferenceError: userData is not defined" in the console',
    toolCalls: [
      {
        name: 'getInspectSummary',
        arguments: {}
      },
      {
        name: 'searchConsole',
        arguments: {
          query: 'userData is not defined',
          caseSensitive: false
        }
      },
      {
        name: 'getConsoleErrors',
        arguments: {
          level: ['error', 'fatal'],
          limit: 20
        }
      }
    ],
    assistantResponse: `I found 3 instances of "userData is not defined" errors. The error originates from \`src/components/UserProfile.tsx:42\`. The issue is that \`userData\` is being accessed before it's initialized.

I'll add a defensive check to prevent this error:
- Changed \`userData.name\` to \`userData?.name\` (optional chaining)
- Added null check before accessing userData properties

The fix has been applied. Check the browser tile to verify the error is resolved.`
  },

  // Example 2: Network failure with 404
  {
    scenario: 'Network failure with 404',
    userMessage: 'The API calls to /api/users are failing with 404 errors',
    toolCalls: [
      {
        name: 'getNetworkFailures',
        arguments: {
          status: [404],
          limit: 10
        }
      },
      {
        name: 'searchNetwork',
        arguments: {
          query: '/api/users',
          searchIn: ['url']
        }
      },
      {
        name: 'getDetectedIssues',
        arguments: {
          severity: ['high', 'critical']
        }
      }
    ],
    assistantResponse: `I detected 15 failed requests to \`/api/users\` with 404 status. The issue is that your app is calling \`/api/users\` (with trailing slash) but your API endpoint is configured as \`/api/user\` (without 's' and no trailing slash).

I've updated the API calls in:
- \`src/services/userService.ts\` - Fixed endpoint URL
- \`src/hooks/useUsers.ts\` - Updated fetch calls

The fix has been applied. Verify by checking the browser tile - the user list should now load correctly.`
  },

  // Example 3: Multiple similar errors indicating a bug
  {
    scenario: 'Multiple similar errors indicating a bug',
    userMessage: 'The app is slow and I see many errors in the console',
    toolCalls: [
      {
        name: 'getInspectSummary',
        arguments: {}
      },
      {
        name: 'getDetectedIssues',
        arguments: {
          severity: ['critical', 'high', 'medium']
        }
      },
      {
        name: 'getConsoleErrors',
        arguments: {
          level: ['error'],
          limit: 100
        }
      }
    ],
    assistantResponse: `Health check shows the app is **unhealthy**:
- 237 console errors (15 fatal)
- 89 network failures (12% success rate)
- 5 critical issues detected

**Critical Problem:** Error spike detected
The error "Cannot read property 'map' of undefined" occurred 87 times in the last 5 minutes. This indicates a systematic bug.

**Root Cause:** In \`src/components/DataList.tsx:28\`, the code calls \`data.map()\` without checking if \`data\` exists.

**Auto-Fix Applied:**
- Added null check: \`data?.map() || []\`
- Added error boundary around the component
- Added console error logging for debugging

The fix has been applied. The error count should drop dramatically. Check the browser tile to confirm.`
  },

  // Example 4: Performance issue with slow API
  {
    scenario: 'Performance issue with slow API',
    userMessage: 'The app is loading very slowly, especially the dashboard',
    toolCalls: [
      {
        name: 'getInspectSummary',
        arguments: {}
      },
      {
        name: 'getNetworkFailures',
        arguments: {
          limit: 50
        }
      },
      {
        name: 'searchNetwork',
        arguments: {
          query: '/api/dashboard',
          searchIn: ['url']
        }
      }
    ],
    assistantResponse: `Performance analysis shows the app is **degraded**:
- Average response time: 8,432ms (very slow)
- Network success rate: 94% (below 95% target)

**Bottleneck Identified:** \`/api/dashboard\` endpoint
- Average response time: 12,847ms
- Request count: 23
- Max duration: 18,234ms

**Optimization Applied:**
1. Added request caching with 60s TTL
2. Implemented parallel data fetching
3. Added loading indicators for better UX
4. Optimized database query (added indexes)

**Expected Improvement:**
- First load: ~13s → ~3s (75% faster)
- Cached loads: ~13s → ~150ms (98% faster)

The fix has been applied. Check the browser tile - the dashboard should load much faster now.`
  },

  // Example 5: CORS error requiring proxy setup
  {
    scenario: 'CORS error requiring proxy setup',
    userMessage: 'I\'m getting CORS errors when calling the external API',
    toolCalls: [
      {
        name: 'getNetworkFailures',
        arguments: {
          limit: 20
        }
      },
      {
        name: 'searchNetwork',
        arguments: {
          query: 'cors',
          searchIn: ['error']
        }
      },
      {
        name: 'getDetectedIssues',
        arguments: {
          severity: ['high']
        }
      }
    ],
    assistantResponse: `CORS analysis found 12 blocked requests to \`https://external-api.com\`.

**Problem:** The external API doesn't allow requests from your origin (localhost:3000).

**Solution Options:**

1. **Recommended**: Set up a development proxy
   - In \`vite.config.ts\`, add:
   \`\`\`typescript
   server: {
     proxy: {
       '/api': 'https://external-api.com'
     }
   }
   \`\`\`
   - Change API calls from \`https://external-api.com/data\` to \`/api/data\`

2. **Alternative**: Ask the external API provider to add CORS headers for your domain

I've updated \`vite.config.ts\` with the proxy configuration. Restart the dev server and the CORS errors should be resolved.`
  },

  // Example 6: Auto-fixing batch of issues
  {
    scenario: 'Auto-fixing batch of issues',
    userMessage: 'Fix as many issues as you can automatically',
    toolCalls: [
      {
        name: 'getDetectedIssues',
        arguments: {
          severity: ['critical', 'high', 'medium']
        }
      },
      {
        name: 'runAutoFixBatch',
        arguments: {
          issue_ids: ['issue_1', 'issue_2', 'issue_3', 'issue_4', 'issue_5']
        }
      }
    ],
    assistantResponse: `Found 8 auto-fixable issues (5 critical, 2 high, 1 medium).

**Auto-Fix Results:**
✓ Fixed 5/8 issues:
- Added missing semicolons (2 files)
- Fixed undefined variable access (1 file)
- Added error handling to fetch calls (2 files)
- Implemented retry logic for failed requests (1 file)

✗ Failed 3/8 issues (require manual fixes):
- Authentication token expired (manual: refresh token)
- Missing API endpoint (manual: implement endpoint)
- Database connection failed (manual: check DB server)

**Files Modified:**
- \`src/utils/api.ts\` - Added retry logic and error handling
- \`src/components/UserList.tsx\` - Fixed undefined variable
- \`src/services/auth.ts\` - Added defensive checks

The auto-fixed issues are resolved. The 3 failed issues need manual attention - I've added them to a todo list.`
  }
]

// ============================================================================
// TOOL USAGE GUIDELINES
// ============================================================================

/**
 * Detailed guidelines for inspect tool usage
 * Add this to the system prompt for comprehensive instructions
 */
export const INSPECT_TOOL_USAGE_GUIDELINES = `
## Inspect Tool Usage Guidelines

### When to Use Inspect Tools

**ALWAYS use inspect tools when:**
- User reports errors, crashes, or unexpected behavior
- Console shows red error messages
- Network tab shows failed requests (red status codes)
- App feels slow or unresponsive
- Features don't work as expected
- Before deploying code (verify no regressions)

**CONSIDER using inspect tools when:**
- User asks "is there anything wrong?"
- After making code changes
- After installing new packages
- When testing new features
- During code review

### Tool Selection Flowchart

\`\`\`
Start: User reports issue
  │
  ├─→ Quick overview needed?
  │   └─→ getInspectSummary()
  │
  ├─→ Specific error type?
  │   ├─→ Console errors → getConsoleErrors() or searchConsole()
  │   ├─→ Network issues → getNetworkFailures() or searchNetwork()
  │   └─→ Unknown → getDetectedIssues()
  │
  ├─→ Need patterns/trends?
  │   └─→ getDetectedIssues() (groups and analyzes)
  │
  ├─→ Issues found?
  │   ├─→ Can auto-fix? → runAutoFix() or runAutoFixBatch()
  │   └─→ Manual fix → Analyze and report to user
  │
  └─→ Fix applied?
      └─→ Verify with getInspectSummary() or getDetectedIssues()
\`\`\`

### Best Practices by Scenario

**Scenario 1: User sees console error**
\`\`\`
1. searchConsole({query: 'error message'})
2. getConsoleErrors({level: ['error'], limit: 20})
3. Analyze stack traces and patterns
4. Identify root cause
5. Fix or runAutoFix()
6. Verify fix
\`\`\`

**Scenario 2: API call failing**
\`\`\`
1. getNetworkFailures({status: [400, 500]})
2. searchNetwork({query: '/api/endpoint'})
3. Check auth tokens, request format
4. getDetectedIssues() for API-specific issues
5. Fix or runAutoFix()
6. Verify with test call
\`\`\`

**Scenario 3: App is slow**
\`\`\`
1. getInspectSummary() - check avgResponseTime
2. getNetworkFailures() - find slow endpoints
3. getDetectedIssues() - check for performance issues
4. Analyze bottlenecks
5. Implement caching/optimization
6. Verify improvement
\`\`\`

**Scenario 4: General health check**
\`\`\`
1. getInspectSummary() - overall stats
2. getDetectedIssues({severity: ['critical', 'high']})
3. Report health status
4. Recommend actions if needed
\`\`\`

### Common Mistakes to Avoid

❌ **Don't** call inspect tools without a clear purpose
✅ **Do** Have a hypothesis before investigating

❌ **Don't** Ignore warnings - they often precede errors
✅ **Do** Investigate warnings to prevent future errors

❌ **Don't** Fix symptoms without finding root cause
✅ **Do** Use patterns and trends to identify systematic issues

❌ **Don't** Apply fixes without verification
✅ **Do** Always re-check inspect data after fixing

❌ **Don't** Batch fix without checking severity
✅ **Do** Prioritize critical > high > medium > low

### Verification Checklist

After applying fixes, verify:

□ getInspectSummary() shows improved metrics
□ getConsoleErrors() shows reduced error count
□ getNetworkFailures() shows fewer failures
□ getDetectedIssues() shows issues resolved
□ Browser tile confirms fixes work visually
□ No new errors introduced by the fix

### Reporting to User

When reporting findings:

1. **Summary**: 1-2 sentences on overall status
2. **Key Findings**: Bullet points of main issues
3. **Actions Taken**: What you fixed
4. **Verification**: How you confirmed it works
5. **Recommendations**: What to monitor or fix next

Example:
\`\`\`
**Health Status**: Degraded → Healthy

**Key Findings**:
- Fixed "undefined variable" error (87 occurrences)
- Added missing error handling (3 files)
- Optimized slow API endpoint (13s → 2s)

**Verification**: Error count dropped from 237 to 0, API success rate 100%

**Recommendations**: Monitor for 24h, add unit tests for fixed issues
\`\`\`
`

// ============================================================================
// COMPLETE INSPECT PROMPT
// ============================================================================

/**
 * Complete inspect prompt for system integration
 * Combines all sections into a single comprehensive prompt
 */
export function getInspectSystemPrompt(): string {
  return `
${INSPECT_SYSTEM_PROMPT_ADDITIONS}

${INSPECT_TOOL_USAGE_GUIDELINES}

**Remember**: The inspect module is your automated debugging assistant. Use it proactively to catch issues early, diagnose problems systematically, and verify fixes thoroughly. The goal is zero console errors and 100% network success rate.
  `.trim()
}

// ============================================================================
// PROMPT EXPORTS
// ============================================================================

/**
 * Inspect prompts export for orchestrator integration
 */
export const inspectPrompts = {
  systemPromptAdditions: INSPECT_SYSTEM_PROMPT_ADDITIONS,
  toolUsageGuidelines: INSPECT_TOOL_USAGE_GUIDELINES,
  fewShotExamples: INSPECT_FEW_SHOT_EXAMPLES,
  getCompletePrompt: getInspectSystemPrompt,
}

export default inspectPrompts