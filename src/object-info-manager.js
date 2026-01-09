
import * as THREE from 'three';

export class ObjectInfoManager {
    constructor(viewer) {
        this.viewer = viewer;
        this.container = document.getElementById('measurement-result');
    }

    update(selectedObjects) {
        if (!this.container) return;

        if (!selectedObjects || selectedObjects.length === 0) {
            this.container.innerHTML = '<p class="empty-state" data-i18n="clickObjectInfo">' + this.t('clickObjectInfo') + '</p>';
            return;
        }

        if (selectedObjects.length === 1) {
            this.renderSingleObject(selectedObjects[0]);
        } else {
            this.renderMultiObject(selectedObjects);
        }
    }

    t(key) {
        return this.viewer.languageManager ? this.viewer.languageManager.translate(key) : key;
    }

    renderSingleObject(object) {
        let content = '';
        const entity = object.userData.entity;

        // Handle Dimensions (Measurement Visuals)
        if (object.userData.type === 'DIMENSION' || (object.parent && object.parent.userData.type === 'DIMENSION')) {
            // If child is clicked, check parent
            const dimObj = object.userData.type === 'DIMENSION' ? object : object.parent;
            const val = dimObj.userData.value;
            // Value might be string (dist) or number?
            // Assuming formatted string or number.
            content += this.row(this.t('dimensionValue'), val);
            // Maybe Type?
            content += this.row(this.t('Type'), 'Dimension');
            this.container.innerHTML = content;
            return;
        }

        // Basic Info
        let type = object.userData.type || 'Unknown';
        if (object.isGroup) type = 'Polyline/Group'; // Refined Polyline Group

        content += '<div class="info-header"><strong>' + this.t('Type') + ':</strong> ' + type + '</div>';
        content += '<div class="info-header"><strong>ID:</strong> ' + object.id + '</div>';
        if (object.userData.layer) {
            content += '<div class="info-header"><strong>' + this.t('layers') + ':</strong> ' + object.userData.layer + '</div>';
        }
        content += '<hr class="my-2 border-white/10">';

        // Geometry Specifics
        if (type === 'LINE') {
            const len = this.calculateLength(object);
            if (len !== null) content += this.row(this.t('length'), len.toFixed(4));

            if (entity) {
                if (entity.startPoint) content += this.pointRow(this.t('startPoint'), entity.startPoint);
                if (entity.endPoint) content += this.pointRow(this.t('endPoint'), entity.endPoint);
            } else {
                // Fallback to geometry
                // Can extract from BufferGeometry if needed
            }
        }
        else if (type === 'CIRCLE') {
            if (entity) {
                content += this.row(this.t('radius'), entity.radius.toFixed(4));
                content += this.row(this.t('diameter'), (entity.radius * 2).toFixed(4));
                content += this.row(this.t('circumference'), (2 * Math.PI * entity.radius).toFixed(4));
                content += this.row(this.t('area'), (Math.PI * entity.radius * entity.radius).toFixed(4));
                content += this.pointRow(this.t('center'), entity.center);
            }
        }
        else if (type === 'ARC') {
            if (entity && typeof entity.radius === 'number') {
                content += this.row(this.t('radius'), entity.radius.toFixed(4));
                // Length of Arc
                const start = entity.startAngle * Math.PI / 180;
                const end = entity.endAngle * Math.PI / 180;
                let angle = end - start;
                if (angle < 0) angle += Math.PI * 2;
                const len = angle * entity.radius;
                content += this.row(this.t('length'), len.toFixed(4));
                content += this.row(this.t('startAngle'), entity.startAngle.toFixed(2) + '°');
                content += this.row(this.t('endAngle'), entity.endAngle.toFixed(2) + '°');
                content += this.pointRow(this.t('center'), entity.center);
            }
        }
        else if (type === 'LWPOLYLINE' || type === 'POLYLINE' || object.isGroup) {
            // For Groups (Exploded Polyline), calculate total length of children
            // Or use entity data if valid
            let totalLen = 0;
            let count = 0;

            // If it's a Group (our Refactored Polyline)
            if (object.isGroup) {
                object.children.forEach(child => {
                    const l = this.calculateLength(child);
                    if (l) totalLen += l;
                    count++;
                });
            } else if (entity && entity.vertices) {
                // Fallback to entity math if not a Group (legacy?)
                // ... math logic ...
            }

            content += this.row(this.t('totalLength'), totalLen.toFixed(4));
            content += this.row('Segments', count);

            const isClosed = (entity && ((entity.flag & 1) === 1 || entity.closed));
            content += this.row('Closed', isClosed ? this.t('yes') : this.t('no'));
        }

        this.container.innerHTML = content;
    }

