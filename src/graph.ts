import type { FloorDefinition } from './data';
import { buildAliases, extractStairKeys, getDisplayName } from './labels';
import { GraphNode, NavigationPath, RouteSegment, SearchResult } from './types';

/**
 * Стоимость перехода между этажами (в условных пикселях).
 * Намеренно больше любого маршрута внутри этажа (диагональ плана ~1060 px):
 * иначе Дейкстра выбирает «короткий» путь через другой этаж для двух точек
 * на одном этаже. Для межэтажных маршрутов число переходов задано разницей
 * этажей, поэтому штраф не влияет на выбор лестницы, но убирает лишние
 * переэтажные «срезы».
 */
const INTER_FLOOR_COST = 10000;

/** Служебные узлы коридоров не показываем в поиске. */
const INTERNAL_NODE = /_Node\d/i;

export class GraphService {
  private nodes: Map<string, GraphNode> = new Map();
  private adjacency: Map<string, { target: string; weight: number }[]> = new Map();

  /**
   * Объединяет графы всех этажей в один. Id узлов получают префикс этажа,
   * потому что лестницы и служебные узлы называются одинаково на разных этажах.
   */
  public loadFloors(floors: readonly FloorDefinition[]): void {
    this.nodes.clear();
    this.adjacency.clear();

    for (const { floor, graph } of floors) {
      const prefix = this.prefix(floor);

      for (const [rawId, data] of Object.entries(graph.nodes)) {
        const id = prefix + rawId;
        this.nodes.set(id, {
          id,
          rawId,
          x: data.x,
          y: data.y,
          floor,
          search_aliases: buildAliases(rawId)
        });
        this.adjacency.set(id, []);
      }

      for (const edge of graph.edges) {
        this.addEdge(prefix + edge.from, prefix + edge.to);
      }
    }

    this.linkInterFloorStairs();
  }

  private prefix(floor: number): string {
    return `f${floor}:`;
  }

  /** Двунаправленное ребро; вес — евклидово расстояние в пикселях плана. */
  private addEdge(fromId: string, toId: string, weight?: number): void {
    const from = this.nodes.get(fromId);
    const to = this.nodes.get(toId);
    if (!from || !to) return;

    const cost = weight ?? Math.hypot(from.x - to.x, from.y - to.y);
    this.adjacency.get(fromId)!.push({ target: toId, weight: cost });
    this.adjacency.get(toId)!.push({ target: fromId, weight: cost });
  }

  /**
   * Связывает лестницы соседних этажей по каноническим ключам:
   * stairs_D_south, D113_stairs_D_east и stairs_D_south_K108 → D_south.
   * Это позволяет использовать реальные имена узлов из каждого этажа.
   */
  private linkInterFloorStairs(): void {
    const byFloor = new Map<number, { node: GraphNode; keys: string[] }[]>();

    for (const node of this.nodes.values()) {
      const keys = extractStairKeys(node.rawId);
      if (keys.length === 0) continue;

      const list = byFloor.get(node.floor) ?? [];
      list.push({ node, keys });
      byFloor.set(node.floor, list);
    }

    const floorNumbers = Array.from(byFloor.keys()).sort((a, b) => a - b);

    for (let i = 0; i < floorNumbers.length - 1; i++) {
      const current = byFloor.get(floorNumbers[i])!;
      const next = byFloor.get(floorNumbers[i + 1])!;

      for (const a of current) {
        for (const b of next) {
          if (a.keys.some(key => b.keys.includes(key))) {
            this.addEdge(a.node.id, b.node.id, INTER_FLOOR_COST);
          }
        }
      }
    }
  }

