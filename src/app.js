import { DXFParser } from './dxf-parser.js';
import { Renderer } from './renderer.js';
import { ViewportController } from './viewport.js';
import { OSNAPSystem } from './osnap.js';
import { MeasurementTools } from './measurement-tools.js';
import { LanguageManager } from './localization.js?v=2.0';
import { HatchBoundaryResolver } from './hatch-boundary-resolver.js';

class DXFViewerApp {
    constructor() {
        this.canvas = document.getElementById('viewport');
        this.parser = new DXFParser();
        this.renderer = null;
        this.viewport = null;
        this.osnap = null;
        this.measurement = null;
        this.language = null;
        this.dxfData = null;
        this.animationFrameId = null;

        this.init();
    }

    init() {
        // Initialize State
        this.multiSelect = true;
        this.selectedMeasurement = null;
        this.isDraggingSelection = false;
        this.dragStart = null; // {x, y} screen coords
        this.isSelecting = false; // "Click-Move-Click" state
        this.selectionStart = null; // {x, y} start
        this.selectionCurrent = null; // {x, y} current
        this.ignoreNextClick = false; // Prevent click event after selection
        // Initialize Language Manager
        this.language = new LanguageManager();
        this.language.init();

        // Subscribe to language changes
        this.language.subscribe(() => this.onLanguageChanged());

        // Initialize canvas size
        this.resizeCanvas();

        // Initialize renderer
        this.renderer = new Renderer(this.canvas);

        // Initialize viewport controller
        this.viewport = new ViewportController(this.canvas, this.renderer);

        // Initialize OSNAP system
        this.osnap = new OSNAPSystem(this.renderer);

        // Initialize measurement tools (Pass language manager)
        this.measurement = new MeasurementTools(this.renderer, this.osnap, this.language);

        // Setup UI event listeners
        this.setupUIEvents();

        // Setup canvas events
        this.setupCanvasEvents();

        // Start render loop
        this.startRenderLoop();

        // Update status
        this.updateStatus(this.language.translate('ready'));

        // Check for URL parameter "file"
        const urlParams = new URLSearchParams(window.location.search);
        const fileUrl = urlParams.get('file');

        if (fileUrl) {
            // Hide Open File Button
            const fileUploadContainer = document.querySelector('.file-upload-container');
            if (fileUploadContainer) {
                // Find label specifically to hide, or hide the whole container?
                // Request says: "hide 'Open DXF File' button". 
                // The label acts as the button.
                const btn = fileUploadContainer.querySelector('.file-open-btn');
                if (btn) btn.style.display = 'none';
            }

            // Fetch and Load
            this.updateStatus(`Loading file from URL: ${fileUrl}...`);
            fetch(fileUrl)
                .then(response => {
                    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
                    return response.blob();
                })
                .then(blob => {
                    // Create a File object from Blob
                    // Extract filename from URL or default
                    const fileName = fileUrl.split('/').pop() || 'downloaded.dxf';
                    const file = new File([blob], fileName, { type: "application/dxf" });

                    // Update Filename Display
                    const nameDisplay = document.getElementById('file-name');
                    if (nameDisplay) nameDisplay.textContent = fileName;

                    this.loadDXFFile(file);
                })
                .catch(err => {
                    console.error('Error fetching DXF from URL:', err);
                    this.updateStatus(`Error loading URL: ${err.message}`);
                });
        }
    }

    resizeCanvas() {
        const rect = this.canvas.getBoundingClientRect();
        this.canvas.width = rect.width;
        this.canvas.height = rect.height;

        if (this.renderer) {
            this.renderer.viewport.width = rect.width;
            this.renderer.viewport.height = rect.height;
        }
    }

    setupUIEvents() {
        // ... (keep existing file input logic) ...
        const fileInput = document.getElementById('file-input');
        const fileName = document.getElementById('file-name');

        if (fileInput) {
            fileInput.addEventListener('change', (e) => {
                if (e.target.files.length > 0) {
                    const file = e.target.files[0];
                    fileName.textContent = file.name;
                    this.loadDXFFile(file);
                } else {
                    fileName.textContent = this.language.translate('noFileSelected');
                }
            });
        }

        // Zoom Tools Dropdown
        const zoomMenuBtn = document.getElementById('zoom-menu-btn');
        const zoomDropdown = document.getElementById('zoom-dropdown-menu');
        const zoomExtentsBtn = document.getElementById('zoom-extents-btn');
        const zoomWindowBtn = document.getElementById('zoom-window-btn');

        if (zoomMenuBtn && zoomDropdown) {
            zoomMenuBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                zoomDropdown.classList.toggle('hidden');
            });

