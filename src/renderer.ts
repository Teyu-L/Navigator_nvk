import { GraphNode, RouteSegment } from './types';

/**
 * MapRenderer
 * -----------
 * Draws the route overlay on a canvas that is pixel-aligned with the floor
 * plan image. The image + canvas live inside a single "stage" element, which
 * is what gets scaled/panned, so path geometry always stays glued to the plan
 * no matter how the map is zoomed or what size the phone screen is.
 */
export class MapRenderer {
  private container: HTMLElement;
  private stage: HTMLDivElement;
  private imgElement: HTMLImageElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;

  private currentFloor: number = 1;
  private activePathSegment: RouteSegment | null = null;
  private startNode: GraphNode | null = null;
  private endNode: GraphNode | null = null;
  private imageRequestId: number = 0;

  private scale: number = 1;      // current absolute scale
  private fitScale: number = 1;   // scale that fits the stage into the viewport
  private minScale: number = 0.2;
  private maxScale: number = 6;
  private translateX: number = 0;
  private translateY: number = 0;

  private isDragging: boolean = false;
  private dragStartX: number = 0;
  private dragStartY: number = 0;
  private lastTranslateX: number = 0;
  private lastTranslateY: number = 0;

  private pinchStartDist: number = 0;
  private pinchStartScale: number = 1;

  constructor(containerId: string) {
    const container = document.getElementById(containerId);
    if (!container) throw new Error(`Container #${containerId} not found`);
    this.container = container;

    this.stage = document.createElement('div');
    this.stage.className = 'map-stage';

    this.imgElement = document.createElement('img');
    this.imgElement.className = 'map-image';
    this.imgElement.alt = 'Floor plan';

    this.canvas = document.createElement('canvas');
    this.canvas.className = 'map-canvas';

    this.stage.appendChild(this.imgElement);
    this.stage.appendChild(this.canvas);
    this.container.appendChild(this.stage);

    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('Could not get Canvas 2D Context');
    this.ctx = ctx;

    this.initPanAndZoom();
    this.initResizeObserver();
  }

  /* ------------------------------------------------------------------ */
  /* Floor / data API                                                   */
  /* ------------------------------------------------------------------ */

  /**
   * Loads a floor plan image and syncs the canvas backing store to the
   * image's natural dimensions (this is the coordinate space used by nodes).
   */
  public async setFloorImage(imageUrl: string, floor: number): Promise<void> {
    this.currentFloor = floor;
    const requestId = ++this.imageRequestId;

    return new Promise((resolve, reject) => {
      this.imgElement.onload = () => {
        // A newer floor was requested while this image was loading — ignore.
        if (requestId !== this.imageRequestId) {
          resolve();
          return;
        }

        const naturalW = this.imgElement.naturalWidth || 750;
        const naturalH = this.imgElement.naturalHeight || 750;

        this.stage.style.width = `${naturalW}px`;
        this.stage.style.height = `${naturalH}px`;

        // 1 canvas pixel === 1 image pixel === 1 graph unit
        this.canvas.width = naturalW;
        this.canvas.height = naturalH;

        this.fitToContainer();
        this.redraw();
        resolve();
      };
      this.imgElement.onerror = () => reject(new Error(`Failed to load floor image: ${imageUrl}`));
      this.imgElement.src = imageUrl;
    });
  }

  /**
   * Updates start / end markers and the segment currently being shown.
   */
  public setRouteData(
    start: GraphNode | null,
    end: GraphNode | null,
    segment: RouteSegment | null
  ): void {
    this.startNode = start;
    this.endNode = end;
    this.activePathSegment = segment;
    this.redraw();
  }

  public getActiveFloor(): number {
    return this.currentFloor;
  }

  /* ------------------------------------------------------------------ */
  /* Drawing                                                            */
  /* ------------------------------------------------------------------ */

  public redraw(): void {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    if (this.activePathSegment && this.activePathSegment.floor === this.currentFloor) {
      this.drawPathLine(this.activePathSegment.nodes);
    }

    this.drawMarkers();
  }

