import { TileComponentProps } from '../Canvas/TileRegistry'
import { HermesAgentChatPanel } from './HermesAgentChatPanel'

/**
 * Hermes module: HTTP chat to the Hermes API server (`POST /v1/responses`).
 * Gateway + Integrations are documented in Settings; keep chrome minimal here.
 */
export function HermesAgentTile({ data }: TileComponentProps) {
  const metaObj =
    data.meta && typeof data.meta === 'object' ? (data.meta as Record<string, unknown>) : undefined

  return (
    <div className="flex h-full min-h-0 flex-col bg-canvas-bg">
      <div className="min-h-0 flex-1 overflow-hidden">
        <HermesAgentChatPanel tileId={data.id} tileMeta={metaObj} />
      </div>
    </div>
  )
}
