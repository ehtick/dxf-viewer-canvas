/**
 * DXF Parser Module
 * Supports DXF versions AC1009-AC1015
 * Parses entities, layers, linetypes, and other DXF structures
 */

export class DXFParser {
    constructor() {
        this.entities = [];
        this.layers = new Map();
        this.linetypes = new Map();
        this.header = {};
        this.blocks = new Map();
    }

    /**
     * Parse DXF file content
     * @param {string} content - DXF file content as string
     * @returns {Object} Parsed DXF data
     */
    parse(content) {
        // Normalize line endings (handle both \r\n and \n)
        const normalized = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
        const lines = normalized.split('\n').map(line => line.trim());
        let i = 0;

        while (i < lines.length) {
            const code = parseInt(lines[i]);
            const value = lines[i + 1];

            if (code === 0) {
                if (value === 'SECTION') {
                    i = this.parseSection(lines, i + 2);
                } else {
                    i += 2;
                }
            } else {
                i += 2;
            }
        }

        return {
            entities: this.entities,
            layers: Array.from(this.layers.values()),
            linetypes: Array.from(this.linetypes.values()),
            header: this.header,
            blocks: this.blocks
        };
    }

    /**
     * Parse a DXF section
     */
    parseSection(lines, startIndex) {
        let i = startIndex;
        // startIndex points to the group code (2), the section name is at startIndex + 1
        const sectionType = lines[i + 1];
        i += 2; // Skip group code and section type

        switch (sectionType) {
            case 'HEADER':
                i = this.parseHeader(lines, i);
                break;
            case 'TABLES':
                i = this.parseTables(lines, i);
                break;
            case 'BLOCKS':
                i = this.parseBlocks(lines, i);
                break;
            case 'ENTITIES':
                i = this.parseEntities(lines, i);
                break;
            default:
                // Skip unknown sections
                while (i < lines.length) {
                    if (parseInt(lines[i]) === 0 && lines[i + 1] === 'ENDSEC') {
                        return i + 2;
                    }
                    i += 2;
                }
        }

        return i;
    }

    /**
     * Parse HEADER section
     */
    parseHeader(lines, startIndex) {
        let i = startIndex;
        let currentVar = null;

        while (i < lines.length) {
            const code = parseInt(lines[i]);
            const value = lines[i + 1];

            if (code === 0 && value === 'ENDSEC') {
                return i + 2;
            }

            if (code === 9) {
                currentVar = value;
                this.header[currentVar] = null;
            } else if (currentVar) {
                this.header[currentVar] = this.parseValue(code, value);
            }

            i += 2;
        }

        return i;
    }

    /**
     * Parse TABLES section
     */
    parseTables(lines, startIndex) {
        let i = startIndex;

        while (i < lines.length) {
            const code = parseInt(lines[i]);
            const value = lines[i + 1];

            if (code === 0) {
                if (value === 'ENDSEC') {
                    return i + 2;
                } else if (value === 'TABLE') {
                    i = this.parseTable(lines, i + 2);
                } else {
                    i += 2;
                }
            } else {
                i += 2;
            }
        }

        return i;
    }

    /**
     * Parse a table (LAYER, LTYPE, etc.)
     */
    parseTable(lines, startIndex) {
        let i = startIndex;
        // startIndex points to group code (2), table name is at startIndex + 1
        const tableType = lines[i + 1];
        i += 2;

        while (i < lines.length) {
            const code = parseInt(lines[i]);
            const value = lines[i + 1];

            if (code === 0) {
                if (value === 'ENDTAB') {
                    return i + 2;
                } else if (tableType === 'LAYER' && value === 'LAYER') {
                    i = this.parseLayer(lines, i + 2);
                } else if (tableType === 'LTYPE' && value === 'LTYPE') {
                    i = this.parseLinetype(lines, i + 2);
                } else {
                    i += 2;
                }
            } else {
                i += 2;
            }
        }

        return i;
    }

