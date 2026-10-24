import { GraphNode, GraphData, RouteSegment, NavigationPath, SearchResult } from './types';

export class GraphService {
  private nodes: Map<string, GraphNode> = new Map();
  private adjacency: Map<string, { target: string; weight: number }[]> = new Map();

  /**
   * Load and parse graph JSON files from provided URLs and merge into unified graph.
   */
  public async loadAndMergeGraphs(urls: string[]): Promise<void> {
    this.nodes.clear();
    this.adjacency.clear();

    const loadedGraphs: GraphData[] = await Promise.all(
      urls.map(url => fetch(url).then(res => {
        if (!res.ok) throw new Error(`Failed to load graph data from ${url}`);
        return res.json() as Promise<GraphData>;
      }))
    );

    // 1. Merge nodes and floor-local edges
    for (const graph of loadedGraphs) {
      for (const [id, node] of Object.entries(graph.nodes)) {
        this.nodes.set(id, {
          ...node,
          id,
          search_aliases: node.search_aliases || [id]
        });
        if (!this.adjacency.has(id)) {
          this.adjacency.set(id, []);
        }
      }

      for (const edge of graph.edges) {
        this.addEdge(edge.from, edge.to, edge.weight);
      }
    }

    // 2. Connect staircases/elevators across floors
    this.linkInterFloorStairs();
  }

  /**
   * Helper to add a bidirectional edge with Euclidean or custom distance.
   */
  private addEdge(fromId: string, toId: string, customWeight?: number): void {
    const fromNode = this.nodes.get(fromId);
    const toNode = this.nodes.get(toId);

    if (!fromNode || !toNode) return;

    let weight = customWeight;
    if (weight === undefined) {
      if (fromNode.floor === toNode.floor) {
        // Euclidean distance in map pixel coordinates
        const dx = fromNode.x - toNode.x;
        const dy = fromNode.y - toNode.y;
        weight = Math.sqrt(dx * dx + dy * dy);
      } else {
        // Vertical floor change penalty equivalent distance (~40 units)
        weight = 40;
      }
    }

    if (!this.adjacency.has(fromId)) this.adjacency.set(fromId, []);
    if (!this.adjacency.has(toId)) this.adjacency.set(toId, []);

    this.adjacency.get(fromId)!.push({ target: toId, weight });
    this.adjacency.get(toId)!.push({ target: fromId, weight });
  }

  /**
   * Links staircase and elevator nodes across floors (Floor 1 <-> Floor 2 <-> Floor 3).
   */
  private linkInterFloorStairs(): void {
    const allNodeIds = Array.from(this.nodes.keys());
    const floor1StairNodes = allNodeIds.filter(id => {
      const node = this.nodes.get(id);
      return node && node.floor === 1 && (id.toLowerCase().includes('stair') || id.toLowerCase().includes('elevator'));
    });

    for (const f1Id of floor1StairNodes) {
      const f2Id = this.findNodeIdOnFloor(f1Id, 2);
      const f3Id = this.findNodeIdOnFloor(f1Id, 3);

      // Connect Floor 1 <-> Floor 2
      if (f2Id) {
        this.addEdge(f1Id, f2Id, 45);
      }
      // Connect Floor 2 <-> Floor 3
      if (f2Id && f3Id) {
        this.addEdge(f2Id, f3Id, 45);
      }
    }
  }

  /**
   * Resolves the node on `floor` that represents the same vertical connector
   * as a Floor 1 stair node. Handles composite ids such as
   * "D113_stairs_D_east" -> "D213_stairs_D_east_f2".
   */
  private findNodeIdOnFloor(f1Id: string, floor: number): string | null {
    const replaced = f1Id.replace(/([A-Z])1(\d{2})/g, `$1${floor}$2`);
    const candidates = [`${replaced}_f${floor}`, `${f1Id}_f${floor}`, replaced, f1Id];

    for (const candidate of candidates) {
      const node = this.nodes.get(candidate);
      if (node && node.floor === floor) return candidate;
    }
    return null;
  }

  /**
   * Dijkstra's Algorithm to find shortest path between startNode and endNode.
   */
  public findShortestPath(startNodeId: string, endNodeId: string): NavigationPath | null {
    if (!this.nodes.has(startNodeId) || !this.nodes.has(endNodeId)) {
      return null;
    }

    if (startNodeId === endNodeId) {
      const singleNode = this.nodes.get(startNodeId)!;
      const segment: RouteSegment = {
        floor: singleNode.floor,
        nodes: [singleNode],
        distance: 0,
        startNode: singleNode,
        endNode: singleNode
      };
      return {
        totalDistance: 0,
        segments: [segment],
        allNodes: [singleNode]
      };
    }

    const distances: Map<string, number> = new Map();
    const previous: Map<string, string | null> = new Map();
    const unvisited: Set<string> = new Set();

    for (const nodeId of this.nodes.keys()) {
      distances.set(nodeId, Infinity);
      previous.set(nodeId, null);
      unvisited.add(nodeId);
    }

    distances.set(startNodeId, 0);

    while (unvisited.size > 0) {
      // Find node with smallest distance in unvisited set
      let currentId: string | null = null;
      let smallestDist = Infinity;

      for (const id of unvisited) {
        const d = distances.get(id)!;
        if (d < smallestDist) {
          smallestDist = d;
          currentId = id;
        }
      }

      if (currentId === null || smallestDist === Infinity) {
        break; // Unreachable destination
      }

      if (currentId === endNodeId) {
        break; // Reached target
      }

      unvisited.delete(currentId);

      const neighbors = this.adjacency.get(currentId) || [];
      for (const neighbor of neighbors) {
        if (!unvisited.has(neighbor.target)) continue;

        const alt = distances.get(currentId)! + neighbor.weight;
        if (alt < distances.get(neighbor.target)!) {
          distances.set(neighbor.target, alt);
          previous.set(neighbor.target, currentId);
        }
      }
    }

    // Reconstruct path
    const pathIds: string[] = [];
    let curr: string | null = endNodeId;

    while (curr !== null) {
      pathIds.unshift(curr);
      curr = previous.get(curr) || null;
    }

    // If start node was not reached
    if (pathIds[0] !== startNodeId) {
      return null;
    }

    const allNodes = pathIds.map(id => this.nodes.get(id)!);
    const totalDistance = Math.round(distances.get(endNodeId)!);

    return this.chunkMultiFloorRoute(allNodes, totalDistance);
  }