    renderMultiObject(objects) {
        let totalLen = 0;
        let lineCount = 0;
        let otherCount = 0;

        objects.forEach(obj => {
            const len = this.calculateLength(obj);
            if (len !== null) {
                totalLen += len;
                lineCount++;
            } else {
                otherCount++;
            }
        });

        let content = '';
        content += '<div class="info-header"><strong>' + this.t('selectionCount').replace('{count}', objects.length) + '</strong></div>';
        content += '<hr class="my-2 border-white/10">';

        if (lineCount > 0) {
            content += this.row(this.t('totalLength'), totalLen.toFixed(4));
            content += '<div class="text-xs text-gray-400 mt-1">(' + lineCount + ' linear entities)</div>';
        }

        if (otherCount > 0) {
            content += '<div class="text-xs text-gray-400">(' + otherCount + ' non-linear entities)</div>';
        }

        this.container.innerHTML = content;
    }

    calculateLength(object) {
        if (!object) return 0;

        // If Group (Polyline), recurse?
        if (object.isGroup) {
            let sum = 0;
            object.children.forEach(c => sum += this.calculateLength(c));
            return sum;
        }

        const type = object.userData.type;
        const entity = object.userData.entity;

        if (type === 'LINE') {
            if (object.geometry) {
                object.geometry.computeBoundingBox(); // Ensure?
                // Or use positions
                const pos = object.geometry.attributes.position;
                if (pos && pos.count >= 2) {
                    const p1 = new THREE.Vector3(pos.getX(0), pos.getY(0), pos.getZ(0));
                    const p2 = new THREE.Vector3(pos.getX(1), pos.getY(1), pos.getZ(1));
                    return p1.distanceTo(p2);
                }
            }
            if (entity && entity.startPoint && entity.endPoint) {
                const p1 = new THREE.Vector3(entity.startPoint.x, entity.startPoint.y, entity.startPoint.z || 0);
                const p2 = new THREE.Vector3(entity.endPoint.x, entity.endPoint.y, entity.endPoint.z || 0);
                return p1.distanceTo(p2);
            }
        }

        if (type === 'ARC' || (type === 'LWPOLYLINE' && object.userData.parentType === 'LWPOLYLINE' && !object.isGroup)) {
            // It's a segment? ARC segment.
            // If refactored Polyline segment is ARC
            if (type === 'ARC' && entity && entity.radius) {
                // Full Arc Entity
                const start = entity.startAngle * Math.PI / 180;
                const end = entity.endAngle * Math.PI / 180;
                let angle = end - start;
                if (angle < 0) angle += Math.PI * 2;
                return angle * entity.radius;
            }
            // How do we handle "Segment" entities that are primitive lines but part of Polyline?
            // They have 'LINE' type usually.
            // If Segment is Arc (bulge), geometry should tell us length?
            // Helper: Compute line length from geometry for generic case.
            if (object.geometry && object.geometry.attributes.position) {
                // Sum segments
                let len = 0;
                const pos = object.geometry.attributes.position;
                for (let i = 0; i < pos.count - 1; i++) {
                    const x1 = pos.getX(i), y1 = pos.getY(i), z1 = pos.getZ(i);
                    const x2 = pos.getX(i + 1), y2 = pos.getY(i + 1), z2 = pos.getZ(i + 1);
                    const dx = x2 - x1, dy = y2 - y1, dz = z2 - z1;
                    len += Math.sqrt(dx * dx + dy * dy + dz * dz);
                }
                return len;
            }
        }

        if (type === 'CIRCLE' && entity) {
            return 2 * Math.PI * entity.radius;
        }

        return null;
    }

    row(label, value) {
        return '<div class="flex justify-between text-sm mb-1"><span class="text-gray-400">' + label + ':</span> <span class="text-white font-mono">' + value + '</span></div>';
    }

    pointRow(label, pt) {
        if (!pt) return '';
        const x = pt.x !== undefined ? pt.x : pt[0]; // Handle array vs object?
        // Assuming object {x,y,z}
        return '<div class="mb-1">' +
            '<span class="text-xs text-gray-400 block">' + label + '</span>' +
            '<div class="flex gap-2 font-mono text-xs text-white pl-2">' +
            '<span>X: ' + pt.x.toFixed(3) + '</span>' +
            '<span>Y: ' + pt.y.toFixed(3) + '</span>' +
            '</div>' +
            '</div>';
    }
}