    /**
     * Parse a layer definition
     */
    parseLayer(lines, startIndex) {
        let i = startIndex;
        const layer = {
            name: '',
            color: 7,
            lineType: 'CONTINUOUS',
            flags: 0,
            visible: true
        };

        while (i < lines.length) {
            const code = parseInt(lines[i]);
            const value = lines[i + 1];

            if (code === 0) {
                // Save layer before returning
                if (layer.name) {
                    this.layers.set(layer.name, layer);
                }
                return i;
            }

            switch (code) {
                case 2: layer.name = value; break;
                case 62:
                    layer.color = parseInt(value);
                    if (layer.color < 0) {
                        layer.visible = false;
                        layer.color = Math.abs(layer.color);
                    }
                    break;
                case 6: layer.lineType = value; break;
                case 70: layer.flags = parseInt(value); break;
            }

            i += 2;
        }

        // Save layer if we reached end of file
        if (layer.name) {
            this.layers.set(layer.name, layer);
        }
        return i;
    }

    /**
     * Parse a linetype definition
     */
    parseLinetype(lines, startIndex) {
        let i = startIndex;
        const linetype = {
            name: '',
            description: '',
            pattern: [],
            patternLength: 0
        };

        while (i < lines.length) {
            const code = parseInt(lines[i]);
            const value = lines[i + 1];

            if (code === 0) {
                this.linetypes.set(linetype.name, linetype);
                return i;
            }

            switch (code) {
                case 2: linetype.name = value; break;
                case 3: linetype.description = value; break;
                case 40: linetype.patternLength = parseFloat(value); break;
                case 49: linetype.pattern.push(parseFloat(value)); break;
            }

            i += 2;
        }

        return i;
    }

    /**
     * Parse BLOCKS section
     */
    parseBlocks(lines, startIndex) {
        let i = startIndex;
        let currentBlock = null;

        while (i < lines.length) {
            const code = parseInt(lines[i]);
            const value = lines[i + 1];

            if (code === 0) {
                if (value === 'ENDSEC') {
                    return i + 2;
                }

                if (value === 'BLOCK') {
                    currentBlock = { entities: [] };
                    i += 2;
                    // Parse Block Header
                    while (i < lines.length) {
                        const bCode = parseInt(lines[i]);
                        const bValue = lines[i + 1];

                        if (bCode === 0) break; // End of header (start of entities or ENDBLK)

                        switch (bCode) {
                            case 2: currentBlock.name = bValue; break;
                            case 10: currentBlock.x = parseFloat(bValue); break;
                            case 20: currentBlock.y = parseFloat(bValue); break;
                            case 30: currentBlock.z = parseFloat(bValue); break;
                            case 70: currentBlock.flags = parseInt(bValue); break;
                        }
                        i += 2;
                    }
                } else if (value === 'ENDBLK') {
                    if (currentBlock && currentBlock.name) {
                        this.blocks.set(currentBlock.name, currentBlock);
                    }
                    currentBlock = null;
                    i += 2;
                } else {
                    // It's an entity inside a block
                    if (currentBlock) {
                        const entity = this.parseEntity(lines, i, value);
                        if (entity) {
                            currentBlock.entities.push(entity);
                            i = entity._endIndex;
                        } else {
                            i += 2;
                        }
                    } else {
                        // Orphan entity in blocks section? Skip.
                        i += 2;
                    }
                }
            } else {
                i += 2;
            }
        }

        return i;
    }

    /**
     * Parse ENTITIES section
     */
    parseEntities(lines, startIndex) {
        let i = startIndex;

        while (i < lines.length) {
            const code = parseInt(lines[i]);
            const value = lines[i + 1];

            if (code === 0) {
                if (value === 'ENDSEC') {
                    return i + 2;
                } else {
                    const entity = this.parseEntity(lines, i, value);
                    if (entity) {
                        this.entities.push(entity);
                        i = entity._endIndex;
                    } else {
                        i += 2;
                    }
                }
            } else {
                i += 2;
            }
        }

        return i;
    }

