import type { TileData } from '../../store/canvasStore'
import { OrchestratorModuleLayout } from '../orchestrator/OrchestratorModuleLayout'

interface Props {
  data: TileData
}

/** Canvas orchestrator tile — same UI/behavior as the sidebar orchestrator panel. */
export function OrchestratorWidgetTile({ data }: Props) {
  void data
  return <OrchestratorModuleLayout variant="tile" />
}
