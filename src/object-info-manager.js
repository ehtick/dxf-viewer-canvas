
import * as THREE from 'three';

export class ObjectInfoManager {
    constructor(viewer, measurementManager) {
        this.viewer = viewer;
        this.measurementManager = measurementManager;
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

            if (dimObj.userData.isUserDefined) {
                content += this.getToleranceHTML(dimObj.userData.tolerance);
            }

            this.container.innerHTML = content;

            if (dimObj.userData.isUserDefined) {
                this.bindToleranceEvents(dimObj);
            }
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

    getToleranceHTML(tolerance) {
        const active = tolerance ? tolerance.active : false;
        // User said: "Tolerans aktif değilse tolerans yoktur ve inputlar '0' dır."
        // We show 0 if not active, or kept value? "inputlar 0 dır" implies we show 0.
        const plus = (tolerance && active) ? tolerance.plus : 0;
        const minus = (tolerance && active) ? tolerance.minus : 0;
        const disabled = active ? '' : 'disabled';
        const opacity = active ? 'opacity-100' : 'opacity-50 pointer-events-none';

        return `
        <div class="tolerance-section mt-3 pt-2 border-t border-white/10">
            <div class="flex items-center justify-between mb-2">
                 <span class="text-gray-200 font-medium text-sm">Tolerans</span>
                 <input type="checkbox" id="tol-active" ${active ? 'checked' : ''} class="form-checkbox h-4 w-4 text-cyan-400 rounded bg-black/20 border-white/10 cursor-pointer accent-cyan-500">
            </div>
            <div id="tol-inputs" class="grid grid-cols-2 gap-2 transition-opacity duration-200 ${opacity}">
                <div class="relative">
                     <span class="absolute left-2 top-1.5 text-xs text-gray-500 font-bold">+</span>
                     <input type="number" id="tol-plus" value="${plus}" step="0.01" class="w-full bg-black/20 border border-white/10 rounded pl-5 pr-2 py-1 text-sm text-white focus:outline-none focus:border-cyan-500 font-mono" placeholder="0.00" ${disabled}>
                </div>
                <div class="relative">
                     <span class="absolute left-2 top-1.5 text-xs text-gray-500 font-bold">-</span>
                     <input type="number" id="tol-minus" value="${minus}" step="0.01" class="w-full bg-black/20 border border-white/10 rounded pl-5 pr-2 py-1 text-sm text-white focus:outline-none focus:border-cyan-500 font-mono" placeholder="0.00" ${disabled}>
                </div>
            </div>
        </div>`;
    }

    bindToleranceEvents(object) {
        const cb = document.getElementById('tol-active');
        const iPlus = document.getElementById('tol-plus');
        const iMinus = document.getElementById('tol-minus');
        const divInputs = document.getElementById('tol-inputs');

        if (!cb || !iPlus || !iMinus) return;

        const updateObj = () => {
            const tol = {
                active: cb.checked,
                plus: parseFloat(iPlus.value) || 0,
                minus: parseFloat(iMinus.value) || 0
            };
            if (this.measurementManager) {
                this.measurementManager.updateTolerance(object, tol);
            }
        };

        cb.addEventListener('change', () => {
            const isActive = cb.checked;
            if (isActive) {
                divInputs.classList.remove('opacity-50', 'pointer-events-none');
                divInputs.classList.add('opacity-100');
                iPlus.disabled = false;
                iMinus.disabled = false;
                // Keep default 0 or restore? Request says "inputlar 0 dır" when not active. 
                // So when activating, they start at 0 (already 0).
            } else {
                divInputs.classList.add('opacity-50', 'pointer-events-none');
                divInputs.classList.remove('opacity-100');
                iPlus.disabled = true;
                iMinus.disabled = true;
                iPlus.value = 0;
                iMinus.value = 0;
            }
            updateObj();
        });

        iPlus.addEventListener('input', () => {
            // " + tolerans inputu değiştiğinde, - tolerans inputu onunla aynı olacak şekilde otomatik güncellenir."
            // Only update minus if it hasn't been manually edited? 
            // Or always? "dinamik olarak otomatik güncellenir".
            // Usually this implies a "symmetric" convenience, but allows override?
            // "Eş zamanlı olarak ölçümün toleransı güncellenir."
            // If user types in Plus, update Minus to match.
            // If user THEN types in Minus, it changes Minus (asymmetric).
            // But if user goes back to Plus, does it overwrite Minus? 
            // "onunla aynı olacak şekilde" implies strict linking OR convenience default.
            // Let's implement strict following when Plus changes.
            iMinus.value = iPlus.value;

            updateObj();
        });

        iMinus.addEventListener('input', () => {
            updateObj();
        });
    }
}
