import { Component, type ErrorInfo, type ReactNode } from 'react'
import { recordTelemetry } from '../../store/unifiedTelemetryStore'

interface Props {
  tileId: string
  children: ReactNode
}

interface State {
  hasError: boolean
  message: string | null
}

export class TileErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, message: null }
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, message: error?.message ?? String(error) }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    const stack = [error?.stack, info.componentStack].filter(Boolean).join('\n')
    recordTelemetry({
      category: 'error',
      source: 'tile',
      level: 'error',
      tileId: this.props.tileId,
      title: 'Tile render error',
      text: `${error?.message ?? String(error)}\n${stack}`.slice(0, 48_000),
      payloadJson: JSON.stringify({
        componentStack: info.componentStack,
        name: error?.name,
      }),
    })
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div className="flex h-full min-h-[120px] flex-col items-center justify-center gap-2 bg-red-950/40 p-4 text-center text-red-200">
          <div className="text-xs font-semibold uppercase tracking-wider text-red-300/90">Tile error</div>
          <p className="max-w-prose text-[11px] leading-relaxed text-red-100/90">
            {this.state.message ?? 'Something went wrong in this tile.'}
          </p>
        </div>
      )
    }
    return this.props.children
  }
}
