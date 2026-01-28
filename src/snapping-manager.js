
import * as THREE from 'three';

export class SnappingManager {
    constructor(viewer) {
        this.viewer = viewer;
        this.scene = viewer.scene;
        this.camera = viewer.camera;
        this.raycaster = new THREE.Raycaster();

        // Configuration
        this.snapDistance = 6; // in pixels
        this.activeSnap = null; // { type, point, object }
        this.enabledSnaps = {
            endpoint: true,
            midpoint: true,
            center: true,
            intersection: true,
            perpendicular: true,
            nearest: true,
            quadrant: true,
            node: true
        };

        // Priority for snapping (lower index = higher priority)
        this.snapPriority = {
            'endpoint': 1,
            'midpoint': 2,
            'intersection': 2,  // High priority for intersections
            'center': 3,
            'quadrant': 4,
            'node': 4,
            // Perpendicular/Nearest should be fallback if no key point is close
            'perpendicular': 10,
            'nearest': 11
        };

        // World plane and temp vectors for cursor positioning
        this.worldPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0); // z=0
        this._cursorWorld = new THREE.Vector3();
        this._tmp = new THREE.Vector3();

        // Visuals
        this.markerGroup = new THREE.Group();
        this.scene.add(this.markerGroup);

        // Materials
        this.markerMaterial = new THREE.LineBasicMaterial({ color: 0x00ff00, depthTest: false }); // Green

