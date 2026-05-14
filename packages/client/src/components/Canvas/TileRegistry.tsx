import { TileType, TileData } from '../../store/canvasStore'
import { TileAckOnMount } from '../../hooks/useTileMountAck'
import { isHeavyTile } from '../../lib/tileLoadProfile'
import { TerminalTile } from '../tiles/TerminalTile'
import { EditorTile } from '../tiles/EditorTile'
import { BrowserTile } from '../tiles/BrowserTile'
import { AgentBrowserTile } from '../tiles/AgentBrowserTile'
import { DiffTile } from '../tiles/DiffTile'
import { TodoTile } from '../tiles/TodoTile'
import { AgentTile } from '../tiles/AgentTile'
import { OrchestratorWidgetTile } from '../tiles/OrchestratorWidgetTile'
import { ChangelogTile } from '../tiles/ChangelogTile'
import { GithubCliTile } from '../tiles/GithubCliTile'
import { AgentTeamTile } from '../tiles/AgentTeamTile'
import { AgentGroupChatTile } from '../tiles/AgentGroupChatTile'
import { BenchmarkTile } from '../tiles/BenchmarkTile'
import { RemotionTile } from '../tiles/RemotionTile'
import { OpenRouterUsageTile } from '../tiles/OpenRouterUsageTile'
import { ToolboxTile } from '../tiles/ToolboxTile'
import { ResearchTile } from '../tiles/ResearchTile'
import { ReasoningTraceTile } from '../tiles/ReasoningTraceTile'
import { ProjectStatusTile } from '../tiles/ProjectStatusTile'
import { TelemetryTile } from '../tiles/TelemetryTile'
import { HermesBridgeTile } from '../tiles/HermesBridgeTile'
import { HermesAgentTile } from '../tiles/HermesAgentTile'
import { TelegramOnboardTile } from '../tiles/TelegramOnboardTile'
import { NativeGatewayTile } from '../tiles/NativeGatewayTile'
import { BugBountyTile } from '../tiles/BugBountyTile'

export interface TileComponentProps {
  data: TileData
}

/**
 * Wrap a tile component to auto-ack on mount for light/medium tiles.
 * Heavy tiles handle their own ack timing internally.
 */
function withAutoAck(
  Component: React.ComponentType<TileComponentProps>,
  tileType: TileType
): React.ComponentType<TileComponentProps> {
  if (isHeavyTile(tileType)) {
    return Component
  }
  return function WrappedTile(props: TileComponentProps) {
    return (
      <>
        <TileAckOnMount tileId={props.data.id} />
        <Component {...props} />
      </>
    )
  }
}

/** Raw tile components (for heavy tiles that ack manually). */
export const RawTileComponents: Record<TileType, React.ComponentType<TileComponentProps>> = {
  terminal: TerminalTile,
  editor: EditorTile,
  browser: BrowserTile,
  agent_browser: AgentBrowserTile,
  github: GithubCliTile,
  diff: DiffTile,
  todo: TodoTile,
  agent: AgentTile,
  agent_team: AgentTeamTile,
  agent_group_chat: AgentGroupChatTile,
  changelog: ChangelogTile,
  orchestrator: OrchestratorWidgetTile,
  benchmark: BenchmarkTile,
  remotion: RemotionTile,
  openrouter_usage: OpenRouterUsageTile,
  toolbox: ToolboxTile,
  research: ResearchTile,
  reasoning: ReasoningTraceTile,
  project_status: ProjectStatusTile,
  telemetry: TelemetryTile,
  hermes_bridge: HermesBridgeTile,
  hermes_agent: HermesAgentTile,
  telegram_onboard: TelegramOnboardTile,
  native_gateway: NativeGatewayTile,
  bug_bounty: BugBountyTile,
}

/** Tile registry with auto-ack wrappers for non-heavy tiles. */
export const TileRegistry: Record<TileType, React.ComponentType<TileComponentProps>> = {
  terminal: withAutoAck(TerminalTile, 'terminal'),
  editor: withAutoAck(EditorTile, 'editor'),
  browser: withAutoAck(BrowserTile, 'browser'),
  agent_browser: withAutoAck(AgentBrowserTile, 'agent_browser'),
  github: withAutoAck(GithubCliTile, 'github'),
  diff: withAutoAck(DiffTile, 'diff'),
  todo: withAutoAck(TodoTile, 'todo'),
  agent: withAutoAck(AgentTile, 'agent'),
  agent_team: withAutoAck(AgentTeamTile, 'agent_team'),
  agent_group_chat: withAutoAck(AgentGroupChatTile, 'agent_group_chat'),
  changelog: withAutoAck(ChangelogTile, 'changelog'),
  orchestrator: withAutoAck(OrchestratorWidgetTile, 'orchestrator'),
  benchmark: withAutoAck(BenchmarkTile, 'benchmark'),
  remotion: withAutoAck(RemotionTile, 'remotion'),
  openrouter_usage: withAutoAck(OpenRouterUsageTile, 'openrouter_usage'),
  toolbox: withAutoAck(ToolboxTile, 'toolbox'),
  research: withAutoAck(ResearchTile, 'research'),
  reasoning: withAutoAck(ReasoningTraceTile, 'reasoning'),
  project_status: withAutoAck(ProjectStatusTile, 'project_status'),
  telemetry: withAutoAck(TelemetryTile, 'telemetry'),
  hermes_bridge: withAutoAck(HermesBridgeTile, 'hermes_bridge'),
  hermes_agent: withAutoAck(HermesAgentTile, 'hermes_agent'),
  telegram_onboard: withAutoAck(TelegramOnboardTile, 'telegram_onboard'),
  native_gateway: withAutoAck(NativeGatewayTile, 'native_gateway'),
  bug_bounty: withAutoAck(BugBountyTile, 'bug_bounty'),
}
