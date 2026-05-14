/**
 * Side effects when an Orca-wrapped terminal command completes (telemetry, diagnostics, bounty).
 */

import type { TerminalCommandRecord } from '../../store/terminalCommandState'
import { useCanvasStore } from '../../store/canvasStore'
import { useTerminalDiagnosticsStore } from '../../store/terminalDiagnosticsStore'
import { recordTelemetry } from '../../store/unifiedTelemetryStore'
import {
  classifyTerminalFailure,
  routeTerminalCommandFailureToBounty,
} from '../telemetry/tapTerminalOutput'
import { appendRawMemorySignal } from '../orchestrator/memoryDistiller'
import { getDefaultSessionId } from '../persistence/sessionPersistence'
import { applyVaultSecretRedaction } from '../vault/vaultBrainMirror'

export function emitOrcaCommandCompletedTelemetry(tileId: string, rec: TerminalCommandRecord): void {
  recordTelemetry({
    category: 'log',
    source: 'orchestrator',
    level: rec.exitCode === 0 ? 'info' : 'warn',
    tileId,
    title: 'Orca terminal command completed',
    text: `${rec.cmd.replace(/\s+/g, ' ').trim().slice(0, 200)} exit=${rec.exitCode}`,
    payloadJson: JSON.stringify({
      orcaCommand: {
        commandId: rec.commandId,
        cmd: rec.cmd,
        argv: rec.argv,
        exitCode: rec.exitCode,
        durationMs: rec.durationMs,
        errorSignature: rec.errorSignature,
      },
    }),
  })
}

export function finalizeOrcaTerminalCommandEffects(tileId: string, rec: TerminalCommandRecord): void {
  emitOrcaCommandCompletedTelemetry(tileId, rec)

  void appendRawMemorySignal({
    ts: Date.now(),
    sessionId: getDefaultSessionId(),
    kind: 'terminal_command',
    detail: applyVaultSecretRedaction(
      JSON.stringify({
        tileId,
        commandId: rec.commandId,
        cmd: rec.cmd,
        argv: rec.argv,
        exitCode: rec.exitCode,
        durationMs: rec.durationMs,
        errorSignature: rec.errorSignature,
      })
    ),
  })

  if (rec.exitCode === 0) return

  const tile = useCanvasStore.getState().tiles.get(tileId)
  const title = typeof tile?.title === 'string' ? tile.title : 'Terminal'

  const text =
    rec.outputTail.trim().length > 0 ? rec.outputTail : `Command failed with exit code ${rec.exitCode}`

  routeTerminalCommandFailureToBounty(tileId, {
    commandId: rec.commandId,
    exitCode: rec.exitCode,
    outputTail: text,
    errorSignature: rec.errorSignature,
  })

  const diagnostic =
    classifyTerminalFailure(text.split('\n').find((l) => l.trim()) ?? text) ?? {
      severity: 'error' as const,
      kind: 'generic' as const,
      recoverability: 'unknown' as const,
      summary: text.split('\n')[0]?.trim().slice(0, 500) || 'Terminal command failed',
    }

  useTerminalDiagnosticsStore.getState().recordDiagnostic({
    tileId,
    tileTitle: title,
    severity: diagnostic.severity,
    kind: diagnostic.kind,
    summary: diagnostic.summary,
    recoverability: diagnostic.recoverability,
    rawText: text.slice(0, 8000),
    exitCode: rec.exitCode,
    signal: null,
  })

  recordTelemetry({
    category: 'error',
    source: 'terminal',
    level: 'error',
    tileId,
    title: `Terminal diagnostic (${diagnostic.kind})`,
    text: text.slice(0, 4000),
    payloadJson: JSON.stringify({
      terminalDiagnostic: {
        severity: diagnostic.severity,
        kind: diagnostic.kind,
        summary: diagnostic.summary,
        recoverability: diagnostic.recoverability,
        exitCode: rec.exitCode,
        orcaCommandId: rec.commandId,
      },
    }),
  })

  const prevMeta =
    tile?.meta && typeof tile.meta === 'object' ? { ...(tile.meta as Record<string, unknown>) } : {}
  useCanvasStore.getState().updateTile(tileId, {
    meta: {
      ...prevMeta,
      lastTerminalDiagnostic: {
        severity: diagnostic.severity,
        kind: diagnostic.kind,
        summary: diagnostic.summary,
        recoverability: diagnostic.recoverability,
        ts: Date.now(),
        exitCode: rec.exitCode,
      },
    },
  })
}
