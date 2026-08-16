// Simple force-directed graph on a canvas.
// Nodes are entities; edges are facts whose relation connects two entities.

import { getState, getEntityName, entityMatchesClass } from './store.js';

const NODE_RADIUS = 22;
const SPRING_LEN = 140;
const SPRING_K = 0.02;
const REPULSION = 6000;
const DAMPING = 0.85;
const CENTER_PULL = 0.002;

// Deterministic hue from any id string.
function hashHue(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
    return h % 360;
}
function classColor(id) { return `hsl(${hashHue(id)}, 65%, 45%)`; }
function relationColor(id) { return `hsl(${hashHue(id)}, 60%, 40%)`; }

export class GraphView {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.nodes = new Map(); // entityId -> { x, y, vx, vy }
        this.edges = []; // { a, b, label }
        this.running = false;
        this.dpr = window.devicePixelRatio || 1;
        this.dragging = null;
        this.hover = null;

        this._onResize = () => this.resize();
        window.addEventListener('resize', this._onResize);

        canvas.addEventListener('mousedown', (e) => this._onMouseDown(e));
        canvas.addEventListener('mousemove', (e) => this._onMouseMove(e));
        canvas.addEventListener('click', (e) => this._onClick(e));
        window.addEventListener('mouseup', () => (this.dragging = null));

        // Interaction state
        this.pendingSourceId = null;
        this._downX = 0;
        this._downY = 0;
        this._wasDragged = false;

        // Callbacks (set from outside)
        this.onBackgroundClick = null;   // (x, y)
        this.onNodeClick = null;         // (id, x, y)

        // View options
        this.layout = 'force';           // 'force' | 'circular' | 'grid'
        this.colorBy = 'class';          // 'class' | 'relation'
        this.sizeBy = 'degree';          // 'degree' | 'centrality'
        this.query = '';                 // e.g. 'is sibling to=Mariana'
        this.hiddenEntityIds = new Set();
        this.hiddenRelationIds = new Set();

        // Derived per sync()
        this.degree = new Map();
        this.closeness = new Map();
        this.visibleNodeIds = null;      // null = all visible
        this.visibleEdgeFilter = null;   // (edge) => bool, or null
        this.entityInfo = new Map();     // id -> entity object

