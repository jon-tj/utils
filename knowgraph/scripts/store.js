// Knowgraph data store — persists to localStorage.
//
// Data model:
//   classes:   { id, name,
//                parentClassIds: string[],
//                relations: { relationId, required: boolean }[] }
//   relations: { id, name,
//                aType: { kind: 'entity'|'date'|'number'|'boolean'|'enum',
//                         classId?: string, options?: string[] },
//                bType: same as aType,
//                transitive?: boolean, bidirectional?: boolean,
//                maxOutgoing?: number, maxIncoming?: number }
//                (max* only meaningful for entity↔entity relations; both
//                default to 1, clamped 1..10; only BASE facts count.)
//   entities:  { id, name, classIds: string[] }
//   facts:     { id, relationId, a: any, b: any,
//                derived?: boolean, derivedFrom?: string[] }
//              Derived facts are generated from base facts by relation
//              properties (transitive/bidirectional). They must not be edited
//              or deleted directly; they are regenerated per-relation on demand.

const STORAGE_KEY = 'knowgraph:v1';

const EMPTY = { classes: [], relations: [], entities: [], facts: [] };

export function uid() {
    return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

function clampSlot(n) {
    n = Math.floor(Number(n));
    if (!Number.isFinite(n) || n < 0) return 0;
    if (n > 10) return 10;
    return n;
}

function migrate(parsed) {
    const s = { ...structuredClone(EMPTY), ...parsed };
    for (const c of s.classes) {
        if (!Array.isArray(c.parentClassIds)) c.parentClassIds = [];
        if (!Array.isArray(c.relations)) {
            const legacy = Array.isArray(c.requiredRelationIds) ? c.requiredRelationIds : [];
            c.relations = legacy.map(rid => ({ relationId: rid, required: true }));
        }
        delete c.requiredRelationIds;
    }
    for (const r of s.relations) {
        if (typeof r.transitive !== 'boolean') r.transitive = false;
        if (typeof r.bidirectional !== 'boolean') r.bidirectional = false;
        if (typeof r.maxOutgoing !== 'number') r.maxOutgoing = 1;
        if (typeof r.maxIncoming !== 'number') r.maxIncoming = 1;
        r.maxOutgoing = clampSlot(r.maxOutgoing);
        r.maxIncoming = clampSlot(r.maxIncoming);
    }
    for (const f of s.facts) {
        if (f.derived && !Array.isArray(f.derivedFrom)) f.derivedFrom = [];
    }
    return s;
}

function loadRaw() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return structuredClone(EMPTY);
        return migrate(JSON.parse(raw));
    } catch (e) {
        console.error('Failed to load knowgraph data:', e);
        return structuredClone(EMPTY);
    }
}

let state = loadRaw();
const listeners = new Set();

function persist() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    for (const fn of listeners) fn(state);
}

export function subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
}

export function getState() {
    return state;
}

export function replaceAll(next) {
    state = migrate(next);
    rebuildAllRelations();
    persist();
}

// --- Classes ---
export function addClass(name) {
    const c = { id: uid(), name: name.trim(), parentClassIds: [], relations: [] };
    state.classes.push(c);
    persist();
    return c;
}
export function updateClass(id, patch) {
    const c = state.classes.find(x => x.id === id);
    if (!c) return;
    if (patch.parentClassIds) {
        // Filter self and cycles
        patch = {
            ...patch,
            parentClassIds: patch.parentClassIds.filter(pid =>
                pid !== id && !isAncestor(id, pid)
            ),
        };
    }
    Object.assign(c, patch);
    persist();
}
export function deleteClass(id) {
    state.classes = state.classes.filter(c => c.id !== id);
    for (const e of state.entities) {
        e.classIds = e.classIds.filter(cid => cid !== id);
    }
    for (const c of state.classes) {
        c.parentClassIds = c.parentClassIds.filter(pid => pid !== id);
    }
    for (const r of state.relations) {
        if (r.aType.classId === id) delete r.aType.classId;
        if (r.bType.classId === id) delete r.bType.classId;
    }
    persist();
}

