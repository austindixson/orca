import { nanoid } from 'nanoid'
import { resolveSkillCommandPrompt } from './skillCommands'
import { useOrchestratorSessionStore } from '../store/orchestratorSessionStore'
import { useToastStore } from '../store/toastStore'
import { quickOrchestratorInputUiStore } from '../components/orchestrator/QuickOrchestratorInput'

/**
 * Inbound Telegram → first Orca UI WebSocket → same orchestrator run as the bottom bar → reply string back to Telegram.
 */
export async function handleGatewayTelegramMessage(
  ws: WebSocket,
  payload: {
    requestId: string
    chatId: number
    text: string
    username?: string
    queued?: {
      likely: boolean
      ageMs?: number
    }
  }
): Promise<void> {
  const sendResult = (text: string) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(
        JSON.stringify({
          type: 'gateway:telegram:result',
          payload: { requestId: payload.requestId, text },
        })
      )
    }
  }

  const { running, run } = useOrchestratorSessionStore.getState()
  if (running) {
    sendResult(
      'Orca is busy with another run. Try again when the current task finishes.'
    )
    return
  }

  const label = payload.username ? `@${payload.username}` : `chat:${payload.chatId}`
  const userText = payload.text.trim()
  if (payload.queued?.likely) {
    const ageSec = Math.max(0, Math.round((payload.queued.ageMs ?? 0) / 1000))
    const agePhrase = ageSec > 0 ? `about ${ageSec}s old` : 'older than live delivery'
    const approved = window.confirm(
      `Queued Telegram message detected (${agePhrase}) from ${label}.\n\n` +
        `Message:\n${userText}\n\n` +
        `Run this queued message now?`
    )
    if (!approved) {
      sendResult('Skipped queued Telegram message per user confirmation in Orca.')
      useToastStore.getState().addToast({
        type: 'info',
        title: 'Queued Telegram message skipped',
        message: `Ignored backlog message from ${label}.`,
      })
      return
    }
    useToastStore.getState().addToast({
      type: 'warning',
      title: 'Queued Telegram message approved',
      message: `Running backlog message from ${label}.`,
    })
  }
  const skillResolved = await resolveSkillCommandPrompt(userText)
  if (skillResolved.error) {
    useToastStore.getState().addToast({
      type: 'warning',
      title: 'Skill command',
      message: skillResolved.error,
    })
  }
  const line = `[Telegram ${label}] ${skillResolved.promptText}`

  try {
    // Telegram-originated runs should behave like tile/quick submits and collapse the center bar.
    quickOrchestratorInputUiStore.getState().setSuppressedUntilIdle(true)
    await run({ id: nanoid(), text: line, attachments: [] })
    const outcome = useOrchestratorSessionStore.getState().lastRunOutcome

    if (!outcome) {
      sendResult('Orca did not process the message (unknown state).')
      return
    }

    switch (outcome.kind) {
      case 'ok': {
        const textOut = outcome.assistantText.trim()
        sendResult(
          textOut ||
            '(Orca completed the turn without any text reply. Check the canvas for tool activity.)'
        )
        return
      }
      case 'skipped':
        sendResult(`Orca can't run yet: ${outcome.reason}`)
        return
      case 'queued':
        sendResult('Queued behind the current run — I will reply when it finishes.')
        return
      case 'busy_rejected':
        sendResult('Orca is busy with another run. Try again when the current task finishes.')
        return
      case 'aborted':
        sendResult('Run was cancelled before a reply was produced.')
        return
      case 'error':
        sendResult(`Orca error: ${outcome.message}`)
        return
      default: {
        const _exhaustive: never = outcome
        void _exhaustive
        sendResult('Orca did not process the message (unknown outcome).')
      }
    }
  } catch (e) {
    sendResult(`Error: ${e instanceof Error ? e.message : String(e)}`)
  }
}
