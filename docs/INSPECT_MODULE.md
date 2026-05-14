# Inspect Module - Automated Debugging

**🚀 Self-healing browser debugging with automatic console/network capture and intelligent error detection**

## What is the Inspect Module?

The Inspect Module is a comprehensive debugging system that gives the orchestrator the ability to automatically detect, diagnose, and fix browser issues without user intervention. It captures all console output and network activity, analyzes patterns, and applies fixes for common problems.

## 🎯 Key Capabilities

### 1. **Automatic Capture**
- **Console**: All logs, errors, warnings from the browser
- **Network**: All fetch/XHR requests with full details
- **Zero Configuration**: Works automatically in browser tiles

### 2. **Intelligent Detection**
- Groups identical errors to find patterns
- Detects error spikes (sudden increases)
- Identifies API failures (4xx, 5xx, timeouts)
- Finds performance issues (slow endpoints, large payloads)

### 3. **Auto-Fix**
- Syntax errors (missing semicolons, brackets)
- Undefined variables (defensive checks)
- Network failures (retries, auth refresh)
- API issues (rate limiting, validation)
- Performance problems (caching, compression)

### 4. **Visual Interface**
- Real-time console/network monitoring
- Filterable by type, severity, status
- Export to JSON, CSV, Markdown
- One-click auto-fix buttons

## 🚀 Quick Start

### Using the Inspect Tile

1. **Add Inspect Tile**:
   - Click the "Modules" button in the sidebar
   - Select "Inspect" from the list
   - Tile opens with Console, Network, Issues tabs

2. **Monitor Activity**:
   - Open a browser tile
   - Watch console logs appear in real-time
   - See network requests with status codes
   - Check Issues tab for detected problems

3. **Auto-Fix Issues**:
   - Go to Issues tab
   - Click "Auto-fix" on fixable issues
   - Watch fixes be applied automatically
   - Verify results in console/network tabs

### Using Orchestrator Auto-Debugging

The orchestrator can automatically debug issues:

```
You: "The browser is showing errors"
Orchestrator: [Running get_console_errors]
Orchestrator: [Analyzing 3 console errors]
Orchestrator: Found 2 undefined variables and 1 syntax error
Orchestrator: [Running auto-fix on all issues]
Orchestrator: Fixed all issues. Verifying...
Orchestrator: ✅ All issues resolved
```

## 💡 Use Cases

### 1. **Development**
- Catch console errors during development
- Debug API failures immediately
- Monitor performance metrics
- Export data for team sharing

### 2. **Testing**
- Capture all errors during test runs
- Analyze network failures
- Verify error handling
- Generate test reports

### 3. **Production Monitoring**
- Monitor console errors in production
- Track API success rates
- Detect performance degradation
- Auto-fix common issues

### 4. **Automated Debugging**
- Orchestrator detects and fixes issues
- Zero manual intervention required
- Continuous health monitoring
- Self-healing applications

## 🔧 Inspect Tools

The orchestrator has 9 specialized tools:

| Tool | What it does |
|------|--------------|
| `get_console_errors` | Get all console errors |
| `get_network_failures` | Get failed network requests |
| `get_inspect_summary` | Get overall statistics |
| `search_console` | Search console entries |
| `search_network` | Search network requests |
| `get_detected_issues` | Get auto-detected problems |
| `export_inspect_data` | Export all data |
| `run_auto_fix` | Fix a single issue |
| `run_auto_fix_batch` | Fix multiple issues |

## 🤖 Orchestrator Skills

### Auto-Debug Browser
```
1. Check inspect summary
2. Identify critical issues
3. Run auto-fix on fixable issues
4. Verify fixes worked
5. Report results
```

### Investigate Console Errors
```
1. Get console errors
2. Group similar errors
3. Find root cause from stack traces
4. Suggest fixes
5. Apply if auto-fixable
```

### Investigate Network Failures
```
1. Get network failures
2. Group by endpoint
3. Check auth/CORS issues
4. Identify slow endpoints
5. Apply optimizations
```