// --- Relations ---
export function addRelation(name, aType, bType, opts = {}) {
    const r = {
        id: uid(),
        name: name.trim(),
        aType,
        bType,
        transitive: !!opts.transitive,
        bidirectional: !!opts.bidirectional,
        maxOutgoing: clampSlot(opts.maxOutgoing ?? 1),
        maxIncoming: clampSlot(opts.maxIncoming ?? 1),
    };
    state.relations.push(r);
    rebuildRelation(r.id);
    persist();
    return r;
}
export function updateRelation(id, patch) {
    const r = state.relations.find(x => x.id === id);
    if (!r) return;
    if ('maxOutgoing' in patch) patch.maxOutgoing = clampSlot(patch.maxOutgoing);
    if ('maxIncoming' in patch) patch.maxIncoming = clampSlot(patch.maxIncoming);
    const affects =
        ('transitive' in patch && !!patch.transitive !== !!r.transitive) ||
        ('bidirectional' in patch && !!patch.bidirectional !== !!r.bidirectional) ||
        ('aType' in patch) ||
        ('bType' in patch);
    Object.assign(r, patch);
    if (affects) rebuildRelation(id);
    persist();
}
export function deleteRelation(id) {
    state.relations = state.relations.filter(r => r.id !== id);
    state.facts = state.facts.filter(f => f.relationId !== id);
    for (const c of state.classes) {
        c.relations = c.relations.filter(rr => rr.relationId !== id);
    }
    persist();
}

// --- Entities ---
export function addEntity(name, classIds = []) {
    const e = { id: uid(), name: name.trim(), classIds: [...classIds] };
    state.entities.push(e);
    persist();
    return e;
}
export function updateEntity(id, patch) {
    const e = state.entities.find(x => x.id === id);
    if (!e) return;
    Object.assign(e, patch);
    persist();
}
export function deleteEntity(id) {
    state.entities = state.entities.filter(e => e.id !== id);
    // Collect which relations lose base facts so we can rebuild only those.
    const touchedRelIds = new Set();
    state.facts = state.facts.filter(f => {
        const r = state.relations.find(rel => rel.id === f.relationId);
        if (!r) return false;
        const refs = (r.aType.kind === 'entity' && f.a === id)
            || (r.bType.kind === 'entity' && f.b === id);
        if (refs) {
            touchedRelIds.add(f.relationId);
            return false;
        }
        return true;
    });
    for (const rid of touchedRelIds) rebuildRelation(rid);
    persist();
}

// --- Facts ---
export function addFact(relationId, a, b) {
    const f = { id: uid(), relationId, a, b };
    state.facts.push(f);
    rebuildRelation(relationId);
    persist();
    return f;
}
export function updateFact(id, patch) {
    const f = state.facts.find(x => x.id === id);
    if (!f) return;
    if (f.derived) return; // derived facts are read-only
    Object.assign(f, patch);
    rebuildRelation(f.relationId);
    persist();
}
export function deleteFact(id) {
    const f = state.facts.find(x => x.id === id);
    if (!f) return;
    if (f.derived) return; // derived facts can only be removed by rebuild
    const rid = f.relationId;
    state.facts = state.facts.filter(x => x.id !== id);
    rebuildRelation(rid);
    persist();
}

// --- Lookups ---
export function getEntityName(id) {
    return state.entities.find(e => e.id === id)?.name ?? '(missing)';
}
export function getClassName(id) {
    return state.classes.find(c => c.id === id)?.name ?? '(missing)';
}
export function getRelation(id) {
    return state.relations.find(r => r.id === id);
}
export function getClass(id) {
    return state.classes.find(c => c.id === id);
}

// --- Inheritance helpers ---

// All ancestors of classId (excluding self). Cycle-safe.
export function getAncestorClassIds(classId) {
    const out = new Set();
    const stack = [classId];
    const seen = new Set([classId]);
    while (stack.length) {
        const cur = stack.pop();
        const c = getClass(cur);
        if (!c) continue;
        for (const pid of c.parentClassIds) {
            if (seen.has(pid)) continue;
            seen.add(pid);
            out.add(pid);
            stack.push(pid);
        }
    }
    return [...out];
}

// True if `ancestorId` is (transitively) an ancestor of `descendantId`.
export function isAncestor(ancestorId, descendantId) {
    return getAncestorClassIds(descendantId).includes(ancestorId);
}

// All class ids an entity effectively belongs to (declared + ancestors).
export function getEntityEffectiveClassIds(entity) {
    const out = new Set(entity.classIds);
    for (const cid of entity.classIds) {
        for (const a of getAncestorClassIds(cid)) out.add(a);
    }
    return [...out];
}

// True if the entity is (directly or via inheritance) of the given class.
export function entityMatchesClass(entity, classId) {
    return getEntityEffectiveClassIds(entity).includes(classId);
}