  /**
   * Алгоритм Дейкстры. Возвращает путь, разбитый по этажам.
   */
  public findShortestPath(startNodeId: string, endNodeId: string): NavigationPath | null {
    const start = this.nodes.get(startNodeId);
    const end = this.nodes.get(endNodeId);
    if (!start || !end) return null;

    if (startNodeId === endNodeId) {
      return {
        segments: [{ floor: start.floor, nodes: [start], endNode: start }]
      };
    }

    const distances = new Map<string, number>();
    const previous = new Map<string, string | null>();
    const unvisited = new Set<string>();

    for (const id of this.nodes.keys()) {
      distances.set(id, Infinity);
      previous.set(id, null);
      unvisited.add(id);
    }
    distances.set(startNodeId, 0);

    while (unvisited.size > 0) {
      let currentId: string | null = null;
      let smallest = Infinity;

      for (const id of unvisited) {
        const distance = distances.get(id)!;
        if (distance < smallest) {
          smallest = distance;
          currentId = id;
        }
      }

      if (currentId === null || smallest === Infinity || currentId === endNodeId) break;
      unvisited.delete(currentId);

      for (const neighbor of this.adjacency.get(currentId) ?? []) {
        if (!unvisited.has(neighbor.target)) continue;

        const candidate = smallest + neighbor.weight;
        if (candidate < distances.get(neighbor.target)!) {
          distances.set(neighbor.target, candidate);
          previous.set(neighbor.target, currentId);
        }
      }
    }

    const pathIds: string[] = [];
    let cursor: string | null = endNodeId;

    while (cursor !== null) {
      pathIds.unshift(cursor);
      cursor = previous.get(cursor) ?? null;
    }

    if (pathIds[0] !== startNodeId) return null;

    const allNodes = pathIds.map(id => this.nodes.get(id)!);
    return { segments: this.chunkByFloor(allNodes) };
  }

  /** Делит маршрут на участки одного этажа и помечает переходы. */
  private chunkByFloor(allNodes: GraphNode[]): RouteSegment[] {
    const segments: RouteSegment[] = [];
    let segmentNodes: GraphNode[] = [allNodes[0]];

    for (let i = 1; i < allNodes.length; i++) {
      const previous = allNodes[i - 1];
      const current = allNodes[i];

      if (current.floor === previous.floor) {
        segmentNodes.push(current);
        continue;
      }

      segments.push({
        floor: previous.floor,
        nodes: segmentNodes,
        endNode: previous,
        transitionToFloor: current.floor
      });
      segmentNodes = [current];
    }

    const last = segmentNodes[segmentNodes.length - 1];
    segments.push({ floor: last.floor, nodes: segmentNodes, endNode: last });

    return segments;
  }

  /** Поиск по исходному id и всем алиасам (рус/англ, номера аудиторий). */
  public searchNodes(query: string): SearchResult[] {
    const needle = query.trim().toLowerCase();
    if (!needle) return [];

    const results: SearchResult[] = [];

    for (const node of this.nodes.values()) {
      if (INTERNAL_NODE.test(node.rawId)) continue;

      let bestMatch: string | null = null;
      let score = 0;

      if (node.rawId.toLowerCase().includes(needle)) {
        bestMatch = node.rawId;
        score = 50;
      }

      for (const alias of node.search_aliases) {
        const value = alias.toLowerCase();
        if (value === needle) {
          bestMatch = alias;
          score = 100;
          break;
        }
        if (value.startsWith(needle) && score < 80) {
          bestMatch = alias;
          score = 80;
        } else if (value.includes(needle) && score < 40) {
          bestMatch = alias;
          score = 40;
        }
      }

      if (bestMatch !== null) {
        results.push({
          node,
          matchedAlias: bestMatch,
          displayName: getDisplayName(node),
          score
        });
      }
    }

    return results.sort((a, b) =>
      b.score - a.score ||
      a.displayName.length - b.displayName.length ||
      a.displayName.localeCompare(b.displayName, 'ru')
    );
  }

  public getAllNodes(): GraphNode[] {
    return Array.from(this.nodes.values()).filter(node => !INTERNAL_NODE.test(node.rawId));
  }

  public getNode(id: string): GraphNode | undefined {
    return this.nodes.get(id);
  }
}