            // Close on outside click
            document.addEventListener('click', (e) => {
                if (!zoomDropdown.contains(e.target) && !zoomMenuBtn.contains(e.target)) {
                    zoomDropdown.classList.add('hidden');
                }
            });
        }

        if (zoomExtentsBtn) {
            zoomExtentsBtn.addEventListener('click', () => {
                if (this.dxfData) {
                    this.viewport.zoomToFit();
                    zoomDropdown.classList.add('hidden');
                    // Reset window zoom state if active
                    this.activateZoomWindow(false);
                }
            });
        }

        if (zoomWindowBtn) {
            zoomWindowBtn.addEventListener('click', () => {
                this.activateZoomWindow(true);
                zoomDropdown.classList.add('hidden');
            });
        }

        // Layers
        // ... (rest of function)


        // Sidebar Toggles
        const sidebar = document.getElementById('sidebar');
        const closeSidebarBtn = document.getElementById('sidebar-close-btn');
        const floatingToggleBtn = document.getElementById('sidebar-floating-toggle');

        if (sidebar && closeSidebarBtn && floatingToggleBtn) {
            // Close Sidebar (X)
            closeSidebarBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                sidebar.classList.add('collapsed');
                // Remove hidden class to show floating button
                floatingToggleBtn.classList.remove('hidden');
                setTimeout(() => this.resizeCanvas(), 300);
            });

            // Open Sidebar (Floating)
            floatingToggleBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                sidebar.classList.remove('collapsed');
                // Add hidden class to hide floating button
                floatingToggleBtn.classList.add('hidden');
                setTimeout(() => this.resizeCanvas(), 300);
            });
        }

        // OSNAP dropdown toggle
        const osnapToggle = document.getElementById('osnap-toggle');
        const osnapMenu = document.getElementById('osnap-menu');
        const osnapChevron = document.getElementById('osnap-chevron');

        if (osnapToggle && osnapMenu) {
            osnapToggle.addEventListener('click', (e) => {
                e.stopPropagation();
                osnapMenu.classList.toggle('hidden');
                osnapChevron.classList.toggle('rotate-180');
            });

            // Close dropdown when clicking outside
            document.addEventListener('click', (e) => {
                if (!osnapMenu.contains(e.target) && !osnapToggle.contains(e.target)) {
                    osnapMenu.classList.add('hidden');
                    osnapChevron.classList.remove('rotate-180');
                }
            });
        }

        // OSNAP checkboxes
        document.querySelectorAll('[data-snap]').forEach(checkbox => {
            checkbox.addEventListener('change', (e) => {
                const snapMode = e.target.dataset.snap;
                this.osnap.toggleSnapMode(snapMode, e.target.checked);
            });
        });

        // Settings dropdown toggle
        const settingsToggle = document.getElementById('settings-toggle');
        const settingsMenu = document.getElementById('settings-menu');

        if (settingsToggle && settingsMenu) {
            settingsToggle.addEventListener('click', (e) => {
                e.stopPropagation();
                settingsMenu.classList.toggle('hidden');
            });

            // Close dropdown when clicking outside
            document.addEventListener('click', (e) => {
                if (!settingsToggle.contains(e.target) && !settingsMenu.contains(e.target)) {
                    settingsMenu.classList.add('hidden');
                }
            });
        }

        // Layers Dropdown
        const layersToggle = document.getElementById('layers-toggle');
        const layersMenu = document.getElementById('layers-menu');

        if (layersToggle && layersMenu) {
            layersToggle.addEventListener('click', (e) => {
                e.stopPropagation();
                layersMenu.classList.toggle('hidden');
                // Close others
                if (settingsMenu) settingsMenu.classList.add('hidden');
                if (osnapMenu) osnapMenu.classList.add('hidden');
            });

            document.addEventListener('click', (e) => {
                if (!layersToggle.contains(e.target) && !layersMenu.contains(e.target)) {
                    layersMenu.classList.add('hidden');
                }
            });

            layersMenu.addEventListener('click', (e) => e.stopPropagation());
        }

        // Measurement tool buttons
        document.querySelectorAll('[data-tool]').forEach(button => {
            button.addEventListener('click', (e) => {
                const tool = e.target.closest('[data-tool]').dataset.tool;
                this.activateMeasurementTool(tool, e.target.closest('[data-tool]'));
            });
        });

        // Settings
        const bgColor = document.getElementById('bg-color');
        if (bgColor) {
            bgColor.addEventListener('change', (e) => {
                const color = e.target.value;
                this.renderer.setBackgroundColor(color);

                // Update text color based on background brightness
                const hex = color.replace('#', '');
                const r = parseInt(hex.substr(0, 2), 16);
                const g = parseInt(hex.substr(2, 2), 16);
                const b = parseInt(hex.substr(4, 2), 16);
                const brightness = ((r * 299) + (g * 587) + (b * 114)) / 1000;

                document.body.style.setProperty('--text-primary', brightness > 128 ? '#1a1a1a' : '#e0e0e0');
            });
        }

        // Measurement Color Settings
        const measureColor = document.getElementById('measurement-color');
        const measureColorValue = document.getElementById('measurement-color-value');
        if (measureColor && measureColorValue) {
            measureColor.addEventListener('input', (e) => {
                const color = e.target.value;
                this.renderer.setMeasurementColor(color);
                measureColorValue.textContent = color;
            });
        }

        const linetypeScale = document.getElementById('linetype-scale');
        const linetypeValue = document.getElementById('linetype-scale-value');
        linetypeScale.addEventListener('input', (e) => {
            const value = parseFloat(e.target.value);
            this.renderer.linetypeScale = value;
            linetypeValue.textContent = value.toFixed(1);
        });

        const snapTolerance = document.getElementById('snap-tolerance');
        const snapValue = document.getElementById('snap-tolerance-value');
        snapTolerance.addEventListener('input', (e) => {
            const value = parseInt(e.target.value);
            this.osnap.setSnapTolerance(value);
            snapValue.textContent = `${value}px`;
        });

        const multiSelectToggle = document.getElementById('multi-select-toggle');
        if (multiSelectToggle) {
            multiSelectToggle.checked = this.multiSelect; // Sync UI with State
            multiSelectToggle.addEventListener('change', (e) => {
                this.multiSelect = e.target.checked;
            });
        }
    }

    activateZoomWindow(active) {
        this.isZoomWindowActive = active;
        if (active) {
            this.canvas.style.cursor = 'crosshair';
            this.updateStatus(this.language.translate('instrZoomWindow'));
            // Deactivate measurement tools
            this.measurement.deactivateTool();
        } else {
            this.canvas.style.cursor = 'default';
            this.updateStatus(this.language.translate('ready'));
        }
    }

    setupCanvasEvents() {
        // Mouse move for OSNAP and coordinates
        this.canvas.addEventListener('mousemove', (e) => {
            const worldPos = this.viewport.getMouseWorldPos();

            // Update coordinates display
            this.updateCoordinates(worldPos.x, worldPos.y);

            // Find snap point
            if (this.dxfData && this.dxfData.entities) {
                let referencePoint = null;

                // Get reference point for distance measurement
                if (this.measurement.activeTool === 'distance' &&
                    this.measurement.measurementPoints &&
                    this.measurement.measurementPoints.length === 1) {
                    referencePoint = this.measurement.measurementPoints[0];
                }

                const snap = this.osnap.findSnapPoint(worldPos, this.dxfData.entities, referencePoint);
                this.renderer.snapPoint = snap;

                // Handle measurement live preview
                if (this.measurement.getActiveTool()) {
                    this.measurement.handleMouseMove(worldPos, snap);
                }
            }
        });

        // Double Click for Chain Selection
        this.canvas.addEventListener('dblclick', (e) => {
            if (this.multiSelect && !this.measurement.getActiveTool()) {
                const worldPos = this.viewport.getMouseWorldPos();
                const entity = this.findEntityAtPoint(worldPos);
                if (entity) {
                    this.handleChainSelection(entity);
                }
            }
        });

        // Click for measurements or object info
        this.canvas.addEventListener('click', (e) => {
            if (this.ignoreNextClick) {
                this.ignoreNextClick = false;
                return;
            }
            // Prevent double-handling behavior (e.g. mousedown selects, click deselects)
            if (this.skipClickSelection) {
                this.skipClickSelection = false;
                return;
            }

            if (this.measurement.getActiveTool()) {
                const worldPos = this.viewport.getMouseWorldPos();
                const snap = this.renderer.snapPoint;

                // Pass entities to measurement tool for angle measurement
                if (this.dxfData && this.dxfData.entities) {
                    this.measurement.setEntities(this.dxfData.entities, this.renderer.viewport);
                }

                const result = this.measurement.handleClick(worldPos, snap);

                if (result) {
                    this.displayMeasurementResult(result);
                }
            } else {
                // No measurement tool active - show object info
                const worldPos = this.viewport.getMouseWorldPos();
                const entity = this.findEntityAtPoint(worldPos);

                if (entity) {
                    this.displayObjectInfo(entity);
                } else {
                    this.renderer.setHighlight(null);
                    this.highlightEntityInTree(null);

                    // Check for measurement selection
                    this.checkMeasurementSelection(worldPos);

                    const resultDiv = document.getElementById('measurement-result');
                    if (resultDiv) resultDiv.innerHTML = '<p class="empty-state">Click an object to view info</p>';
                }
            }
        });

        // Selection Rectangle Events
        this.setupSelectionEvents();

        // Update zoom level display
        this.canvas.addEventListener('wheel', () => {
            setTimeout(() => this.updateZoomLevel(), 50);
        });

        // Handle ESC and DELETE keys
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                // Cancel Drag Selection Rectangle
                if (this.isSelecting) {
                    this.isSelecting = false;
                    this.selectionStart = null;
                    this.selectionCurrent = null;
                    this.renderer.selectionRect = null;
                    this.updateStatus(this.language.translate('selectionCancelled'));
                }

                this.renderer.setHighlight(null);
                this.highlightEntityInTree(null);
                this.selectedMeasurement = null;

                // Clear Info Panel
                const resultDiv = document.getElementById('measurement-result');
                if (resultDiv) resultDiv.innerHTML = '<p class="empty-state">Click an object to view info</p>';

                if (this.measurement.activeTool) {
                    if (this.measurement.measurementPoints.length > 0) {
                        // Clear selected points but keep tool active
                        this.measurement.measurementPoints = [];
                        this.updateStatus(this.language.translate('selectionCleared'));
                        // Clear preview from renderer
                        this.renderer.measurements = this.renderer.measurements.filter(m => !m.isPreview);
                    } else {
                        // Deactivate tool
                        this.measurement.deactivateTool();
                        // Remove active class from buttons
                        document.querySelectorAll('[data-tool]').forEach(btn => btn.classList.remove('active'));
                        this.updateMeasurementResult(this.language.translate('selectTool'));
                        this.updateStatus(this.language.translate('ready'));
                    }
                }
                this.renderer.render(this.dxfData?.entities || [], this.dxfData?.layers || [], this.dxfData?.linetypes || [], this.dxfData?.blocks || new Map());
            } else if (e.key === 'Delete') {
                // Delete selected measurement
                if (this.selectedMeasurement) {
                    this.renderer.measurements = this.renderer.measurements.filter(m => m !== this.selectedMeasurement);
                    this.selectedMeasurement = null;
                    this.updateStatus(this.language.translate('measurementDeleted'));
                    if (this.dxfData) {
                        this.renderer.render(this.dxfData.entities, this.dxfData.layers, this.dxfData.linetypes, this.dxfData.blocks);
                    }
                }
                // Delete selected entities (Hide them) AND Measurements
                else if (this.renderer.highlightedEntities.size > 0) {
                    let entityCount = 0;
                    let measurementCount = 0;

                    const measurementsToDelete = new Set();

                    this.renderer.highlightedEntities.forEach(item => {
                        // Check if it's a measurement (by checking if it exists in renderer.measurements)
                        if (this.renderer.measurements.includes(item)) {
                            measurementsToDelete.add(item);
                            measurementCount++;
                        } else {
                            // Assume DXF Entity
                            item.visible = false;
                            entityCount++;
                        }
                    });

                    // Remove measurements from renderer
                    if (measurementCount > 0) {
                        this.renderer.measurements = this.renderer.measurements.filter(m => !measurementsToDelete.has(m));
                    }

                    this.renderer.highlightedEntities.clear();
                    this.renderer.setHighlight(null);

                    const statusMsg = [];
                    if (entityCount > 0) statusMsg.push(`${entityCount} ${this.language.translate('entitiesDeleted')}`);
                    if (measurementCount > 0) statusMsg.push(`${measurementCount} ${this.language.translate('measurementDeleted')}`);

                    this.updateStatus(statusMsg.join(', ') || this.language.translate('selectionDeleted'));

                    if (this.dxfData) {
                        this.renderer.render(this.dxfData.entities, this.dxfData.layers, this.dxfData.linetypes, this.dxfData.blocks);
                    }
                }
            }
        });
    }

    setupSelectionEvents() {
        this.canvas.addEventListener('mousedown', (e) => {
            // Only if no active tool and not panning (middle click/space)
            if (this.measurement.getActiveTool()) return;
            if (e.button !== 0) return; // Only left click

            const rect = this.canvas.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;

            // HANDLE ZOOM WINDOW START
            if (this.isZoomWindowActive) {
                this.isSelecting = true;
                this.selectionStart = { x, y };
                this.selectionCurrent = { x, y };
                this.renderer.selectionRect = { p1: this.selectionStart, p2: this.selectionCurrent };
                // Render to show initial rect
                if (this.dxfData) {
                    this.renderer.render(this.dxfData.entities, this.dxfData.layers, this.dxfData.linetypes, this.dxfData.blocks);
                }
                return;
            }

            if (this.isSelecting) {
                // Second Click: Finalize Selection
                // Update current point one last time
                this.selectionCurrent = { x, y };
                this.performSelection(this.selectionStart, this.selectionCurrent);

                // Reset State
                this.isSelecting = false;
                this.selectionStart = null;
                this.selectionCurrent = null;
                this.renderer.selectionRect = null;

                // IGNORE the subsequent click event to prevent deselection
                this.ignoreNextClick = true;

                // Trigger Render
                if (this.dxfData) {
                    this.renderer.render(this.dxfData.entities, this.dxfData.layers, this.dxfData.linetypes, this.dxfData.blocks);
                }
            } else {
                // First Click: Start Selection (if empty space)
                // Priority: 1. Entity, 2. Measurement, 3. Empty (Box Selection)
                const worldPos = this.viewport.getMouseWorldPos();

                // 1. Entity Check
                const hit = this.findEntityAtPoint(worldPos);

                if (hit) {
                    // Perform Selection Logic
                    if (this.multiSelect) {
                        if (this.renderer.highlightedEntities.has(hit)) {
                            this.renderer.highlightedEntities.delete(hit);
                        } else {
                            this.renderer.highlightedEntities.add(hit);
                        }
                    } else {
                        // Single Selection: Replace
                        this.renderer.setHighlight(hit);
                    }

                    // De-select Measurement if any
                    if (this.renderer.selectedMeasurement) {
                        this.selectedMeasurement = null;
                        this.renderer.selectedMeasurement = null;
                    }

                    this.updateInfoPanel(hit); // Update UI immediately
                    this.updateStatus(this.language.translate('entitySelected'));
                    if (this.dxfData) {
                        this.renderer.render(this.dxfData.entities, this.dxfData.layers, this.dxfData.linetypes, this.dxfData.blocks);
                    }

                    // Prevent Click Handler from undoing this
                    this.skipClickSelection = true;
                }
                // 2. Measurement Check (if not entity)
                else if (this.checkMeasurementSelection(worldPos)) {
                    this.skipClickSelection = true;
                }
                // 3. Start Window Selection (Empty Space)
                else {
                    this.isSelecting = true;
                    this.selectionStart = { x, y };
                    this.selectionCurrent = { x, y };
                    this.renderer.selectionRect = { p1: this.selectionStart, p2: this.selectionCurrent };
                }
            }
        });

        this.canvas.addEventListener('mousemove', (e) => {
            if (!this.isSelecting) return;

            const rect = this.canvas.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;

            this.selectionCurrent = { x, y };

            // Update Renderer Rect
            this.renderer.selectionRect = {
                p1: this.selectionStart,
                p2: this.selectionCurrent
            };

            // Trigger Render Loop
            if (this.dxfData) {
                this.renderer.render(this.dxfData.entities, this.dxfData.layers, this.dxfData.linetypes, this.dxfData.blocks);
            }
        });

        this.canvas.addEventListener('mouseup', (e) => {
            if (this.isZoomWindowActive && this.isSelecting) {
                // Finish Zoom
                const rect = this.canvas.getBoundingClientRect();
                const x = e.clientX - rect.left;
                const y = e.clientY - rect.top;

                // Convert screen rect to world rect
                const p1 = this.renderer.screenToWorld(this.selectionStart.x, this.selectionStart.y);
                const p2 = this.renderer.screenToWorld(x, y);

                this.viewport.zoomToRect(p1, p2);

                // Reset
                this.isSelecting = false;
                this.selectionStart = null;
                this.renderer.selectionRect = null;
                this.activateZoomWindow(false); // Exit mode

                if (this.dxfData) {
                    this.renderer.render(this.dxfData.entities, this.dxfData.layers, this.dxfData.linetypes, this.dxfData.blocks);
                }
            }
        });
    }

    performSelection(p1, p2) {
        if (!p1 || !p2 || !this.dxfData) return;

        // Determine Mode: 
        // Window (Blue): Left->Right (p1.x < p2.x). Inside only.
        // Crossing (Green): Right->Left (p1.x > p2.x). Overlap.
        const isCrossing = p1.x > p2.x;

        // Rectangle Bounds (Screen)
        const rx = Math.min(p1.x, p2.x);
        const ry = Math.min(p1.y, p2.y);
        const rw = Math.abs(p1.x - p2.x);
        const rh = Math.abs(p1.y - p2.y);
        const rectRight = rx + rw;
        const rectBottom = ry + rh;

        const entities = this.dxfData.entities;
        const selected = [];

        entities.forEach(entity => {
            if (!entity.visible) return;
            const bounds = this.renderer.getEntityBounds(entity);
            if (!bounds) return;

            // Convert bounds to Screen Box
            const b1 = this.renderer.worldToScreen(bounds.minX, bounds.minY);
            const b2 = this.renderer.worldToScreen(bounds.maxX, bounds.maxY);

            // Bounds might be flipped due to Y-axis, so find min/max
            const eMinX = Math.min(b1.x, b2.x);
            const eMaxX = Math.max(b1.x, b2.x);
            const eMinY = Math.min(b1.y, b2.y);
            const eMaxY = Math.max(b1.y, b2.y);

            // Check containment/intersection
            const fullyInside = (eMinX >= rx && eMaxX <= rectRight && eMinY >= ry && eMaxY <= rectBottom);
            // Intersection: !(One is left of Other OR Other is left of One ...)
            const intersects = !(eMaxX < rx || eMinX > rectRight || eMaxY < ry || eMinY > rectBottom);

            if (isCrossing) {
                // Crossing: Inside OR Touching (Intersects)
                if (intersects) selected.push(entity);
            } else {
                // Window: Strictly Inside
                if (fullyInside) selected.push(entity);
            }
        });

        // 2. User Measurements Selection (Rectangle)
        if (this.renderer.measurements) {
            this.renderer.measurements.forEach(m => {
                // Calculate Measurement Bounds
                let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
                const points = [];
                if (m.points) points.push(...m.points);
                if (m.placementPoint) points.push(m.placementPoint);

                if (points.length === 0) return;

                points.forEach(p => {
                    minX = Math.min(minX, p.x);
                    maxX = Math.max(maxX, p.x);
                    minY = Math.min(minY, p.y);
                    maxY = Math.max(maxY, p.y);
                });

                // Add margin for visual elements
                minX -= 5; maxX += 5; minY -= 5; maxY += 5;

                // Bounds to Screen
                const b1 = this.renderer.worldToScreen(minX, minY);
                const b2 = this.renderer.worldToScreen(maxX, maxY);

                const eMinX = Math.min(b1.x, b2.x);
                const eMaxX = Math.max(b1.x, b2.x);
                const eMinY = Math.min(b1.y, b2.y);
                const eMaxY = Math.max(b1.y, b2.y);

                const fullyInside = (eMinX >= rx && eMaxX <= rectRight && eMinY >= ry && eMaxY <= rectBottom);
                const intersects = !(eMaxX < rx || eMinX > rectRight || eMaxY < ry || eMinY > rectBottom);

                if (isCrossing) {
                    if (intersects) selected.push(m);
                } else {
                    if (fullyInside) selected.push(m);
                }
            });
        }

        if (this.multiSelect) {
            // Add to existing
            selected.forEach(e => this.renderer.highlightedEntities.add(e));
        } else {
            // Replace
            this.renderer.setHighlight(selected);
        }

        this.updateStatus(this.language.translate('selectionCount').replace('{count}', selected.length));
    }

    checkMeasurementSelection(worldPos) {
        // Detailed hit test for measurements in SCREEN SPACE
        this.selectedMeasurement = null;
        this.renderer.selectedMeasurement = null;

        let found = null;
        const mouseScreen = this.renderer.worldToScreen(worldPos.x, worldPos.y);

        // Reverse iterate to select top-most
        for (let i = this.renderer.measurements.length - 1; i >= 0; i--) {
            const m = this.renderer.measurements[i];

            // Check Cached Screen Bounds (calculated in renderer.js)
            // This ensures WYSIWYG selection
            if (m._screenBounds) {
                if (mouseScreen.x >= m._screenBounds.minX && mouseScreen.x <= m._screenBounds.maxX &&
                    mouseScreen.y >= m._screenBounds.minY && mouseScreen.y <= m._screenBounds.maxY) {
                    found = m;
                    break;
                }
            } else {
                // Fallback if not yet rendered or bounds missing
                // Check dist to placement point
                if (m.placementPoint) {
                    const sPlacement = this.renderer.worldToScreen(m.placementPoint.x, m.placementPoint.y);
                    const d = Math.hypot(sPlacement.x - mouseScreen.x, sPlacement.y - mouseScreen.y);
                    if (d < 15) { found = m; break; }
                }
            }
        }

        if (found) {
            this.selectedMeasurement = found;
            this.renderer.selectedMeasurement = found;
            this.updateStatus(this.language.translate('measurementSelected'));
            // Re-render to show highlight
            this.renderer.render(this.dxfData.entities, this.dxfData.layers, this.dxfData.linetypes, this.dxfData.blocks);
            return true;
        }

        return false;
    }

    pointToSegmentDistance(p, v, w) {
        const l2 = (w.x - v.x) ** 2 + (w.y - v.y) ** 2;
        if (l2 === 0) return Math.hypot(p.x - v.x, p.y - v.y);
        let t = ((p.x - v.x) * (w.x - v.x) + (p.y - v.y) * (w.y - v.y)) / l2;
        t = Math.max(0, Math.min(1, t));
        return Math.hypot(p.x - (v.x + t * (w.x - v.x)), p.y - (v.y + t * (w.y - v.y)));
    }

    async loadDXFFile(file) {
        try {
            if (this.animationFrameId) {
                cancelAnimationFrame(this.animationFrameId);
                this.animationFrameId = null;
            }

            this.updateStatus(this.language.translate('loadingDXF'));

            // Clear previous DXF data and canvas
            console.log("Starting file load sequence...");
            this.dxfData = null; // Explicitly nullify

            // Force Canvas Clear (Robust)
            const ctx = this.canvas.getContext('2d');
            ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
            this.canvas.width = this.canvas.width; // Trigger layout/context reset

            // Re-initialize renderer state
            this.renderer.clear(); // Fills background
            this.renderer.measurements = [];
            this.renderer.highlightedEntities.clear();
            this.renderer.selectionRect = null;
            this.renderer.snapPoint = null;
            this.measurement.activeTool = null;
            console.log("Canvas cleared and state reset.");

            // Clear UI
            this.entityTree = [];
            const treeDisplay = document.getElementById('entity-tree-content');
            if (treeDisplay) treeDisplay.innerHTML = '';

            this.renderer.setHighlight(null);

            // --- Encoding Detection Strategy ---
            // 1. Try reading as UTF-8 (Default)
            let text = await file.text();

            // 2. Check for replacement characters (\uFFFD) indicating encoding errors
            // If many errors found, fallback to legacy encoding (Windows-1254 for Turkish)
            if (text.includes('\uFFFD')) {
                console.warn('UTF-8 decoding errors detected. Attempting fallback to windows-1254 (Turkish).');
                try {
                    text = await this.readFileWithEncoding(file, 'windows-1254');
                    this.updateStatus('Loaded with Windows-1254 encoding');
                } catch (err) {
                    console.error('Fallback encoding failed:', err);
                    // Continue with original text if fallback fails
                }
            }

            const parsedData = this.parser.parse(text);

            // Explode polylines and build tree grouped by Layers
            const explodedEntities = [];
            let entityIdCounter = 0;
            const layerGroups = new Map();

            // Helper to get/create layer node
            const getLayerNode = (layerName) => {
                const name = layerName || '0';
                if (!layerGroups.has(name)) {
                    layerGroups.set(name, {
                        id: `layer_${name.replace(/\W/g, '_')}`,
                        text: name,
                        type: 'layer',
                        icon: 'layer',
                        children: [],
                        visible: true
                    });
                }
                return layerGroups.get(name);
            };

            for (const entity of parsedData.entities) {
                const layerNode = getLayerNode(entity.layer);

                if (entity.type === 'LWPOLYLINE' || entity.type === 'POLYLINE') {
                    // Create Group Node for Polyline
                    const groupId = `group_${++entityIdCounter}`;
                    const groupNode = {
                        id: groupId,
                        type: entity.type,
                        text: `${entity.type} (Group)`,
                        layer: entity.layer,
                        children: [],
                        visible: true
                    };

                    const primitives = this.renderer.decomposePolyline(entity);

                    primitives.forEach((prim, idx) => {
                        prim._id = `entity_${++entityIdCounter}`;
                        prim._parentId = groupId;
                        prim.visible = true; // Default visibility

                        explodedEntities.push(prim);

                        groupNode.children.push({
                            id: prim._id,
                            type: prim.type,
                            text: `${prim.type} ${idx + 1}`,
                            entity: prim,
                            visible: true
                        });
                    });

                    // Add Group to Layer
                    layerNode.children.push(groupNode);
                } else {
                    entity._id = `entity_${++entityIdCounter}`;
                    entity.visible = true;
                    explodedEntities.push(entity);

                    // Add Entity to Layer
                    layerNode.children.push({
                        id: entity._id,
                        type: entity.type,
                        text: entity.type,
                        entity: entity,
                        visible: true
                    });
                }
            }

            parsedData.entities = explodedEntities;
            this.dxfData = parsedData;

            // Sort layers alphabetically and build tree
            this.entityTree = Array.from(layerGroups.values())
                .sort((a, b) => a.text.localeCompare(b.text));

            console.log('Parsed & Exploded DXF data:', this.dxfData);
            console.log('Entity Tree (Layer Grouped):', this.entityTree);

            // Update layers panel
            this.updateLayersPanel(this.dxfData.layers);

            // Render entity tree UI
            this.renderEntityTree();

            // Start render loop
            const animate = () => {
                if (this.dxfData) {
                    this.renderer.render(
                        this.dxfData.entities,
                        this.dxfData.layers,
                        this.dxfData.linetypes,
                        this.dxfData.blocks
                    );
                }
                this.animationFrameId = requestAnimationFrame(animate);
            };

            // Cancel existing loop if any
            if (this.animationFrameId) {
                cancelAnimationFrame(this.animationFrameId);
            }

            animate();

            // Zoom to fit
            this.viewport.zoomToFit();

            // Hide help overlay
            document.getElementById('viewport-overlay').classList.add('hidden');

            this.updateStatus(this.language.translate('loadedInfo')
                .replace('{count}', this.dxfData.entities.length)
                .replace('{layers}', this.dxfData.layers.length));
            this.updateZoomLevel();

        } catch (error) {
            console.error('Error loading DXF file:', error);
            this.updateStatus(this.language.translate('errorLoading') + error.message);
            alert('Failed to load DXF file. Please ensure it is a valid DXF file (AC1009-AC1015).');
        }
    }

    updateLayersPanel(layers) {
        const panel = document.getElementById('layers-panel');

        if (!layers || layers.length === 0) {
            panel.innerHTML = `<p class="empty-state">${this.language.translate('noLayers')}</p>`;
            return;
        }

        panel.innerHTML = '';

        layers.forEach(layer => {
            const item = document.createElement('label');
            item.className = 'layer-item';

            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.checked = layer.visible;
            checkbox.addEventListener('change', (e) => {
                layer.visible = e.target.checked;
                // Also update our Tree Nodes? Syncing is complex. 
                // Currently separate systems.
                this.renderer.render(
                    this.dxfData.entities,
                    this.dxfData.layers,
                    this.dxfData.linetypes,
                    this.dxfData.blocks
                );
            });

            const colorBox = document.createElement('div');
            colorBox.className = 'layer-color';
            const rgb = this.getLayerColor(layer.color);
            colorBox.style.backgroundColor = `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;

            const name = document.createElement('span');
            name.className = 'layer-name';
            name.textContent = layer.name;

            item.appendChild(checkbox);
            item.appendChild(colorBox);
            item.appendChild(name);
            panel.appendChild(item);
        });
    }

    getLayerColor(colorIndex) {
        // Simple ACI color mapping
        const colors = [
            [0, 0, 0],       // 0 - ByBlock
            [255, 0, 0],     // 1 - Red
            [255, 255, 0],   // 2 - Yellow
            [0, 255, 0],     // 3 - Green
            [0, 255, 255],   // 4 - Cyan
            [0, 0, 255],     // 5 - Blue
            [255, 0, 255],   // 6 - Magenta
            [255, 255, 255], // 7 - White
        ];

        if (colorIndex >= 0 && colorIndex < colors.length) {
            return colors[colorIndex];
        }
        return [255, 255, 255];
    }

    /**
     * Helper to read file with specific encoding
     */
    readFileWithEncoding(file, encoding) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(reader.error);
            reader.readAsText(file, encoding);
        });
    }

    activateMeasurementTool(tool, button) {
        // Deactivate all buttons
        document.querySelectorAll('.tool-btn').forEach(btn => {
            btn.classList.remove('active');
        });

        // Check if clicking the same tool (toggle off)
        if (this.measurement.getActiveTool() === tool) {
            this.measurement.deactivateTool();
            this.updateMeasurementResult(this.language.translate('selectTool'));
            this.updateStatus(this.language.translate('ready'));
        } else {
            // Activate new tool
            button.classList.add('active');
            this.measurement.activateTool(tool);

            const instructions = {
                distance: this.language.translate('instrDistance'),
                angle: this.language.translate('instrAngle'),
                radius: this.language.translate('instrRadius'),
                coordinate: this.language.translate('instrCoordinate')
            };

            this.updateMeasurementResult(instructions[tool]);
            this.updateStatus(instructions[tool]);
        }
    }

    displayMeasurementResult(result) {
        this.updateMeasurementResult(result.label);
    }

    updateMeasurementResult(text) {
        const resultDiv = document.getElementById('measurement-result');

        if (text.includes('\n')) {
            // Multi-line result
            const lines = text.split('\n');
            resultDiv.innerHTML = lines.map(line => `<p>${line}</p>`).join('');
        } else {
            resultDiv.innerHTML = `<p>${text}</p>`;
        }
    }

    updateCoordinates(x, y) {
        const coords = document.getElementById('cursor-coords');
        coords.textContent = `X: ${x.toFixed(3)} | Y: ${y.toFixed(3)}`;
    }

    updateStatus(text) {
        const status = document.getElementById('status-text');
        status.textContent = text;
    }

    updateZoomLevel() {
        const zoom = document.getElementById('zoom-level');
        const percentage = (this.renderer.viewport.scale * 100).toFixed(0);
        zoom.textContent = `Zoom: ${percentage}%`;
    }

    startRenderLoop() {
        const render = () => {
            if (this.dxfData) {
                this.renderer.render(
                    this.dxfData.entities,
                    this.dxfData.layers,
                    this.dxfData.linetypes
                );
            } else {
                this.renderer.clear();
            }

            this.animationFrameId = requestAnimationFrame(render);
        };

        render();
    }

    findEntityAtPoint(worldPos) {
        if (!this.dxfData || !this.dxfData.entities) return null;

        const tolerance = 10 / this.renderer.viewport.scale; // 10 pixels in world units

        for (const entity of this.dxfData.entities) {
            // Simple approach: Check all, return first match or closest?
            // Reverse order to pick top-most?
            // Let's just forward for now
            if (entity.visible === false) continue; // Skip invisible

            if (entity.type === 'LINE') {
                const dist = this.pointToLineDistance(worldPos, entity);
                if (dist < tolerance) return entity;
            } else if (entity.type === 'CIRCLE') {
                const dist = Math.sqrt(
                    Math.pow(worldPos.x - entity.cx, 2) +
                    Math.pow(worldPos.y - entity.cy, 2)
                );
                if (Math.abs(dist - entity.radius) < tolerance) return entity;
            } else if (entity.type === 'ARC') {
                const dist = Math.sqrt(
                    Math.pow(worldPos.x - entity.cx, 2) +
                    Math.pow(worldPos.y - entity.cy, 2)
                );
                // Also check angle? For now just radius
                if (Math.abs(dist - entity.radius) < tolerance) return entity;
            } else if (entity.type === 'HATCH') {
                if (this.isPointInHatch(worldPos, entity)) return entity;
            } else if (entity.type === 'DIMENSION') {
                // Precise Geometric Hit Test (Text & Lines)
                // Avoids large empty AABB selection
                const geom = this.renderer.calculateDimensionGeometry(entity);
                if (geom) {
                    const p = this.renderer.worldToScreen(worldPos.x, worldPos.y);
                    const fs = (this.renderer.textScale || 6) * this.renderer.viewport.scale;
                    const tol = 10; // Screen pixels tolerance for lines

                    // 1. Text Check (Hit Box approx)
                    // Text is centered at midX, midY. Allow selection near it.
                    const distText = Math.hypot(p.x - geom.midX, p.y - geom.midY);
                    if (distText < fs * 3) return entity; // Generous radius around text

                    // 2. Line Checks (Dimensions & Extensions)
                    if (this.pointToSegmentDistance(p, geom.d1, geom.d2) < tol) return entity;
                    if (this.pointToSegmentDistance(p, geom.sP1, geom.d1) < tol) return entity;
                    if (this.pointToSegmentDistance(p, geom.sP2, geom.d2) < tol) return entity;
                }
            }
        }
        return null;
    }

    isPointInHatch(point, hatch) {
        if (!hatch.loops || hatch.loops.length === 0) return false;

        let inside = false;

        // Iterate all loops (treat as XOR or simplified winding)
        // Ray Casting algorithm: Count intersections with ray from (px, py) to (Infinity, py)
        const px = point.x;
        const py = point.y;

        hatch.loops.forEach(loop => {
            const res = HatchBoundaryResolver.resolveLoop(loop);
            if (!res || !res.ok || !res.path) return;

            // Iterate segments
            res.path.forEach(seg => {
                // Ray: y = py, x > px

                if (seg.type === 'LINE') {
                    const y1 = seg.y1;
                    const y2 = seg.y2;
                    const x1 = seg.x1;
                    const x2 = seg.x2;

                    // Check if segment spans py
                    // Use > and <= to handle vertices exactly on ray consistent with "ray passes through vertex" (scanline rule)
                    // If py is exactly equal to y1 or y2, we decision based on conventions.
                    // Convention: include lower bound, exclude upper bound.
                    const isBetweenY = (y1 > py) !== (y2 > py);

                    if (isBetweenY) {
                        // Find x intersection
                        // x = x1 + (py - y1) * (x2 - x1) / (y2 - y1)
                        const intersectX = x1 + (py - y1) * (x2 - x1) / (y2 - y1);
                        if (intersectX > px) {
                            inside = !inside;
                        }
                    }
                } else if (seg.type === 'ARC') {
                    // Arc intersection with Ray
                    // Circle: (x-cx)^2 + (y-cy)^2 = r^2
                    // Ray: y = py, x > px
                    const dy = py - seg.cy;
                    if (Math.abs(dy) <= seg.radius) {
                        // Potential intersection(s)
                        const dx = Math.sqrt(seg.radius * seg.radius - dy * dy);
                        // Two x candidates: cx - dx, cx + dx
                        const candidates = [seg.cx - dx, seg.cx + dx];

                        candidates.forEach(cx_cand => {
                            if (cx_cand > px) {
                                // Check if this point is on the Arc segment
                                // Angle check
                                // Angles in segment are SCREEN radians (flipped Y)
                                // Convert candidate to angle in that space
                                // Wait, simple geometry: Is point within start/end angles?

                                // We need to be careful with angle space.
                                // HatchBoundaryResolver normalized angles to SCREEN SPACE?
                                // Let's simplify: Check if angle of (cx_cand, py) from center is within sweep.
                                // But which space?
                                // Renderer uses seg.startAngle directly.
                                // HBR returns seg.startAngle, seg.endAngle in Radians.
                                // HBR logic for calculating area uses: startA = -s.startAngle (flipping back to World?)

                                // Let's use the definition from the resolver.
                                let angle = Math.atan2(py - seg.cy, cx_cand - seg.cx);
                                if (angle < 0) angle += Math.PI * 2; // [0, 2PI]

                                let sA = seg.startAngle; // Assuming [0, 2PI] or close?
                                let eA = seg.endAngle;
                                const ccw = seg.isCounterClockwise;

                                // Normalize angles to [0, 2PI]
                                while (sA < 0) sA += Math.PI * 2;
                                while (sA >= Math.PI * 2) sA -= Math.PI * 2;
                                while (eA < 0) eA += Math.PI * 2;
                                while (eA >= Math.PI * 2) eA -= Math.PI * 2;

                                let passed = false;
                                if (ccw) {
                                    if (sA <= eA) {
                                        passed = (angle >= sA && angle <= eA);
                                    } else {
                                        passed = (angle >= sA || angle <= eA);
                                    }
                                } else {
                                    // Clockwise
                                    if (sA >= eA) {
                                        passed = (angle <= sA && angle >= eA);
                                    } else {
                                        passed = (angle <= sA || angle >= eA);
                                    }
                                }

                                if (passed) {
                                    inside = !inside;
                                }
                            }
                        });
                    }
                }
            });
        });

        return inside;
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

    displayObjectInfo(entity) {
        if (this.multiSelect) {
            if (this.renderer.highlightedEntities.has(entity)) {
                this.renderer.highlightedEntities.delete(entity);
            } else {
                this.renderer.highlightedEntities.add(entity);
            }
        } else {
            this.renderer.setHighlight(entity);
        }
        this.updateInfoPanel(entity);
    }

    updateInfoPanel(entity) {
        const resultDiv = document.getElementById('measurement-result');
        let html = `<div class="object-info">`;

        // Determine Header
        let typeOrCount = entity.type;
        let entitiesToMeasure = [];

        if (this.multiSelect && this.renderer.highlightedEntities.size > 1) {
            typeOrCount = this.language.translate('selectionCount').replace('{count}', this.renderer.highlightedEntities.size);
            entitiesToMeasure = Array.from(this.renderer.highlightedEntities);
        } else if (entity.type === 'Chain Selection') { // From handleChainSelection
            typeOrCount = this.language.translate('chainSelection').replace('{count}', entity.count);
            entitiesToMeasure = Array.from(this.renderer.highlightedEntities);
        } else {
            entitiesToMeasure = [entity];
        }

        html += `<h4 style="color: var(--accent-primary); margin-bottom: 8px; font-weight: 600;">${typeOrCount}</h4>`;

        // Calculate Area
        let area = null;
        try {
            area = this.calculateArea(entitiesToMeasure);
        } catch (e) {
            console.warn('Area calc failed', e);
        }

        if (area !== null) {
            const val = typeof area === 'object' ? area.area : area;
            const count = (typeof area === 'object' && area.count) ? area.count : 1;

            let label = this.language.translate('area');
            if ((this.multiSelect && entitiesToMeasure.length > 1) || count > 1) {
                label = this.language.translate('profileArea').replace('{count}', count - 1);
            }

            const title = (typeof area === 'object' && area.details) ? `title="${area.details}"` : "";

            html += `<p ${title} style="margin-bottom: 8px; color: #4ade80; cursor: help;"><strong>${label}:</strong> ${val.toFixed(3)} mm²</p>`;
            html += `<p ${title} style="margin-bottom: 8px; color: #4ade80; cursor: help;"><strong>${this.language.translate('weight')}:</strong> ${(val * 2.7 / 1000).toFixed(3)} kg/m</p>`;
        }


        // Single Entity Details
        if (entitiesToMeasure.length === 1) {
            const ent = entitiesToMeasure[0];
            const t = (k) => this.language.translate(k); // Helper handling

            if (ent.type === 'LINE') {
                html += `<div style="font-size: 12px; line-height: 1.6;">`;
                html += `<p><strong>${t('startPoint')}:</strong></p>`;
                html += `<p style="margin-left: 12px;">X: ${ent.x1.toFixed(3)}</p>`;
                html += `<p style="margin-left: 12px;">Y: ${ent.y1.toFixed(3)}</p>`;
                html += `<p style="margin-top: 8px;"><strong>${t('endPoint')}:</strong></p>`;
                html += `<p style="margin-left: 12px;">X: ${ent.x2.toFixed(3)}</p>`;
                html += `<p style="margin-left: 12px;">Y: ${ent.y2.toFixed(3)}</p>`;
                const length = Math.sqrt(Math.pow(ent.x2 - ent.x1, 2) + Math.pow(ent.y2 - ent.y1, 2));
                html += `<p style="margin-top: 8px;"><strong>${t('length')}:</strong> ${length.toFixed(3)}</p>`;

                // Calculate angle with X-axis
                const dx = ent.x2 - ent.x1;
                const dy = ent.y2 - ent.y1;
                let angle = Math.atan2(dy, dx) * 180 / Math.PI;

                // Normalize to 0-180 range
                if (angle < 0) angle += 180;

                html += `<p style="margin-top: 8px;"><strong>${t('angle')}:</strong> `;
                if (Math.abs(angle) < 0.1 || Math.abs(angle - 180) < 0.1) {
                    html += `${t('horizontal')} (${angle.toFixed(2)}°)`;
                } else if (Math.abs(angle - 90) < 0.1) {
                    html += `${t('vertical')} (${angle.toFixed(2)}°)`;
                } else {
                    html += `${angle.toFixed(2)}°`;
                }
                html += `</p>`;
                html += `</div>`;
            } else if (ent.type === 'CIRCLE') {
                html += `<div style="font-size: 12px; line-height: 1.6;">`;
                html += `<p><strong>${t('centerPoint')}:</strong></p>`;
                html += `<p style="margin-left: 12px;">X: ${ent.cx.toFixed(3)}</p>`;
                html += `<p style="margin-left: 12px;">Y: ${ent.cy.toFixed(3)}</p>`;
                html += `<p style="margin-top: 8px;"><strong>${t('radius')}:</strong> ${ent.radius.toFixed(3)}</p>`;
                html += `<p><strong>${t('diameter')}:</strong> ${(ent.radius * 2).toFixed(3)}</p>`;
                html += `</div>`;
            } else if (ent.type === 'ARC') {
                html += `<div style="font-size: 12px; line-height: 1.6;">`;
                html += `<p><strong>${t('centerPoint')}:</strong></p>`;
                html += `<p style="margin-left: 12px;">X: ${ent.cx.toFixed(3)}</p>`;
                html += `<p style="margin-left: 12px;">Y: ${ent.cy.toFixed(3)}</p>`;
                html += `<p style="margin-top: 8px;"><strong>${t('radius')}:</strong> ${ent.radius.toFixed(3)}</p>`;
                let startAngle = ent.startAngle % 360;
                if (startAngle < 0) startAngle += 360;

                let endAngle = ent.endAngle % 360;
                if (endAngle < 0) endAngle += 360;

                html += `<p><strong>${t('startAngle')}:</strong> ${startAngle.toFixed(2)}°</p>`;
                html += `<p><strong>${t('endAngle')}:</strong> ${endAngle.toFixed(2)}°</p>`;
                html += `</div>`;
            } else if (ent.type === 'HATCH') {
                html += `<div style="font-size: 12px; line-height: 1.6;">`;
                html += `<p><strong>${t('pattern')}:</strong> ${ent.patternName || 'Solid'}</p>`;
                html += `<p><strong>${t('solidFill')}:</strong> ${ent.solidFill ? t('yes') : t('no')}</p>`;
                html += `<p><strong>${t('loops')}:</strong> ${ent.loops ? ent.loops.length : 0}</p>`;
                html += `</div>`;
            } else if (ent.type === 'INSERT') {
                html += `<div style="font-size: 12px; line-height: 1.6;">`;
                html += `<p><strong>${t('blockName')}:</strong> ${ent.block}</p>`;
                html += `<p><strong>${t('position')}:</strong> X: ${(ent.x || 0).toFixed(3)}, Y: ${(ent.y || 0).toFixed(3)}</p>`;
                html += `<p><strong>${t('scale')}:</strong> X: ${(ent.scaleX || 1).toFixed(2)}, Y: ${(ent.scaleY || 1).toFixed(2)}</p>`;
                html += `<p><strong>${t('rotation')}:</strong> ${(ent.rotation || 0).toFixed(2)}°</p>`;
                html += `</div>`;
            }
        }

        html += `</div>`;
        resultDiv.innerHTML = html;
    }

    // --- AREA CALCULATION LOGIC ---

    calculateArea(entities) {
        if (!entities || entities.length === 0) return null;

        // 1. Single Simple Entity (Circle)
        if (entities.length === 1) {
            const ent = entities[0];
            if (ent.type === 'CIRCLE') {
                return Math.PI * ent.radius * ent.radius;
            }
        }

        // 2. Identify Separate Connected Loops
        const components = this.findConnectedLoops(entities);
        if (components.length === 0) return null;

        const allLoops = [];

        // 3. Extract ALL loops from each component
        for (const compEntities of components) {
            // Use looser tolerance (0.01) for area calculation to catch imperfect loops
            const rawLoops = this.extractAllLoops(compEntities, 0.01);
            // 3b. Decompose any self-intersecting loops (e.g. Single Polyline with bridges)
            for (const loop of rawLoops) {
                const simpleLoops = this.decomposeComplexLoops(loop);
                allLoops.push(...simpleLoops);
            }
        }

        if (allLoops.length === 0) return null;

        // 4. Calculate Area for each Loop
        const areas = [];
        for (const vertices of allLoops) {
            if (vertices && vertices.length >= 3) {
                const a = this.calculateGeometricArea(vertices);
                // Filter out zero-area spikes (bridges)
                if (a > 0.001) areas.push(a);
            }
        }

        if (areas.length === 0) return null;

        // 5. Logic: If multiple loops, assume Profile (Outer - Inner Holes)
        // Sort Descending
        areas.sort((a, b) => b - a);

        const maxArea = areas[0];

        // If single loop, just return it
        if (areas.length === 1) return { area: maxArea, count: 1 };

        // If multiple, subtract smaller areas from max
        // Profile Area = Max - Sum(Rest)
        let holesArea = 0;
        for (let i = 1; i < areas.length; i++) {
            holesArea += areas[i];
        }

        const totalArea = maxArea - holesArea;

        return {
            area: totalArea,
            count: areas.length,
            details: `Outer: ${maxArea.toFixed(2)}, Holes: ${holesArea.toFixed(2)}`
        };
    }

    findConnectedLoops(entities) {
        // Graph Traversal to find connected components
        // Nodes: Entities
        // Edges: Shared Endpoints

        if (entities.length === 0) return [];
        if (entities.length === 1) return [[entities[0]]];

        const set = new Set(entities);
        const components = [];
        const visited = new Set();

        const eps = (ent) => {
            // Helper identical to decomposeEntity concepts but just endpoints
            // Maybe reuse decompose to be safe
            const segs = this.decomposeEntity(ent);
            if (!segs) return [];
            const points = [];
            segs.forEach(s => { points.push(s.p1); points.push(s.p2); });
            return points;
        };

        const tolerance = 0.05;
        const connected = (e1, e2) => {
            const p1s = eps(e1);
            const p2s = eps(e2);
            for (const p1 of p1s) {
                for (const p2 of p2s) {
                    if (Math.hypot(p1.x - p2.x, p1.y - p2.y) < tolerance) return true;
                }
            }
            return false;
        };

        // This O(N^2) approach might be slow for huge selections but fine for typical profiles
        const entityList = Array.from(entities);

        // Build Adjacency List for faster traversal
        const adj = new Map();
        entityList.forEach(e => adj.set(e, []));

        for (let i = 0; i < entityList.length; i++) {
            for (let j = i + 1; j < entityList.length; j++) {
                if (connected(entityList[i], entityList[j])) {
                    adj.get(entityList[i]).push(entityList[j]);
                    adj.get(entityList[j]).push(entityList[i]);
                }
            }
        }

        // Traverse
        for (const ent of entityList) {
            if (visited.has(ent)) continue;

            const component = [];
            const stack = [ent];
            visited.add(ent);

            while (stack.length > 0) {
                const curr = stack.pop();
                component.push(curr);

                const neighbors = adj.get(curr) || [];
                for (const n of neighbors) {
                    if (!visited.has(n)) {
                        visited.add(n);
                        stack.push(n);
                    }
                }
            }
            components.push(component);
        }

        return components;
    }

    /*
     * Decomposes a single complex loop (e.g. self-intersecting or with bridges)
     * into multiple simple loops by detecting repeated vertices.
     */
    decomposeComplexLoops(vertices) {
        if (!vertices || vertices.length < 3) return [];

        let currentLoop = [...vertices];
        const simpleLoops = [];
        // INCREASED TOLERANCE to catch messy bridge points
        const tolerance = 0.15;
        const matches = (p1, p2) => Math.hypot(p1.x - p2.x, p1.y - p2.y) < tolerance;

        let foundSplit = true;
        while (foundSplit) {
            foundSplit = false;
            // Map identifying hash of vertex -> index
            // Spatial hashing for tolerance matching? 
            // O(N^2) scan is safer and robust enough for typical N

            for (let i = 0; i < currentLoop.length; i++) {
                for (let j = i + 1; j < currentLoop.length; j++) {
                    // Avoid matching adjacent if it's just a segment? 
                    // No, duplicate vertex means loop closed there.
                    // But j should be somewhat far from i? 
                    // If A->B->A (spike), i=0, j=2.

                    if (matches(currentLoop[i], currentLoop[j])) {
                        // Found a Pinch Point!
                        // Extract [i ... j] as a sub-loop?
                        // Loop is (i -> i+1 ... -> j).
                        // Since i match j, the loop is closed.
                        // However, effectively the path goes ... -> v[i] -> v[i+1] ... -> v[j] -> v[j+1] -> ...
                        // If v[i] == v[j], then v[i] -> v[j+1] is the shortcut.
                        // The sub-loop is v[i] -> v[i+1] ... -> v[j-1] -> v[j](=v[i]).

                        // Extract sub-loop
                        // Vertices from i to j-1 (plus j as closer?)
                        // My loops are implicit?
                        // calculateGeometricArea expects array of vertices.
                        // so slice(i, j) ?
                        // slice(i, j) gives [v[i], v[i+1]... v[j-1]].
                        // The next point for v[j-1] wraps to v[i]. Correct.

                        const subLoop = currentLoop.slice(i, j);

                        // Check if it's a degenerate spike (area ~ 0) elsewhere?
                        // Just add to candidates.
                        simpleLoops.push(subLoop);

                        // Remove from main loop
                        // Replace [i...j] with just one instance of the vertex
                        // so ... v[i-1] -> v[i] -> v[j+1] ...
                        // splice(start, deleteCount, item)
                        // start i, delete count (j - i). 
                        // Removes v[i]...v[j-1]. 
                        // Keeps v[j] at index i.
                        currentLoop.splice(i, j - i);

                        foundSplit = true;
                        break;
                    }
                }
                if (foundSplit) break;
            }
        }

        // Add the remaining hull/loop
        if (currentLoop.length >= 3) {
            simpleLoops.push(currentLoop);
        }

        return simpleLoops;
    }

    /**
     * Iteratively extracts all closed loops from a bag of entities.
     * Consumes segments as they are used.
     */
    extractAllLoops(entities, toleranceOverride = 0.0001) {
        // Step A: Decompose all entities into atomic segments
        let segments = [];
        for (const ent of entities) {
            const decomp = this.decomposeEntity(ent);
            if (decomp) segments.push(...decomp);
        }

        if (segments.length === 0) return [];

        const loops = [];
        const used = new Set();
        // TIGHT TOLERANCE for extraction (standard DXF precision)
        // Helps avoid "Short Circuiting" convex loops incorrectly.
        const tolerance = toleranceOverride;
        const matches = (p1, p2) => Math.hypot(p1.x - p2.x, p1.y - p2.y) < tolerance;

        // Step A.1: Prune "Bridge" Edges (Zero-width cut lines)
        // Look for pairs of segments that are reverses of each other (A->B and B->A)
        // This effectively disconnects the outer loop from inner holes if they are linked by a bridge.
        for (let i = 0; i < segments.length; i++) {
            if (used.has(i)) continue;
            for (let j = i + 1; j < segments.length; j++) {
                if (used.has(j)) continue;

                const s1 = segments[i];
                const s2 = segments[j];

                // Check if s2 is reverse of s1
                if (matches(s1.p1, s2.p2) && matches(s1.p2, s2.p1)) {
                    // Found a bridge pair! Mark both as used (ignored)
                    used.add(i);
                    used.add(j);
                    break;
                }
            }
        }

        // Loop Extraction using remaining segments
        for (let i = 0; i < segments.length; i++) {
            if (used.has(i)) continue;

            const ordered = [segments[i]];
            const currentLoopIndices = [i];

            let currentTip = segments[i].p2;
            let loopClosed = false;

            while (true) {
                let foundNext = false;
                for (let j = 0; j < segments.length; j++) {
                    if (used.has(j)) continue;
                    if (currentLoopIndices.includes(j)) continue;

                    const seg = segments[j];

                    if (matches(currentTip, seg.p1)) {
                        ordered.push(seg);
                        currentTip = seg.p2;
                        currentLoopIndices.push(j);
                        foundNext = true;
                        break;
                    } else if (matches(currentTip, seg.p2)) {
                        ordered.push({
                            p1: seg.p2,
                            p2: seg.p1,
                            bulge: -seg.bulge,
                            radius: seg.radius,
                            theta: (typeof seg.theta === 'number') ? -seg.theta : seg.theta
                        });
                        currentTip = seg.p1;
                        currentLoopIndices.push(j);
                        foundNext = true;
                        break;
                    }
                }

                if (!foundNext) break;

                if (matches(currentTip, ordered[0].p1)) {
                    loopClosed = true;
                    break;
                }
            }

            if (loopClosed) {
                const vertices = ordered.map(seg => ({
                    x: seg.p1.x,
                    y: seg.p1.y,
                    bulge: seg.bulge,
                    radius: seg.radius,
                    theta: seg.theta
                }));
                loops.push(vertices);
                currentLoopIndices.forEach(idx => used.add(idx));
            }
        }

        return loops;
    }

    // Renamed/Deprecated: assembleLoop (Now integrated)
    assembleLoop(entities) {
        // Backward compatibility: If an array of entities is passed that forms a single loop
        const loops = this.extractAllLoops(entities);
        return loops.length > 0 ? loops[0] : null;
    }

    decomposeEntity(ent) {
        // Returns Array of {p1: {x,y}, p2: {x,y}, bulge: number}
        if (ent.type === 'LINE') {
            return [{ p1: { x: ent.x1, y: ent.y1 }, p2: { x: ent.x2, y: ent.y2 }, bulge: 0 }];
        } else if (ent.type === 'ARC') {
            const deg2rad = Math.PI / 180;

            const start = ent.startAngle * deg2rad;
            const end = ent.endAngle * deg2rad;

            // 1) Direction (supports both styles)
            const isCCW =
                (typeof ent.counterClockwise === 'boolean') ? ent.counterClockwise :
                    (typeof ent.ccw === 'number') ? (ent.ccw === 1) :
                        true;

            // 2) Signed sweep
            let sweep = end - start;
            if (isCCW) {
                while (sweep <= 0) sweep += Math.PI * 2;
            } else {
                while (sweep >= 0) sweep -= Math.PI * 2;
            }

            const bulge = Math.tan(sweep / 4);

            const p1 = { x: ent.cx + ent.radius * Math.cos(start), y: ent.cy + ent.radius * Math.sin(start) };
            const p2 = { x: ent.cx + ent.radius * Math.cos(end), y: ent.cy + ent.radius * Math.sin(end) };

            return [{
                p1, p2,
                bulge,
                radius: ent.radius,
                theta: sweep // signed
            }];
        } else if (ent.type === 'LWPOLYLINE' || ent.type === 'POLYLINE') {
            if (!ent.vertices || ent.vertices.length < 2) return [];
            const segs = [];
            const len = ent.vertices.length;
            const closed = (ent.flags & 1) === 1 || ent.closed;

            // If closed, iterate all, wrap around
            // If open, iterate len - 1
            const count = closed ? len : len - 1;

            for (let i = 0; i < count; i++) {
                const p1 = ent.vertices[i];
                const p2 = ent.vertices[(i + 1) % len];

                const seg = {
                    p1: { x: p1.x, y: p1.y },
                    p2: { x: p2.x, y: p2.y },
                    bulge: p1.bulge || 0
                };

                // Promote Bulge to Analytic Arc Props if bulge exists
                // This ensures "Polyline" calculation matches "Arc" calculation precision
                if (seg.bulge && seg.bulge !== 0) {
                    const arcParams = DXFParser.bulgeToArc(seg.p1, seg.p2, seg.bulge);
                    if (arcParams) {
                        seg.radius = arcParams.radius;
                        // Calculate sweep in radians strictly from bulge to preserve sign info for Area Calc
                        seg.theta = 4 * Math.atan(seg.bulge);
                    }
                }

                segs.push(seg);
            }
            return segs;
        }
        return null;
    }


    calculateGeometricArea(vertices) {
        let area2 = 0; // 2 * area (signed)
        const n = vertices.length;
        if (n < 3) return 0;

        // ---- NUMERIC STABILITY FIX (translation-invariant) ----
        const x0 = vertices[0].x;
        const y0 = vertices[0].y;

        for (let i = 0; i < n; i++) {
            const p1 = vertices[i];
            const p2 = vertices[(i + 1) % n];

            // Shifted coords for stable shoelace
            const x1 = p1.x - x0;
            const y1 = p1.y - y0;
            const x2 = p2.x - x0;
            const y2 = p2.y - y0;

            // 1) Shoelace contribution (signed)
            area2 += (x1 * y2 - x2 * y1);

            // 2) Bulge/Arc correction (same geometry as renderer)
            const bulge = p1.bulge || 0;
            if (Math.abs(bulge) > 1e-12) {
                const arc = DXFParser.bulgeToArc(p1, p2, bulge);
                if (arc && isFinite(arc.radius)) {
                    const theta = 4 * Math.atan(bulge); // signed, supports major arcs
                    const r = arc.radius;
                    const segArea = 0.5 * r * r * (theta - Math.sin(theta)); // signed
                    area2 += 2 * segArea;
                }
            }
        }

        return Math.abs(area2 / 2);
    }


    renderEntityTree() {
        const treeDisplay = document.getElementById('entity-tree-content');
        if (!treeDisplay) return;

        // Persist open state
        const expandedIds = new Set();
        treeDisplay.querySelectorAll('details[open]').forEach(el => {
            if (el.dataset.id) expandedIds.add(el.dataset.id);
        });

        treeDisplay.innerHTML = '';

        if (!this.entityTree || this.entityTree.length === 0) {
            treeDisplay.innerHTML = '<p class="empty-state">No entities loaded</p>';
            return;
        }

        const createTreeItem = (node) => {
            const isGroup = node.children && node.children.length > 0;

            // Visibility Toggle
            const eyeBtn = document.createElement('button');
            eyeBtn.className = `p-1 hover:text-white rounded mr-1 ${node.visible ? 'text-white/60' : 'text-white/20'}`;
            eyeBtn.title = node.visible ? "Hide" : "Show";
            eyeBtn.innerHTML = node.visible ?
                '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>' :
                '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24M1 1l22 22"/></svg>';

            eyeBtn.onclick = (e) => {
                e.stopPropagation();
                this.toggleEntityVisibility(node);
            };

            if (isGroup) {
                const details = document.createElement('details');
                details.className = 'tree-group group mb-1';
                details.dataset.id = node.id; // Identifier for parent expansion logic

                // Restore open state
                if (expandedIds.has(node.id)) details.open = true;

                const summary = document.createElement('summary');
                summary.className = 'tree-summary flex items-center p-1 rounded hover:bg-white/5 cursor-pointer text-sm select-none';
                summary.dataset.id = node.id; // Identifier for selection highlighting logic

                // Custom content wrapper
                const contentSpan = document.createElement('span');
                contentSpan.className = 'flex items-center flex-1 gap-2 ml-1';

                // Icon
                let iconHtml = '';
                if (node.type === 'layer') {
                    iconHtml = '<svg class="w-3 h-3 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"/></svg>';
                }
                else if (node.type === 'HATCH') {
                    iconHtml = '<svg class="w-3 h-3 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"/></svg>';
                } else if (node.type === 'INSERT') {
                    iconHtml = '<svg class="w-3 h-3 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"/></svg>';
                } else {
                    iconHtml = '<svg class="w-3 h-3 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z"/></svg>';
                }

                contentSpan.innerHTML = `${iconHtml} <span class="truncate">${node.text}</span>`;

                // Selection Handler
                contentSpan.onclick = (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    this.selectEntityFromTree(node.id);
                };

                summary.appendChild(eyeBtn);
                summary.appendChild(contentSpan);
                details.appendChild(summary);

                const childrenContainer = document.createElement('div');
                childrenContainer.className = 'pl-4 border-l border-white/10 ml-2 mt-1';

                node.children.forEach(child => {
                    childrenContainer.appendChild(createTreeItem(child));
                });

                details.appendChild(childrenContainer);
                return details;
            } else {
                // Leaf Node
                const div = document.createElement('div');
                div.className = 'tree-leaf flex items-center p-1 rounded hover:bg-white/10 cursor-pointer text-xs ml-4 mb-0.5';
                div.dataset.id = node.id;
                if (!node.visible) div.classList.add('opacity-50');

                const textSpan = document.createElement('span');
                textSpan.className = 'flex-1 ml-2 truncate';
                textSpan.textContent = node.text;

                textSpan.onclick = (e) => {
                    e.stopPropagation();
                    this.selectEntityFromTree(node.id);
                };

                div.appendChild(eyeBtn);
                div.appendChild(textSpan);
                return div;
            }
        };

        this.entityTree.forEach(node => {
            treeDisplay.appendChild(createTreeItem(node));
        });
    }

    toggleEntityVisibility(node) {
        node.visible = !node.visible;

        // Recursive toggle for children
        const updateChildren = (n, state) => {
            if (n.children) {
                n.children.forEach(c => {
                    c.visible = state;
                    updateChildren(c, state);
                });
            }
            if (n.entity) n.entity.visible = state;
        };

        updateChildren(node, node.visible);

        this.renderEntityTree(); // Re-render tree for icons
        // Not calling renderer.render() here because existing loop handles everything on animation frame?
        // Wait, startRenderLoop runs continuously? Yes.
        // It checks `dxfData`. `dxfData` entities have `visible` prop now.
        // Renderer skips invisible.
    }

    selectEntityFromTree(id) {
        const findNode = (nodes, id) => {
            for (const node of nodes) {
                if (node.id === id) return node;
                if (node.children) {
                    const found = findNode(node.children, id);
                    if (found) return found;
                }
            }
            return null;
        };

        const node = findNode(this.entityTree, id);

        if (node) {
            const entities = [];
            const collect = (n) => {
                if (n.entity) entities.push(n.entity);
                if (n.children) n.children.forEach(collect);
            };
            collect(node);

            if (entities.length > 0) {
                if (this.multiSelect) {
                    const allSelected = entities.every(e => this.renderer.highlightedEntities.has(e));
                    if (allSelected) {
                        entities.forEach(e => this.renderer.highlightedEntities.delete(e));
                        this.highlightEntityInTree(id, false);
                    } else {
                        entities.forEach(e => this.renderer.highlightedEntities.add(e));
                        this.highlightEntityInTree(id, true);
                    }
                } else {
                    this.renderer.setHighlight(entities);
                    this.highlightEntityInTree(id, true);
                }

                if (entities.length === 1) {
                    this.updateInfoPanel(entities[0]);
                } else {
                    const resultDiv = document.getElementById('measurement-result');
                    if (resultDiv) resultDiv.innerHTML = `<div class="object-info"><h4 style="color: var(--accent-primary);">${node.text}</h4><p>Selected ${entities.length} entities</p></div>`;
                }
            }
        }
    }

    highlightEntityInTree(id, shouldSelect = true) {
        const treeDisplay = document.getElementById('entity-tree-content');
        if (!treeDisplay) return;

        // Explicit Clear All Command (when id is null)
        if (id === null) {
            treeDisplay.querySelectorAll('.selected').forEach(el => el.classList.remove('selected', 'bg-blue-500/20', 'text-blue-200'));
            // Also close details if needed? No, let's keep them open to preserve context.
            return;
        }

        if (!this.multiSelect && shouldSelect) {
            treeDisplay.querySelectorAll('.selected').forEach(el => el.classList.remove('selected', 'bg-blue-500/20', 'text-blue-200'));
        } else if (!this.multiSelect && !shouldSelect) {
            treeDisplay.querySelectorAll('.selected').forEach(el => el.classList.remove('selected', 'bg-blue-500/20', 'text-blue-200'));
        }

        const elements = treeDisplay.querySelectorAll(`[data-id="${id}"]`);

        elements.forEach(el => {
            if (el.classList.contains('tree-leaf') || el.classList.contains('tree-summary')) {
                if (shouldSelect) {
                    el.classList.add('selected', 'bg-blue-500/20', 'text-blue-200');

                    let walker = el.parentElement;
                    while (walker && walker !== treeDisplay) {
                        if (walker.tagName === 'DETAILS') walker.open = true;
                        walker = walker.parentElement;
                    }

                    const sidebar = document.getElementById('sidebar');
                    if (sidebar && !sidebar.classList.contains('collapsed')) {
                        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    }
                } else {
                    el.classList.remove('selected', 'bg-blue-500/20', 'text-blue-200');
                }

            }
        });
    }

    handleChainSelection(startEntity) {
        console.log('Chain Selection Triggered', startEntity);
        if (!startEntity || !this.dxfData) return;

        const chain = new Set();
        chain.add(startEntity);

        // CASE 1: Polyline Group
        if (startEntity._parentId) {
            this.dxfData.entities.forEach(e => {
                if (e._parentId === startEntity._parentId) {
                    chain.add(e);
                }
            });
            this.updateStatus(`Chain Selected: Polyline Group (${chain.size} entities)`);
        }

        // CASE 2: Topological Chain (Brute Force Iterative)
        // User Algorithm: 
        // 1. Detect start/end points of selected entity
        // 2. Look for entities with equal start/end points
        // 3. Select and update array
        // 4. Repeat until no more found

        // Helper: Get Endpoints
        const getEndpoints = (ent) => {
            const eps = [];
            if (ent.type === 'LINE') {
                eps.push({ x: ent.x1, y: ent.y1 });
                eps.push({ x: ent.x2, y: ent.y2 });
            } else if (ent.type === 'ARC') {
                // DXF Parsed angles are in Degrees, Math.cos/sin expect Radians
                const startRad = ent.startAngle * Math.PI / 180;
                const endRad = ent.endAngle * Math.PI / 180;

                const sX = ent.cx + ent.radius * Math.cos(startRad);
                const sY = ent.cy + ent.radius * Math.sin(startRad);
                const eX = ent.cx + ent.radius * Math.cos(endRad);
                const eY = ent.cy + ent.radius * Math.sin(endRad);
                eps.push({ x: sX, y: sY });
                eps.push({ x: eX, y: eY });
            } else if ((ent.type === 'LWPOLYLINE' || ent.type === 'POLYLINE')) {
                if (ent.vertices && ent.vertices.length > 0) {
                    eps.push(ent.vertices[0]);
                    eps.push(ent.vertices[ent.vertices.length - 1]);
                }
            }
            return eps;
        };

        // Initialize Loop
        let activePoints = getEndpoints(startEntity);
        // Add endpoints of group peers if any
        if (chain.size > 1) {
            chain.forEach(e => {
                if (e !== startEntity) activePoints.push(...getEndpoints(e));
            });
        }

        const candidates = this.dxfData.entities.filter(e => e.visible && !chain.has(e));
        let foundNew = true;
        const tolerance = 0.05; // Slightly loose tolerance

        console.log(`Starting Chain Search with ${candidates.length} candidates`);

        while (foundNew) {
            foundNew = false;
            // Iterate backwards to allow safe removal
            for (let i = candidates.length - 1; i >= 0; i--) {
                const candidate = candidates[i];
                if (chain.has(candidate)) continue;

                const candPoints = getEndpoints(candidate);
                if (candPoints.length === 0) continue;

                let connected = false;

                // Compare candidate points against ALL active points
                for (const cp of candPoints) {
                    for (const ap of activePoints) {
                        const dist = Math.sqrt((cp.x - ap.x) ** 2 + (cp.y - ap.y) ** 2);
                        if (dist < tolerance) {
                            connected = true;
                            break;
                        }
                    }
                    if (connected) break;
                }

                if (connected) {
                    chain.add(candidate);
                    activePoints.push(...candPoints);
                    candidates.splice(i, 1);
                    foundNew = true;
                }
            }
        }

        this.updateStatus(`Chain Selected: ${chain.size} entities`);

        // Apply Selection
        chain.forEach(e => {
            this.renderer.highlightedEntities.add(e);
            if (e._id) this.highlightEntityInTree(e._id, true);
        });

        // Update Info Panel
        this.updateInfoPanel({
            type: 'Chain Selection',
            count: chain.size
        });
    }

    destroy() {
        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
        }
    }

    onLanguageChanged() {
        console.log('Language changed, refreshing UI...');

        // 1. Refresh Info Panel (Selection)
        if (this.renderer.highlightedEntities.size > 0) {
            // Re-trigger info panel update with current selection
            // We can pick an arbitrary entity from the set as the argument, 
            // logic inside updateInfoPanel handles multi-selection (size > 1) check.
            const anyEntity = this.renderer.highlightedEntities.values().next().value;
            this.updateInfoPanel(anyEntity);
        }

        // 2. Refresh Measurement Tool Instructions
        const activeTool = this.measurement.getActiveTool();
        if (activeTool) {
            const instructions = {
                distance: this.language.translate('instrDistance'),
                angle: this.language.translate('instrAngle'),
                radius: this.language.translate('instrRadius'),
                coordinate: this.language.translate('instrCoordinate')
            };
            this.updateMeasurementResult(instructions[activeTool]);
            this.updateStatus(instructions[activeTool]);
        } else {
            // If no tool, reset to default state
            this.updateMeasurementResult(this.language.translate('selectTool'));
            this.updateStatus(this.language.translate('ready'));
        }

        // 3. Refresh Layers Panel (for dynamic "No layers" message)
        if (this.dxfData) {
            this.updateLayersPanel(this.dxfData.layers);
            // Also refresh loaded info status?
            this.updateStatus(this.language.translate('loadedInfo')
                .replace('{count}', this.dxfData.entities.length)
                .replace('{layers}', this.dxfData.layers.length));
        } else {
            this.updateStatus(this.language.translate('ready'));
        }
    }
}

// Initialize app when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        window.dxfViewerApp = new DXFViewerApp();
    });
} else {
    window.dxfViewerApp = new DXFViewerApp();
}