    /**
     * Parse a single entity
     */
    parseEntity(lines, startIndex, entityType) {
        const entity = {
            type: entityType,
            layer: '0',
            color: 256, // BYLAYER
            lineType: 'BYLAYER',
            _endIndex: startIndex + 2
        };

        let i = startIndex + 2;

        while (i < lines.length) {
            const code = parseInt(lines[i]);
            const value = lines[i + 1];

            if (code === 0) {
                // For POLYLINE entities with vertices follow flag, parse VERTEX entities
                if (entityType === 'POLYLINE' && entity.verticesFollow === 1) {
                    i = this.parsePolylineVertices(lines, i, entity);
                }
                entity._endIndex = i;
                break;
            }

            // Common properties
            switch (code) {
                case 8: entity.layer = value; break;
                case 62: entity.color = parseInt(value); break;
                case 6: entity.lineType = value; break;
            }

            // Entity-specific properties
            switch (entityType) {
                case 'LINE':
                    this.parseLineEntity(entity, code, value);
                    break;
                case 'CIRCLE':
                    this.parseCircleEntity(entity, code, value);
                    break;
                case 'ARC':
                    this.parseArcEntity(entity, code, value);
                    break;
                case 'LWPOLYLINE':
                    this.parseLWPolylineEntity(entity, code, value);
                    break;
                case 'POLYLINE':
                    this.parsePolylineEntity(entity, code, value);
                    break;
                case 'TEXT':
                    this.parseTextEntity(entity, code, value);
                    break;
                case 'MTEXT':
                    this.parseMTextEntity(entity, code, value);
                    break;
                case 'DIMENSION':
                    this.parseDimensionEntity(entity, code, value);
                    break;
                case 'HATCH':
                    this.parseHatchEntity(entity, code, value);
                    break;
                case 'POINT':
                    this.parsePointEntity(entity, code, value);
                    break;
                case 'INSERT':
                    this.parseInsertEntity(entity, code, value);
                    break;
            }

            i += 2;
        }

        if (entity.type === 'HATCH') {
            console.log('DXFParser: Parsed HATCH', {
                solidFill: entity.solidFill,
                pattern: entity.patternName,
                loops: entity.loops ? entity.loops.map(loop => ({
                    isPolyline: loop.isPolyline,
                    vertexCount: loop.vertices ? loop.vertices.length : 0,
                    edgeCount: loop.edges ? loop.edges.length : 0,
                    vertices: loop.vertices, // Expose vertices for verification
                    edges: loop.edges ? loop.edges.map(e => ({ type: e.type, data: e })) : []
                })) : [],
                raw: entity._loopState && entity._loopState.debug ? entity._loopState.debug.raw : []
            });
        }

        // Post-process MTEXT to format aggregated text
        if (entity.type === 'MTEXT' && entity.text) {
            entity.text = this.formatText(entity.text);
        }

        return entity;
    }

    parseLineEntity(entity, code, value) {
        switch (code) {
            case 10: entity.x1 = parseFloat(value); break;
            case 20: entity.y1 = parseFloat(value); break;
            case 30: entity.z1 = parseFloat(value) || 0; break;
            case 11: entity.x2 = parseFloat(value); break;
            case 21: entity.y2 = parseFloat(value); break;
            case 31: entity.z2 = parseFloat(value) || 0; break;
        }
    }

    parseCircleEntity(entity, code, value) {
        switch (code) {
            case 10: entity.cx = parseFloat(value); break;
            case 20: entity.cy = parseFloat(value); break;
            case 30: entity.cz = parseFloat(value) || 0; break;
            case 40: entity.radius = parseFloat(value); break;
        }
    }

    parseArcEntity(entity, code, value) {
        switch (code) {
            case 10: entity.cx = parseFloat(value); break;
            case 20: entity.cy = parseFloat(value); break;
            case 30: entity.cz = parseFloat(value) || 0; break;
            case 40: entity.radius = parseFloat(value); break;
            case 50: entity.startAngle = parseFloat(value); break;
            case 51: entity.endAngle = parseFloat(value); break;
        }
    }

