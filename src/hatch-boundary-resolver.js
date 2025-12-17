/**
 * Hatch Boundary Resolver
 * LibreCAD-style topological stitching and normalization.
 * Output is SAFE for Canvas fill().
 */

export class HatchBoundaryResolver {

    static resolveLoop(loop) {
        if (!loop) return null;
        if (loop.isPolyline) {
            return this.resolvePolylineLoop(loop);
        } else {
            return this.resolveEdgeLoop(loop);
        }
    }

    /* =========================
     * EDGE LOOP RESOLUTION
     * ========================= */
    static resolveEdgeLoop(loop) {
        if (!loop.edges || loop.edges.length === 0) {
            return { ok: false, reason: "no edges" };
        }

        const edges = loop.edges.map(e => this.normalizeEdge(e));
        const used = new Set();
        const path = [];

        // adaptive tolerance based on geometry scale
        const bbox = this.computeBBox(edges);
        const tol = Math.max(bbox.diag * 1e-4, 1e-4);

        let current = edges[0];
        used.add(0);
        path.push(current);

        while (path.length < edges.length) {
            let found = false;
            const tip = { x: current.x2, y: current.y2 };

            for (let i = 0; i < edges.length; i++) {
                if (used.has(i)) continue;

                const e = edges[i];

                if (this.dist(e.x1, e.y1, tip.x, tip.y) < tol) {
                    path.push(e);
                    used.add(i);
                    current = e;
                    found = true;
                    break;
                }

                if (this.dist(e.x2, e.y2, tip.x, tip.y) < tol) {
                    const rev = this.reverseEdge(e);
                    path.push(rev);
                    used.add(i);
                    current = rev;
                    found = true;
                    break;
                }
            }

            if (!found) {
                // Heuristic: Auto-Bridge Gaps
                // Find the closest remaining edge
                let minDist = Infinity;
                let bestIdx = -1;
                let connectToStart = true; // Connects to e.x1/y1

                for (let i = 0; i < edges.length; i++) {
                    if (used.has(i)) continue;
                    const e = edges[i];

                    const dStart = this.dist(e.x1, e.y1, tip.x, tip.y);
                    const dEnd = this.dist(e.x2, e.y2, tip.x, tip.y);

                    if (dStart < minDist) {
                        minDist = dStart;
                        bestIdx = i;
                        connectToStart = true;
                    }
                    if (dEnd < minDist) {
                        minDist = dEnd;
                        bestIdx = i;
                        connectToStart = false; // Connects to e.x2/y2 (so we must reverse e)
                    }
                }

                if (bestIdx !== -1) {
                    // Create Bridge Edge
                    // If separation is significant, explicitly add a LINE
                    // If small (fuzzy), just snap? No, add Line for safety.
                    const target = edges[bestIdx];
                    const nextStart = connectToStart ? { x: target.x1, y: target.y1 } : { x: target.x2, y: target.y2 };

                    if (minDist > tol) {
                        console.warn(`HATCH_REPAIR: Bridging gap of ${minDist.toFixed(4)} units.`);
                        path.push({
                            type: 'LINE',
                            x1: tip.x, y1: tip.y,
                            x2: nextStart.x, y2: nextStart.y
                        });
                    }

                    // Add the target edge
                    if (connectToStart) {
                        path.push(target);
                        current = target;
                    } else {
                        const rev = this.reverseEdge(target);
                        path.push(rev);
                        current = rev;
                    }
                    used.add(bestIdx);
                    found = true;
                }
            }

            if (!found) {
                console.warn("STITCH_FAIL: Isolated island detected or bridge failed.", JSON.stringify(edges));
                return { ok: false, reason: "stitch failed", path };
            }
        }

        // closed-loop validation
        // closed-loop validation & Final Bridge
        const first = path[0];
        const last = path[path.length - 1];
        const closeDist = this.dist(first.x1, first.y1, last.x2, last.y2);

        if (closeDist > tol) {
            console.warn(`HATCH_REPAIR: Closing loop gap of ${closeDist.toFixed(4)} units.`);
            path.push({
                type: 'LINE',
                x1: last.x2, y1: last.y2,
                x2: first.x1, y2: first.y1
            });
        }

        // normalize winding (CCW outer loop)
        const area = this.calculateLoopArea(path);
        if (area < 0) {
            return { ok: true, path: this.reversePath(path) };
        }

        return { ok: true, path };
    }

    /* =========================
     * POLYLINE LOOP
     * ========================= */
    static resolvePolylineLoop(loop) {
        const verts = loop.vertices;
        if (!verts || verts.length < 2) {
            return { ok: false, reason: "invalid polyline" };
        }

        const path = [];
        for (let i = 0; i < verts.length; i++) {
            const p1 = verts[i];
            const p2 = verts[(i + 1) % verts.length];

            if (p1.bulge) {
                const arc = this.bulgeToArc(p1, p2, p1.bulge);
                path.push(arc);
            } else {
                path.push({
                    type: 'LINE',
                    x1: p1.x, y1: p1.y,
                    x2: p2.x, y2: p2.y
                });
            }
        }

        // FIX: Polyline loops also need winding normalization for correct fill
        const area = this.calculateLoopArea(path);
        if (area < 0) {
            return { ok: true, path: this.reversePath(path) };
        }

        return { ok: true, path };
    }

