/**
 * Measurement Tools Module
 * Precision measurement with OSNAP integration
 */

export class MeasurementTools {
    constructor(renderer, osnapSystem, languageManager) {
        this.renderer = renderer;
        this.osnap = osnapSystem;
        this.language = languageManager;
        this.activeTool = null;
        this.measurementPoints = [];
        this.currentMeasurement = null;
    }

    /**
     * Activate a measurement tool
     * @param {string} tool - 'distance', 'angle', 'radius', 'coordinate'
     */
    activateTool(tool) {
        this.activeTool = tool;
        this.measurementPoints = [];
        this.currentMeasurement = null;
    }

    /**
     * Deactivate current tool
     */
    deactivateTool() {
        this.activeTool = null;
        this.measurementPoints = [];
        this.currentMeasurement = null;
    }

    /**
     * Set entities for angle measurement
     */
    setEntities(entities, viewport) {
        this.entities = entities;
        this.viewport = viewport;
    }

    /**
     * Handle click for measurement
     * @param {Object} worldPos - World coordinates
     * @param {Object} snapPoint - Snap point if available
     */
    handleClick(worldPos, snapPoint) {
        const point = snapPoint ? snapPoint.point : worldPos;

        switch (this.activeTool) {
            case 'distance':
                return this.handleDistanceClick(point);
            case 'angle':
                return this.handleAngleClick(point);
            case 'radius':
                return this.handleRadiusClick(snapPoint);
            case 'coordinate':
                return this.handleCoordinateClick(point);
        }
        return null;
    }

    handleDistanceClick(point) {
        if (this.measurementPoints.length === 0) {
            // Step 1: First point
            this.measurementPoints.push(point);
            return null;
        } else if (this.measurementPoints.length === 1) {
            // Step 2: Second point (define distance value)
            let finalPoint = point;

            // Apply Smart Mode Constraint to click
            if (this.currentSmartMode === 'horizontal') {
                finalPoint = { x: point.x, y: this.measurementPoints[0].y };
            } else if (this.currentSmartMode === 'vertical') {
                finalPoint = { x: this.measurementPoints[0].x, y: point.y };
            }

            this.measurementPoints.push(finalPoint);
            return null; // Move to step 3 (placement)
        } else if (this.measurementPoints.length === 2) {
            // Step 3: Placement point
            const p1 = this.measurementPoints[0];
            const p2 = this.measurementPoints[1];
            const placementPoint = point;

            const distance = Math.sqrt(
                Math.pow(p2.x - p1.x, 2) +
                Math.pow(p2.y - p1.y, 2)
            );

            // Determine final mode for label
            // Re-calculate mode logic for consistency
            const minX = Math.min(p1.x, p2.x);
            const maxX = Math.max(p1.x, p2.x);
            const minY = Math.min(p1.y, p2.y);
            const maxY = Math.max(p1.y, p2.y);

            const isLeftRight = (placementPoint.x < minX || placementPoint.x > maxX);
            const isTopBottom = (placementPoint.y < minY || placementPoint.y > maxY);

            let mode = 'aligned';
            let finalValue = distance;
            let labelText = `${this.language.translate('distLabel')}: ${distance.toFixed(3)}`;

            if (isLeftRight && !isTopBottom) {
                mode = 'vertical';
                finalValue = Math.abs(p2.y - p1.y);
                labelText = `${this.language.translate('vertLabel')}: ${finalValue.toFixed(3)}`;
            } else if (isTopBottom && !isLeftRight) {
                mode = 'horizontal';
                finalValue = Math.abs(p2.x - p1.x);
                labelText = `${this.language.translate('horizLabel')}: ${finalValue.toFixed(3)}`;
            }

            const measurement = {
                type: 'distance',
                points: [p1, p2],
                placementPoint: placementPoint,
                value: finalValue,
                label: labelText,
                isPreview: false,
                smartMode: mode
            };

            // Remove preview and add final measurement
            this.renderer.measurements = this.renderer.measurements.filter(m => !m.isPreview);
            this.renderer.measurements.push(measurement);

            this.currentMeasurement = measurement;

            // Allow next measurement immediately
            this.measurementPoints = [];

            return measurement;
        }

        return null;
    }