    parseLWPolylineEntity(entity, code, value) {
        if (!entity.vertices) entity.vertices = [];
        if (!entity.bulges) entity.bulges = [];

        switch (code) {
            case 70: entity.flags = parseInt(value); break;
            case 90: entity.vertexCount = parseInt(value); break;
            case 10:
                entity.vertices.push({ x: parseFloat(value), y: 0, bulge: 0 });
                break;
            case 20:
                if (entity.vertices.length > 0) {
                    entity.vertices[entity.vertices.length - 1].y = parseFloat(value);
                }
                break;
            case 42:
                if (entity.vertices.length > 0) {
                    entity.vertices[entity.vertices.length - 1].bulge = parseFloat(value);
                }
                break;
        }
    }

    parsePolylineEntity(entity, code, value) {
        if (!entity.vertices) entity.vertices = [];

        switch (code) {
            case 66: entity.verticesFollow = parseInt(value); break;
            case 70: entity.flags = parseInt(value); break;
        }
    }

    /**
     * Parse VERTEX entities that follow a POLYLINE
     */
    parsePolylineVertices(lines, startIndex, entity) {
        let i = startIndex;

        while (i < lines.length) {
            const code = parseInt(lines[i]);
            const value = lines[i + 1];

            if (code === 0) {
                if (value === 'VERTEX') {
                    // Parse this vertex
                    const vertex = { x: 0, y: 0, bulge: 0 };
                    i += 2;

                    while (i < lines.length) {
                        const vCode = parseInt(lines[i]);
                        const vValue = lines[i + 1];

                        if (vCode === 0) {
                            // End of this vertex
                            break;
                        }

                        switch (vCode) {
                            case 10: vertex.x = parseFloat(vValue); break;
                            case 20: vertex.y = parseFloat(vValue); break;
                            case 42: vertex.bulge = parseFloat(vValue); break;
                        }

                        i += 2;
                    }

                    entity.vertices.push(vertex);
                } else if (value === 'SEQEND') {
                    // End of polyline vertices
                    i += 2;
                    break;
                } else {
                    // Some other entity, stop parsing vertices
                    break;
                }
            } else {
                i += 2;
            }
        }

        return i;
    }

    parseTextEntity(entity, code, value) {
        switch (code) {
            case 10: entity.x = parseFloat(value); break;
            case 20: entity.y = parseFloat(value); break;
            case 30: entity.z = parseFloat(value) || 0; break;
            case 40: entity.height = parseFloat(value); break;
            case 1: entity.text = this.formatText(value); break;
            case 50: entity.rotation = parseFloat(value); break;
            case 72: entity.hAlign = parseInt(value); break;
            case 73: entity.vAlign = parseInt(value); break;
        }
    }

    parseMTextEntity(entity, code, value) {
        switch (code) {
            case 10: entity.x = parseFloat(value); break;
            case 20: entity.y = parseFloat(value); break;
            case 30: entity.z = parseFloat(value) || 0; break;
            case 40: entity.height = parseFloat(value); break;
            case 1:
            case 3:
                if (!entity.text) entity.text = '';
                entity.text += value;
                // Defer formatting until full string is assembled? 
                // Or format incremental? 
                // MText splits string across codes 3 and 1. Code 1 is last 250 chars.
                // We should append RAW then format later?
                // But parseEntity returns immediately after loop.
                // We can't easily post-process cleanly here without buffering.
                // However, usually parseEntity is called sequentially.
                // Let's assume we can clean up at the end? 
                // No, better to append raw and assume we format when rendering?
                // Or format here? If we format partial split codes, we might break escape sequences split across boundary.
                // Simplification: Append raw here, format in `parseEntity` end?
                // Actually `parseEntity` loop finishes.
                // Let's format at assignment but `entity.text` accumulates.
                // If we format incrementally, valid. Exception: split escape.
                // For now, let's keep accumulation RAW here, but adding a check?
                // Better: Modify `parseEntity` Loop to format `entity.text` just before returning?
                break;
            case 50: entity.rotation = parseFloat(value); break;
        }
    }

