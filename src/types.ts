export interface GraphNode {
  id: string;
  x: number;
  y: number;
  floor: number;
  search_aliases: string[];
}

export interface GraphEdge {
  from: string;
  to: string;
  weight?: number;
}

export interface GraphData {
  nodes: Record<string, GraphNode>;
  edges: GraphEdge[];
}

export interface RouteSegment {
  floor: number;
  nodes: GraphNode[];
  distance: number;
  startNode: GraphNode;
  endNode: GraphNode;
  transitionToFloor?: number; // Floor number to transition to next
  transitionStairName?: string;
}

export interface NavigationPath {
  totalDistance: number;
  segments: RouteSegment[];
  allNodes: GraphNode[];
}

export interface SearchResult {
  node: GraphNode;
  matchedAlias: string;
  displayName: string;
  score: number;
}