    handleAngleClick(point) {
        // Find line at this point
        const tolerance = 15; // pixels
        const line = this.findLineAtPoint(point, tolerance);

        if (this.measurementPoints.length === 0) {
            // Step 1: Select First Line
            if (line) {
                this.measurementPoints.push(line);
                return { label: this.language.translate('selectSecondLine') || 'Select second line' };
            }
        } else if (this.measurementPoints.length === 1) {
            // Step 2: Select Second Line
            if (line) {
                // Check if it's the same line/entity
                if (line === this.measurementPoints[0]) return null;

                this.measurementPoints.push(line);

                // Calculate intersection immediately to be ready for Step 3
                const l1 = this.measurementPoints[0];
                const l2 = this.measurementPoints[1];
                this.intersectionPoint = this.calculateIntersection(l1, l2);

                if (!this.intersectionPoint) {
                    // Parallel lines?
                    this.measurementPoints = [];
                    return { label: 'Lines are parallel' };
                }

                return { label: this.language.translate('placeAngle') || 'Click to place angle' };
            }
        } else if (this.measurementPoints.length === 2) {
            // Step 3: Placement
            // Finalize measurement
            const final = this.currentMeasurement; // Calculated in mouse move
            final.isPreview = false;

            // Add to persistence
            this.renderer.measurements = this.renderer.measurements.filter(m => !m.isPreview);
            this.renderer.measurements.push(final);

            // Reset for next
            this.measurementPoints = [];
            this.intersectionPoint = null;
            this.currentMeasurement = null;

            return final;
        }
        return null;
    }

    calculateIntersection(l1, l2) {
        // Line 1: P1 + t * V1
        // Line 2: P3 + u * V2
        const x1 = l1.x1, y1 = l1.y1, x2 = l1.x2, y2 = l1.y2;
        const x3 = l2.x1, y3 = l2.y1, x4 = l2.x2, y4 = l2.y2;

        const denom = (y4 - y3) * (x2 - x1) - (x4 - x3) * (y2 - y1);
        if (denom === 0) return null; // Parallel

        const ua = ((x4 - x3) * (y1 - y3) - (y4 - y3) * (x1 - x3)) / denom;

        return {
            x: x1 + ua * (x2 - x1),
            y: y1 + ua * (y2 - y1)
        };
    }