    parseDimensionEntity(entity, code, value) {
        switch (code) {
            case 10: entity.defX = parseFloat(value); break;
            case 20: entity.defY = parseFloat(value); break;
            case 30: entity.defZ = parseFloat(value) || 0; break;
            case 11: entity.midX = parseFloat(value); break;
            case 21: entity.midY = parseFloat(value); break;
            case 13: entity.pt1X = parseFloat(value); break;
            case 23: entity.pt1Y = parseFloat(value); break;
            case 14: entity.pt2X = parseFloat(value); break;
            case 24: entity.pt2Y = parseFloat(value); break;
            case 1: entity.text = this.formatText(value); break;
            case 50: entity.rotation = parseFloat(value); break;
            case 70: entity.dimType = parseInt(value); break;
        }
    }

    /**
     * Format MText/Text content
     * Handles %% codes, \U+ unicode, and basic MText formatting
     */
    formatText(text) {
        if (!text) return '';

        let s = text;

        // 1. Handle AutoCAD Control Codes (%%)
        s = s.replace(/%%[cC]/g, 'Ø'); // Diameter
        s = s.replace(/%%[dD]/g, '°'); // Degree
        s = s.replace(/%%[pP]/g, '±'); // Plus/Minus
        s = s.replace(/%%[uU]/g, '');  // Underline (not supported yet -> strip)
        s = s.replace(/%%[oO]/g, '');  // Overscore (not supported yet -> strip)

        // 2. Handle Unicode Escapes (\U+XXXX)
        s = s.replace(/\\U\+([0-9A-Fa-f]{4})/g, (match, hex) => {
            return String.fromCharCode(parseInt(hex, 16));
        });

        // 3. Handle MText Newline (\P)
        s = s.replace(/\\P/g, '\n');

        // 4. Handle MText Formatting Codes (Strip them for now)
        // \A1; Alignment
        // \H...; Height
        // \C...; Color
        // \f...; Font
        // \S...; Stacking
        // Regex to strip: backslash followed by char, optional value, then semicolon?
        // Simple heuristic: \L, \l, \k, \K (switches)
        // \A..., \C..., \H..., \f..., \T..., \Q..., \W... ending with ;
        // Stacking \S...^...; is complex. Just strip \S?

        // Strip braces {}
        s = s.replace(/[{}]/g, '');

        // Strip formatting sequences
        // Common pattern: \[A-Z0-9]+;
        s = s.replace(/\\[ACFHQTWf][^;]*;/g, ''); // Remove Font/Height/Color...
        s = s.replace(/\\[LlkK]/g, ''); // Remove switches

        return s;
    }