    /* =========================
     * NORMALIZATION
     * ========================= */
    static normalizeEdge(e) {
        if (e.type === 1) {
            return {
                type: 'LINE',
                x1: e.x1, y1: e.y1,
                x2: e.x2, y2: e.y2
            };
        }

        if (e.type === 2) { // ARC edge
            // IMPORTANT:
            // Many DXF exports encode HATCH ARC-edge angles differently when ccw=0 (clockwise).
            // If we treat those angles as standard CCW angles, endpoints don't connect and stitching fails.
            // We normalize everything to a World-CCW angle measure for stitching,
            // then convert to Screen angles (because worldToScreen flips Y).

            const ccw = (e.ccw === 1);

            const a1raw = e.startAngle * Math.PI / 180;
            const a2raw = e.endAngle * Math.PI / 180;

            // Normalize to a consistent World-CCW angle measure (so endpoints match adjacent LINE edges)
            const a1w = ccw ? a1raw : -a1raw;
            const a2w = ccw ? a2raw : -a2raw;

            // Convert to Screen angles (worldToScreen flips Y)
            const startAng = -a1w;
            const endAng = -a2w;

            return {
                type: 'ARC',
                cx: e.cx, cy: e.cy, radius: e.radius,

                // radians (SCREEN space) for Canvas arc()
                startAngle: startAng,
                endAngle: endAng,

                // canvas anticlockwise flag
                isCounterClockwise: ccw,

                // World endpoints for topological stitching:
                x1: e.cx + e.radius * Math.cos(a1w),
                y1: e.cy + e.radius * Math.sin(a1w),
                x2: e.cx + e.radius * Math.cos(a2w),
                y2: e.cy + e.radius * Math.sin(a2w)
            };
        }


        return null;
    }

    static reverseEdge(e) {
        if (e.type === 'LINE') {
            return { ...e, x1: e.x2, y1: e.y2, x2: e.x1, y2: e.y1 };
        }

        if (e.type === 'ARC') {
            return {
                ...e,
                startAngle: e.endAngle, // Use the already (potentially) negated angle
                endAngle: e.startAngle,
                isCounterClockwise: !e.isCounterClockwise,
                x1: e.x2, y1: e.y2,
                x2: e.x1, y2: e.y1
            };
        }
        return e;
    }

    static reversePath(path) {
        return path.slice().reverse().map(e => this.reverseEdge(e));
    }

    /* =========================
     * GEOMETRY
     * ========================= */
    static calculateLoopArea(path) {
        let area = 0;
        for (const s of path) {
            area += (s.x1 * s.y2 - s.y1 * s.x2);

            if (s.type === 'ARC') {
                // We stored Screen Angles (-Angle).
                // Use World Angles for calculation (Flip back)
                const startA = -s.startAngle;
                const endA = -s.endAngle;

                let sweep = endA - startA;
                if (s.isCounterClockwise) {
                    while (sweep <= 0) sweep += 2 * Math.PI;
                } else {
                    while (sweep >= 0) sweep -= 2 * Math.PI;
                }
                area += s.radius * s.radius * (sweep - Math.sin(sweep));
            }
        }
        return area * 0.5;
    }

    static bulgeToArc(p1, p2, bulge) {
        const theta = 4 * Math.atan(bulge);
        const dx = p2.x - p1.x;
        const dy = p2.y - p1.y;
        const chord = Math.hypot(dx, dy);
        const r = chord / (2 * Math.sin(theta / 2));

        const mx = (p1.x + p2.x) / 2;
        const my = (p1.y + p2.y) / 2;
        const nx = -dy / chord;
        const ny = dx / chord;
        const d = r * Math.cos(theta / 2);

        const cx = mx + nx * d;
        const cy = my + ny * d;

        // Calculate World Angles
        const ang1 = Math.atan2(p1.y - cy, p1.x - cx);
        const ang2 = Math.atan2(p2.y - cy, p2.x - cx);

        return {
            type: 'ARC',
            cx, cy,
            radius: Math.abs(r),
            startAngle: -ang1, // Negate for Screen
            endAngle: -ang2,   // Negate for Screen
            isCounterClockwise: bulge > 0,
            x1: p1.x, y1: p1.y,
            x2: p2.x, y2: p2.y
        };
    }

    static computeBBox(edges) {
        let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
        for (const e of edges) {
            minx = Math.min(minx, e.x1, e.x2);
            miny = Math.min(miny, e.y1, e.y2);
            maxx = Math.max(maxx, e.x1, e.x2);
            maxy = Math.max(maxy, e.y1, e.y2);
        }
        return { diag: Math.hypot(maxx - minx, maxy - miny) };
    }

    static dist(x1, y1, x2, y2) {
        return Math.hypot(x1 - x2, y1 - y2);
    }
}