    handleMouseMove(point, snapPoint) {
        if (this.activeTool === 'distance') {
            // ... existing distance logic ...
            if (this.measurementPoints.length === 1) {
                // Step 2 Preview: Dragging second point
                const p1 = this.measurementPoints[0];
                let p2 = snapPoint ? snapPoint.point : point;

                // Virtual Line / Extension Logic
                // Only show if hovering a line
                const hoverLine = this.findLineAtPoint(p2, 20);
                if (hoverLine) {
                    this.currentSmartMode = 'virtual-extension';
                    this.referenceEntity = hoverLine;
                } else {
                    this.currentSmartMode = null;
                    this.referenceEntity = null;
                }

                const distance = Math.sqrt(
                    Math.pow(p2.x - p1.x, 2) +
                    Math.pow(p2.y - p1.y, 2)
                );

                // Use current mouse position as temporary placement so dimension moves with cursor
                const preview = {
                    type: 'distance',
                    points: [p1, p2],
                    placementPoint: point,
                    value: distance,
                    label: `${this.language.translate('distLabel')}: ${distance.toFixed(3)}`,
                    isPreview: true,
                    smartMode: this.currentSmartMode
                };

                // Update measuremens list
                this.renderer.measurements = this.renderer.measurements.filter(m => !m.isPreview);
                this.renderer.measurements.push(preview);

                return true;
            } else if (this.measurementPoints.length === 2) {
                // Step 3 Preview: Dragging dimension line (placement)
                const p1 = this.measurementPoints[0];
                const p2 = this.measurementPoints[1];
                const placement = point;

                // Auto-Dimensioning Logic based on Placement
                // Calculate Bounding Box of P1-P2
                const minX = Math.min(p1.x, p2.x);
                const maxX = Math.max(p1.x, p2.x);
                const minY = Math.min(p1.y, p2.y);
                const maxY = Math.max(p1.y, p2.y);

                const isLeftRight = (placement.x < minX || placement.x > maxX);
                const isTopBottom = (placement.y < minY || placement.y > maxY);

                let mode = 'aligned';
                let finalValue = 0;
                let labelText = "";

                // Priority: Left/Right -> Vertical, Top/Bottom -> Horizontal
                // Overlap (Corners) -> Aligned (Free)

                if (isLeftRight && !isTopBottom) {
                    mode = 'vertical';
                    finalValue = Math.abs(p2.y - p1.y);
                    labelText = `${this.language.translate('vertLabel')}: ${finalValue.toFixed(3)}`;
                } else if (isTopBottom && !isLeftRight) {
                    mode = 'horizontal';
                    finalValue = Math.abs(p2.x - p1.x);
                    labelText = `${this.language.translate('horizLabel')}: ${finalValue.toFixed(3)}`;
                } else {
                    mode = 'aligned'; // Default fallback (Free/Corner)
                    finalValue = Math.sqrt(Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2));
                    labelText = `${this.language.translate('distLabel')}: ${finalValue.toFixed(3)}`;
                }

                const preview = {
                    type: 'distance',
                    points: [p1, p2],
                    placementPoint: placement,
                    value: finalValue,
                    label: labelText,
                    isPreview: true,
                    smartMode: mode
                };

                this.renderer.measurements = this.renderer.measurements.filter(m => !m.isPreview);
                this.renderer.measurements.push(preview);

                return true;
            }
        } else if (this.activeTool === 'angle' && this.measurementPoints.length === 2 && this.intersectionPoint) {
            // Preview Angle
            const I = this.intersectionPoint;
            const M = point;
            const radius = Math.hypot(M.x - I.x, M.y - I.y);

            // Mouse Angle
            let angM = Math.atan2(M.y - I.y, M.x - I.x);
            if (angM < 0) angM += 2 * Math.PI;

            // Line angles
            const l1 = this.measurementPoints[0];
            const l2 = this.measurementPoints[1];

            const a1 = Math.atan2(l1.y2 - l1.y1, l1.x2 - l1.x1);
            const a2 = Math.atan2(l2.y2 - l2.y1, l2.x2 - l2.x1);

            // 4 Rays from Intersection: a1, a1+PI, a2, a2+PI
            const rays = [
                this.normalizeAngle(a1),
                this.normalizeAngle(a1 + Math.PI),
                this.normalizeAngle(a2),
                this.normalizeAngle(a2 + Math.PI)
            ].sort((a, b) => a - b);

            // Find which sector angM falls into
            let startAngle = 0;
            let endAngle = 0;

            // Check intervals [r0, r1], [r1, r2], [r2, r3], [r3, r0(wrapped)]
            if (angM >= rays[0] && angM <= rays[1]) {
                startAngle = rays[0]; endAngle = rays[1];
            } else if (angM >= rays[1] && angM <= rays[2]) {
                startAngle = rays[1]; endAngle = rays[2];
            } else if (angM >= rays[2] && angM <= rays[3]) {
                startAngle = rays[2]; endAngle = rays[3];
            } else {
                startAngle = rays[3]; endAngle = rays[0]; // Wrap around
            }

            // Calculate Degrees
            let diff = endAngle - startAngle;
            if (diff < 0) diff += 2 * Math.PI;
            const deg = diff * 180 / Math.PI;

            this.currentMeasurement = {
                type: 'angle',
                lines: [l1, l2],
                value: deg,
                label: `${deg.toFixed(2)}°`,
                center: I,
                radius: radius,
                startAngle: startAngle,
                endAngle: endAngle,
                isPreview: true
            };

            this.renderer.measurements = this.renderer.measurements.filter(m => !m.isPreview);
            this.renderer.measurements.push(this.currentMeasurement);

            return true;
        }
        return false;
    }

    normalizeAngle(a) {
        a = a % (2 * Math.PI);
        if (a < 0) a += 2 * Math.PI;
        return a;
    }

    findLineAtPoint(point, tolerance) {
        if (!this.entities || !this.viewport) return null;

        const worldTolerance = tolerance / this.viewport.scale;

        for (const entity of this.entities) {
            if (entity.type === 'LINE') {
                const dist = this.pointToLineDistance(point, entity);
                if (dist < worldTolerance) {
                    return entity;
                }
            }
        }
        return null;
    }

    pointToLineDistance(point, line) {
        const dx = line.x2 - line.x1;
        const dy = line.y2 - line.y1;
        const len = Math.sqrt(dx * dx + dy * dy);
        if (len === 0) return Math.sqrt(Math.pow(point.x - line.x1, 2) + Math.pow(point.y - line.y1, 2));

        const t = Math.max(0, Math.min(1, ((point.x - line.x1) * dx + (point.y - line.y1) * dy) / (len * len)));
        const projX = line.x1 + t * dx;
        const projY = line.y1 + t * dy;
        return Math.sqrt(Math.pow(point.x - projX, 2) + Math.pow(point.y - projY, 2));
    }

    handleRadiusClick(snapPoint) {
        if (!snapPoint || !snapPoint.entity) return null;

        const entity = snapPoint.entity;
        let measurement = null;

        if (entity.type === 'CIRCLE') {
            measurement = {
                type: 'radius',
                entity: entity,
                radius: entity.radius,
                diameter: entity.radius * 2,
                label: `Radius: ${entity.radius.toFixed(3)}\nDiameter: ${(entity.radius * 2).toFixed(3)}`
            };
        } else if (entity.type === 'ARC') {
            measurement = {
                type: 'radius',
                entity: entity,
                radius: entity.radius,
                diameter: entity.radius * 2,
                label: `Radius: ${entity.radius.toFixed(3)}\nDiameter: ${(entity.radius * 2).toFixed(3)}`
            };
        }

        this.currentMeasurement = measurement;
        return measurement;
    }

    handleCoordinateClick(point) {
        this.currentMeasurement = {
            type: 'coordinate',
            point: point,
            label: `X: ${point.x.toFixed(3)}\nY: ${point.y.toFixed(3)}`
        };

        return this.currentMeasurement;
    }

    /**
     * Get current measurement result
     */
    getCurrentMeasurement() {
        return this.currentMeasurement;
    }

    /**
     * Get active tool name
     */
    getActiveTool() {
        return this.activeTool;
    }

    /**
     * Get number of points collected
     */
    getPointCount() {
        return this.measurementPoints.length;
    }
}