## 📊 Data Captured

### Console Entries
- Type: log, error, warn, info, debug
- Message and data
- Stack trace (for errors)
- Source file and line
- Timestamp

### Network Requests
- URL and method
- Request/response headers
- Request/response bodies
- Status code and duration
- Success/failure status
- Timing information

### Detected Issues
- Issue type and category
- Severity level
- Affected entries
- Suggested fix
- Auto-fix capability

## 🎨 Inspect Tile UI

### Console Tab
- 📋 List of all console entries
- 🔍 Search and filter
- 🎨 Color-coded by severity
- 📋 Copy to clipboard
- 📁 Stack traces (expandable)

### Network Tab
- 🌐 List of all network requests
- 🎯 Status color coding
- ⏱️ Duration and size
- 🔍 Search and filter
- 📋 Headers/body (expandable)

### Issues Tab
- ⚠️ Auto-detected problems
- 🎯 Severity badges
- 🔧 Auto-fix buttons
- 📝 Suggested fixes
- 📊 Affected entries

## 🔐 Privacy & Security

- No data sent to external servers
- All processing happens locally
- Export is user-initiated
- Sensitive data can be filtered
- Stack traces sanitized if needed

## 📈 Performance Impact

- Console capture: < 1ms per log
- Network capture: < 5ms per request
- Memory usage: ~10-20 MB
- No impact on app performance

## 🧪 Testing the Module

### Test Console Capture
```
1. Open a browser tile
2. In browser console, run: console.error('Test error')
3. Check InspectTile Console tab
4. Should see the error with stack trace
```

### Test Network Capture
```
1. Open a browser tile
2. Navigate to any website
3. Check InspectTile Network tab
4. Should see all requests with details
```

### Test Auto-Fix
```
1. Create a fixable issue (e.g., undefined variable)
2. Wait for error detection
3. Go to InspectTile Issues tab
4. Click "Auto-fix" button
5. Verify fix was applied
```

## 📚 Documentation

- [Inspect Module README](./packages/client/src/lib/inspect/README.md) - Complete technical documentation
- [Error Detection Guide](./packages/client/src/lib/inspect/README_ERROR_DETECTION.md) - Error detection details
- [Export Functionality](./packages/client/src/lib/inspect/README_EXPORT.md) - Export features

## 🛠️ Architecture

```
Browser Tile (with interceptors)
    ↓
Inspect Store (Zustand)
    ↓
Error Detection (algorithms)
    ↓
Orchestrator Tools (query interface)
    ↓
Auto-Fix Workflows (apply fixes)
    ↓
Verification (check results)
```

## 🎯 Future Enhancements

- [ ] Machine learning for error prediction
- [ ] Custom error patterns (user-defined)
- [ ] Integration with external monitoring
- [ ] Historical trend analysis
- [ ] A/B testing for fixes
- [ ] Multi-tab correlation analysis

## 💻 Implementation Details

### File Structure
```
packages/client/src/
├── lib/inspect/
│   ├── types.ts                    # Data structures
│   ├── errorDetection.ts           # Detection algorithms
│   ├── networkInterceptor.ts       # Network capture
│   └── exportInspectData.ts        # Export functionality
├── store/
│   └── inspectStore.ts             # State management
├── orchestrator/
│   ├── inspectTools.ts             # Query tools
│   ├── autoFixWorkflows.ts         # Auto-fix logic
│   └── skills/inspectSkills.ts     # Debugging skills
└── components/tiles/
    └── InspectTile.tsx             # UI component
```

## 🤝 Contributing

When contributing to the inspect module:

1. Add new types to `types.ts`
2. Implement detection in `errorDetection.ts`
3. Add auto-fix logic to `autoFixWorkflows.ts`
4. Update UI in `InspectTile.tsx` if needed
5. Write tests for new functionality
6. Update documentation

## 📝 License

Part of Orca Coder. See project LICENSE for details.

---

**Built with ❤️ for Orca Coder - Making debugging automatic and intelligent**
