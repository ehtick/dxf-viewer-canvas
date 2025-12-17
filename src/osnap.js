/**
 * OSNAP (Object Snap) System Module
 * Detects snap points on entities with various snap modes
 */

export class OSNAPSystem {
    constructor(renderer) {
        this.renderer = renderer;
        this.snapModes = {
            endpoint: true,
            midpoint: true,
            center: true,
            quadrant: true,
            intersection: true,
            perpendicular: true,
            nearest: true,
            node: true
        };
        this.snapTolerance = 15; // pixels
    }

    /**
     * Find snap point near cursor position
     * @param {Object} worldPos - World coordinates {x, y}
     * @param {Array} entities - Entities to snap to
     * @param {Object} [referencePoint] - Optional reference point for perpendicular/tangent snaps
     * @returns {Object|null} Snap result {type, point, entity}
     */
    findSnapPoint(worldPos, entities, referencePoint = null) {
        let closestSnap = null;
        let closestDist = Infinity;

        // Priority: Special snaps > Nearest
        // If we have a special snap within tolerance, ignore nearest unless it's much closer (which implies we are far from special snap)
        // Actually, standard behavior: Special snaps take precedence if within tolerance.

        const specialSnaps = ['endpoint', 'midpoint', 'center', 'quadrant', 'intersection', 'perpendicular', 'node'];

        for (const entity of entities) {
            const layer = this.renderer.layers.get(entity.layer);
            if (layer && !layer.visible) continue;

            const snaps = this.getEntitySnapPoints(entity, worldPos, referencePoint);

            for (const snap of snaps) {
                const screenPos = this.renderer.worldToScreen(snap.point.x, snap.point.y);
                const cursorScreen = this.renderer.worldToScreen(worldPos.x, worldPos.y);

                const dist = Math.sqrt(
                    Math.pow(screenPos.x - cursorScreen.x, 2) +
                    Math.pow(screenPos.y - cursorScreen.y, 2)
                );

                if (dist < this.snapTolerance) {
                    // Start with simple distance check
                    if (dist < closestDist) {
                        // If current closest is special and new is nearest, skip (unless much closer? no, special wins inside tolerance)
                        if (closestSnap && specialSnaps.includes(closestSnap.type) && snap.type === 'nearest') {
                            continue;
                        }
                        closestDist = dist;
                        closestSnap = snap;
                    }
                    // If distance is similar or valid, but new one is special and current is nearest, swap
                    else if (closestSnap && snap.type !== 'nearest' && closestSnap.type === 'nearest') {
                        closestDist = dist;
                        closestSnap = snap;
                    }
                }
            }
        }

        return closestSnap;
    }

    /**
     * Get all snap points for an entity
     */
    getEntitySnapPoints(entity, cursorPos, referencePoint = null) {
        const snaps = [];

        switch (entity.type) {
            case 'LINE':
                snaps.push(...this.getLineSnaps(entity, cursorPos, referencePoint));
                break;
            case 'CIRCLE':
                snaps.push(...this.getCircleSnaps(entity, cursorPos));
                break;
            case 'ARC':
                snaps.push(...this.getArcSnaps(entity, cursorPos));
                break;
            case 'LWPOLYLINE':
            case 'POLYLINE':
                snaps.push(...this.getPolylineSnaps(entity, cursorPos));
                break;
            case 'POINT':
                if (this.snapModes.node) {
                    snaps.push({
                        type: 'node',
                        point: { x: entity.x, y: entity.y },
                        entity
                    });
                }
                break;
        }

        return snaps;
    }

