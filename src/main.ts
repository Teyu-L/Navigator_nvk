import './style.css';
import { GraphService } from './graph';
import { MapRenderer } from './renderer';
import { UIController } from './ui';
import { NavigationPath, RouteSegment } from './types';

const FLOOR_DATA_URLS = [
  '/data/floor1.json',
  '/data/floor2.json',
  '/data/floor3.json'
];

const FLOOR_IMAGES: Record<number, string> = {
  1: '/maps/floor1.png',
  2: '/maps/floor2.png',
  3: '/maps/floor3.png'
};

class AppController {
  private graph = new GraphService();
  private renderer!: MapRenderer;
  private ui!: UIController;

  private currentPath: NavigationPath | null = null;
  private activeSegmentIndex: number = 0;
  private floorRequestId: number = 0;

  public async init(): Promise<void> {
    try {
      await this.graph.loadAndMergeGraphs(FLOOR_DATA_URLS);

      this.renderer = new MapRenderer('map-container');
      this.ui = new UIController(this.graph, {
        onRouteCalculate: (startId, endId) => this.handleRoute(startId, endId),
        onFloorChange: (floor) => this.handleFloorChange(floor),
        onClearRoute: () => this.handleClearRoute(),
        onSelectSegment: (index) => this.handleSelectSegment(index)
      });

      this.wireMapControls();
      await this.showFloor(1, null);
      this.hideLoading();
      this.handleDeepLink();
    } catch (error) {
      console.error('Failed to initialize UniNav:', error);
      this.showFatalError(error);
    }
  }

  private wireMapControls(): void {
    document.getElementById('zoom-in-btn')?.addEventListener('click', () => this.renderer.zoomIn());
    document.getElementById('zoom-out-btn')?.addEventListener('click', () => this.renderer.zoomOut());
    document.getElementById('zoom-reset-btn')?.addEventListener('click', () => this.renderer.resetZoom());
  }

  /** Calculate route and show its first floor segment. */
  private handleRoute(startId: string, endId: string): void {
    const path = this.graph.findShortestPath(startId, endId);

    if (!path || path.segments.length === 0) {
      this.currentPath = null;
      this.activeSegmentIndex = 0;
      const start = this.graph.getNode(startId) ?? null;
      const end = this.graph.getNode(endId) ?? null;
      this.renderer.setRouteData(start, end, null);
      this.ui.updateRouteInfo(null);
      return;
    }

    this.currentPath = path;
    this.activeSegmentIndex = 0;

    const firstFloor = path.segments[0].floor;
    const end = this.graph.getNode(endId) ?? null;

    // Show start/end immediately (markers), then switch to the first route floor.
    this.renderer.setRouteData(this.graph.getNode(startId) ?? null, end, null);
    this.ui.updateRouteInfo(path, 0);

    void this.showFloor(firstFloor, path.segments[0]);
  }

  /** Manual floor switch via the floating floor buttons. */
  private handleFloorChange(floor: number): void {
    if (!this.currentPath) {
      void this.showFloor(floor, null);
      return;
    }

    const segmentIndex = this.findSegmentIndexForFloor(floor);
    const segment = segmentIndex >= 0 ? this.currentPath.segments[segmentIndex] : null;

    if (segmentIndex >= 0) {
      this.activeSegmentIndex = segmentIndex;
    }

    void this.showFloor(floor, segment);
  }

  /** Tapping a step in the multi-floor route bar. */
  private handleSelectSegment(index: number): void {
    if (!this.currentPath) return;
    const segment = this.currentPath.segments[index];
    if (!segment) return;

    this.activeSegmentIndex = index;
    void this.showFloor(segment.floor, segment);
  }

  private handleClearRoute(): void {
    this.currentPath = null;
    this.activeSegmentIndex = 0;
    this.renderer.setRouteData(null, null, null);
  }

  /**
   * Loads an image and draws the given segment. Guarded against rapid floor
   * switching (only the latest request is allowed to update the overlay).
   */
  private async showFloor(floor: number, segment: RouteSegment | null): Promise<void> {
    const requestId = ++this.floorRequestId;

    this.ui.setActiveFloorUI(floor);

    try {
      await this.renderer.setFloorImage(FLOOR_IMAGES[floor], floor);
    } catch (error) {
      console.error(error);
      return;
    }

    if (requestId !== this.floorRequestId) return;

    const start = this.ui.getSelectedStartNode();
    const end = this.ui.getSelectedEndNode();

    this.renderer.setRouteData(start, end, segment);
    if (this.currentPath) {
      this.ui.updateRouteInfo(this.currentPath, this.activeSegmentIndex);
    }
  }

  /** First segment on a floor (earlier segments win if a path visits it twice). */
  private findSegmentIndexForFloor(floor: number): number {
    if (!this.currentPath) return -1;
    return this.currentPath.segments.findIndex(segment => segment.floor === floor);
  }

  /** ?from=ID&to=ID deep link support. */
  private handleDeepLink(): void {
    const params = new URLSearchParams(window.location.search);
    const from = params.get('from');
    const to = params.get('to');
    if (!from || !to) return;

    const resolve = (value: string): string | null => {
      if (this.graph.getNode(value)) return value;
      const results = this.graph.searchNodes(value);
      return results.length > 0 ? results[0].node.id : null;
    };

    const startId = resolve(from);
    const endId = resolve(to);
    if (startId && endId) {
      this.ui.setSelectedNodes(startId, endId);
    }
  }

  private hideLoading(): void {
    const overlay = document.getElementById('loading-overlay');
    if (overlay) overlay.classList.add('hidden');
  }

  private showFatalError(error: unknown): void {
    const overlay = document.getElementById('loading-overlay');
    if (!overlay) return;
    overlay.classList.remove('hidden');
    overlay.innerHTML = `
      <div class="fatal-error">
        <div class="fatal-icon">⚠️</div>
        <h2>Could not load the map</h2>
        <p>${error instanceof Error ? error.message : 'Unknown error'}</p>
        <button onclick="window.location.reload()" class="btn btn-secondary">Retry</button>
      </div>
    `;
  }
}

new AppController().init();