    parseHatchEntity(entity, code, value) {
        if (!entity.loops) entity.loops = [];

        // --- State Machine Initialization ---
        if (!entity._loopState) {
            entity._loopState = {
                currentLoop: null,
                currentEdge: null,
                isPolyline: false,
                hasBulges: false,
                isClosed: false,
                // Debug Statistics
                debug: {
                    expectedLoops: 0,
                    totalLoops: 0,
                    edgeCounts: [],
                    raw: []
                }
            };
        }

        // Capture Raw DXF for Debugging
        entity._loopState.debug.raw.push({ code, value });

        switch (code) {
            case 70: entity.solidFill = parseInt(value); break;
            case 63: entity.fillColor = parseInt(value); break;
            case 2: entity.patternName = value; break;

            // --- Boundary Loop Start ---
            case 91: // Number of boundary paths
                entity._loopState.debug.expectedLoops = parseInt(value);
                break;

            case 92: // Boundary Path Type Flag (New Loop Start)
                {
                    const flags = parseInt(value);
                    const isPolyline = (flags & 2) === 2; // Bit 1 set = Polyline

                    const newLoop = {
                        flags: flags,
                        isPolyline: isPolyline,
                        vertices: [], // For Polyline
                        edges: [],    // For Edge Path
                        // Metadata
                        expectedItems: 0, // Edges or Vertices
                        itemCount: 0
                    };

                    entity.loops.push(newLoop);
                    entity._loopState.currentLoop = newLoop;
                    entity._loopState.isPolyline = isPolyline;
                    entity._loopState.currentEdge = null;
                    entity._loopState.debug.totalLoops++;
                }
                break;

            // --- Polyline/Edge Loop Context Handler ---
            case 72:
                // CRITICAL: Context Sensitive
                if (entity._loopState.isPolyline) {
                    // Context: Polyline -> Has Bulge Flag
                    entity._loopState.hasBulges = parseInt(value) === 1;
                } else if (entity._loopState.currentLoop) {
                    // Context: Edge Path -> Edge Type Enum
                    // Check limit first
                    const loop = entity._loopState.currentLoop;
                    if (loop.itemCount >= loop.expectedItems) {
                        entity._loopState.currentEdge = null; // Stop parsing extra edges
                        break;
                    }

                    const edgeType = parseInt(value); // 1=Line, 2=CircArc, 3=EllArc, 4=Spline
                    const newEdge = { type: edgeType };

                    // Initialize default properties for robustness
                    if (edgeType === 2) { // Arc
                        newEdge.ccw = 1; // Default to CCW if code 73 is missing (Reliability Fix)
                    }
                    if (edgeType === 4) { // Spline
                        newEdge.controlPoints = []; // Raw data storage
                    }

                    loop.edges.push(newEdge);
                    loop.itemCount++;
                    entity._loopState.currentEdge = newEdge;
                }
                break;

            case 73:
                // Context Sensitive
                if (entity._loopState.isPolyline) {
                    // Context: Polyline -> Is Closed Flag
                    entity._loopState.isClosed = parseInt(value) === 1;
                } else if (entity._loopState.currentEdge && entity._loopState.currentEdge.type === 2) {
                    // Context: Arc Edge -> CCW Flag
                    entity._loopState.currentEdge.ccw = parseInt(value);
                }
                break;

            case 93: // Number of edges (Edge Path) or Vertices (Polyline)
                if (entity._loopState.currentLoop) {
                    entity._loopState.currentLoop.expectedItems = parseInt(value);
                }
                break;

            case 97: // Source Boundary Objects (End of geometry)
            case 98: // Seed Points (End of geometry)
                // Reliable signal to stop parsing boundary geometry
                // This prevents seed points (Code 10/20) from being misinterpreted as polyline vertices
                entity._loopState.currentEdge = null;
                entity._loopState.currentLoop = null; // STOP loop processing
                entity._loopState.isPolyline = false;
                break;

            // --- Geometry Data ---
            case 10: // X Coordinate
                if (entity._loopState.isPolyline && entity._loopState.currentLoop) {
                    entity._loopState.currentLoop.vertices.push({ x: parseFloat(value), y: 0, bulge: 0 });
                } else if (entity._loopState.currentEdge) {
                    const e = entity._loopState.currentEdge;
                    if (e.type === 1) e.x1 = parseFloat(value); // Line Start
                    else if (e.type === 2) e.cx = parseFloat(value); // Arc Center
                    else if (e.type === 4) e.controlPoints.push({ x: parseFloat(value), y: 0 }); // Spline CP
                }
                break;

            case 20: // Y Coordinate
                if (entity._loopState.isPolyline && entity._loopState.currentLoop) {
                    const verts = entity._loopState.currentLoop.vertices;
                    if (verts.length > 0) verts[verts.length - 1].y = parseFloat(value);
                } else if (entity._loopState.currentEdge) {
                    const e = entity._loopState.currentEdge;
                    if (e.type === 1) e.y1 = parseFloat(value); // Line Start
                    else if (e.type === 2) e.cy = parseFloat(value); // Arc Center
                    else if (e.type === 4) { // Spline CP
                        const cps = e.controlPoints;
                        if (cps.length > 0) cps[cps.length - 1].y = parseFloat(value);
                    }
                }
                break;

            case 11: // Line End X
                if (entity._loopState.currentEdge && entity._loopState.currentEdge.type === 1)
                    entity._loopState.currentEdge.x2 = parseFloat(value);
                break;
            case 21: // Line End Y
                if (entity._loopState.currentEdge && entity._loopState.currentEdge.type === 1)
                    entity._loopState.currentEdge.y2 = parseFloat(value);
                break;
            case 40: // Circle/Arc Radius OR Spline Knot? (Spline knot is 40, but knot count is 74...)
                if (entity._loopState.currentEdge && entity._loopState.currentEdge.type === 2)
                    entity._loopState.currentEdge.radius = parseFloat(value);
                break;
            case 50: // Start Angle
                if (entity._loopState.currentEdge && entity._loopState.currentEdge.type === 2)
                    entity._loopState.currentEdge.startAngle = parseFloat(value);
                break;
            case 51: // End Angle
                if (entity._loopState.currentEdge && entity._loopState.currentEdge.type === 2)
                    entity._loopState.currentEdge.endAngle = parseFloat(value);
                break;
            case 42: // Bulge (Polyline)
                if (entity._loopState.isPolyline && entity._loopState.currentLoop) {
                    const verts = entity._loopState.currentLoop.vertices;
                    if (verts.length > 0) verts[verts.length - 1].bulge = parseFloat(value);
                }
                break;
        }

        // Use a simple log marker for now to avoid spam. Full debug dump should happen at end of entity parsing if possible,
        // but 'parseHatchEntity' is called per code. 
        // We will log when a Loop Start (92) is detected to show progress.
        if (code === 92) {
            console.log(`[HATCH-PARSER] New Loop detected. Pattern: ${entity.patternName || 'Unknown'}`, entity._loopState.currentLoop);
        }
    }