    getLineSnaps(entity, cursorPos, referencePoint) {
        const snaps = [];

        // Endpoints
        if (this.snapModes.endpoint) {
            snaps.push({
                type: 'endpoint',
                point: { x: entity.x1, y: entity.y1 },
                entity
            });
            snaps.push({
                type: 'endpoint',
                point: { x: entity.x2, y: entity.y2 },
                entity
            });
        }

        // Midpoint
        if (this.snapModes.midpoint) {
            snaps.push({
                type: 'midpoint',
                point: {
                    x: (entity.x1 + entity.x2) / 2,
                    y: (entity.y1 + entity.y2) / 2
                },
                entity
            });
        }

        // Perpendicular
        if (this.snapModes.perpendicular && referencePoint) {
            // Use infinite line logic for perpendicular snap
            const perp = this.perpendicularPointOnInfiniteLine(
                referencePoint,
                { x: entity.x1, y: entity.y1 },
                { x: entity.x2, y: entity.y2 }
            );
            if (perp) {
                snaps.push({
                    type: 'perpendicular',
                    point: { x: perp.x, y: perp.y },
                    entity,
                    isProjection: perp.t < 0 || perp.t > 1 // Flag if outside segment
                });
            }
        }

        // Nearest point on line
        if (this.snapModes.nearest) {
            const nearest = this.nearestPointOnLine(
                cursorPos,
                { x: entity.x1, y: entity.y1 },
                { x: entity.x2, y: entity.y2 }
            );
            if (nearest) {
                snaps.push({
                    type: 'nearest',
                    point: nearest,
                    entity
                });
            }
        }

        return snaps;
    }

    getCircleSnaps(entity, cursorPos) {
        const snaps = [];

        // Center
        if (this.snapModes.center) {
            snaps.push({
                type: 'center',
                point: { x: entity.cx, y: entity.cy },
                entity
            });
        }

        // Quadrants
        if (this.snapModes.quadrant) {
            snaps.push({
                type: 'quadrant',
                point: { x: entity.cx + entity.radius, y: entity.cy },
                entity
            });
            snaps.push({
                type: 'quadrant',
                point: { x: entity.cx, y: entity.cy + entity.radius },
                entity
            });
            snaps.push({
                type: 'quadrant',
                point: { x: entity.cx - entity.radius, y: entity.cy },
                entity
            });
            snaps.push({
                type: 'quadrant',
                point: { x: entity.cx, y: entity.cy - entity.radius },
                entity
            });
        }

        // Nearest point on circle
        if (this.snapModes.nearest) {
            const dx = cursorPos.x - entity.cx;
            const dy = cursorPos.y - entity.cy;
            const dist = Math.sqrt(dx * dx + dy * dy);

            if (dist > 0) {
                snaps.push({
                    type: 'nearest',
                    point: {
                        x: entity.cx + (dx / dist) * entity.radius,
                        y: entity.cy + (dy / dist) * entity.radius
                    },
                    entity
                });
            }
        }

        return snaps;
    }

    getArcSnaps(entity, cursorPos) {
        const snaps = [];

        // Center
        if (this.snapModes.center) {
            snaps.push({
                type: 'center',
                point: { x: entity.cx, y: entity.cy },
                entity
            });
        }

        // Endpoints
        if (this.snapModes.endpoint) {
            const startRad = entity.startAngle * Math.PI / 180;
            const endRad = entity.endAngle * Math.PI / 180;

            snaps.push({
                type: 'endpoint',
                point: {
                    x: entity.cx + entity.radius * Math.cos(startRad),
                    y: entity.cy + entity.radius * Math.sin(startRad)
                },
                entity
            });
            snaps.push({
                type: 'endpoint',
                point: {
                    x: entity.cx + entity.radius * Math.cos(endRad),
                    y: entity.cy + entity.radius * Math.sin(endRad)
                },
                entity
            });
        }

        // Midpoint
        if (this.snapModes.midpoint) {
            let midAngle = (entity.startAngle + entity.endAngle) / 2;

            // Handle angle wrapping
            if (entity.endAngle < entity.startAngle) {
                midAngle = ((entity.startAngle + entity.endAngle + 360) / 2) % 360;
            }

            const midRad = midAngle * Math.PI / 180;
            snaps.push({
                type: 'midpoint',
                point: {
                    x: entity.cx + entity.radius * Math.cos(midRad),
                    y: entity.cy + entity.radius * Math.sin(midRad)
                },
                entity
            });
        }

        return snaps;
    }

