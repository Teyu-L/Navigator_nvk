import { GraphNode, SearchResult, NavigationPath, RouteSegment } from './types';
import { GraphService } from './graph';

export interface UICallbacks {
  onRouteCalculate: (startNodeId: string, endNodeId: string) => void;
  onFloorChange: (floor: number) => void;
  onClearRoute: () => void;
  onSelectSegment: (segmentIndex: number) => void;
}

export class UIController {
  private graphService: GraphService;
  private callbacks: UICallbacks;

  private startInput!: HTMLInputElement;
  private startDropdown!: HTMLElement;
  private endInput!: HTMLInputElement;
  private endDropdown!: HTMLElement;
  private swapBtn!: HTMLButtonElement;

  private selectedStartNode: GraphNode | null = null;
  private selectedEndNode: GraphNode | null = null;

  private floorButtons: Map<number, HTMLButtonElement> = new Map();
  private routeInfoContainer!: HTMLElement;
  private segmentBar!: HTMLElement;

  constructor(graphService: GraphService, callbacks: UICallbacks) {
    this.graphService = graphService;
    this.callbacks = callbacks;

    this.bindDOM();
    this.initSearchInputs();
    this.initFloorButtons();
    this.initActionButtons();
  }

  private bindDOM(): void {
    this.startInput = document.getElementById('start-input') as HTMLInputElement;
    this.startDropdown = document.getElementById('start-dropdown') as HTMLElement;
    this.endInput = document.getElementById('end-input') as HTMLInputElement;
    this.endDropdown = document.getElementById('end-dropdown') as HTMLElement;
    this.swapBtn = document.getElementById('swap-btn') as HTMLButtonElement;
    this.routeInfoContainer = document.getElementById('route-info') as HTMLElement;
    this.segmentBar = document.getElementById('segment-bar') as HTMLElement;

    // Floor switcher buttons
    [1, 2, 3].forEach(floor => {
      const btn = document.getElementById(`floor-btn-${floor}`) as HTMLButtonElement;
      if (btn) this.floorButtons.set(floor, btn);
    });
  }