    parsePointEntity(entity, code, value) {
        switch (code) {
            case 10: entity.x = parseFloat(value); break;
            case 20: entity.y = parseFloat(value); break;
            case 30: entity.z = parseFloat(value) || 0; break;
        }
    }



    parseInsertEntity(entity, code, value) {
        switch (code) {
            case 2: entity.block = value; break;
            case 10: entity.x = parseFloat(value); break;
            case 20: entity.y = parseFloat(value); break;
            case 30: entity.z = parseFloat(value) || 0; break;
            case 41: entity.scaleX = parseFloat(value); break;
            case 42: entity.scaleY = parseFloat(value); break;
            case 43: entity.scaleZ = parseFloat(value); break;
            case 50: entity.rotation = parseFloat(value); break;
            case 70: entity.colCount = parseInt(value); break;
            case 71: entity.rowCount = parseInt(value); break;
            case 44: entity.colSpacing = parseFloat(value); break;
            case 45: entity.rowSpacing = parseFloat(value); break;
        }
    }

    /**
     * Parse value based on group code
     */
    parseValue(code, value) {
        if (code >= 10 && code < 60) {
            return parseFloat(value);
        } else if (code >= 60 && code < 80) {
            return parseInt(value);
        }
        return value;
    }

    /**
     * Convert bulge to arc segments
     * @param {Object} p1 - Start point {x, y}
     * @param {Object} p2 - End point {x, y}
     * @param {number} bulge - Bulge value
     * @returns {Object} Arc parameters {cx, cy, radius, startAngle, endAngle}
     */
    static bulgeToArc(p1, p2, bulge) {
        if (bulge === undefined || bulge === null || Math.abs(bulge) < 1e-12) {
            return null; // line
        }

        // Signed central angle (radians). Range: (-2π, 2π)
        const theta = 4 * Math.atan(bulge);

        const dx = p2.x - p1.x;
        const dy = p2.y - p1.y;
        const chord = Math.hypot(dx, dy);
        if (chord < 1e-12) return null;

        const halfThetaAbs = Math.abs(theta) / 2;

        // Always positive radius magnitude (world)
        const radius = chord / (2 * Math.sin(halfThetaAbs));

        // Midpoint of chord
        const mx = (p1.x + p2.x) / 2;
        const my = (p1.y + p2.y) / 2;

        // Unit left-perp of chord (points to "left" of p1->p2)
        const ux = dx / chord;
        const uy = dy / chord;
        const px = -uy;
        const py = ux;

        // Distance from midpoint to center along perp.
        // NOTE: cos(|theta|/2) becomes negative for |theta| > π (major arcs) automatically.
        const h = radius * Math.cos(halfThetaAbs);

        // Bulge sign chooses which side of the chord is the "bulge side"
        const s = bulge >= 0 ? 1 : -1;

        const cx = mx + px * h * s;
        const cy = my + py * h * s;

        // Start angle from center to p1
        const startRad = Math.atan2(p1.y - cy, p1.x - cx);

        // CRITICAL: lock the sweep to theta (this fixes quadrant-dependent flips)
        const endRad = startRad + theta;

        return {
            cx,
            cy,
            radius: Math.abs(radius),
            startAngle: startRad * 180 / Math.PI, // degrees (world)
            endAngle: endRad * 180 / Math.PI,     // degrees (world)
            counterClockwise: theta > 0,
            theta // keep it (radians) for exact area if you want
        };
    }


}