    getPolylineSnaps(entity, cursorPos) {
        const snaps = [];

        if (!entity.vertices || entity.vertices.length === 0) return snaps;

        for (let i = 0; i < entity.vertices.length; i++) {
            const v = entity.vertices[i];

            // Vertex endpoints
            if (this.snapModes.endpoint) {
                snaps.push({
                    type: 'endpoint',
                    point: { x: v.x, y: v.y },
                    entity
                });
            }

            // Segment midpoints and nearest
            if (i < entity.vertices.length - 1) {
                const v2 = entity.vertices[i + 1];

                if (this.snapModes.midpoint) {
                    snaps.push({
                        type: 'midpoint',
                        point: {
                            x: (v.x + v2.x) / 2,
                            y: (v.y + v2.y) / 2
                        },
                        entity
                    });
                }

                if (this.snapModes.nearest) {
                    const nearest = this.nearestPointOnLine(
                        cursorPos,
                        { x: v.x, y: v.y },
                        { x: v2.x, y: v2.y }
                    );
                    if (nearest) {
                        snaps.push({
                            type: 'nearest',
                            point: nearest,
                            entity
                        });
                    }
                }
            }
        }

        return snaps;
    }

    /**
     * Find nearest point on a line segment
     */
    /**
     * Find nearest point on a line segment
     */
    nearestPointOnLine(point, lineStart, lineEnd) {
        const dx = lineEnd.x - lineStart.x;
        const dy = lineEnd.y - lineStart.y;
        const lengthSquared = dx * dx + dy * dy;

        if (lengthSquared === 0) return lineStart;

        let t = ((point.x - lineStart.x) * dx + (point.y - lineStart.y) * dy) / lengthSquared;
        t = Math.max(0, Math.min(1, t));

        return {
            x: lineStart.x + t * dx,
            y: lineStart.y + t * dy
        };
    }

    /**
     * Find perpendicular projection point on line segment
     * Returns null if projection falls outside segment
     */
    perpendicularPointOnLine(point, lineStart, lineEnd) {
        const dx = lineEnd.x - lineStart.x;
        const dy = lineEnd.y - lineStart.y;
        const lengthSquared = dx * dx + dy * dy;

        if (lengthSquared === 0) return null;

        const t = ((point.x - lineStart.x) * dx + (point.y - lineStart.y) * dy) / lengthSquared;

        // Strictly within segment (with small tolerance for endpoints)
        if (t >= 0 && t <= 1) {
            return {
                x: lineStart.x + t * dx,
                y: lineStart.y + t * dy
            };
        }

        return null;
    }

    /**
     * Find perpendicular projection point on infinite line
     */
    perpendicularPointOnInfiniteLine(point, lineStart, lineEnd) {
        const dx = lineEnd.x - lineStart.x;
        const dy = lineEnd.y - lineStart.y;
        const lengthSquared = dx * dx + dy * dy;

        if (lengthSquared === 0) return null;

        const t = ((point.x - lineStart.x) * dx + (point.y - lineStart.y) * dy) / lengthSquared;

        return {
            x: lineStart.x + t * dx,
            y: lineStart.y + t * dy,
            t: t // Return t to check if it's outside segment (t < 0 or t > 1)
        };
    }

    /**
     * Find intersection between two lines
     */
    lineLineIntersection(l1p1, l1p2, l2p1, l2p2) {
        const x1 = l1p1.x, y1 = l1p1.y;
        const x2 = l1p2.x, y2 = l1p2.y;
        const x3 = l2p1.x, y3 = l2p1.y;
        const x4 = l2p2.x, y4 = l2p2.y;

        const denom = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);

        if (Math.abs(denom) < 0.0001) return null; // Parallel

        const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / denom;
        const u = -((x1 - x2) * (y1 - y3) - (y1 - y2) * (x1 - x3)) / denom;

        if (t >= 0 && t <= 1 && u >= 0 && u <= 1) {
            return {
                x: x1 + t * (x2 - x1),
                y: y1 + t * (y2 - y1)
            };
        }

        return null;
    }

    /**
     * Toggle snap mode
     */
    toggleSnapMode(mode, enabled) {
        if (this.snapModes.hasOwnProperty(mode)) {
            this.snapModes[mode] = enabled;
        }
    }

    /**
     * Set snap tolerance in pixels
     */
    setSnapTolerance(tolerance) {
        this.snapTolerance = tolerance;
    }
}