// The full set of relations a class has, including inherited ones.
// Returns [{ relationId, required, inheritedFrom: classId | null }]
// If the same relation appears multiple times, `required` is true if any is required.
// `inheritedFrom` is null when defined on the class itself, else the ancestor classId.
export function getEffectiveClassRelations(classId) {
    const merged = new Map();
    const visitedClasses = new Set();

    const visit = (cid, inheritedFrom) => {
        if (visitedClasses.has(cid)) return;
        visitedClasses.add(cid);
        const c = getClass(cid);
        if (!c) return;
        for (const rr of c.relations) {
            const prev = merged.get(rr.relationId);
            if (!prev) {
                merged.set(rr.relationId, {
                    relationId: rr.relationId,
                    required: !!rr.required,
                    inheritedFrom,
                });
            } else {
                if (rr.required) prev.required = true;
                if (inheritedFrom === null) prev.inheritedFrom = null;
            }
        }
        for (const pid of c.parentClassIds) {
            visit(pid, inheritedFrom ?? pid);
        }
    };
    visit(classId, null);
    return [...merged.values()];
}

// --- Derived facts ---

// Whether a relation can support transitive / bidirectional derivation.
// Only entity->entity relations qualify; for bidirectional we also need
// compatible types on both sides (same classId, or both any).
export function canBeTransitive(rel) {
    return !!rel && rel.aType.kind === 'entity' && rel.bType.kind === 'entity';
}
export function canBeBidirectional(rel) {
    if (!canBeTransitive(rel)) return false;
    const ac = rel.aType.classId ?? null;
    const bc = rel.bType.classId ?? null;
    return ac === bc;
}

// Slot bookkeeping — only base facts count against caps.
export function outgoingBaseCount(relationId, entityId) {
    let n = 0;
    for (const f of state.facts) {
        if (f.relationId === relationId && !f.derived && f.a === entityId) n++;
    }
    return n;
}
export function incomingBaseCount(relationId, entityId) {
    let n = 0;
    for (const f of state.facts) {
        if (f.relationId === relationId && !f.derived && f.b === entityId) n++;
    }
    return n;
}

// Regenerate ALL derived facts for a single relation. Base facts are
// untouched. Cheap when nothing needs regenerating.
function rebuildRelation(relationId) {
    const rel = state.relations.find(r => r.id === relationId);
    // Always drop derived facts of this relation up front.
    state.facts = state.facts.filter(
        f => !(f.relationId === relationId && f.derived),
    );
    if (!rel) return;
    if (!rel.transitive && !rel.bidirectional) return;
    if (rel.aType.kind !== 'entity' || rel.bType.kind !== 'entity') return;

    const base = state.facts.filter(f => f.relationId === relationId && !f.derived);
    if (!base.length) return;

    // Edge map keyed by "a|b" -> { a, b, from: Set<factId>, derived }
    const edges = new Map();
    const put = (a, b, fromIds, derived) => {
        if (a === b) return; // skip self loops
        const key = `${a}|${b}`;
        const cur = edges.get(key);
        if (!cur) {
            edges.set(key, { a, b, from: new Set(fromIds), derived });
        } else {
            for (const id of fromIds) cur.from.add(id);
            if (!derived) cur.derived = false; // an existing base edge wins
        }
    };
    for (const f of base) put(f.a, f.b, [f.id], false);
    if (rel.bidirectional) {
        for (const f of base) put(f.b, f.a, [f.id], true);
    }
    if (rel.transitive) {
        // Iterate to a fixed point. Small graphs -> fine to be naive.
        let changed = true;
        while (changed) {
            changed = false;
            const arr = [...edges.values()];
            for (const e1 of arr) {
                for (const e2 of arr) {
                    if (e1.b !== e2.a) continue;
                    if (e1.a === e2.b) continue;
                    const key = `${e1.a}|${e2.b}`;
                    if (!edges.has(key)) {
                        edges.set(key, {
                            a: e1.a,
                            b: e2.b,
                            from: new Set([...e1.from, ...e2.from]),
                            derived: true,
                        });
                        changed = true;
                    }
                }
            }
        }
    }

    for (const e of edges.values()) {
        if (!e.derived) continue;
        state.facts.push({
            id: uid(),
            relationId,
            a: e.a,
            b: e.b,
            derived: true,
            derivedFrom: [...e.from],
        });
    }
}

// One-shot rebuild for all relations (used after replaceAll import).
function rebuildAllRelations() {
    for (const r of state.relations) rebuildRelation(r.id);
}

// Ensure derived facts exist on load (in case data was hand-edited).
rebuildAllRelations();

