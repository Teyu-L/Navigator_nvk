import { GraphNode, RouteSegment } from './types';

/**
 * Базовая система координат графов. JSON-файлы в map/ были размечены по
 * растровым планам 750×750, поэтому все x/y в графах заданы именно в этих
 * единицах, независимо от того, какого размера SVG сейчас на экране.
 */
const BASE_WIDTH = 750;
const BASE_HEIGHT = 750;

/** Пересчёт координат графа в текущие CSS-пиксели плана на экране. */
interface RenderMetrics {
  width: number;
  height: number;
  scaleX: number;
  scaleY: number;
  dpr: number;
}

/**
 * MapRenderer
 * -----------
 * Draws the route overlay on a canvas that is pixel-aligned with the floor
 * plan image. The image sits in a transformed "stage" (pan/zoom), while the
 * canvas lives in screen space above it and is re-sized/re-drawn on every
 * transform. This keeps the route glued to the plan at any display size and
 * lets the SVG stay sharp when zoomed.
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

  /** rAF-хэндл, чтобы не перерисовывать canvas несколько раз за кадр. */
  private overlayFrame: number | null = null;

  /** Resize/orientation должны пересчитать fit и слой canvas. */
  private handleViewportResize = (): void => {
    this.fitToContainer();
  };

  constructor(containerId: string) {
    const container = document.getElementById(containerId);
    if (!container) throw new Error(`Container #${containerId} not found`);
    this.container = container;

    this.stage = document.createElement('div');
    this.stage.className = 'map-stage';

    this.imgElement = document.createElement('img');
    this.imgElement.className = 'map-image';
    this.imgElement.alt = 'План этажа';

    this.canvas = document.createElement('canvas');
    this.canvas.className = 'map-canvas';

    this.stage.appendChild(this.imgElement);
    this.container.appendChild(this.stage);
    // Canvas — отдельный слой в screen-space над трансформируемым stage.
    // Так его размер всегда равен реальному размеру SVG на экране.
    this.container.appendChild(this.canvas);

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

        const naturalW = this.imgElement.naturalWidth || BASE_WIDTH;
        const naturalH = this.imgElement.naturalHeight || BASE_HEIGHT;

        this.stage.style.width = `${naturalW}px`;
        this.stage.style.height = `${naturalH}px`;

        // Размер canvas и масштаб координат считаются в redraw() по реальному
        // getBoundingClientRect() SVG после применения fit/zoom/pan.
        this.fitToContainer();
        this.redraw();
        resolve();
      };
      this.imgElement.onerror = () => reject(new Error(`Не удалось загрузить изображение этажа: ${imageUrl}`));
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

  /* ------------------------------------------------------------------ */
  /* Drawing                                                            */
  /* ------------------------------------------------------------------ */

  public redraw(): void {
    const metrics = this.syncCanvasToImage();
    if (!metrics) return;

    // Backing store может быть в device-пикселях (retina), но рисуем мы в
    // CSS-пикселях: dpr-трансформация переводит одно в другое.
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.ctx.setTransform(metrics.dpr, 0, 0, metrics.dpr, 0, 0);

    if (this.activePathSegment && this.activePathSegment.floor === this.currentFloor) {
      this.drawPath(this.activePathSegment.nodes, metrics);
    }

    this.drawMarkers(metrics);
  }

  /**
   * Подгоняет canvas под реальный размер SVG на экране (после resize,
   * zoom и pan) и возвращает коэффициенты пересчёта координат графа.
   * Координаты в JSON всегда остаются в системе BASE_WIDTH×BASE_HEIGHT.
   */
  private syncCanvasToImage(): RenderMetrics | null {
    const imageRect = this.imgElement.getBoundingClientRect();
    const containerRect = this.container.getBoundingClientRect();
    const currentSvgWidth = imageRect.width;
    const currentSvgHeight = imageRect.height;

    if (!Number.isFinite(currentSvgWidth) || !Number.isFinite(currentSvgHeight) || currentSvgWidth < 1 || currentSvgHeight < 1) {
      return null;
    }

    const scaleX = currentSvgWidth / BASE_WIDTH;
    const scaleY = currentSvgHeight / BASE_HEIGHT;

    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const backingWidth = Math.round(currentSvgWidth * dpr);
    const backingHeight = Math.round(currentSvgHeight * dpr);

    const left = `${imageRect.left - containerRect.left}px`;
    const top = `${imageRect.top - containerRect.top}px`;
    const cssWidth = `${currentSvgWidth}px`;
    const cssHeight = `${currentSvgHeight}px`;

    if (this.canvas.style.left !== left) this.canvas.style.left = left;
    if (this.canvas.style.top !== top) this.canvas.style.top = top;
    if (this.canvas.style.width !== cssWidth) this.canvas.style.width = cssWidth;
    if (this.canvas.style.height !== cssHeight) this.canvas.style.height = cssHeight;

    if (this.canvas.width !== backingWidth || this.canvas.height !== backingHeight) {
      this.canvas.width = backingWidth;
      this.canvas.height = backingHeight;
    }

    return {
      width: currentSvgWidth,
      height: currentSvgHeight,
      scaleX,
      scaleY,
      dpr
    };
  }

  /** Перерисовка не чаще одного раза за кадр (zoom/pan идут потоком). */
  private scheduleOverlayRender(): void {
    if (this.overlayFrame !== null) return;

    this.overlayFrame = window.requestAnimationFrame(() => {
      this.overlayFrame = null;
      this.redraw();
    });
  }

  public drawPath(nodes: GraphNode[], metrics?: RenderMetrics): void {
    const activeMetrics = metrics || this.syncCanvasToImage();
    if (!activeMetrics || nodes.length < 2) return;

    const currentSvgWidth = activeMetrics.width;
    const currentSvgHeight = activeMetrics.height;
    const scaleX = currentSvgWidth / BASE_WIDTH;
    const scaleY = currentSvgHeight / BASE_HEIGHT;
    const unit = (scaleX + scaleY) / 2;

    const points = nodes.map(node => {
      const renderX = node.x * scaleX;
      const renderY = node.y * scaleY;
      return { x: renderX, y: renderY };
    });

    this.ctx.save();

    // Soft glow behind the route
    this.ctx.shadowColor = 'rgba(37, 99, 235, 0.45)';
    this.ctx.shadowBlur = 12 * unit;

    // Outer casing keeps the line readable over dark plan lines
    this.drawPolyline(points, '#1D4ED8', 10 * unit);

    // Bright inner line
    this.drawPolyline(points, '#3B82F6', 6 * unit);

    this.drawDirectionArrows(nodes, activeMetrics, unit);
    this.ctx.restore();
  }

  private drawPolyline(points: { x: number; y: number }[], color: string, lineWidth: number): void {
    this.ctx.beginPath();
    this.ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) {
      this.ctx.lineTo(points[i].x, points[i].y);
    }
    this.ctx.strokeStyle = color;
    this.ctx.lineWidth = lineWidth;
    this.ctx.lineCap = 'round';
    this.ctx.lineJoin = 'round';
    this.ctx.stroke();
  }

  private drawDirectionArrows(nodes: GraphNode[], metrics: RenderMetrics, unit: number): void {
    this.ctx.fillStyle = '#FFFFFF';
    const scaleX = metrics.scaleX;
    const scaleY = metrics.scaleY;

    for (let i = 0; i < nodes.length - 1; i++) {
      const p1 = nodes[i];
      const p2 = nodes[i + 1];
      const baseDx = p2.x - p1.x;
      const baseDy = p2.y - p1.y;

      // Порог задан в координатах графа, поэтому не зависит от масштаба экрана.
      if (Math.hypot(baseDx, baseDy) < 34) continue;

      const renderX1 = p1.x * scaleX;
      const renderY1 = p1.y * scaleY;
      const renderX2 = p2.x * scaleX;
      const renderY2 = p2.y * scaleY;
      const midX = (renderX1 + renderX2) / 2;
      const midY = (renderY1 + renderY2) / 2;
      const angle = Math.atan2(renderY2 - renderY1, renderX2 - renderX1);

      this.ctx.save();
      this.ctx.translate(midX, midY);
      this.ctx.rotate(angle);

      this.ctx.beginPath();
      this.ctx.moveTo(7 * unit, 0);
      this.ctx.lineTo(-6 * unit, -5.5 * unit);
      this.ctx.lineTo(-3 * unit, 0);
      this.ctx.lineTo(-6 * unit, 5.5 * unit);
      this.ctx.closePath();
      this.ctx.fill();

      this.ctx.restore();
    }
  }

  private drawMarkers(metrics: RenderMetrics): void {
    const currentSvgWidth = metrics.width;
    const currentSvgHeight = metrics.height;
    const scaleX = currentSvgWidth / BASE_WIDTH;
    const scaleY = currentSvgHeight / BASE_HEIGHT;
    const unit = (scaleX + scaleY) / 2;

    // Лестницу рисуем первой: если она стоит вплотную к A/B, маркеры старта
    // и финиша должны оставаться сверху.
    const seg = this.activePathSegment;
    if (seg && seg.floor === this.currentFloor && seg.transitionToFloor !== undefined) {
      const stairNode = seg.endNode;
      const renderX = stairNode.x * scaleX;
      const renderY = stairNode.y * scaleY;
      const isUp = seg.transitionToFloor > this.currentFloor;
      const label = `${isUp ? 'Поднимитесь' : 'Спуститесь'} → Этаж ${seg.transitionToFloor}`;
      this.drawStairMarker(
        renderX,
        renderY,
        label,
        unit,
        this.isPinAbove(stairNode)
      );
    }

    if (this.startNode && this.startNode.floor === this.currentFloor) {
      const renderX = this.startNode.x * scaleX;
      const renderY = this.startNode.y * scaleY;
      this.drawPin(
        renderX,
        renderY,
        '#10B981', 'A', 'Старт', unit
      );
    }

    if (this.endNode && this.endNode.floor === this.currentFloor) {
      const renderX = this.endNode.x * scaleX;
      const renderY = this.endNode.y * scaleY;
      this.drawPin(
        renderX,
        renderY,
        '#EF4444', 'B', 'Финиш', unit
      );
    }
  }

  /**
   * Точка A/B стоит почти над лестницей? Тогда подпись перехода лучше
   * опустить под маркер, иначе два баннера нарисуются друг поверх друга.
   */
  private isPinAbove(stairNode: GraphNode): boolean {
    return [this.startNode, this.endNode].some(pin =>
      pin !== null &&
      pin.floor === this.currentFloor &&
      pin.y < stairNode.y &&
      stairNode.y - pin.y < 60 &&
      Math.abs(pin.x - stairNode.x) < 150
    );
  }

  private drawPin(
    x: number,
    y: number,
    color: string,
    label: string,
    title: string,
    unit: number
  ): void {
    this.ctx.save();

    // Halo
    this.ctx.beginPath();
    this.ctx.arc(x, y, 16 * unit, 0, Math.PI * 2);
    this.ctx.fillStyle = color + '33';
    this.ctx.fill();

    // Badge
    this.ctx.beginPath();
    this.ctx.arc(x, y, 12 * unit, 0, Math.PI * 2);
    this.ctx.fillStyle = color;
    this.ctx.fill();
    this.ctx.strokeStyle = '#FFFFFF';
    this.ctx.lineWidth = 2.5 * unit;
    this.ctx.stroke();

    this.ctx.fillStyle = '#FFFFFF';
    this.ctx.font = `bold ${12 * unit}px "Plus Jakarta Sans", sans-serif`;
    this.ctx.textAlign = 'center';
    this.ctx.textBaseline = 'middle';
    this.ctx.fillText(label, x, y + 0.5 * unit);

    // Tooltip
    this.ctx.font = `600 ${11 * unit}px "Plus Jakarta Sans", sans-serif`;
    const textWidth = this.ctx.measureText(title).width;
    const bannerW = textWidth + 14 * unit;
    const bannerH = 19 * unit;
    const bannerX = x - bannerW / 2;
    const bannerY = y - 34 * unit;

    this.ctx.fillStyle = 'rgba(15, 23, 42, 0.88)';
    this.roundRect(bannerX, bannerY, bannerW, bannerH, 5 * unit);
    this.ctx.fill();

    this.ctx.fillStyle = '#FFFFFF';
    this.ctx.textAlign = 'center';
    this.ctx.textBaseline = 'middle';
    this.ctx.fillText(title, x, bannerY + bannerH / 2 + 0.5 * unit);

    this.ctx.restore();
  }

  private drawStairMarker(
    x: number,
    y: number,
    label: string,
    unit: number,
    bannerBelow: boolean = false
  ): void {
    this.ctx.save();

    this.ctx.beginPath();
    this.ctx.arc(x, y, 14 * unit, 0, Math.PI * 2);
    this.ctx.fillStyle = '#8B5CF6';
    this.ctx.fill();
    this.ctx.strokeStyle = '#FFFFFF';
    this.ctx.lineWidth = 2.5 * unit;
    this.ctx.stroke();

    this.ctx.fillStyle = '#FFFFFF';
    this.ctx.font = `${13 * unit}px "Plus Jakarta Sans", sans-serif`;
    this.ctx.textAlign = 'center';
    this.ctx.textBaseline = 'middle';
    this.ctx.fillText('🛗', x, y + 0.5 * unit);

    this.ctx.font = `700 ${11 * unit}px "Plus Jakarta Sans", sans-serif`;
    const textWidth = this.ctx.measureText(label).width;
    const bannerW = textWidth + 16 * unit;
    const bannerH = 22 * unit;
    const bannerX = x - bannerW / 2;
    const bannerY = bannerBelow ? y + 16 * unit : y - 38 * unit;

    this.ctx.fillStyle = '#4C1D95';
    this.roundRect(bannerX, bannerY, bannerW, bannerH, 6 * unit);
    this.ctx.fill();
    this.ctx.strokeStyle = '#DDD6FE';
    this.ctx.lineWidth = 1.5 * unit;
    this.ctx.stroke();

    this.ctx.fillStyle = '#FFFFFF';
    this.ctx.textAlign = 'center';
    this.ctx.textBaseline = 'middle';
    this.ctx.fillText(label, x, bannerY + bannerH / 2 + 0.5 * unit);

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
    const stageW = parseFloat(this.stage.style.width) || BASE_WIDTH;
    const stageH = parseFloat(this.stage.style.height) || BASE_HEIGHT;

    const padding = 12;
    const availableW = Math.max(1, rect.width - padding * 2);
    const availableH = Math.max(1, rect.height - padding * 2);

    const fitScale = Math.min(availableW / stageW, availableH / stageH);
    this.scale = fitScale;
    this.minScale = fitScale * 0.85;
    this.maxScale = fitScale * 7;

    this.translateX = (rect.width - stageW * this.scale) / 2;
    this.translateY = (rect.height - stageH * this.scale) / 2;

    this.applyTransform();
  }

  private applyTransform(): void {
    this.stage.style.transform =
      `translate(${this.translateX}px, ${this.translateY}px) scale(${this.scale})`;

    // Canvas живёт в screen-space, поэтому после каждого zoom/pan его нужно
    // пересчитать и перерисовать — иначе маршрут «отклеится» от плана.
    this.scheduleOverlayRender();
  }

  private initResizeObserver(): void {
    const ro = new ResizeObserver(() => {
      this.fitToContainer();
    });
    ro.observe(this.container);

    // Явные слушатели по требованиям: поворот экрана и изменение окна.
    window.addEventListener('resize', this.handleViewportResize);
    window.addEventListener('orientationchange', this.handleViewportResize);
  }
}