        this.resize();
    }

    destroy() {
        this.stop();
        window.removeEventListener('resize', this._onResize);
    }

    resize() {
        const rect = this.canvas.getBoundingClientRect();
        this.canvas.width = Math.max(1, rect.width * this.dpr);
        this.canvas.height = Math.max(1, rect.height * this.dpr);
        this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
        this.width = rect.width;
        this.height = rect.height;
    }

    sync() {
        const { entities, relations, facts } = getState();
        const nextIds = new Set(entities.map(e => e.id));

        // Remove nodes that no longer exist
        for (const id of [...this.nodes.keys()]) {
            if (!nextIds.has(id)) this.nodes.delete(id);
        }

        // Add new nodes at random-ish positions near center
        for (const e of entities) {
            if (!this.nodes.has(e.id)) {
                this.nodes.set(e.id, {
                    x: this.width / 2 + (Math.random() - 0.5) * 200,
                    y: this.height / 2 + (Math.random() - 0.5) * 200,
                    vx: 0,
                    vy: 0,
                });
            }
        }

        // Build edges from entity-to-entity facts
        this.edges = [];
        for (const f of facts) {
            const rel = relations.find(r => r.id === f.relationId);
            if (!rel) continue;
            if (rel.aType.kind !== 'entity' || rel.bType.kind !== 'entity') continue;
            if (!this.nodes.has(f.a) || !this.nodes.has(f.b)) continue;
            this.edges.push({ a: f.a, b: f.b, label: rel.name, relationId: rel.id });
        }

        // Cache entity info for coloring.
        this.entityInfo = new Map(entities.map(e => [e.id, e]));

        this._computeMetrics();
        this._applyQuery();
        if (this.layout !== 'force') this._applyLayout();
    }

    _computeMetrics() {
        const ids = [...this.nodes.keys()];
        const visibleIds = ids.filter(id => this._isNodeVisible(id));
        const adj = new Map(visibleIds.map(id => [id, new Set()]));
        for (const e of this.edges) {
            if (!this._isEdgeVisible(e)) continue;
            adj.get(e.a)?.add(e.b);
            adj.get(e.b)?.add(e.a);
        }
        // Degree/closeness default to 0 for anything not in the visible subgraph.
        this.degree = new Map(ids.map(id => [id, adj.get(id)?.size ?? 0]));
        this.closeness = new Map();
        for (const id of ids) this.closeness.set(id, 0);
        for (const s of visibleIds) {
            const dist = new Map([[s, 0]]);
            const queue = [s];
            while (queue.length) {
                const cur = queue.shift();
                const d = dist.get(cur);
                for (const nb of adj.get(cur)) {
                    if (!dist.has(nb)) {
                        dist.set(nb, d + 1);
                        queue.push(nb);
                    }
                }
            }
            let sum = 0;
            for (const [id, d] of dist) if (id !== s) sum += d;
            const reachable = dist.size - 1;
            this.closeness.set(s, sum > 0 ? reachable / sum : 0);
        }
    }

    _applyQuery() {
        this.visibleNodeIds = null;
        this.visibleEdgeFilter = null;
        const raw = (this.query || '').trim();
        if (!raw) return;
        const { relations, entities, facts, classes } = getState();

        // Form 1: relationName=entityName (substring match on both sides).
        const m = /^(.+?)\s*=\s*(.+)$/.exec(raw);
        if (m) {
            const relQ = m[1].trim().toLowerCase();
            const entQ = m[2].trim().toLowerCase();
            const rels = relations.filter(r => r.name.toLowerCase().includes(relQ));
            const ents = entities.filter(e => e.name.toLowerCase().includes(entQ));
            if (!rels.length || !ents.length) {
                this.visibleNodeIds = new Set();
                this.visibleEdgeFilter = () => false;
                return;
            }
            const relIds = new Set(rels.map(r => r.id));
            const entIds = new Set(ents.map(e => e.id));
            const visible = new Set(entIds);
            for (const f of facts) {
                if (!relIds.has(f.relationId)) continue;
                if (!entIds.has(f.a) && !entIds.has(f.b)) continue;
                visible.add(f.a);
                visible.add(f.b);
            }
            this.visibleNodeIds = visible;
            this.visibleEdgeFilter = (edge) =>
                relIds.has(edge.relationId)
                && (entIds.has(edge.a) || entIds.has(edge.b));
            return;
        }

        // Form 2: substring on entity names. Prefer entities; if none, fall
        // through to classes; if none, fall through to relations.
        const q = raw.toLowerCase();
        let targetIds = new Set(
            entities.filter(e => e.name.toLowerCase().includes(q)).map(e => e.id),
        );

        // Form 3: substring on class name — collect all entities in those classes.
        if (!targetIds.size) {
            const matchedClasses = classes.filter(c => c.name.toLowerCase().includes(q));
            if (matchedClasses.length) {
                for (const e of entities) {
                    if (matchedClasses.some(c => entityMatchesClass(e, c.id))) {
                        targetIds.add(e.id);
                    }
                }
            }
        }

        // Form 4: substring on relation name — show every entity pair connected
        // by any matching relation.
        if (!targetIds.size) {
            const matchedRelations = relations.filter(r => r.name.toLowerCase().includes(q));
            if (matchedRelations.length) {
                const relIds = new Set(matchedRelations.map(r => r.id));
                const visible = new Set();
                for (const f of facts) {
                    if (!relIds.has(f.relationId)) continue;
                    visible.add(f.a);
                    visible.add(f.b);
                }
                this.visibleNodeIds = visible;
                this.visibleEdgeFilter = (edge) => relIds.has(edge.relationId);
                return;
            }
        }

        if (!targetIds.size) {
            this.visibleNodeIds = new Set();
            this.visibleEdgeFilter = () => false;
            return;
        }

        // Include direct neighbors via any relation, any direction.
        const visible = new Set(targetIds);
        for (const f of facts) {
            if (targetIds.has(f.a)) visible.add(f.b);
            if (targetIds.has(f.b)) visible.add(f.a);
        }
        this.visibleNodeIds = visible;
        this.visibleEdgeFilter = (edge) =>
            targetIds.has(edge.a) || targetIds.has(edge.b);
    }

    _isNodeVisible(id) {
        if (this.hiddenEntityIds.has(id)) return false;
        if (this.visibleNodeIds && !this.visibleNodeIds.has(id)) return false;
        return true;
    }

    _isEdgeVisible(e) {
        if (this.hiddenRelationIds.has(e.relationId)) return false;
        if (this.visibleEdgeFilter && !this.visibleEdgeFilter(e)) return false;
        if (!this._isNodeVisible(e.a) || !this._isNodeVisible(e.b)) return false;
        return true;
    }

    _applyLayout() {
        const ids = [...this.nodes.keys()].filter(id => this._isNodeVisible(id));
        if (!ids.length) return;
        if (this.layout === 'circular') {
            const cx = this.width / 2;
            const cy = this.height / 2;
            const R = Math.max(60, Math.min(this.width, this.height) / 2 - 60);
            ids.forEach((id, i) => {
                const n = this.nodes.get(id);
                const t = (i / ids.length) * Math.PI * 2 - Math.PI / 2;
                n.x = cx + Math.cos(t) * R;
                n.y = cy + Math.sin(t) * R;
                n.vx = 0; n.vy = 0;
            });
        } else if (this.layout === 'grid') {
            const cols = Math.max(1, Math.ceil(Math.sqrt(ids.length)));
            const rows = Math.ceil(ids.length / cols);
            const cellW = this.width / (cols + 1);
            const cellH = this.height / (rows + 1);
            ids.forEach((id, i) => {
                const n = this.nodes.get(id);
                const c = i % cols;
                const r = Math.floor(i / cols);
                n.x = (c + 1) * cellW;
                n.y = (r + 1) * cellH;
                n.vx = 0; n.vy = 0;
            });
        }
    }

    setLayout(mode) {
        this.layout = mode;
        if (mode !== 'force') this._applyLayout();
    }
    setColorBy(mode) { this.colorBy = mode; }
    setSizeBy(mode) { this.sizeBy = mode; }
    setQuery(q) {
        this.query = q;
        this._applyQuery();
        this._computeMetrics();
        if (this.layout !== 'force') this._applyLayout();
    }
    setHiddenEntities(set) {
        this.hiddenEntityIds = set instanceof Set ? set : new Set(set);
        this._computeMetrics();
        if (this.layout !== 'force') this._applyLayout();
    }
    setHiddenRelations(set) {
        this.hiddenRelationIds = set instanceof Set ? set : new Set(set);
        this._computeMetrics();
        if (this.layout !== 'force') this._applyLayout();
    }

    start() {
        if (this.running) return;
        this.running = true;
        const loop = () => {
            if (!this.running) return;
            this.step();
            this.render();
            requestAnimationFrame(loop);
        };
        requestAnimationFrame(loop);
    }

    stop() {
        this.running = false;
    }

    step() {
        if (this.layout !== 'force') return;
        const ids = [...this.nodes.keys()].filter(id => this._isNodeVisible(id));

        // Repulsion between all visible node pairs
        for (let i = 0; i < ids.length; i++) {
            const na = this.nodes.get(ids[i]);
            for (let j = i + 1; j < ids.length; j++) {
                const nb = this.nodes.get(ids[j]);
                let dx = nb.x - na.x;
                let dy = nb.y - na.y;
                let dist2 = dx * dx + dy * dy;
                if (dist2 < 1) {
                    dx = Math.random() - 0.5;
                    dy = Math.random() - 0.5;
                    dist2 = 1;
                }
                const dist = Math.sqrt(dist2);
                const force = REPULSION / dist2;
                const fx = (dx / dist) * force;
                const fy = (dy / dist) * force;
                na.vx -= fx;
                na.vy -= fy;
                nb.vx += fx;
                nb.vy += fy;
            }
        }

        // Spring attraction along visible edges
        for (const e of this.edges) {
            if (!this._isEdgeVisible(e)) continue;
            const na = this.nodes.get(e.a);
            const nb = this.nodes.get(e.b);
            if (!na || !nb) continue;
            const dx = nb.x - na.x;
            const dy = nb.y - na.y;
            const dist = Math.sqrt(dx * dx + dy * dy) || 0.01;
            const disp = dist - SPRING_LEN;
            const force = SPRING_K * disp;
            const fx = (dx / dist) * force;
            const fy = (dy / dist) * force;
            na.vx += fx;
            na.vy += fy;
            nb.vx -= fx;
            nb.vy -= fy;
        }

        // Weak pull toward center + integrate (only for visible nodes; hidden
        // nodes stay parked at their last position so they don't drift).
        const cx = this.width / 2;
        const cy = this.height / 2;
        for (const [id, n] of this.nodes) {
            if (!this._isNodeVisible(id)) {
                n.vx = 0;
                n.vy = 0;
                continue;
            }
            if (this.dragging === id) {
                n.vx = 0;
                n.vy = 0;
                continue;
            }
            n.vx += (cx - n.x) * CENTER_PULL;
            n.vy += (cy - n.y) * CENTER_PULL;
            n.vx *= DAMPING;
            n.vy *= DAMPING;
            n.x += n.vx;
            n.y += n.vy;
        }
    }

    render() {
        const ctx = this.ctx;
        ctx.clearRect(0, 0, this.width, this.height);

        const nodeVisible = (id) => {
            if (this.hiddenEntityIds.has(id)) return false;
            if (this.visibleNodeIds && !this.visibleNodeIds.has(id)) return false;
            return true;
        };

        // Edges
        ctx.font = '11px sans-serif';
        for (const e of this.edges) {
            if (this.hiddenRelationIds.has(e.relationId)) continue;
            if (this.visibleEdgeFilter && !this.visibleEdgeFilter(e)) continue;
            if (!nodeVisible(e.a) || !nodeVisible(e.b)) continue;
            const a = this.nodes.get(e.a);
            const b = this.nodes.get(e.b);
            if (!a || !b) continue;
            const edgeColor = this.colorBy === 'relation' ? relationColor(e.relationId) : '#888';
            const rA = this._nodeRadius(e.a);
            const rB = this._nodeRadius(e.b);
            this._drawArrow(a.x, a.y, b.x, b.y, rA, rB, edgeColor);
            const mx = (a.x + b.x) / 2;
            const my = (a.y + b.y) / 2;
            ctx.fillStyle = edgeColor;
            ctx.textAlign = 'center';
            ctx.fillText(e.label, mx, my - 4);
        }

        // Nodes
        for (const [id, n] of this.nodes) {
            if (!nodeVisible(id)) continue;
            const isHover = this.hover === id;
            const isPending = this.pendingSourceId === id;
            const r = this._nodeRadius(id);
            const fillBase = this._nodeFill(id);
            ctx.beginPath();
            ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
            ctx.fillStyle = isHover ? this._darken(fillBase) : fillBase;
            ctx.fill();
            ctx.strokeStyle = isPending ? '#ff9800' : '#fff';
            ctx.lineWidth = isPending ? 4 : 2;
            ctx.stroke();

            ctx.fillStyle = '#fff';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.font = '12px sans-serif';
            const name = getEntityName(id);
            ctx.fillText(this._truncate(name, 10), n.x, n.y);
        }
    }

    _nodeRadius(id) {
        if (this.sizeBy === 'degree') {
            const d = this.degree.get(id) ?? 0;
            return NODE_RADIUS + Math.min(20, d * 2);
        }
        if (this.sizeBy === 'centrality') {
            const c = this.closeness.get(id) ?? 0;
            return NODE_RADIUS + Math.min(20, c * 30);
        }
        return NODE_RADIUS;
    }

    _nodeFill(id) {
        if (this.colorBy === 'class') {
            const ent = this.entityInfo.get(id);
            if (ent && ent.classIds && ent.classIds.length) {
                return classColor(ent.classIds[0]);
            }
        }
        return '#0A0ACD';
    }

    _darken(color) {
        // For hsl(...) shift lightness down; fall back to a fixed dark blue.
        const m = /^hsl\((\d+),\s*(\d+)%,\s*(\d+)%\)$/.exec(color);
        if (m) return `hsl(${m[1]}, ${m[2]}%, ${Math.max(20, +m[3] - 15)}%)`;
        return '#000068';
    }

    _drawArrow(x1, y1, x2, y2, rA, rB, color) {
        const ctx = this.ctx;
        const dx = x2 - x1;
        const dy = y2 - y1;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const nx = dx / dist;
        const ny = dy / dist;
        const startR = rA ?? NODE_RADIUS;
        const endR = rB ?? NODE_RADIUS;
        const sx = x1 + nx * startR;
        const sy = y1 + ny * startR;
        const ex = x2 - nx * endR;
        const ey = y2 - ny * endR;

        ctx.strokeStyle = color || '#888';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(ex, ey);
        ctx.stroke();

        const ah = 8;
        const angle = Math.atan2(ny, nx);
        ctx.beginPath();
        ctx.moveTo(ex, ey);
        ctx.lineTo(
            ex - ah * Math.cos(angle - Math.PI / 6),
            ey - ah * Math.sin(angle - Math.PI / 6)
        );
        ctx.lineTo(
            ex - ah * Math.cos(angle + Math.PI / 6),
            ey - ah * Math.sin(angle + Math.PI / 6)
        );
        ctx.closePath();
        ctx.fillStyle = color || '#888';
        ctx.fill();
    }

    _truncate(s, n) {
        return s.length > n ? s.slice(0, n - 1) + '…' : s;
    }

    _nodeAt(x, y) {
        for (const [id, n] of this.nodes) {
            if (this.hiddenEntityIds.has(id)) continue;
            if (this.visibleNodeIds && !this.visibleNodeIds.has(id)) continue;
            const dx = n.x - x;
            const dy = n.y - y;
            const r = this._nodeRadius(id);
            if (dx * dx + dy * dy <= r * r) return id;
        }
        return null;
    }

    _relativePos(e) {
        const rect = this.canvas.getBoundingClientRect();
        return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    }

    _onMouseDown(e) {
        const { x, y } = this._relativePos(e);
        this._downX = x;
        this._downY = y;
        this._wasDragged = false;
        this.dragging = this._nodeAt(x, y);
    }

    _onMouseMove(e) {
        const { x, y } = this._relativePos(e);
        if (this.dragging) {
            const n = this.nodes.get(this.dragging);
            if (n) {
                n.x = x;
                n.y = y;
                n.vx = 0;
                n.vy = 0;
            }
            if (Math.hypot(x - this._downX, y - this._downY) > 3) {
                this._wasDragged = true;
            }
        } else {
            this.hover = this._nodeAt(x, y);
            this.canvas.style.cursor = this.hover ? 'pointer' : 'default';
        }
    }

    _onClick(e) {
        if (this._wasDragged) return;
        const { x, y } = this._relativePos(e);
        const id = this._nodeAt(x, y);
        if (id) this.onNodeClick?.(id, x, y);
        else this.onBackgroundClick?.(x, y);
    }

    setPendingSource(id) {
        this.pendingSourceId = id;
    }
    clearPendingSource() {
        this.pendingSourceId = null;
    }
}