  /**
   * Splits multi-floor route into distinct per-floor segments with floor transition instructions.
   */
  private chunkMultiFloorRoute(allNodes: GraphNode[], totalDistance: number): NavigationPath {
    if (allNodes.length === 0) {
      return { totalDistance: 0, segments: [], allNodes: [] };
    }

    const segments: RouteSegment[] = [];
    let currentSegmentNodes: GraphNode[] = [allNodes[0]];

    for (let i = 1; i < allNodes.length; i++) {
      const prevNode = allNodes[i - 1];
      const currNode = allNodes[i];

      if (currNode.floor === prevNode.floor) {
        currentSegmentNodes.push(currNode);
      } else {
        // Floor transition occurred between prevNode and currNode!
        const segDist = this.calculateSegmentDistance(currentSegmentNodes);
        
        let transitionStairName = prevNode.id.replace(/_f\d$/, '').replace(/_/g, ' ');
        if (transitionStairName.toLowerCase().includes('stair')) {
          transitionStairName = transitionStairName.replace(/stairs/i, 'Stairs');
        }

        segments.push({
          floor: prevNode.floor,
          nodes: currentSegmentNodes,
          distance: segDist,
          startNode: currentSegmentNodes[0],
          endNode: prevNode,
          transitionToFloor: currNode.floor,
          transitionStairName: transitionStairName
        });

        // Start new segment on next floor
        currentSegmentNodes = [currNode];
      }
    }

    // Final segment
    if (currentSegmentNodes.length > 0) {
      const lastNode = currentSegmentNodes[currentSegmentNodes.length - 1];
      segments.push({
        floor: lastNode.floor,
        nodes: currentSegmentNodes,
        distance: this.calculateSegmentDistance(currentSegmentNodes),
        startNode: currentSegmentNodes[0],
        endNode: lastNode
      });
    }

    return {
      totalDistance,
      segments,
      allNodes
    };
  }

  private calculateSegmentDistance(nodes: GraphNode[]): number {
    let dist = 0;
    for (let i = 1; i < nodes.length; i++) {
      const dx = nodes[i].x - nodes[i - 1].x;
      const dy = nodes[i].y - nodes[i - 1].y;
      dist += Math.sqrt(dx * dx + dy * dy);
    }
    return Math.round(dist);
  }

  /**
   * Search nodes by query string against node id, room code, or search_aliases.
   */
  public searchNodes(query: string): SearchResult[] {
    const trimmed = query.trim().toLowerCase();
    if (!trimmed) return [];

    const results: SearchResult[] = [];
    const seenNodeIds = new Set<string>();

    for (const node of this.nodes.values()) {
      let bestMatch: string | null = null;
      let score = -1;

      // Check ID first
      if (node.id.toLowerCase() === trimmed) {
        bestMatch = node.id;
        score = 100;
      } else if (node.id.toLowerCase().includes(trimmed)) {
        bestMatch = node.id;
        score = 50;
      }

      // Check search_aliases
      for (const alias of node.search_aliases) {
        const aliasLower = alias.toLowerCase();
        if (aliasLower === trimmed) {
          if (100 > score) {
            bestMatch = alias;
            score = 100;
          }
        } else if (aliasLower.startsWith(trimmed)) {
          if (80 > score) {
            bestMatch = alias;
            score = 80;
          }
        } else if (aliasLower.includes(trimmed)) {
          if (40 > score) {
            bestMatch = alias;
            score = 40;
          }
        }
      }

      if (bestMatch !== null && score > 0 && !seenNodeIds.has(node.id)) {
        seenNodeIds.add(node.id);

        results.push({
          node,
          matchedAlias: bestMatch,
          displayName: this.getDisplayName(node),
          score
        });
      }
    }

    // Higher score first (exact matches before partial matches)
    return results.sort((a, b) => b.score - a.score || a.displayName.localeCompare(b.displayName));
  }

  /** Human-friendly label, e.g. "D105 (Floor 1)" or "Cafeteria (Floor 1)". */
  public getDisplayName(node: GraphNode): string {
    const base = node.id.replace(/_f\d+$/, '');
    const roomMatch = node.search_aliases.find(a => /^[A-Z]\d{3}$/.test(a));
    const humanName = roomMatch ?? base.replace(/_/g, ' ');
    return `${humanName} (Floor ${node.floor})`;
  }

  /**
   * Get all nodes list for select dropdowns.
   */
  public getAllNodes(): GraphNode[] {
    return Array.from(this.nodes.values());
  }

  public getNode(id: string): GraphNode | undefined {
    return this.nodes.get(id);
  }
}