/**
 * AutoCAD Color Index to RGB conversion
 */
export const ACI_COLORS = [
    [0, 0, 0],       // 0 - ByBlock
    [255, 0, 0],     // 1 - Red
    [255, 255, 0],   // 2 - Yellow
    [0, 255, 0],     // 3 - Green
    [0, 255, 255],   // 4 - Cyan
    [0, 0, 255],     // 5 - Blue
    [255, 0, 255],   // 6 - Magenta
    [255, 255, 255], // 7 - White/Black
    [128, 128, 128], // 8 - Gray
    [192, 192, 192], // 9 - Light Gray
    [255, 0, 0],     // 10 - Red
    [255, 127, 127], // 11 - Light Red
    [165, 0, 0],     // 12 - Dark Red
    [165, 82, 82],   // 13
    [127, 0, 0],     // 14
    [127, 63, 63],   // 15
    [76, 0, 0],      // 16
    [76, 38, 38],    // 17
    [38, 0, 0],      // 18
    [38, 19, 19],    // 19
    [255, 63, 0],    // 20
    [255, 159, 127], // 21
    [165, 41, 0],    // 22
    [165, 103, 82],  // 23
    [127, 31, 0],    // 24
    [127, 79, 63]    // 25
    // ... Add more ACI colors as needed (up to 255)
];

// Fill remaining colors with interpolated values
for (let i = ACI_COLORS.length; i < 256; i++) {
    const hue = (i - 10) % 240;
    const sat = Math.floor((i - 10) / 240) * 25 + 100;
    const light = 50 + (i % 2) * 25;
    ACI_COLORS[i] = hslToRgb(hue / 240, sat / 100, light / 100);
}

function hslToRgb(h, s, l) {
    let r, g, b;

    if (s === 0) {
        r = g = b = l;
    } else {
        const hue2rgb = (p, q, t) => {
            if (t < 0) t += 1;
            if (t > 1) t -= 1;
            if (t < 1 / 6) return p + (q - p) * 6 * t;
            if (t < 1 / 2) return q;
            if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
            return p;
        };

        const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
        const p = 2 * l - q;
        r = hue2rgb(p, q, h + 1 / 3);
        g = hue2rgb(p, q, h);
        b = hue2rgb(p, q, h - 1 / 3);
    }

    return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

export function aciToRgb(colorIndex) {
    if (colorIndex === 256) return null; // BYLAYER
    if (colorIndex === 0) return [0, 0, 0]; // BYBLOCK
    if (colorIndex < 0 || colorIndex >= ACI_COLORS.length) return [255, 255, 255];
    return ACI_COLORS[colorIndex];
}
