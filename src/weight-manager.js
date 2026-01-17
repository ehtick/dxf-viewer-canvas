import * as THREE from 'three';
import { MATERIALS, DEFAULT_MATERIAL_ID } from './materials.js';

export class WeightManager {
    constructor(viewer, languageManager, onCloseCallback) {
        this.viewer = viewer;
        this.languageManager = languageManager;
        this.onCloseCallback = onCloseCallback;

        this.currentMaterialId = DEFAULT_MATERIAL_ID;
        this.selectedObjects = [];
        this.calculationResult = null;
        this.isEnabled = false;

        // Visualization
        this.previewMesh = null;
        this.previewMaterial = new THREE.MeshBasicMaterial({
            color: 0x00ff00,
            transparent: true,
            opacity: 0.3,
            depthTest: false,
            side: THREE.DoubleSide
        });
    }

    init() {
        this.createUI();
        this.bindEvents();
    }

    createUI() {
        this.popup = document.getElementById('weight-popup');
        this.btn = document.getElementById('weight-btn');
    }

    bindEvents() {
        if (this.btn) {
            this.btn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (this.isEnabled) {
                    this.togglePopup();
                }
            });
        }

        const selector = document.getElementById('material-selector');
        if (selector) {
            selector.addEventListener('change', (e) => {
                this.currentMaterialId = e.target.value;
                this.calculateAndRender();
            });
        }

        const closeBtn = document.getElementById('weight-popup-close');
        if (closeBtn) {
            closeBtn.addEventListener('click', () => this.close());
        }
    }

    update(selectedObjects) {
        this.selectedObjects = selectedObjects || [];

        const closedGeoms = this.filterClosedGeometries(this.selectedObjects);
        this.isEnabled = closedGeoms.length > 0;

        if (this.btn) {
            if (this.isEnabled) {
                this.btn.classList.remove('opacity-50', 'cursor-not-allowed');
                this.btn.classList.add('hover:bg-white/10');
            } else {
                this.btn.classList.add('opacity-50', 'cursor-not-allowed');
                this.btn.classList.remove('hover:bg-white/10');
                if (this.popup && !this.popup.classList.contains('hidden')) {
                    this.close();
                }
            }
        }

        if (this.popup && !this.popup.classList.contains('hidden')) {
            this.calculateAndRender();
        }
    }

    togglePopup() {
        if (!this.popup) return;

        const isHidden = this.popup.classList.contains('hidden');
        if (isHidden) {
            this.popup.classList.remove('hidden');
            this.calculateAndRender();
            this.visualize();
        } else {
            this.close();
        }
    }

    close() {
        if (this.popup) this.popup.classList.add('hidden');
        this.clearVisualization();
        if (this.onCloseCallback) {
            this.onCloseCallback();
        }
    }

    filterClosedGeometries(objects) {
        const results = [];

        // 1. Check for single closed entities
        const singleClosed = [];
        const potentialChainObjects = [];

        for (const obj of objects) {
            const type = obj.userData.type;
            const entity = obj.userData.entity;

            if (type === 'CIRCLE') {
                results.push({ type: 'single', objects: [obj] });
                continue;
            }

            if ((type === 'LWPOLYLINE' || type === 'POLYLINE') && (entity.closed || (entity.flag & 1) === 1)) {
                results.push({ type: 'single', objects: [obj] });
                continue;
            }

            if (obj.isGroup && (obj.userData.type === 'LWPOLYLINE' || obj.userData.type === 'POLYLINE')) {
                if (entity && (entity.closed || (entity.flag & 1) === 1)) {
                    results.push({ type: 'single', objects: [obj] });
                    continue;
                }
            }

            // If not a closed single entity, it might be part of a chain
            if (type === 'LINE' || type === 'ARC') {
                potentialChainObjects.push(obj);
            }
        }

        // 2. Try to find multiple chains from remaining objects
        if (potentialChainObjects.length > 1) {
            const chains = this.findAllChains(potentialChainObjects);
            console.log(`[filterClosedGeometries] Found ${chains.length} chains from ${potentialChainObjects.length} objects`);
            results.push(...chains);
        }

        return results;
    }

    calculateAndRender() {
        const closedGeoms = this.filterClosedGeometries(this.selectedObjects);
        console.log(`[WeightManager] Found ${closedGeoms.length} closed geometries:`, closedGeoms);
        if (closedGeoms.length === 0) return;

        const items = closedGeoms.map(geomEntry => {
            const area = this.calculateArea(geomEntry);
            console.log(`  - Type: ${geomEntry.type}, Area: ${area.toFixed(2)}`);
            return {
                geomEntry: geomEntry,
                area: area
            };
        });

        items.sort((a, b) => b.area - a.area);

        const outer = items[0];
        const inner = items.slice(1);

        console.log(`[WeightManager] Outer area: ${outer.area.toFixed(2)}, Inner count: ${inner.length}`);

        const outerArea = outer.area;
        const innerAreaSum = inner.reduce((sum, item) => sum + item.area, 0);
        const netArea = outerArea - innerAreaSum;

        console.log(`[WeightManager] Net area: ${netArea.toFixed(2)} (${outerArea.toFixed(2)} - ${innerAreaSum.toFixed(2)})`);

        const mandrelCount = Math.max(0, closedGeoms.length - 1);
        const material = MATERIALS.find(m => m.id === this.currentMaterialId) || MATERIALS[0];
        const weight = (netArea * material.density) / 1000;

        this.updateDOM('val-mandrel', mandrelCount);
        this.updateDOM('val-area', netArea.toFixed(2));
        this.updateDOM('val-weight', weight.toFixed(3));

        this.calculationResult = { outer: outer.geomEntry, inner: inner.map(i => i.geomEntry) };
        this.visualize();

        // Calculate bounding circle AFTER visualization (when mesh is created)
        if (this.previewMesh && this.previewMesh.geometry) {
            const circleData = this.calculateBoundingCircleFromMesh(this.previewMesh.geometry);
            this.boundingCircle = circleData;
            this.updateDOM('val-diameter', circleData.diameter.toFixed(2));

            // Re-visualize to add debug circle
            this.visualizeDebugCircle();
        }
    }

    calculateBoundingCircleFromMesh(geometry) {
        const positions = geometry.attributes.position;
        if (!positions) return { diameter: 0, center: { x: 0, y: 0 }, radius: 0 };

        // Extract all vertices from tessellated geometry
        const points = [];
        for (let i = 0; i < positions.count; i++) {
            points.push({
                x: positions.getX(i),
                y: positions.getY(i)
            });
        }

        console.log(`[calculateBoundingCircleFromMesh] Using ${points.length} tessellated vertices`);

        // Use Welzl's algorithm for minimum enclosing circle
        const result = this.minimumEnclosingCircle(points);

        return {
            diameter: result.diameter,
            center: { x: result.center.x, y: result.center.y },
            radius: result.radius
        };
    }

    // Welzl's algorithm for minimum enclosing circle
    minimumEnclosingCircle(points) {
        // Fisher–Yates shuffle (required for Welzl)
        const pts = points.slice();
        for (let i = pts.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [pts[i], pts[j]] = [pts[j], pts[i]];
        }

        let c = null;

        for (let i = 0; i < pts.length; i++) {
            if (c && this.circleContains(c, pts[i])) continue;

            c = { center: pts[i], radius: 0 };

            for (let j = 0; j < i; j++) {
                if (this.circleContains(c, pts[j])) continue;

                c = this.circleFrom2Points(pts[i], pts[j]);

                for (let k = 0; k < j; k++) {
                    if (this.circleContains(c, pts[k])) continue;
                    c = this.circleFrom3Points(pts[i], pts[j], pts[k]);
                }
            }
        }

        return {
            center: { x: c.center.x, y: c.center.y },
            radius: c.radius,
            diameter: c.radius * 2
        };
    }

    circleContains(c, p) {
        return Math.hypot(p.x - c.center.x, p.y - c.center.y) <= c.radius + 1e-6;
    }

    circleFrom2Points(a, b) {
        const cx = (a.x + b.x) / 2;
        const cy = (a.y + b.y) / 2;
        return {
            center: { x: cx, y: cy },
            radius: Math.hypot(a.x - cx, a.y - cy)
        };
    }

    circleFrom3Points(a, b, c) {
        const d = 2 * (
            a.x * (b.y - c.y) +
            b.x * (c.y - a.y) +
            c.x * (a.y - b.y)
        );

        if (Math.abs(d) < 1e-12) {
            // Points are collinear, use circle from 2 points
            return this.circleFrom2Points(a, b);
        }

        const ux = (
            (a.x * a.x + a.y * a.y) * (b.y - c.y) +
            (b.x * b.x + b.y * b.y) * (c.y - a.y) +
            (c.x * c.x + c.y * c.y) * (a.y - b.y)
        ) / d;

        const uy = (
            (a.x * a.x + a.y * a.y) * (c.x - b.x) +
            (b.x * b.x + b.y * b.y) * (a.x - c.x) +
            (c.x * c.x + c.y * c.y) * (b.x - a.x)
        ) / d;

        return {
            center: { x: ux, y: uy },
            radius: Math.hypot(a.x - ux, a.y - uy)
        };
    }

    calculateBoundingCircleDiameter(geomEntry) {
        // Extract all vertices from the geometry
        let vertices = [];

        if (geomEntry.type === 'single') {
            const entity = geomEntry.objects[0].userData.entity;
            if (entity && entity.vertices) {
                vertices = entity.vertices.map(v => ({ x: v.x, y: v.y, bulge: v.bulge || 0 }));
            }
        } else if (geomEntry.type === 'chain' && geomEntry.vertices) {
            vertices = geomEntry.vertices.map(v => ({ x: v.x, y: v.y, bulge: v.bulge || 0 }));
        }

        if (vertices.length === 0) return 0;

        // Sample points along arcs (only POSITIVE bulge - outward arcs)
        const points = [];
        const n = vertices.length;

        for (let i = 0; i < n; i++) {
            const v1 = vertices[i];
            const v2 = vertices[(i + 1) % n];

            // Always add vertex
            points.push({ x: v1.x, y: v1.y });

            // Sample ALL arcs (both positive and negative bulge can expand boundary)
            if (v1.bulge && Math.abs(v1.bulge) > 0.001) {
                const bulge = v1.bulge;
                const theta = 4 * Math.atan(Math.abs(bulge));
                const chord = Math.hypot(v2.x - v1.x, v2.y - v1.y);

                if (chord > 0.001) {
                    const radius = chord / (2 * Math.sin(theta / 2));

                    // Calculate arc center
                    const midX = (v1.x + v2.x) / 2;
                    const midY = (v1.y + v2.y) / 2;
                    const chordAngle = Math.atan2(v2.y - v1.y, v2.x - v1.x);
                    const sagitta = radius * (1 - Math.cos(theta / 2));

                    // Offset direction depends on bulge sign
                    const offsetAngle = chordAngle + (bulge > 0 ? Math.PI / 2 : -Math.PI / 2);
                    const cx = midX + sagitta * Math.cos(offsetAngle);
                    const cy = midY + sagitta * Math.sin(offsetAngle);

                    // Sample arc points
                    const samples = 8;
                    const startAngle = Math.atan2(v1.y - cy, v1.x - cx);
                    for (let j = 1; j < samples; j++) {
                        const t = j / samples;
                        const angle = startAngle + (bulge > 0 ? t * theta : -t * theta);
                        points.push({
                            x: cx + radius * Math.cos(angle),
                            y: cy + radius * Math.sin(angle)
                        });
                    }
                }
            }
        }

        // Use bounding box for minimum enclosing circle approximation
        let minX = Infinity, maxX = -Infinity;
        let minY = Infinity, maxY = -Infinity;

        for (const p of points) {
            minX = Math.min(minX, p.x);
            maxX = Math.max(maxX, p.x);
            minY = Math.min(minY, p.y);
            maxY = Math.max(maxY, p.y);
        }

        console.log(`[calculateBoundingCircle] Sampled ${points.length} points, bbox: (${minX.toFixed(1)},${minY.toFixed(1)}) to (${maxX.toFixed(1)},${maxY.toFixed(1)})`);

        // Circle center is bounding box center
        const centerX = (minX + maxX) / 2;
        const centerY = (minY + maxY) / 2;

        // Radius is the maximum distance from center to any sampled point
        let radius = 0;
        for (const p of points) {
            const dist = Math.hypot(p.x - centerX, p.y - centerY);
            radius = Math.max(radius, dist);
        }

        return {
            diameter: radius * 2,
            center: { x: centerX, y: centerY },
            radius: radius
        };
    }

    updateDOM(id, value) {
        const el = document.getElementById(id);
        if (el) el.textContent = value;
    }

    calculateArea(geomEntry) {
        if (geomEntry.type === 'single') {
            return this.calculateSingleArea(geomEntry.objects[0]);
        }

        if (geomEntry.type === 'chain') {
            return this.calculateChainArea(geomEntry.vertices);
        }

        return 0;
    }

    calculateSingleArea(obj) {
        const type = obj.userData.type;
        const entity = obj.userData.entity;

        if (type === 'CIRCLE') {
            return Math.PI * entity.radius * entity.radius;
        }

        if (type === 'LWPOLYLINE' || type === 'POLYLINE') {
            if (entity && entity.vertices && entity.vertices.length > 0) {
                const v = entity.vertices;
                const n = v.length;

                // 1) Shoelace (signed chord area *2)
                let chord2 = 0;
                for (let i = 0; i < n; i++) {
                    const j = (i + 1) % n;
                    chord2 += v[i].x * v[j].y - v[j].x * v[i].y;
                }

                // Polyline yönü: + => CCW, - => CW
                const winding = (chord2 === 0) ? 1 : Math.sign(chord2);

                // 2) Bulge düzeltmesi (signed *2 değil, doğrudan alana eklenecek)
                let corr = 0;
                for (let i = 0; i < n; i++) {
                    const j = (i + 1) % n;
                    const b = v[i].bulge || 0;
                    if (b === 0) continue;

                    const p1 = v[i], p2 = v[j];
                    const dx = p2.x - p1.x;
                    const dy = p2.y - p1.y;
                    const c = Math.hypot(dx, dy);
                    if (c === 0) continue;

                    // Arc segment area correction
                    const absBulge = Math.abs(b);
                    const theta = 4 * Math.atan(absBulge);
                    const radius = c / (2 * Math.sin(theta / 2));
                    const segmentArea = (radius * radius / 2) * (theta - Math.sin(theta));

                    // CRITICAL FIX: Arc contribution depends ONLY on bulge sign, not winding!
                    // Winding affects chord area, but arc segment area sign is determined by arc direction
                    const contribution = Math.sign(b) * segmentArea;
                    corr += contribution;
                }

                const totalSigned = (chord2 / 2) + corr;
                return Math.abs(totalSigned);
            }
        }
        return 0;
    }

    calculateChainArea(vertices) {
        const n = vertices.length;
        if (n < 3) return 0;

        // 1) Shoelace for chord area
        let chord2 = 0;
        for (let i = 0; i < n; i++) {
            const j = (i + 1) % n;
            chord2 += vertices[i].x * vertices[j].y - vertices[j].x * vertices[i].y;
        }

        const winding = Math.sign(chord2 || 1);

        // 2) Bulge corrections
        let corr = 0;
        for (let i = 0; i < n; i++) {
            const j = (i + 1) % n;
            const b = vertices[i].bulge || 0;
            if (b === 0) continue;

            const dx = vertices[j].x - vertices[i].x;
            const dy = vertices[j].y - vertices[i].y;
            const c = Math.hypot(dx, dy);
            if (c === 0) continue;

            // Arc segment area correction
            const absBulge = Math.abs(b);
            const theta = 4 * Math.atan(absBulge);
            const radius = c / (2 * Math.sin(theta / 2));
            const segmentArea = (radius * radius / 2) * (theta - Math.sin(theta));

            // Arc contribution depends ONLY on bulge sign, not winding
            corr += Math.sign(b) * segmentArea;
        }

        return Math.abs((chord2 / 2) + corr);
    }


    visualize() {
        this.clearVisualization();
        if (!this.calculationResult) return;

        const outerGeom = this.calculationResult.outer;
        const outerShape = this.createShapeFromObject(outerGeom);
        if (!outerShape) {
            console.warn('[WeightManager] Failed to create outer shape');
            return;
        }

        console.log(`[WeightManager] Visualizing: outer created, ${this.calculationResult.inner.length} inner geometries`);

        this.calculationResult.inner.forEach((innerGeom, idx) => {
            const innerPath = this.createShapeFromObject(innerGeom);
            if (innerPath) {
                outerShape.holes.push(innerPath);
                console.log(`  - Added hole ${idx + 1}`);
            } else {
                console.warn(`  - Failed to create hole ${idx + 1}`);
            }
        });

        console.log(`[WeightManager] Total holes: ${outerShape.holes.length}`);

        const geometry = new THREE.ShapeGeometry(outerShape);
        this.previewMesh = new THREE.Mesh(geometry, this.previewMaterial);
        this.previewMesh.position.z = 0.1;
        this.previewMesh.renderOrder = 999;
        if (this.viewer && this.viewer.scene) {
            this.viewer.scene.add(this.previewMesh);
        }

        this.visualizeDebugCircle();
    }

    visualizeDebugCircle() {
        // Clean up old debug circle
        if (this.debugCircle) {
            if (this.viewer && this.viewer.scene) {
                this.viewer.scene.remove(this.debugCircle);
            }
            if (this.debugCircle.geometry) this.debugCircle.geometry.dispose();
            this.debugCircle = null;
        }

        // DEBUG: Visualize bounding circle
        if (this.boundingCircle && this.viewer && this.viewer.scene) {
            const circleGeometry = new THREE.BufferGeometry();
            const segments = 64;
            const vertices = [];

            for (let i = 0; i <= segments; i++) {
                const theta = (i / segments) * Math.PI * 2;
                const x = this.boundingCircle.center.x + this.boundingCircle.radius * Math.cos(theta);
                const y = this.boundingCircle.center.y + this.boundingCircle.radius * Math.sin(theta);
                vertices.push(x, y, 0);
            }

            circleGeometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));

            const circleMaterial = new THREE.LineBasicMaterial({
                color: 0xff00ff, // Magenta for visibility
                linewidth: 2,
                depthTest: false
            });

            this.debugCircle = new THREE.Line(circleGeometry, circleMaterial);
            this.debugCircle.renderOrder = 1000;
            this.viewer.scene.add(this.debugCircle);

            console.log(`[DEBUG] Bounding circle: center=(${this.boundingCircle.center.x.toFixed(2)},${this.boundingCircle.center.y.toFixed(2)}), radius=${this.boundingCircle.radius.toFixed(2)}, diameter=${this.boundingCircle.diameter.toFixed(2)}`);
        }
    }

    createShapeFromObject(geomEntry) {
        if (geomEntry.type === 'single') {
            return this.createShapeFromSingle(geomEntry.objects[0]);
        }

        if (geomEntry.type === 'chain') {
            return this.createShapeFromChain(geomEntry.vertices);
        }

        return null;
    }

    createShapeFromSingle(obj) {
        const type = obj.userData.type;
        const entity = obj.userData.entity;
        const isClosed = !!(entity.closed || ((entity.flag & 1) === 1));

        if (type === 'CIRCLE') {
            const shape = new THREE.Shape();
            shape.absarc(entity.center.x, entity.center.y, entity.radius, 0, Math.PI * 2, false);
            return shape;
        } else if (type === 'LWPOLYLINE' || type === 'POLYLINE') {
            if (entity && entity.vertices && entity.vertices.length > 0) {
                const shape = new THREE.Shape();
                const v = entity.vertices;
                const n = v.length;
                shape.moveTo(v[0].x, v[0].y);

                // Draw n-1 segments explicitly (0->1, 1->2, ..., (n-2)->(n-1))
                // The last segment (n-1)->0 will be handled by THREE.Shape's auto-close
                for (let i = 0; i < n - 1; i++) {
                    const p1 = v[i];
                    const p2 = v[i + 1];
                    const bulge = v[i].bulge || 0;

                    if (bulge !== 0) {
                        const pts = this.getBulgePoints(p1, p2, bulge);
                        // Skip first point (pts[0]) as it's same as p1 where we already are
                        for (let k = 1; k < pts.length; k++) {
                            shape.lineTo(pts[k].x, pts[k].y);
                        }
                    } else {
                        shape.lineTo(p2.x, p2.y);
                    }
                }

                // For the last segment (v[n-1] -> v[0]), if it has a bulge, we need to draw it
                if (isClosed && n > 0) {
                    const p1 = v[n - 1];
                    const p2 = v[0];
                    const bulge = v[n - 1].bulge || 0;

                    console.log(`Closing segment: v[${n - 1}]=(${p1.x},${p1.y}) -> v[0]=(${p2.x},${p2.y}) bulge=${bulge}`);

                    if (bulge !== 0) {
                        const pts = this.getBulgePoints(p1, p2, bulge);
                        console.log(`  Arc points: ${pts.length}, last pt=(${pts[pts.length - 1].x},${pts[pts.length - 1].y})`);
                        // Draw all arc points for the closing segment
                        for (let k = 1; k < pts.length; k++) {
                            shape.lineTo(pts[k].x, pts[k].y);
                        }
                        // Explicitly close to the first point to ensure perfect closure
                        shape.lineTo(v[0].x, v[0].y);
                        console.log(`  Explicitly closed to v[0]`);
                    }
                    // If no bulge, THREE.Shape auto-closes with a straight line
                }

                return shape;
            }
        }
        return null;
    }

    createShapeFromChain(vertices) {
        const shape = new THREE.Shape();
        const n = vertices.length;
        if (n < 3) return null;

        shape.moveTo(vertices[0].x, vertices[0].y);

        // Draw n-1 segments
        for (let i = 0; i < n - 1; i++) {
            const p1 = vertices[i];
            const p2 = vertices[i + 1];
            const bulge = p1.bulge || 0;

            if (bulge !== 0) {
                const pts = this.getBulgePoints(p1, p2, bulge);
                for (let k = 1; k < pts.length; k++) {
                    shape.lineTo(pts[k].x, pts[k].y);
                }
            } else {
                shape.lineTo(p2.x, p2.y);
            }
        }

        // Closing segment (last vertex back to first)
        const bulge = vertices[n - 1].bulge || 0;
        if (bulge !== 0) {
            const pts = this.getBulgePoints(vertices[n - 1], vertices[0], bulge);
            for (let k = 1; k < pts.length; k++) {
                shape.lineTo(pts[k].x, pts[k].y);
            }
        }
        shape.lineTo(vertices[0].x, vertices[0].y);

        return shape;
    }

    getBulgePoints(v1, v2, bulge) {
        const p1x = v1.x, p1y = v1.y;
        const p2x = v2.x, p2y = v2.y;

        const dx = p2x - p1x;
        const dy = p2y - p1y;
        const dist = Math.hypot(dx, dy);
        if (dist === 0) return [new THREE.Vector2(p1x, p1y)];

        // signed merkez açı
        const theta = 4 * Math.atan(bulge);

        // chord orta noktası
        const mx = (p1x + p2x) * 0.5;
        const my = (p1y + p2y) * 0.5;

        // (unit) sol normal
        const nx = -dy / dist;
        const ny = dx / dist;

        // mid->center offset (signed)
        const off = dist * (1 - bulge * bulge) / (4 * bulge);

        const cx = mx + nx * off;
        const cy = my + ny * off;

        // yarıçap
        const r = dist * (1 + bulge * bulge) / (4 * Math.abs(bulge));

        const startAng = Math.atan2(p1y - cy, p1x - cx);

        // adım sayısı
        const steps = Math.max(16, Math.ceil((Math.abs(theta) * r) / 6));
        const pts = [];
        for (let i = 0; i <= steps; i++) {
            const t = i / steps;
            const ang = startAng + theta * t;
            pts.push(new THREE.Vector2(
                cx + r * Math.cos(ang),
                cy + r * Math.sin(ang)
            ));
        }
        return pts;
    }

    // Find all disconnected closed chains from a set of objects
    findAllChains(objects) {
        const tolerance = 2.0;  // Increased for small arc matching
        const results = [];

        // Extract all segments
        const allSegments = [];
        for (const obj of objects) {
            const seg = this.extractSegment(obj);
            if (seg) {
                seg.used = false;
                allSegments.push(seg);
            }
        }

        // Keep building chains until all segments are used or no more chains can be found
        while (allSegments.some(s => !s.used)) {
            // Find first unused segment
            const startIdx = allSegments.findIndex(s => !s.used);
            if (startIdx === -1) break;

            const chain = this.buildChainFromSegment(allSegments, startIdx, tolerance);

            if (chain && chain.closed) {
                console.log(`  - Found closed chain with ${chain.orderedSegments.length} segments`);

                // Extract vertices
                const vertices = chain.orderedSegments.map(seg => ({
                    x: seg.p1.x,
                    y: seg.p1.y,
                    bulge: seg.bulge || 0
                }));

                results.push({
                    type: 'chain',
                    objects: chain.orderedSegments.map(s => s.object),
                    vertices: vertices
                });
            } else {
                console.log(`  - Found incomplete/open chain with ${chain ? chain.orderedSegments.length : 0} segments`);
                // Mark segments as used even if chain is not closed to avoid infinite loop
                if (chain) {
                    chain.orderedSegments.forEach(seg => {
                        const idx = allSegments.findIndex(s => s.object === seg.object);
                        if (idx !== -1) allSegments[idx].used = true;
                    });
                }
            }
        }

        return results;
    }

    buildChainFromSegment(allSegments, startIdx, tolerance) {
        const ordered = [];
        const segment = allSegments[startIdx];

        ordered.push(segment);
        allSegments[startIdx].used = true;

        let currentEnd = segment.p2;
        let found = true;

        // Try to build a chain
        while (found && ordered.length < allSegments.length) {
            found = false;
            let bestIdx = -1;
            let bestDist = tolerance;
            let bestFlip = false;

            // Find the CLOSEST matching segment, not just the first one
            for (let i = 0; i < allSegments.length; i++) {
                if (allSegments[i].used) continue;

                const seg = allSegments[i];
                const dist1 = currentEnd.distanceTo(seg.p1);
                const dist2 = currentEnd.distanceTo(seg.p2);

                if (dist1 < bestDist) {
                    bestDist = dist1;
                    bestIdx = i;
                    bestFlip = false;
                }
                if (dist2 < bestDist) {
                    bestDist = dist2;
                    bestIdx = i;
                    bestFlip = true;
                }
            }

            // Add the best matching segment if found
            if (bestIdx !== -1) {
                const seg = allSegments[bestIdx];
                found = true;

                if (!bestFlip) {
                    ordered.push(seg);
                    allSegments[bestIdx].used = true;
                    currentEnd = seg.p2;
                } else {
                    const flipped = {
                        object: seg.object,
                        p1: seg.p2,
                        p2: seg.p1,
                        bulge: seg.bulge ? -seg.bulge : 0,
                        used: true
                    };
                    ordered.push(flipped);
                    allSegments[bestIdx].used = true;
                    currentEnd = flipped.p2;
                }
            }
        }

        // Check if chain is closed
        if (ordered.length < 3) return { closed: false, orderedSegments: ordered };

        const start = ordered[0].p1;
        const end = ordered[ordered.length - 1].p2;
        const closed = start.distanceTo(end) < tolerance;

        return {
            closed: closed,
            orderedSegments: ordered
        };
    }

    // Chain Selection Support
    analyzeChain(objects) {
        const tolerance = 2.0;  // Increased for small arc matching
        // Extract all segments with endpoints
        const segments = [];
        for (const obj of objects) {
            const seg = this.extractSegment(obj);
            if (seg) segments.push(seg);
        }

        if (segments.length < 2) return { closed: false };

        // Try to order segments into a chain
        const ordered = [];
        const used = new Set();

        // Start with first segment
        ordered.push(segments[0]);
        used.add(0);

        let currentEnd = segments[0].p2;

        // Try to build a chain
        while (used.size < segments.length) {
            let found = false;

            for (let i = 0; i < segments.length; i++) {
                if (used.has(i)) continue;

                const seg = segments[i];

                // Check if this segment connects to current end
                if (currentEnd.distanceTo(seg.p1) < tolerance) {
                    ordered.push(seg);
                    used.add(i);
                    currentEnd = seg.p2;
                    found = true;
                    break;
                } else if (currentEnd.distanceTo(seg.p2) < tolerance) {
                    // Segment is reversed, flip it
                    ordered.push({
                        object: seg.object,
                        p1: seg.p2,
                        p2: seg.p1,
                        bulge: seg.bulge ? -seg.bulge : 0 // Flip bulge sign
                    });
                    used.add(i);
                    currentEnd = seg.p1;
                    found = true;
                    break;
                }
            }

            if (!found) break; // Can't continue chain
        }

        // Check if chain is closed
        if (ordered.length < 3) return { closed: false };

        const start = ordered[0].p1;
        const end = ordered[ordered.length - 1].p2;
        const closed = start.distanceTo(end) < tolerance;

        if (!closed) return { closed: false };

        // Extract vertices for area calculation
        const vertices = ordered.map(seg => ({
            x: seg.p1.x,
            y: seg.p1.y,
            bulge: seg.bulge || 0
        }));

        return {
            closed: true,
            orderedObjects: ordered.map(s => s.object),
            vertices: vertices
        };
    }

    extractSegment(obj) {
        const type = obj.userData.type;

        if (type === 'LINE') {
            const entity = obj.userData.entity;
            if (!entity || !entity.startPoint || !entity.endPoint) {
                console.warn('[extractSegment] LINE missing entity data');
                return null;
            }

            return {
                object: obj,
                p1: new THREE.Vector2(entity.startPoint.x, entity.startPoint.y),
                p2: new THREE.Vector2(entity.endPoint.x, entity.endPoint.y),
                bulge: 0
            };
        }

        if (type === 'ARC') {
            const entity = obj.userData.entity;

            if (!entity || !entity.center || entity.radius === undefined) {
                console.warn('[extractSegment] ARC missing entity data');
                return null;
            }

            // Calculate endpoints mathematically for accuracy (not from tessellated geometry)
            const cx = entity.center.x;
            const cy = entity.center.y;
            const r = entity.radius;
            const startRad = (entity.startAngle || 0) * Math.PI / 180;
            const endRad = (entity.endAngle || 0) * Math.PI / 180;

            const p1 = new THREE.Vector2(
                cx + r * Math.cos(startRad),
                cy + r * Math.sin(startRad)
            );
            const p2 = new THREE.Vector2(
                cx + r * Math.cos(endRad),
                cy + r * Math.sin(endRad)
            );

            const bulge = this.estimateBulge(entity);

            return {
                object: obj,
                p1: p1,
                p2: p2,
                bulge: bulge
            };
        }

        return null;
    }

    estimateBulge(arcEntity) {
        // Check for undefined/null, not falsy (0 is a valid angle!)
        if (arcEntity.startAngle === undefined || arcEntity.startAngle === null ||
            arcEntity.endAngle === undefined || arcEntity.endAngle === null) {
            return 0;
        }

        const startAng = arcEntity.startAngle * Math.PI / 180;
        const endAng = arcEntity.endAngle * Math.PI / 180;

        let theta = endAng - startAng;
        if (theta < 0) theta += 2 * Math.PI;

        // bulge = tan(θ/4)
        return Math.tan(theta / 4);
    }


    clearVisualization() {
        if (this.previewMesh) {
            if (this.viewer && this.viewer.scene) {
                this.viewer.scene.remove(this.previewMesh);
            }
            if (this.previewMesh.geometry) this.previewMesh.geometry.dispose();
            this.previewMesh = null;
        }

        // Clean up debug circle
        if (this.debugCircle) {
            if (this.viewer && this.viewer.scene) {
                this.viewer.scene.remove(this.debugCircle);
            }
            if (this.debugCircle.geometry) this.debugCircle.geometry.dispose();
            this.debugCircle = null;
        }
    }

    t(key) {
        return this.languageManager ? this.languageManager.translate(key) : key;
    }
}
