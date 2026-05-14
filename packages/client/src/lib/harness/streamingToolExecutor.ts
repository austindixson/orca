/**
 * Mid-stream tool dispatch (future): when the chat API exposes incremental tool-call deltas,
 * parse boundaries here and dispatch readonly tools before the assistant finishes the message.
 * Current orchestrator uses full completion + tool_calls — see chatCompletion.ts.
 */
export const STREAMING_TOOL_EXECUTOR_NOTE =
  'Streaming tool execution requires provider streaming + incremental XML/JSON tool parse; not enabled yet.'
