/** Узел объединённого графа: id уникален и содержит номер этажа. */
export interface GraphNode {
  /** Уникальный id внутри объединённого графа (включает этаж). */
  id: string;
  /** Исходный id из JSON этажа, например "D105". */
  rawId: string;
  x: number;
  y: number;
  floor: number;
  search_aliases: string[];
}

/** Узел в формате JSON этажа — ещё без вычисляемых полей. */
export interface RawGraphNode {
  x: number;
  y: number;
  floor: number;
}

export interface GraphEdge {
  from: string;
  to: string;
}

/** Формат файлов map/final_graph_floorN.json. */
export interface GraphData {
  nodes: Record<string, RawGraphNode>;
  edges: GraphEdge[];
}

/** Участок маршрута в пределах одного этажа. */
export interface RouteSegment {
  floor: number;
  nodes: GraphNode[];
  /** Последний узел участка (на нём рисуется маркер перехода). */
  endNode: GraphNode;
  /** Этаж, на который нужно перейти с последнего узла. */
  transitionToFloor?: number;
}

export interface NavigationPath {
  segments: RouteSegment[];
}

export interface SearchResult {
  node: GraphNode;
  matchedAlias: string;
  displayName: string;
  score: number;
}