  private initSearchInputs(): void {
    // Start Input typing
    this.startInput.addEventListener('input', () => {
      const query = this.startInput.value;
      this.renderDropdown(this.startDropdown, query, (result) => {
        this.selectedStartNode = result.node;
        this.startInput.value = result.displayName;
        this.startDropdown.classList.add('hidden');
        this.triggerCalculationIfReady();
      });
    });

    this.startInput.addEventListener('focus', () => {
      if (!this.startInput.value) {
        this.renderAllNodesDropdown(this.startDropdown, (result) => {
          this.selectedStartNode = result.node;
          this.startInput.value = result.displayName;
          this.startDropdown.classList.add('hidden');
          this.triggerCalculationIfReady();
        });
      }
    });

    // End Input typing
    this.endInput.addEventListener('input', () => {
      const query = this.endInput.value;
      this.renderDropdown(this.endDropdown, query, (result) => {
        this.selectedEndNode = result.node;
        this.endInput.value = result.displayName;
        this.endDropdown.classList.add('hidden');
        this.triggerCalculationIfReady();
      });
    });

    this.endInput.addEventListener('focus', () => {
      if (!this.endInput.value) {
        this.renderAllNodesDropdown(this.endDropdown, (result) => {
          this.selectedEndNode = result.node;
          this.endInput.value = result.displayName;
          this.endDropdown.classList.add('hidden');
          this.triggerCalculationIfReady();
        });
      }
    });

    // Close dropdowns when clicking outside
    document.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      if (!target.closest('.search-group')) {
        this.startDropdown.classList.add('hidden');
        this.endDropdown.classList.add('hidden');
      }
    });

    // Swap A and B button
    this.swapBtn.addEventListener('click', () => {
      const tempNode = this.selectedStartNode;
      const tempText = this.startInput.value;

      this.selectedStartNode = this.selectedEndNode;
      this.startInput.value = this.endInput.value;

      this.selectedEndNode = tempNode;
      this.endInput.value = tempText;

      this.triggerCalculationIfReady();
    });
  }

  private renderDropdown(
    dropdownEl: HTMLElement,
    query: string,
    onSelect: (res: SearchResult) => void
  ): void {
    const results = this.graphService.searchNodes(query);
    dropdownEl.innerHTML = '';

    if (results.length === 0) {
      dropdownEl.innerHTML = `<div class="dropdown-empty">No locations found</div>`;
      dropdownEl.classList.remove('hidden');
      return;
    }

    results.slice(0, 8).forEach(res => {
      const item = document.createElement('div');
      item.className = 'dropdown-item';
      item.innerHTML = `
        <div class="item-title">${res.displayName}</div>
        <div class="item-sub">Matched: "${res.matchedAlias}" • Floor ${res.node.floor}</div>
      `;
      item.addEventListener('click', () => onSelect(res));
      dropdownEl.appendChild(item);
    });

    dropdownEl.classList.remove('hidden');
  }

  private renderAllNodesDropdown(
    dropdownEl: HTMLElement,
    onSelect: (res: SearchResult) => void
  ): void {
    const allNodes = this.graphService.getAllNodes();
    // Filter out internal passage nodes with _Node
    const selectable = allNodes.filter(n => !n.id.includes('_Node'));

    dropdownEl.innerHTML = '';
    selectable.slice(0, 10).forEach(node => {
      const res: SearchResult = {
        node,
        matchedAlias: node.id,
        displayName: this.graphService.getDisplayName(node),
        score: 100
      };

      const item = document.createElement('div');
      item.className = 'dropdown-item';
      item.innerHTML = `
        <div class="item-title">${res.displayName}</div>
        <div class="item-sub">Floor ${node.floor}</div>
      `;
      item.addEventListener('click', () => onSelect(res));
      dropdownEl.appendChild(item);
    });

    dropdownEl.classList.remove('hidden');
  }

  private triggerCalculationIfReady(): void {
    if (this.selectedStartNode && this.selectedEndNode) {
      this.callbacks.onRouteCalculate(this.selectedStartNode.id, this.selectedEndNode.id);
    }
  }

  private initFloorButtons(): void {
    this.floorButtons.forEach((btn, floor) => {
      btn.addEventListener('click', () => {
        this.setActiveFloorUI(floor);
        this.callbacks.onFloorChange(floor);
      });
    });
  }

  public setActiveFloorUI(floor: number): void {
    this.floorButtons.forEach((btn, f) => {
      if (f === floor) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });
  }

  private initActionButtons(): void {
    const clearBtn = document.getElementById('clear-btn') as HTMLButtonElement;
    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        this.selectedStartNode = null;
        this.selectedEndNode = null;
        this.startInput.value = '';
        this.endInput.value = '';
        this.routeInfoContainer.classList.add('hidden');
        this.segmentBar.classList.add('hidden');
        this.callbacks.onClearRoute();
      });
    }

    // Quick chips
    const quickChips = document.querySelectorAll('.chip');
    quickChips.forEach(chip => {
      chip.addEventListener('click', () => {
        const targetQuery = chip.getAttribute('data-target') || '';
        const searchRes = this.graphService.searchNodes(targetQuery);
        if (searchRes.length > 0) {
          const match = searchRes[0];
          if (!this.selectedStartNode) {
            this.selectedStartNode = match.node;
            this.startInput.value = match.displayName;
          } else {
            this.selectedEndNode = match.node;
            this.endInput.value = match.displayName;
          }
          this.triggerCalculationIfReady();
        }
      });
    });
  }

  /**
   * Updates route summary banner and segment progress indicators.
   */
  public updateRouteInfo(path: NavigationPath | null, activeSegmentIndex: number = 0): void {
    if (!path) {
      this.routeInfoContainer.innerHTML = `
        <div class="route-error">
          ⚠️ No direct path found between the selected locations.
        </div>
      `;
      this.routeInfoContainer.classList.remove('hidden');
      this.segmentBar.classList.add('hidden');
      return;
    }

    if (path.totalDistance === 0 && path.segments.length === 1) {
      this.routeInfoContainer.innerHTML = `
        <div class="route-same">
          📍 Start and Destination are the same point!
        </div>
      `;
      this.routeInfoContainer.classList.remove('hidden');
      this.segmentBar.classList.add('hidden');
      return;
    }

    // Distance estimation: ~1 pixel = 0.5 meters
    const approxMeters = Math.round(path.totalDistance * 0.5);
    const approxTimeMin = Math.max(1, Math.ceil(approxMeters / 70));

    const isMultiFloor = path.segments.length > 1;

    this.routeInfoContainer.innerHTML = `
      <div class="route-summary">
        <div class="summary-metric">
          <span class="metric-icon">🚶</span>
          <span class="metric-value">~${approxMeters}m</span>
        </div>
        <div class="summary-metric">
          <span class="metric-icon">⏱️</span>
          <span class="metric-value">~${approxTimeMin} min</span>
        </div>
        <div class="summary-metric">
          <span class="metric-icon">🏢</span>
          <span class="metric-value">${path.segments.length} Floor${path.segments.length > 1 ? 's' : ''}</span>
        </div>
      </div>
    `;
    this.routeInfoContainer.classList.remove('hidden');

    // Segment steps UI
    if (isMultiFloor) {
      this.renderSegmentBar(path.segments, activeSegmentIndex);
    } else {
      this.segmentBar.classList.add('hidden');
    }
  }

  private renderSegmentBar(segments: RouteSegment[], activeIndex: number): void {
    this.segmentBar.innerHTML = '';
    
    segments.forEach((seg, idx) => {
      const stepBtn = document.createElement('button');
      stepBtn.className = `segment-step ${idx === activeIndex ? 'active' : ''}`;
      
      const transitionText = seg.transitionToFloor !== undefined 
        ? `→ Floor ${seg.transitionToFloor}`
        : 'Destination';

      stepBtn.innerHTML = `
        <span class="step-num">${idx + 1}</span>
        <span class="step-label">Floor ${seg.floor} ${transitionText}</span>
      `;

      stepBtn.addEventListener('click', () => {
        this.callbacks.onSelectSegment(idx);
      });

      this.segmentBar.appendChild(stepBtn);
    });

    this.segmentBar.classList.remove('hidden');
  }

  public getSelectedStartNode(): GraphNode | null {
    return this.selectedStartNode;
  }

  public getSelectedEndNode(): GraphNode | null {
    return this.selectedEndNode;
  }

  /**
   * Programmatically select A/B (used for shared links and demo routes).
   */
  public setSelectedNodes(startId: string, endId: string): void {
    const start = this.graphService.getNode(startId);
    const end = this.graphService.getNode(endId);
    if (!start || !end) return;

    this.selectedStartNode = start;
    this.selectedEndNode = end;
    this.startInput.value = this.graphService.getDisplayName(start);
    this.endInput.value = this.graphService.getDisplayName(end);
    this.callbacks.onRouteCalculate(start.id, end.id);
  }
}
