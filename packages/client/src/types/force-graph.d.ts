declare module 'force-graph' {
  type Accessor<T, R> = R | string | ((obj: T) => R)
  type GraphData<NodeT, LinkT> = { nodes: NodeT[]; links: LinkT[] }

  interface ForceGraphInstance<NodeT = any, LinkT = any> {
    graphData(): GraphData<NodeT, LinkT>
    graphData(data: GraphData<NodeT, LinkT>): this
    width(value?: number): this
    height(value?: number): this
    backgroundColor(value?: string): this
    nodeRelSize(value?: number): this
    nodeCanvasObject(
      fn?: (node: NodeT, ctx: CanvasRenderingContext2D, globalScale: number) => void
    ): this
    nodeColor(color?: Accessor<NodeT, string>): this
    linkColor(color?: Accessor<LinkT, string>): this
    linkCurvature(curvature?: Accessor<LinkT, number>): this
    linkWidth(width?: Accessor<LinkT, number>): this
    linkDirectionalArrowLength(length?: Accessor<LinkT, number>): this
    linkDirectionalArrowRelPos(pos?: Accessor<LinkT, number>): this
    d3Force(name: string): unknown
    d3Force(name: string, force: unknown): this
    d3AlphaDecay(value?: number): this
    d3VelocityDecay(value?: number): this
    d3ReheatSimulation(): this
    onNodeClick(fn?: (node: NodeT, event: MouseEvent) => void): this
    onNodeHover(fn?: (node: NodeT | null, prevNode: NodeT | null) => void): this
    onNodeDrag(fn?: (node: NodeT, translate: { x: number; y: number }) => void): this
    onNodeDragEnd(fn?: (node: NodeT) => void): this
    onBackgroundClick(fn?: (event: MouseEvent) => void): this
    onEngineStop(fn?: () => void): this
    centerAt(x?: number, y?: number, ms?: number): this
    zoom(value?: number, ms?: number): this
    zoomToFit(ms?: number, paddingPx?: number, filterFn?: (node: NodeT) => boolean): this
    pauseAnimation(): this
    _destructor?: () => void
  }

  interface ForceGraphGenerator {
    <NodeT = any, LinkT = any>(): (element: HTMLElement) => ForceGraphInstance<NodeT, LinkT>
  }

  const ForceGraph: ForceGraphGenerator
  export default ForceGraph
}