  private drawPathLine(nodes: GraphNode[]): void {
    if (nodes.length < 2) return;

    this.ctx.save();

    // Soft glow behind the route
    this.ctx.shadowColor = 'rgba(37, 99, 235, 0.45)';
    this.ctx.shadowBlur = 12;

    // Outer casing keeps the line readable over dark plan lines
    this.ctx.beginPath();
    this.ctx.moveTo(nodes[0].x, nodes[0].y);
    for (let i = 1; i < nodes.length; i++) {
      this.ctx.lineTo(nodes[i].x, nodes[i].y);
    }
    this.ctx.strokeStyle = '#1D4ED8';
    this.ctx.lineWidth = 10;
    this.ctx.lineCap = 'round';
    this.ctx.lineJoin = 'round';
    this.ctx.stroke();

    // Bright inner line
    this.ctx.beginPath();
    this.ctx.moveTo(nodes[0].x, nodes[0].y);
    for (let i = 1; i < nodes.length; i++) {
      this.ctx.lineTo(nodes[i].x, nodes[i].y);
    }
    this.ctx.strokeStyle = '#3B82F6';
    this.ctx.lineWidth = 6;
    this.ctx.stroke();

    this.drawDirectionArrows(nodes);
    this.ctx.restore();
  }

  private drawDirectionArrows(nodes: GraphNode[]): void {
    this.ctx.fillStyle = '#FFFFFF';

    for (let i = 0; i < nodes.length - 1; i++) {
      const p1 = nodes[i];
      const p2 = nodes[i + 1];
      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist < 34) continue;

      const midX = (p1.x + p2.x) / 2;
      const midY = (p1.y + p2.y) / 2;

      this.ctx.save();
      this.ctx.translate(midX, midY);
      this.ctx.rotate(Math.atan2(dy, dx));

      this.ctx.beginPath();
      this.ctx.moveTo(7, 0);
      this.ctx.lineTo(-6, -5.5);
      this.ctx.lineTo(-3, 0);
      this.ctx.lineTo(-6, 5.5);
      this.ctx.closePath();
      this.ctx.fill();

      this.ctx.restore();
    }
  }

  private drawMarkers(): void {
    if (this.startNode && this.startNode.floor === this.currentFloor) {
      this.drawPin(this.startNode.x, this.startNode.y, '#10B981', 'A', 'Start');
    }

    if (this.endNode && this.endNode.floor === this.currentFloor) {
      this.drawPin(this.endNode.x, this.endNode.y, '#EF4444', 'B', 'Destination');
    }

    const seg = this.activePathSegment;
    if (seg && seg.floor === this.currentFloor && seg.transitionToFloor !== undefined) {
      const stairNode = seg.endNode;
      const isUp = seg.transitionToFloor > this.currentFloor;
      const label = `${isUp ? 'Go up' : 'Go down'} → Floor ${seg.transitionToFloor}`;
      this.drawStairMarker(stairNode.x, stairNode.y, label);
    }
  }

  private drawPin(x: number, y: number, color: string, label: string, title: string): void {
    this.ctx.save();

    // Halo
    this.ctx.beginPath();
    this.ctx.arc(x, y, 16, 0, Math.PI * 2);
    this.ctx.fillStyle = color + '33';
    this.ctx.fill();

    // Badge
    this.ctx.beginPath();
    this.ctx.arc(x, y, 12, 0, Math.PI * 2);
    this.ctx.fillStyle = color;
    this.ctx.fill();
    this.ctx.strokeStyle = '#FFFFFF';
    this.ctx.lineWidth = 2.5;
    this.ctx.stroke();

    this.ctx.fillStyle = '#FFFFFF';
    this.ctx.font = 'bold 12px "Plus Jakarta Sans", sans-serif';
    this.ctx.textAlign = 'center';
    this.ctx.textBaseline = 'middle';
    this.ctx.fillText(label, x, y + 0.5);

    // Tooltip
    this.ctx.font = '600 11px "Plus Jakarta Sans", sans-serif';
    const textWidth = this.ctx.measureText(title).width;
    const bannerW = textWidth + 14;
    const bannerH = 19;
    const bannerX = x - bannerW / 2;
    const bannerY = y - 34;

    this.ctx.fillStyle = 'rgba(15, 23, 42, 0.88)';
    this.roundRect(bannerX, bannerY, bannerW, bannerH, 5);
    this.ctx.fill();

    this.ctx.fillStyle = '#FFFFFF';
    this.ctx.textAlign = 'center';
    this.ctx.textBaseline = 'middle';
    this.ctx.fillText(title, x, bannerY + bannerH / 2 + 0.5);

    this.ctx.restore();
  }

  private drawStairMarker(x: number, y: number, label: string): void {
    this.ctx.save();

    this.ctx.beginPath();
    this.ctx.arc(x, y, 14, 0, Math.PI * 2);
    this.ctx.fillStyle = '#8B5CF6';
    this.ctx.fill();
    this.ctx.strokeStyle = '#FFFFFF';
    this.ctx.lineWidth = 2.5;
    this.ctx.stroke();

    this.ctx.fillStyle = '#FFFFFF';
    this.ctx.font = '13px "Plus Jakarta Sans", sans-serif';
    this.ctx.textAlign = 'center';
    this.ctx.textBaseline = 'middle';
    this.ctx.fillText('🛗', x, y + 0.5);

    this.ctx.font = '700 11px "Plus Jakarta Sans", sans-serif';
    const textWidth = this.ctx.measureText(label).width;
    const bannerW = textWidth + 16;
    const bannerH = 22;
    const bannerX = x - bannerW / 2;
    const bannerY = y - 38;

    this.ctx.fillStyle = '#4C1D95';
    this.roundRect(bannerX, bannerY, bannerW, bannerH, 6);
    this.ctx.fill();
    this.ctx.strokeStyle = '#DDD6FE';
    this.ctx.lineWidth = 1.5;
    this.ctx.stroke();

    this.ctx.fillStyle = '#FFFFFF';
    this.ctx.textAlign = 'center';
    this.ctx.textBaseline = 'middle';
    this.ctx.fillText(label, x, bannerY + bannerH / 2 + 0.5);

    this.ctx.restore();
  }

  private roundRect(x: number, y: number, w: number, h: number, r: number): void {
    this.ctx.beginPath();
    this.ctx.moveTo(x + r, y);
    this.ctx.arcTo(x + w, y, x + w, y + h, r);
    this.ctx.arcTo(x + w, y + h, x, y + h, r);
    this.ctx.arcTo(x, y + h, x, y, r);
    this.ctx.arcTo(x, y, x + w, y, r);
    this.ctx.closePath();
  }

  /* ------------------------------------------------------------------ */
  /* Pan & Zoom                                                         */
  /* ------------------------------------------------------------------ */

  private initPanAndZoom(): void {
    const el = this.container;

    el.addEventListener('wheel', (e: WheelEvent) => {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.15 : 0.87;
      this.zoomAtPoint(this.scale * factor, e.clientX, e.clientY);
    }, { passive: false });

    el.addEventListener('mousedown', (e: MouseEvent) => {
      this.isDragging = true;
      this.dragStartX = e.clientX;
      this.dragStartY = e.clientY;
      this.lastTranslateX = this.translateX;
      this.lastTranslateY = this.translateY;
      el.classList.add('dragging');
    });

    window.addEventListener('mousemove', (e: MouseEvent) => {
      if (!this.isDragging) return;
      this.translateX = this.lastTranslateX + (e.clientX - this.dragStartX);
      this.translateY = this.lastTranslateY + (e.clientY - this.dragStartY);
      this.applyTransform();
    });

    window.addEventListener('mouseup', () => {
      if (!this.isDragging) return;
      this.isDragging = false;
      el.classList.remove('dragging');
    });

    el.addEventListener('touchstart', (e: TouchEvent) => {
      if (e.touches.length === 1) {
        this.isDragging = true;
        this.dragStartX = e.touches[0].clientX;
        this.dragStartY = e.touches[0].clientY;
        this.lastTranslateX = this.translateX;
        this.lastTranslateY = this.translateY;
      } else if (e.touches.length === 2) {
        this.isDragging = false;
        this.pinchStartDist = this.touchDistance(e.touches);
        this.pinchStartScale = this.scale;
      }
    }, { passive: true });

    el.addEventListener('touchmove', (e: TouchEvent) => {
      if (e.touches.length === 1 && this.isDragging) {
        e.preventDefault();
        this.translateX = this.lastTranslateX + (e.touches[0].clientX - this.dragStartX);
        this.translateY = this.lastTranslateY + (e.touches[0].clientY - this.dragStartY);
        this.applyTransform();
      } else if (e.touches.length === 2) {
        e.preventDefault();
        const dist = this.touchDistance(e.touches);
        if (this.pinchStartDist > 0) {
          const targetScale = this.pinchStartScale * (dist / this.pinchStartDist);
          const midX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
          const midY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
          this.zoomAtPoint(targetScale, midX, midY);
        }
      }
    }, { passive: false });

    el.addEventListener('touchend', () => {
      this.isDragging = false;
      this.pinchStartDist = 0;
    });

    el.addEventListener('dblclick', (e: MouseEvent) => {
      this.zoomAtPoint(this.scale * 1.6, e.clientX, e.clientY);
    });
  }

  private touchDistance(touches: TouchList): number {
    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    return Math.sqrt(dx * dx + dy * dy);
  }

  public zoomIn(): void {
    const rect = this.container.getBoundingClientRect();
    this.zoomAtPoint(this.scale * 1.3, rect.left + rect.width / 2, rect.top + rect.height / 2);
  }

  public zoomOut(): void {
    const rect = this.container.getBoundingClientRect();
    this.zoomAtPoint(this.scale * 0.77, rect.left + rect.width / 2, rect.top + rect.height / 2);
  }

  /** Smoothly re-fit the plan and recenter. */
  public resetZoom(): void {
    this.fitToContainer();
  }

  /**
   * Zoom keeping the pointer position anchored. Because the stage has
   * transform-origin 0 0, translate is in screen pixels before scaling.
   */
  private zoomAtPoint(targetScale: number, clientX: number, clientY: number): void {
    const rect = this.container.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;

    const newScale = Math.min(Math.max(this.minScale, targetScale), this.maxScale);
    const ratio = newScale / this.scale;

    this.translateX = x - (x - this.translateX) * ratio;
    this.translateY = y - (y - this.translateY) * ratio;
    this.scale = newScale;

    this.applyTransform();
  }

  /** Scale the stage so the whole plan is visible, centered in the viewport. */
  private fitToContainer(): void {
    const rect = this.container.getBoundingClientRect();
    const stageW = parseFloat(this.stage.style.width) || this.canvas.width || 750;
    const stageH = parseFloat(this.stage.style.height) || this.canvas.height || 750;

    const padding = 12;
    const availableW = Math.max(1, rect.width - padding * 2);
    const availableH = Math.max(1, rect.height - padding * 2);

    this.fitScale = Math.min(availableW / stageW, availableH / stageH);
    this.scale = this.fitScale;
    this.minScale = this.fitScale * 0.85;
    this.maxScale = this.fitScale * 7;

    this.translateX = (rect.width - stageW * this.scale) / 2;
    this.translateY = (rect.height - stageH * this.scale) / 2;

    this.applyTransform();
  }

  private applyTransform(): void {
    this.stage.style.transform =
      `translate(${this.translateX}px, ${this.translateY}px) scale(${this.scale})`;
  }

  private initResizeObserver(): void {
    const ro = new ResizeObserver(() => {
      this.fitToContainer();
    });
    ro.observe(this.container);
  }
}
