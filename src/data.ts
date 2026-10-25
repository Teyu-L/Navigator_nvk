import type { GraphData } from './types';

import floor1Graph from '../map/final_graph_floor1.json';
import floor2Graph from '../map/final_graph_floor2.json';
import floor3Graph from '../map/final_graph_floor3.json';

import floor1Map from '../map/1floor.svg';
import floor2Map from '../map/2floor.svg';
import floor3Map from '../map/3floor.svg';

export interface FloorDefinition {
  floor: number;
  imageUrl: string;
  graph: GraphData;
}

/**
 * Единственный источник данных приложения: реальные планы и графы из map/.
 * Vite импортирует JSON и SVG напрямую, поэтому копий в public/ нет.
 */
export const FLOORS: readonly FloorDefinition[] = [
  { floor: 1, imageUrl: floor1Map, graph: floor1Graph },
  { floor: 2, imageUrl: floor2Map, graph: floor2Graph },
  { floor: 3, imageUrl: floor3Map, graph: floor3Graph }
];