        // Sticky Snap State (for Arc/Circle centers)
        this.stickySnaps = [];
    }

    findSnapPoint(pointer) {
        this.clearMarker();
        this.activeSnap = null;

        // 1. Calculate cursor world position via ray-plane intersection
        this.raycaster.setFromCamera(pointer, this.camera);

        // Get cursor world point: ray intersects z=0 plane
        const ok = this.raycaster.ray.intersectPlane(this.worldPlane, this._cursorWorld);
        if (!ok) return null;
        const cursorWorld = this._cursorWorld;

        // 2. Snap threshold: px -> world
        const worldPerPixel = this.viewer.getWorldPerPixel
            ? this.viewer.getWorldPerPixel()
            : (((this.camera.top - this.camera.bottom) / this.camera.zoom) / (this.viewer.renderer.domElement.clientHeight || 1));

        const worldThreshold = this.snapDistance * worldPerPixel;
        this.raycaster.params.Line.threshold = worldThreshold;

        // Get candidates
        const intersects = this.raycaster.intersectObjects(this.viewer.dxfGroup.children, true);

        // if (intersects.length === 0) return null; // Removed to allow sticky snap to persist in empty space

        // 3. Iterate candidates and find closest snap point
        let closestSnap = null;
        let minDistSq = Infinity;

        // Check each intersected object for snap points
        // Limit to first few intersections for performance
        // Limit to first few intersections for performance
        const checkCount = Math.min(intersects.length, 5);

        // --- 3. DETECT STICKY CENTERS (Arc/Circle) ---
        // We check this for all top intersections regardless of whether we snap to them immediately.
        // This ensures the Center Marker (+) appears when hovering an arc edge, even if we snap to 'nearest' on the edge.

        for (let i = 0; i < checkCount; i++) {
            const hit = intersects[i];
            const object = hit.object;
            const entity = object.userData.entity;
            if (!entity) continue;

            // Helper to convert to world coords
            const toWorld = (x, y, z = 0) => {
                this._tmp.set(x, y, z);
                return this._tmp.clone().applyMatrix4(object.matrixWorld);
            };

            const cursorLocal = cursorWorld ? object.worldToLocal(cursorWorld.clone()) : null;
            if (!cursorLocal) continue;

            let closestArc = null;

            // Check if it's a circle or arc
            if ((entity.type === 'CIRCLE' || entity.type === 'ARC') && entity.center) {
                // Distance check is implicitly done by checking if cursor is on edge?
                // Actually, 'nearest' snap logic checks distance.
                // For Sticky Center, we want to know if we are "close enough to the edge".
                // Since Raycaster hit it, we ARE on the edge (within threshold).
                // So valid hit = show center.
                closestArc = { center: entity.center };
            }
            // Check LWPOLYLINE bulge arcs
            else if ((entity.type === 'LWPOLYLINE' || entity.type === 'POLYLINE') && entity.vertices) {
                for (let j = 0; j < entity.vertices.length - 1; j++) {
                    const v1 = entity.vertices[j];
                    const v2 = entity.vertices[j + 1];
                    if (v1.bulge) {
                        const arc = this.calculateBulgeArcData(v1, v2, v1.bulge);
                        if (arc) {
                            // Check if this specific arc segment was the one hit?
                            // Raycaster hits the object (Polyline). It doesn't tell us WHICH segment.
                            // We must check distance to this arc's edge.
                            const dx = cursorLocal.x - arc.center.x;
                            const dy = cursorLocal.y - arc.center.y;
                            const dist = Math.sqrt(dx * dx + dy * dy);
                            if (Math.abs(dist - arc.radius) < (this.snapDistance / worldPerPixel)) { // Approximation
                                closestArc = arc;
                                break;
                            }
                        }
                    }
                }
            }

            if (closestArc) {
                const centerSnap = {
                    type: 'center',
                    point: toWorld(closestArc.center.x, closestArc.center.y, 0),
                    object: object
                };

                // Add to sticky list if not exists
                const exists = this.stickySnaps.some(s => s.object.id === object.id); // One center per object? Or per arc?
                // For polylines, might have multiple arcs. Stick to one for now per object or refine ID.
                // Simplicity: Per object.
                if (!exists) {
                    this.stickySnaps.push(centerSnap);
                }
            }
        }

        // --- 4. COLLECT SNAP CANDIDATES ---
        if (intersects.length > 0) {
            let allSnaps = [];

            for (let i = 0; i < checkCount; i++) {
                const hit = intersects[i];
                const object = hit.object;

                const points = this.calculateObjectSnapPoints(object, cursorWorld);

                for (const pt of points) {
                    if (!this.enabledSnaps[pt.type]) continue;

                    const dSq = cursorWorld.distanceToSquared(pt.point);
                    if (dSq < (worldThreshold * worldThreshold)) {
                        allSnaps.push({
                            type: pt.type,
                            point: pt.point,
                            object: object,
                            distanceSq: dSq,
                            priority: this.snapPriority[pt.type] || 99,
                            hitIndex: i // Capture visual order (0 is top-most)
                        });
                    }
                }
            }

            // Sort: 
            // 1. Hit Index (Lower is better: Top Object < Bottom Object) -> Matches Visual Highlight ("Green Object")
            // 2. Priority (Lower is better: Endpoint < Nearest)
            // 3. Distance (Lower is better)
            allSnaps.sort((a, b) => {
                if (a.hitIndex !== b.hitIndex) {
                    return a.hitIndex - b.hitIndex;
                }
                if (a.priority !== b.priority) {
                    return a.priority - b.priority;
                }
                return a.distanceSq - b.distanceSq;
            });

            if (allSnaps.length > 0) {
                closestSnap = allSnaps[0];
            }
        }

        // --- 5. FINALIZE ---

        // Draw Markers for Stickies
        this.stickySnaps.forEach(snap => {
            this.drawSnapMarker(snap, true);
        });

        // Determine functionality and draw primary snap
        if (closestSnap) {
            this.activeSnap = closestSnap;
            this.drawSnapMarker(closestSnap, false);
        } else if (this.stickySnaps.length > 0) {
            // No direct snap (e.g. not hovering edge anymore)?
            // OR hovering edge but only sticky remains?
            // "Nearest" makes closestSnap almost always exist on edge.
            // If we move AWAY from edge but stay near Center Marker?

            // Allow snapping to Sticky Centers if cursor is close to them!
            let bestSticky = null;
            let bestDistSq = Infinity;

            this.stickySnaps.forEach(snap => {
                const dSq = cursorWorld.distanceToSquared(snap.point);
                if (dSq < bestDistSq) {
                    bestDistSq = dSq;
                    bestSticky = snap;
                }
            });

            if (bestSticky && bestDistSq < (worldThreshold * worldThreshold)) {
                this.activeSnap = bestSticky;
                this.drawSnapMarker(bestSticky, false);
            }
        }

        return this.activeSnap;
    }

    calculateObjectSnapPoints(object, cursorWorld = null) {
        const snaps = [];
        const entity = object.userData.entity;
        if (!entity) return snaps;

        // Helper to convert local coords to world coords (for blocks/inserts)
        const toWorld = (x, y, z = 0) => {
            this._tmp.set(x, y, z);
            return this._tmp.clone().applyMatrix4(object.matrixWorld);
        };

        // Convert cursor to local space for nearest point calculations
        // Note: For 'nearest', we want the projection of 'cursorWorld' onto the geometry.
        // Since we are adding 'nearest' to the list, we do the math in World Space usually, 
        // to avoid matrix multiply overhead if possible, OR convert to local.
        // Let's use Local for easier math (Line segment 0..1 etc) then convert back.
        const cursorLocal = cursorWorld ? object.worldToLocal(cursorWorld.clone()) : null;
        if (cursorWorld && !cursorLocal) return snaps; // Should not happen if cursorWorld provided

        // Extract geometry based on type
        switch (entity.type) {
            case 'LINE':
                // Standardize: Look for startPoint/endPoint first (dxf-json)
                if (entity.startPoint && entity.endPoint) {
                    // Static Points
                    snaps.push({ type: 'endpoint', point: toWorld(entity.startPoint.x, entity.startPoint.y, entity.startPoint.z ?? 0) });
                    snaps.push({ type: 'endpoint', point: toWorld(entity.endPoint.x, entity.endPoint.y, entity.endPoint.z ?? 0) });
                    snaps.push({
                        type: 'midpoint',
                        point: toWorld(
                            (entity.startPoint.x + entity.endPoint.x) / 2,
                            (entity.startPoint.y + entity.endPoint.y) / 2,
                            ((entity.startPoint.z ?? 0) + (entity.endPoint.z ?? 0)) / 2
                        )
                    });

                    // Dynamic: Nearest / Perpendicular
                    if (cursorLocal) {
                        const p1 = entity.startPoint;
                        const p2 = entity.endPoint;
                        const nearestLocal = this.closestPointOnSegment(cursorLocal, p1, p2);
                        if (nearestLocal) {
                            snaps.push({ type: 'nearest', point: toWorld(nearestLocal.x, nearestLocal.y, nearestLocal.z || 0) });
                            // Perpendicular snap logic is reserved for future implementation (requires base point context).
                            // For now, 'nearest' efficiently handles snapping to any point on the segment.
                        }
                    }

                } else if (entity.vertices) {
                    // Fallback for older parser or Polyline segments treated as Lines
                    snaps.push({ type: 'endpoint', point: toWorld(entity.vertices[0].x, entity.vertices[0].y, 0) });
                    snaps.push({ type: 'endpoint', point: toWorld(entity.vertices[1].x, entity.vertices[1].y, 0) });
                    snaps.push({
                        type: 'midpoint',
                        point: toWorld(
                            (entity.vertices[0].x + entity.vertices[1].x) / 2,
                            (entity.vertices[0].y + entity.vertices[1].y) / 2,
                            0
                        )
                    });
                    if (cursorLocal) {
                        const nearestLocal = this.closestPointOnSegment(cursorLocal, entity.vertices[0], entity.vertices[1]);
                        if (nearestLocal) {
                            snaps.push({ type: 'nearest', point: toWorld(nearestLocal.x, nearestLocal.y, 0) });
                        }
                    }
                }
                break;

                break;

            case 'LWPOLYLINE':
            case 'POLYLINE':
                if (entity.vertices) {
                    entity.vertices.forEach(v => {
                        snaps.push({ type: 'endpoint', point: toWorld(v.x, v.y, v.z || 0) });
                    });

                    const isClosed = entity.closed || (entity.flag & 1) === 1;
                    const len = entity.vertices.length;
                    const count = isClosed ? len : len - 1;

                    // Helper functions for arc angle checks
                    const TAU = Math.PI * 2;
                    const norm = (a) => (a % TAU + TAU) % TAU;

                    // CCW interval test (inclusive)
                    const isOnArcCCW = (a, s, e) => {
                        a = norm(a); s = norm(s); e = norm(e);
                        if (e < s) e += TAU;
                        if (a < s) a += TAU;
                        return a >= s - 1e-9 && a <= e + 1e-9;
                    };

                    // General: ccw -> [s->e], cw -> [e->s] CCW-wise
                    const isOnArc = (a, arc) => {
                        return arc.ccw ? isOnArcCCW(a, arc.startAngle, arc.endAngle)
                            : isOnArcCCW(a, arc.endAngle, arc.startAngle);
                    };

                    for (let i = 0; i < count; i++) {
                        const v1 = entity.vertices[i];
                        const v2 = entity.vertices[(i + 1) % len];

                        // Bulge arc handling
                        if (v1.bulge) {
                            const arc = this.calculateBulgeArcData(v1, v2, v1.bulge);
                            if (arc) {
                                // Center
                                snaps.push({ type: 'center', point: toWorld(arc.center.x, arc.center.y, 0) });

                                // Midpoint = arc midpoint (not chord midpoint)
                                const midAngle = arc.ccw
                                    ? arc.startAngle + arc.sweep / 2
                                    : arc.startAngle - arc.sweep / 2;

                                const mx = arc.center.x + arc.radius * Math.cos(midAngle);
                                const my = arc.center.y + arc.radius * Math.sin(midAngle);
                                snaps.push({ type: 'midpoint', point: toWorld(mx, my, 0) });

                                // Quadrants only if they lie on this arc span
                                const quads = [0, Math.PI / 2, Math.PI, 3 * Math.PI / 2];
                                for (const qa of quads) {
                                    if (!isOnArc(qa, arc)) continue;
                                    const qx = arc.center.x + arc.radius * Math.cos(qa);
                                    const qy = arc.center.y + arc.radius * Math.sin(qa);
                                    snaps.push({ type: 'quadrant', point: toWorld(qx, qy, 0) });
                                }

                                // Nearest on Arc
                                if (cursorLocal) {
                                    const nearestOnArc = this.closestPointOnArc(cursorLocal, arc.center, arc.radius, arc.startAngle, arc.endAngle, arc.ccw);
                                    if (nearestOnArc) {
                                        snaps.push({ type: 'nearest', point: toWorld(nearestOnArc.x, nearestOnArc.y, 0) });
                                    }
                                }
                            }
                        } else {
                            // No bulge - straight segment: chord midpoint
                            snaps.push({
                                type: 'midpoint',
                                point: toWorld((v1.x + v2.x) / 2, (v1.y + v2.y) / 2, 0)
                            });
                            // Nearest On Segment
                            if (cursorLocal) {
                                const nearestLocal = this.closestPointOnSegment(cursorLocal, v1, v2);
                                if (nearestLocal) {
                                    snaps.push({ type: 'nearest', point: toWorld(nearestLocal.x, nearestLocal.y, 0) });
                                }
                            }
                        }
                    }
                }
                break;

            case 'CIRCLE':
            case 'ARC':
                if (entity.center) {
                    snaps.push({ type: 'center', point: toWorld(entity.center.x, entity.center.y, entity.center.z || 0) });
                }

                // Quadrants (0, 90, 180, 270)
                const center = entity.center;
                const radius = entity.radius;
                const quads = [0, Math.PI / 2, Math.PI, 3 * Math.PI / 2];

                quads.forEach(angle => {
                    let valid = true;
                    if (entity.type === 'ARC') {
                        // Normalize Start/End
                        let s = entity.startAngle * Math.PI / 180;
                        let e = entity.endAngle * Math.PI / 180;
                        while (s < 0) s += Math.PI * 2;
                        while (e <= s) e += Math.PI * 2;
                        let testA = angle;
                        while (testA < s) testA += Math.PI * 2;
                        // If testA is within [s, e], keep it. 
                        // Note: Quadrants might be outside arc span. 
                        // Allow tolerating wrap-around logic better or simplified:
                        // Simple check: Is point on arc?
                    }
                    // For now, enable all quadrants for Circle. Arc logic can be refined if needed.
                    if (entity.type === 'CIRCLE' || valid) {
                        snaps.push({
                            type: 'quadrant',
                            point: toWorld(
                                center.x + radius * Math.cos(angle),
                                center.y + radius * Math.sin(angle),
                                center.z || 0
                            )
                        });
                    }
                });

                // Endpoints for Arc
                if (entity.type === 'ARC') {
                    // Angles are likely in DEGREES in raw entity data from dxf-json.
                    const startRad = (entity.startAngle * Math.PI) / 180;
                    const endRad = (entity.endAngle * Math.PI) / 180;

                    const startX = entity.center.x + entity.radius * Math.cos(startRad);
                    const startY = entity.center.y + entity.radius * Math.sin(startRad);
                    snaps.push({ type: 'endpoint', point: toWorld(startX, startY, entity.center.z || 0) });

                    const endX = entity.center.x + entity.radius * Math.cos(endRad);
                    const endY = entity.center.y + entity.radius * Math.sin(endRad);
                    snaps.push({ type: 'endpoint', point: toWorld(endX, endY, entity.center.z || 0) });

                    // Nearest on Arc
                    if (cursorLocal) {
                        // For DXF Arc, angles are Degrees. Helper converts to Rads if needed or we use entity values?
                        const startR = (entity.startAngle * Math.PI) / 180;
                        const endR = (entity.endAngle * Math.PI) / 180;
                        // Determine CCW? DXF is usually CCW.
                        // However, start and end angles might be ordered.
                        // Assuming CCW from start to end.

                        const nearestOnArc = this.closestPointOnArc(cursorLocal, entity.center, entity.radius, startR, endR, true);
                        if (nearestOnArc) {
                            snaps.push({ type: 'nearest', point: toWorld(nearestOnArc.x, nearestOnArc.y, entity.center.z || 0) });
                        }
                    }
                } else if (entity.type === 'CIRCLE') {
                    // Nearest on Circle
                    if (cursorLocal) {
                        const nearestOnCircle = this.closestPointOnArc(cursorLocal, entity.center, entity.radius, 0, Math.PI * 2, true, true); // true for full circle
                        if (nearestOnCircle) {
                            snaps.push({ type: 'nearest', point: toWorld(nearestOnCircle.x, nearestOnCircle.y, entity.center.z || 0) });
                        }
                    }
                }
                break;
        }

        return snaps;
    }

    drawSnapMarker(snap, isSticky = false) {
        // Size in pixels (constant screen size)
        const sizePx = 10;
        const worldPerPixel = this.viewer.getWorldPerPixel
            ? this.viewer.getWorldPerPixel()
            : (((this.camera.top - this.camera.bottom) / this.camera.zoom) / (this.viewer.renderer.domElement.clientHeight || 1));
        const size = sizePx * worldPerPixel;

        let geometry;

        if (isSticky && snap.type === 'center') {
            // Sticky Center: Draw a Plus (+)
            const pts = [];
            pts.push(new THREE.Vector3(-size / 2, 0, 0));
            pts.push(new THREE.Vector3(size / 2, 0, 0));
            pts.push(new THREE.Vector3(0, -size / 2, 0));
            pts.push(new THREE.Vector3(0, size / 2, 0));
            // Note: GL_LINES (LineSegments) logic for separated lines
            // But we use THREE.Line which strips. 
            // 0->1 (Horiz), 1->2 (Diagonal jump? NO)
            // Need disjoint?
            // Simple approach: Use a Cross Box, or just draw one line then another via child?
            // Or just use points order: -x,0 -> x,0 -> 0,0 -> 0,-y -> 0,y (overlap center)
            // Easier: Just use vertices for 2 lines and use LineSegments if we changed material type?
            // But MarkerMaterial is LineBasicMaterial.
            // Let's create a BufferGeometry with "LineSegments" draw mode? 
            // THREE.Line uses LineStrip.
            // THREE.LineSegments uses Pairs.

            // To be safe with existing system (Line), we can draw a continuous path that looks like a plus?
            // Or just add 2 line objects.
            // Let's try continuous path with backtracking (degenerate lines):
            // L->R->Center->Top->Bottom.
            const s2 = size / 2;
            const pts2 = [
                new THREE.Vector3(-s2, 0, 0),
                new THREE.Vector3(s2, 0, 0),
                new THREE.Vector3(0, 0, 0), // Back to center
                new THREE.Vector3(0, s2, 0),
                new THREE.Vector3(0, -s2, 0)
            ];
            geometry = new THREE.BufferGeometry().setFromPoints(pts2);

        } else if (snap.type === 'endpoint') {
            // Square
            const pts = [];
            pts.push(new THREE.Vector3(-size / 2, -size / 2, 0));
            pts.push(new THREE.Vector3(size / 2, -size / 2, 0));
            pts.push(new THREE.Vector3(size / 2, size / 2, 0));
            pts.push(new THREE.Vector3(-size / 2, size / 2, 0));
            pts.push(new THREE.Vector3(-size / 2, -size / 2, 0)); // Close
            geometry = new THREE.BufferGeometry().setFromPoints(pts);
        } else if (snap.type === 'midpoint') {
            // Triangle
            const pts = [];
            pts.push(new THREE.Vector3(-size / 2, -size / 2, 0));
            pts.push(new THREE.Vector3(size / 2, -size / 2, 0));
            pts.push(new THREE.Vector3(0, size / 2, 0));
            pts.push(new THREE.Vector3(-size / 2, -size / 2, 0));
            geometry = new THREE.BufferGeometry().setFromPoints(pts);
        } else if (snap.type === 'center') {
            // Circle (Active Hover)
            const pts = [];
            for (let i = 0; i <= 16; i++) {
                const a = (i / 16) * Math.PI * 2;
                pts.push(new THREE.Vector3(Math.cos(a) * size / 2, Math.sin(a) * size / 2, 0));
            }
            geometry = new THREE.BufferGeometry().setFromPoints(pts);
        } else if (snap.type === 'quadrant') {
            // Diamond
            const pts = [];
            pts.push(new THREE.Vector3(0, size / 2, 0));
            pts.push(new THREE.Vector3(size / 2, 0, 0));
            pts.push(new THREE.Vector3(0, -size / 2, 0));
            pts.push(new THREE.Vector3(-size / 2, 0, 0));
            pts.push(new THREE.Vector3(0, size / 2, 0));
            geometry = new THREE.BufferGeometry().setFromPoints(pts);
            pts.push(new THREE.Vector3(-size / 2, -size / 2, 0));
            geometry = new THREE.BufferGeometry().setFromPoints(pts);
        } else if (snap.type === 'nearest') {
            // Hourglass
            const pts = [];
            pts.push(new THREE.Vector3(-size / 2, size / 2, 0));
            pts.push(new THREE.Vector3(size / 2, -size / 2, 0));
            pts.push(new THREE.Vector3(-size / 2, -size / 2, 0)); // Bottom line? No hourglass is X with top/bottom bars usually
            // AutoCAD Nearest is like an Hourglass.
            // Top Line
            pts.push(new THREE.Vector3(-size / 2, size / 2, 0));
            pts.push(new THREE.Vector3(size / 2, size / 2, 0));
            // Diagonal
            pts.push(new THREE.Vector3(-size / 2, -size / 2, 0));
            // Bottom Line
            pts.push(new THREE.Vector3(size / 2, -size / 2, 0));
            pts.push(new THREE.Vector3(size / 2, size / 2, 0)); // Diagonal back

            // Simple Hourglass:
            // (-w, h) -> (w, h) -> (-w, -h) -> (w, -h) -> (-w, h)
            const pts2 = [
                new THREE.Vector3(-size / 2, size / 2, 0),
                new THREE.Vector3(size / 2, size / 2, 0),
                new THREE.Vector3(-size / 2, -size / 2, 0),
                new THREE.Vector3(size / 2, -size / 2, 0),
                new THREE.Vector3(-size / 2, size / 2, 0)
            ];
            geometry = new THREE.BufferGeometry().setFromPoints(pts2);
        } else if (snap.type === 'perpendicular') {
            // Right Angle (Bottom Left corner usually)
            //  |
            //  |___
            const pts = [];
            pts.push(new THREE.Vector3(-size / 2, size / 2, 0));
            pts.push(new THREE.Vector3(-size / 2, -size / 2, 0));
            pts.push(new THREE.Vector3(size / 2, -size / 2, 0));
            // Inner right angle
            pts.push(new THREE.Vector3(0, -size / 2, 0));
            pts.push(new THREE.Vector3(0, 0, 0));
            pts.push(new THREE.Vector3(-size / 2, 0, 0));

            // Simplest: L shape
            const pts2 = [
                new THREE.Vector3(-size / 2, size / 2, 0),
                new THREE.Vector3(-size / 2, -size / 2, 0),
                new THREE.Vector3(size / 2, -size / 2, 0)
            ];
            geometry = new THREE.BufferGeometry().setFromPoints(pts2);
        } else {
            // Default: Intersection -> X
            const pts = [];
            pts.push(new THREE.Vector3(-size / 2, -size / 2, 0));
            pts.push(new THREE.Vector3(size / 2, -size / 2, 0));
            pts.push(new THREE.Vector3(size / 2, size / 2, 0));
            pts.push(new THREE.Vector3(-size / 2, size / 2, 0));
            pts.push(new THREE.Vector3(-size / 2, -size / 2, 0));
            geometry = new THREE.BufferGeometry().setFromPoints(pts);
        }

        const marker = new THREE.Line(geometry, this.markerMaterial);
        marker.position.copy(snap.point);
        marker.renderOrder = 999;

        this.markerGroup.add(marker);
    }

    clearMarker() {
        while (this.markerGroup.children.length > 0) {
            const c = this.markerGroup.children[0];
            if (c.geometry) c.geometry.dispose();
            this.markerGroup.remove(c);
        }
    }

    clearSticky() {
        this.stickySnaps = [];
        this.activeSnap = null;
        this.clearMarker();
    }

    calculateBulgeCenter(p1, p2, bulge) {
        if (!bulge) return null;
        const chordX = p2.x - p1.x;
        const chordY = p2.y - p1.y;
        const chordLen = Math.sqrt(chordX * chordX + chordY * chordY);
        if (chordLen < 1e-9) return null;

        const theta = 4 * Math.atan(bulge);
        const radius = chordLen / (2 * Math.sin(theta / 2));

        // Vector from Midpoint to Center
        // Midpoint
        const mx = (p1.x + p2.x) / 2;
        const my = (p1.y + p2.y) / 2;

        // Normal vector (-dy, dx)
        const nx = -chordY;
        const ny = chordX;

        // Distance from chord to center (sagitta related)
        // radius^2 = (chord/2)^2 + d^2
        // d = sqrt(r^2 - (c/2)^2)
        // Sign depends on bulge sign?
        // Actually, algebraic formula from bulges:
        // offset = (1 - bulge^2) / (4 * bulge) * chordLen? No.
        // offset vector factor 'f' from midpoint:
        // f = (1 - b^2) / (4*b)

        const f = (1 - bulge * bulge) / (4 * bulge);

        const cx = mx + nx * f;
        const cy = my + ny * f;

        return { x: cx, y: cy };
    }

    calculateBulgeArcData(p1, p2, bulge) {
        if (!bulge) return null;

        const dx = p2.x - p1.x;
        const dy = p2.y - p1.y;
        const chordLen = Math.sqrt(dx * dx + dy * dy);
        if (chordLen < 1e-9) return null;

        const theta = 4 * Math.atan(bulge);            // signed included angle
        const r = chordLen / (2 * Math.sin(theta / 2)); // signed radius

        // Midpoint
        const mx = (p1.x + p2.x) / 2;
        const my = (p1.y + p2.y) / 2;

        // Perp vector (NOT normalized is OK with f)
        const nx = -dy;
        const ny = dx;

        const f = (1 - bulge * bulge) / (4 * bulge);

        const cx = mx + nx * f;
        const cy = my + ny * f;

        // Start/End angles (local space)
        const startAngle = Math.atan2(p1.y - cy, p1.x - cx);
        const endAngle = Math.atan2(p2.y - cy, p2.x - cx);

        const TAU = Math.PI * 2;
        const norm = (a) => {
            a = a % TAU;
            return a < 0 ? a + TAU : a;
        };

        const s = norm(startAngle);
        const e = norm(endAngle);

        const ccw = bulge > 0;

        // Sweep in chosen direction
        let sweep;
        if (ccw) {
            sweep = e - s;
            if (sweep < 0) sweep += TAU;
        } else {
            sweep = s - e;
            if (sweep < 0) sweep += TAU;
        }

        return {
            center: { x: cx, y: cy },
            radius: Math.abs(r),
            startAngle: s,
            endAngle: e,
            ccw,
            sweep
        };
    }

    closestPointOnSegment(p, a, b) {
        const pax = p.x - a.x, pay = p.y - a.y;
        const bax = b.x - a.x, bay = b.y - a.y;
        const h = Math.min(1.0, Math.max(0.0, (pax * bax + pay * bay) / (bax * bax + bay * bay)));
        return {
            x: a.x + h * bax,
            y: a.y + h * bay
        };
    }

    closestPointOnArc(p, center, radius, startAngle, endAngle, ccw = true, fullCircle = false) {
        const dx = p.x - center.x;
        const dy = p.y - center.y;

        // Angle from center to point
        let angle = Math.atan2(dy, dx);
        const TAU = Math.PI * 2;

        // Project to circle radius
        const px = center.x + radius * Math.cos(angle);
        const py = center.y + radius * Math.sin(angle);

        if (fullCircle) {
            return { x: px, y: py };
        }

        // Normalize
        const norm = (a) => (a % TAU + TAU) % TAU;
        angle = norm(angle);
        const s = norm(startAngle);
        const e = norm(endAngle);

        // Check if angle is within arc
        let inside = false;

        if (ccw) { // ccw: s -> e
            if (s <= e) {
                inside = (angle >= s && angle <= e);
            } else { // Wrap around 0
                inside = (angle >= s || angle <= e);
            }
        } else { // cw: s -> e (decreasing?)
            // entity data for Bulge usually handled by converting to CCW start/end
            // But if we passed raw angles, we must be careful.
            // My calculateBulgeArcData returns CCW sweeps.
            // If entity is ARC/CIRCLE, we assume CCW.
            if (s <= e) {
                inside = (angle >= s && angle <= e);
            } else {
                inside = (angle >= s || angle <= e);
            }
        }

        if (inside) {
            return { x: px, y: py };
        }

        // If not inside, clamp to nearest endpoint?
        // Usually, 'nearest' snap SHOULD NOT snap to endpoints if far away.
        // It strictly snaps "On Object". If outside arc span, it is NOT on object.
        // So return null.
        return null;
    }
}
