import { useCanvasStore } from '../../store/canvasStore'
import { getViewportLayoutRect } from '../layoutPresets'
import { revealOrchestratorTile } from './revealOrchestratorTile'

const W_ONBOARD = 384
const H_ONBOARD = 540
const W_GATEWAY = 432
const H_GATEWAY = 580
const GAP = 12
const VIEWPORT_INSET = 16

/**
 * Ensures the Telegram onboard + native gateway tiles exist, side by side in the viewport.
 * Reuses one tile per type (Picasso off) via merge logic in the store.
 */
export function ensureTelegramGatewayTiles(): { onboardId: string; gatewayId: string } {
  const { pan, zoom, bringToFront, addTile, updateTile, tiles } = useCanvasStore.getState()
  const area = getViewportLayoutRect(pan, zoom)

  let onboard = [...tiles.values()].find((t) => t.type === 'telegram_onboard')
  let gateway = [...tiles.values()].find((t) => t.type === 'native_gateway')

  const pairW = W_ONBOARD + GAP + W_GATEWAY
  const pairX =
    area != null ? area.x + Math.max(VIEWPORT_INSET, (area.w - pairW) / 2) : 120
  const pairY = area != null ? area.y + VIEWPORT_INSET : 80

  const revealOpts = { bypassAutoFocusPreference: true, forceCamera: true } as const

  if (!onboard) {
    const id = addTile('telegram_onboard', { x: pairX, y: pairY })
    updateTile(id, {
      w: W_ONBOARD,
      h: H_ONBOARD,
      title: 'Telegram · Onboard',
      meta: { telegramOnboard: true },
    })
    onboard = useCanvasStore.getState().tiles.get(id)!
    revealOrchestratorTile(id, { label: 'Telegram onboard…', effect: 'pulse' }, null, revealOpts)
  } else {
    bringToFront(onboard.id)
    updateTile(onboard.id, {
      x: pairX,
      y: pairY,
      w: W_ONBOARD,
      h: H_ONBOARD,
      meta: { ...onboard.meta, telegramOnboard: true },
    })
    revealOrchestratorTile(onboard.id, { label: 'Telegram onboard…', effect: 'pulse' }, null, revealOpts)
  }

  if (!gateway) {
    const id = addTile('native_gateway', { x: pairX + W_ONBOARD + GAP, y: pairY })
    updateTile(id, {
      w: W_GATEWAY,
      h: H_GATEWAY,
      title: 'Native gateway',
      meta: { nativeGatewayTile: true },
    })
    gateway = useCanvasStore.getState().tiles.get(id)!
    revealOrchestratorTile(id, { label: 'Gateway…', effect: 'pulse' }, null, revealOpts)
  } else {
    bringToFront(gateway.id)
    updateTile(gateway.id, {
      x: pairX + W_ONBOARD + GAP,
      y: pairY,
      w: W_GATEWAY,
      h: H_GATEWAY,
      meta: { ...gateway.meta, nativeGatewayTile: true },
    })
    revealOrchestratorTile(gateway.id, { label: 'Gateway…', effect: 'pulse' }, null, revealOpts)
  }

  return { onboardId: onboard!.id, gatewayId: gateway!.id }
}
