/**
 * Viewport Controller Module
 * Handles pan, zoom, and viewport transformations
 */

export class ViewportController {
    constructor(canvas, renderer) {
        this.canvas = canvas;
        this.renderer = renderer;
        this.isDragging = false;
        this.lastMousePos = { x: 0, y: 0 };
        this.minScale = 0.01;
        this.maxScale = 1000;

        this.setupEventListeners();
    }

    setupEventListeners() {
        // Mouse wheel zoom
        this.canvas.addEventListener('wheel', (e) => {
            e.preventDefault();
            this.handleZoom(e);
        });

        // Mouse drag pan
        this.canvas.addEventListener('mousedown', (e) => {
            if (e.button === 1) { // Middle click
                this.isDragging = true;
                this.lastMousePos = { x: e.clientX, y: e.clientY };
                this.canvas.style.cursor = 'grabbing';
            }
        });

        this.canvas.addEventListener('mousemove', (e) => {
            if (this.isDragging) {
                this.handlePan(e);
            }

            // Store mouse position for other modules
            this.lastMousePos = { x: e.clientX, y: e.clientY };
        });

        this.canvas.addEventListener('mouseup', (e) => {
            if (e.button === 1) {
                this.isDragging = false;
                this.canvas.style.cursor = 'default';
            }
        });

        this.canvas.addEventListener('mouseleave', () => {
            this.isDragging = false;
            this.canvas.style.cursor = 'default';
        });

        // Touch support for trackpad
        this.canvas.addEventListener('touchstart', (e) => {
            if (e.touches.length === 1) {
                this.isDragging = true;
                this.lastMousePos = {
                    x: e.touches[0].clientX,
                    y: e.touches[0].clientY
                };
            }
        });

        this.canvas.addEventListener('touchmove', (e) => {
            e.preventDefault();
            if (this.isDragging && e.touches.length === 1) {
                const touch = e.touches[0];
                const dx = touch.clientX - this.lastMousePos.x;
                const dy = touch.clientY - this.lastMousePos.y;

                this.renderer.viewport.x -= dx / this.renderer.viewport.scale;
                this.renderer.viewport.y += dy / this.renderer.viewport.scale;

                this.lastMousePos = { x: touch.clientX, y: touch.clientY };
            }
        });

        this.canvas.addEventListener('touchend', () => {
            this.isDragging = false;
        });

        // Window resize
        window.addEventListener('resize', () => {
            this.handleResize();
        });
    }

    handleZoom(e) {
        const rect = this.canvas.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;

        // Get world coordinates before zoom
        const worldBefore = this.renderer.screenToWorld(mouseX, mouseY);

        // Calculate zoom factor (reduced sensitivity: 1.03 for smooth zooming)
        const zoomFactor = e.deltaY < 0 ? 1.03 : 0.97;
        const newScale = this.renderer.viewport.scale * zoomFactor;

        // Clamp scale
        if (newScale < this.minScale || newScale > this.maxScale) {
            return;
        }

        this.renderer.viewport.scale = newScale;

        // Get world coordinates after zoom
        const worldAfter = this.renderer.screenToWorld(mouseX, mouseY);

        // Adjust viewport to keep mouse position fixed
        this.renderer.viewport.x += worldBefore.x - worldAfter.x;
        this.renderer.viewport.y += worldBefore.y - worldAfter.y;
    }

    handlePan(e) {
        const dx = e.clientX - this.lastMousePos.x;
        const dy = e.clientY - this.lastMousePos.y;

        this.renderer.viewport.x -= dx / this.renderer.viewport.scale;
        this.renderer.viewport.y += dy / this.renderer.viewport.scale;

        this.lastMousePos = { x: e.clientX, y: e.clientY };
    }

    handleResize() {
        const rect = this.canvas.getBoundingClientRect();
        this.canvas.width = rect.width;
        this.canvas.height = rect.height;
        this.renderer.viewport.width = rect.width;
        this.renderer.viewport.height = rect.height;
    }

    zoomToFit() {
        const bounds = this.renderer.getBounds();
        const width = bounds.maxX - bounds.minX;
        const height = bounds.maxY - bounds.minY;

        if (width === 0 || height === 0) return;

        const padding = 1.1; // 10% padding
        const scaleX = this.canvas.width / (width * padding);
        const scaleY = this.canvas.height / (height * padding);

        this.renderer.viewport.scale = Math.min(scaleX, scaleY);
        this.renderer.viewport.x = (bounds.minX + bounds.maxX) / 2;
        this.renderer.viewport.y = (bounds.minY + bounds.maxY) / 2;
    }

    /**
     * Zoom to specific world rectangle
     * @param {Object} p1 - {x, y} World Coord
     * @param {Object} p2 - {x, y} World Coord
     */
    zoomToRect(p1, p2) {
        if (!p1 || !p2) return;

        const width = Math.abs(p1.x - p2.x);
        const height = Math.abs(p1.y - p2.y);
        const centerX = (p1.x + p2.x) / 2;
        const centerY = (p1.y + p2.y) / 2;

        if (width === 0 || height === 0) return;

        const padding = 1.0;
        const scaleX = this.canvas.width / (width * padding);
        const scaleY = this.canvas.height / (height * padding);

        // Use smallest scale (fit entire rect)
        let newScale = Math.min(scaleX, scaleY);

        // Clamp scale
        newScale = Math.max(this.minScale, Math.min(this.maxScale, newScale));

        this.renderer.viewport.scale = newScale;
        this.renderer.viewport.x = centerX;
        this.renderer.viewport.y = centerY;
    }

    getMouseWorldPos() {
        const rect = this.canvas.getBoundingClientRect();
        const mouseX = this.lastMousePos.x - rect.left;
        const mouseY = this.lastMousePos.y - rect.top;
        return this.renderer.screenToWorld(mouseX, mouseY);
    }
}
