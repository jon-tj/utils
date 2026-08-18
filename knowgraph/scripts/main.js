import * as store from './store.js';
import { GraphView } from './graph.js';

// ---------- Tab switching ----------

const tabButtons = document.querySelectorAll('.sidebar [data-tab-btn]');
const tabPanels = document.querySelectorAll('.main .tab');

let activeTab = 'graph';

function setTab(name) {
    activeTab = name;
    for (const btn of tabButtons) {
        const on = btn.dataset.tabBtn === name;
        btn.classList.toggle('transparent', !on);
        btn.disabled = on;
    }
    for (const panel of tabPanels) {
        panel.hidden = panel.dataset.tab !== name;
    }
    if (name === 'graph') {
        graph.resize();
        graph.sync();
        graph.start();
    } else {
        graph.stop();
    }
    render();
}

for (const btn of tabButtons) {
    btn.addEventListener('click', () => setTab(btn.dataset.tabBtn));
}

// Navigate to the Relations tab and highlight the given relation row.
function focusRelation(relationId) {
    setTab('relations');
    requestAnimationFrame(() => {
        const row = document.getElementById(`relation-${relationId}`);
        if (!row) return;
        row.scrollIntoView({ behavior: 'smooth', block: 'center' });
        row.classList.add('kg-highlight');
        setTimeout(() => row.classList.remove('kg-highlight'), 1600);
    });
}

// Navigate to the Entities tab and highlight the specific fact row.
function focusFact(factId) {
    setTab('entities');
    requestAnimationFrame(() => {
        const row = document.getElementById(`fact-${factId}`);
        if (!row) return;
        row.scrollIntoView({ behavior: 'smooth', block: 'center' });
        row.classList.add('kg-highlight');
        setTimeout(() => row.classList.remove('kg-highlight'), 1600);
    });
}

// ---------- Graph ----------

const canvas = document.querySelector('section[data-tab="graph"] canvas');
const graph = new GraphView(canvas);

graph.onBackgroundClick = () => {
    if (graph.pendingSourceId) {
        const sourceId = graph.pendingSourceId;
        graph.clearPendingSource();
        hideEntityInfo();
        openGraphModal({
            title: 'New entity + relation',
            needsEntity: true,
            needsRelation: true,
            sourceId,
            targetId: null,
        });
    } else {
        openGraphModal({
            title: 'New entity',
            needsEntity: true,
            needsRelation: false,
        });
    }
};
graph.onNodeClick = (id) => {
    // Clicking the currently-selected node deselects it.
    if (graph.pendingSourceId === id) {
        graph.clearPendingSource();
        hideEntityInfo();
        return;
    }
    // Clicking a different node while one is selected opens the fact modal.
    if (graph.pendingSourceId) {
        const sourceId = graph.pendingSourceId;
        graph.clearPendingSource();
        hideEntityInfo();
        openGraphModal({
            title: 'New relation',
            needsEntity: false,
            needsRelation: true,
            sourceId,
            targetId: id,
        });
        return;
    }
    // No selection yet: select this entity.
    graph.setPendingSource(id);
    showEntityInfo(id);
};

// Graph toolbar controls.
const graphLayoutSel = document.getElementById('graph-layout');
const graphColorSel = document.getElementById('graph-color');
const graphSizeSel = document.getElementById('graph-size');
const graphQueryInput = document.getElementById('graph-query');
if (graphLayoutSel) {
    graph.setLayout(graphLayoutSel.value);
    graphLayoutSel.addEventListener('change', () => graph.setLayout(graphLayoutSel.value));
}
if (graphColorSel) {
    graph.setColorBy(graphColorSel.value);
    graphColorSel.addEventListener('change', () => graph.setColorBy(graphColorSel.value));
}
if (graphSizeSel) {
    graph.setSizeBy(graphSizeSel.value);
    graphSizeSel.addEventListener('change', () => graph.setSizeBy(graphSizeSel.value));
}
if (graphQueryInput) {
    graph.setQuery(graphQueryInput.value);
    graphQueryInput.addEventListener('input', () => graph.setQuery(graphQueryInput.value));
}

// ---------- Rendering ----------

function render() {
    if (activeTab === 'entities') renderEntities();
    else if (activeTab === 'classes') renderClasses();
    else if (activeTab === 'relations') renderRelations();
    else if (activeTab === 'table') renderTable();
    if (activeTab === 'graph') graph.sync();
}

store.subscribe(() => render());

// ---------- Helpers ----------

function el(tag, attrs = {}, children = []) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
        if (k === 'class') node.className = v;
        else if (k === 'style') Object.assign(node.style, v);
        else if (k.startsWith('on') && typeof v === 'function') {
            node.addEventListener(k.slice(2).toLowerCase(), v);
        } else if (v === true) node.setAttribute(k, '');
        else if (v === false || v == null) { /* skip */ }
        else node.setAttribute(k, v);
    }
    for (const child of [].concat(children)) {
        if (child == null) continue;
        node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
    }
    return node;
}

function clear(container) {
    while (container.firstChild) container.removeChild(container.firstChild);
}

function formatType(t) {
    if (t.kind === 'entity') {
        return t.classId ? `Entity: ${store.getClassName(t.classId)}` : 'Entity (any)';
    }
    if (t.kind === 'enum') {
        return `one of: ${(t.options ?? []).join(', ') || '(no options)'}`;
    }
    return t.kind;
}

function formatValue(kind, value) {
    if (value === undefined || value === null || value === '') return '';
    if (kind === 'entity') return store.getEntityName(value);
    if (kind === 'boolean') return value ? 'true' : 'false';
    return String(value);
}

// ---------- Entities tab ----------

const entitiesRoot = document.getElementById('main__entities');

function renderEntities() {
    const { entities, classes } = store.getState();
    clear(entitiesRoot);

    entitiesRoot.appendChild(el('h2', {}, 'Entities'));

    const nameInput = el('input', { type: 'text', placeholder: 'Entity name', required: true });
    const pendingClassIds = new Set();
    const classChecks = el('ul', { class: 'kg-facts' });
    for (const c of classes) {
        const cb = el('input', { type: 'checkbox' });
        cb.addEventListener('change', () => {
            if (cb.checked) pendingClassIds.add(c.id);
            else pendingClassIds.delete(c.id);
        });
        classChecks.appendChild(el('li', {}, [el('label', {}, [cb, ' ', c.name])]));
    }
    if (!classes.length) {
        classChecks.appendChild(el('li', { class: 'muted' }, 'No classes defined.'));
    }
    entitiesRoot.appendChild(el('form', {
        class: 'kg-form',
        onSubmit: (e) => {
            e.preventDefault();
            if (!nameInput.value.trim()) return;
            store.addEntity(nameInput.value, [...pendingClassIds]);
            nameInput.value = '';
            pendingClassIds.clear();
        },
    }, [
        el('div', { class: 'flex-col' }, [
            el('label', {}, 'Name'),
            nameInput,
            el('label', {}, 'Classes'),
            classChecks,
            el('button', { class: 'primary', type: 'submit' }, 'Add entity'),
        ]),
    ]));

    const list = el('div', { class: 'kg-list' });
    for (const e of entities) list.appendChild(renderEntityRow(e));
    if (!entities.length) list.appendChild(el('p', { class: 'muted' }, 'No entities yet.'));
    entitiesRoot.appendChild(list);
}

function renderEntityRow(e) {
    const { classes, relations, facts } = store.getState();
    const nameInput = el('input', { type: 'text', value: e.name });

    const classList = el('ul', { class: 'kg-facts' });
    for (const c of classes) {
        const cb = el('input', {
            type: 'checkbox',
            checked: e.classIds.includes(c.id) || undefined,
        });
        cb.addEventListener('change', () => {
            const set = new Set(e.classIds);
            if (cb.checked) set.add(c.id);
            else set.delete(c.id);
            store.updateEntity(e.id, { classIds: [...set] });
        });
        classList.appendChild(el('li', {}, [el('label', {}, [cb, ' ', c.name])]));
    }
    if (!classes.length) {
        classList.appendChild(el('li', { class: 'muted' }, 'No classes defined.'));
    }

    return el('div', { class: 'kg-row' }, [
        el('div', { class: 'flex-row' }, [
            nameInput,
            el('button', {
                class: 'primary transparent',
                onClick: () => {
                    store.updateEntity(e.id, { name: nameInput.value.trim() });
                },
            }, 'Save name'),
            el('button', {
                class: 'primary transparent',
                onClick: () => {
                    if (confirm(`Delete entity "${e.name}"?`)) store.deleteEntity(e.id);
                },
            }, 'Delete'),
        ]),
        el('div', { class: 'flex-col' }, [
            el('label', { class: 'muted' }, 'Classes'),
            classList,
        ]),
        renderEntityFacts(e, relations, facts),
    ]);
}

function renderEntityFacts(entity, relations, facts) {
    const { entities } = store.getState();

    // Effective relations from all classes the entity belongs to (with inheritance).
    // required = true if any class contributes it as required.
    const effective = new Map(); // relationId -> { relationId, required }
    for (const cid of entity.classIds) {
        for (const eff of store.getEffectiveClassRelations(cid)) {
            const prev = effective.get(eff.relationId);
            if (!prev) effective.set(eff.relationId, { relationId: eff.relationId, required: !!eff.required });
            else if (eff.required) prev.required = true;
        }
    }

    // Only relations whose A-side accepts this entity make sense here.
    const classRelations = [...effective.values()]
        .map(x => ({ ...x, rel: relations.find(r => r.id === x.relationId) }))
        .filter(x => x.rel && x.rel.aType.kind === 'entity'
            && (!x.rel.aType.classId || store.entityMatchesClass(entity, x.rel.aType.classId)));
    // Required first
    classRelations.sort((a, b) => Number(b.required) - Number(a.required));

    const derivedBadge = (f) => {
        if (!f?.derived) return null;
        const sources = (f.derivedFrom ?? [])
            .map(id => facts.find(x => x.id === id))
            .filter(Boolean);
        const rel = relations.find(r => r.id === f.relationId);
        const desc = sources.length
            ? sources.map(s => `${formatValue(rel?.aType.kind, s.a)} → ${formatValue(rel?.bType.kind, s.b)}`).join(', ')
            : rel?.name ?? '?';
        const firstSource = sources[0];
        return el('button', {
            type: 'button',
            class: 'kg-derived-link',
            title: firstSource
                ? `derived from: ${desc}. Click to jump to source fact.`
                : `derived from: ${desc}`,
            onClick: () => {
                if (firstSource) focusFact(firstSource.id);
                else focusRelation(f.relationId);
            },
        }, ' (derived)');
    };

    const classRelList = el('ul', { class: 'kg-facts' });
    // Build a filtered B-side entity <select>. For entity kinds we restrict to
    // entities that (a) satisfy the class constraint, (b) are not `entity` itself
    // (no self loops), (c) are not already used as B for this entity/relation
    // (unless they are the currently-selected value in this slot), and (d) still
    // have incoming slot capacity left on this relation.
    const buildEntityBSelect = (rel, currentValue, excludeAsUsed) => {
        const sel = document.createElement('select');
        sel.appendChild(new Option('— entity —', ''));
        const maxIn = rel.maxIncoming ?? 1;
        const incomingCapped = maxIn > 0;
        for (const en of entities) {
            if (en.id === entity.id) continue;
            if (rel.bType.classId && !store.entityMatchesClass(en, rel.bType.classId)) continue;
            const isCurrent = currentValue === en.id;
            if (excludeAsUsed.has(en.id) && !isCurrent) continue;
            if (incomingCapped) {
                const incoming = store.incomingBaseCount(rel.id, en.id);
                // Current value already uses a slot; keep it selectable.
                if (incoming >= maxIn && !isCurrent) continue;
            }
            const opt = new Option(en.name, en.id);
            if (isCurrent) opt.selected = true;
            sel.appendChild(opt);
        }
        return sel;
    };

    // Render class relations, supporting multiple slots for entity->entity.
    for (const { rel, required } of classRelations) {
        const isEntityB = rel.bType.kind === 'entity';
        const baseFacts = facts.filter(f =>
            f.relationId === rel.id && !f.derived && f.a === entity.id
        );
        const derivedForRel = facts.filter(f =>
            f.relationId === rel.id && f.derived && f.a === entity.id
        );
        const label = (extra) => el('span', { class: required ? '' : 'muted' }, [
            required ? '★ ' : '',
            rel.name,
            ` (${formatType(rel.bType)})${extra ? ' ' + extra : ''}: `,
        ]);

        if (isEntityB) {
            // Multi-slot: one <li> per existing base fact + one empty add-slot.
            const maxOut = rel.maxOutgoing ?? 1;
            const usedBIds = new Set(baseFacts.map(f => f.b));

            baseFacts.forEach((f, idx) => {
                const sel = buildEntityBSelect(rel, f.b, usedBIds);
                sel.addEventListener('change', () => {
                    if (!sel.value) store.deleteFact(f.id);
                    else store.updateFact(f.id, { b: sel.value });
                });
                classRelList.appendChild(el('li', { id: `fact-${f.id}` }, [
                    label(baseFacts.length > 1 ? `#${idx + 1}` : ''),
                    sel,
                    el('button', {
                        class: 'primary transparent',
                        onClick: () => store.deleteFact(f.id),
                    }, '×'),
                ]));
            });

            // Derived (read-only) entries — separate rows.
            for (const f of derivedForRel) {
                classRelList.appendChild(el('li', { id: `fact-${f.id}` }, [
                    label('(inferred)'),
                    el('strong', {}, formatValue(rel.bType.kind, f.b)),
                    derivedBadge(f),
                ]));
            }

            // Empty add-slot if there's remaining capacity (max=0 means unlimited).
            if (maxOut === 0 || baseFacts.length < maxOut) {
                const sel = buildEntityBSelect(rel, null, usedBIds);
                sel.addEventListener('change', () => {
                    if (!sel.value) return;
                    store.addFact(rel.id, entity.id, sel.value);
                });
                const remaining = maxOut - baseFacts.length;
                const hint = maxOut === 0
                    ? '(add \u2014 unlimited)'
                    : `(add \u2014 ${remaining} slot${remaining === 1 ? '' : 's'} left)`;
                classRelList.appendChild(el('li', {}, [
                    label(hint),
                    sel,
                ]));
            }
            continue;
        }

        // Non-entity B: single fact, existing behaviour.
        const existing = baseFacts[0] || derivedForRel[0];
        if (existing?.derived) {
            classRelList.appendChild(el('li', { id: `fact-${existing.id}` }, [
                label(''),
                el('strong', {}, formatValue(rel.bType.kind, existing.b)),
                derivedBadge(existing),
            ]));
            continue;
        }
        const input = createBValueInput(rel.bType, entities, existing?.b);
        const commit = () => {
            const val = input.getValue();
            const existingFact = baseFacts[0];
            if (existingFact?.derived) return;
            if (val === null || val === '') {
                if (existingFact) store.deleteFact(existingFact.id);
                return;
            }
            if (existingFact) store.updateFact(existingFact.id, { b: val });
            else store.addFact(rel.id, entity.id, val);
        };
        input.el.addEventListener('change', commit);
        classRelList.appendChild(el('li', existing ? { id: `fact-${existing.id}` } : {}, [
            label(''),
            input.el,
        ]));
    }
    if (!classRelations.length && !facts.some(f => {
        const r = relations.find(rr => rr.id === f.relationId);
        return r && r.aType.kind === 'entity' && f.a === entity.id;
    })) {
        classRelList.appendChild(el('li', { class: 'muted' }, 'No facts yet.'));
    }

    // Any other facts (not from effective class relations) — appended to the
    // same list so class relations stay at the top.
    const classRelIds = new Set(classRelations.map(x => x.rel.id));
    const otherFacts = facts.filter(f => {
        const r = relations.find(rr => rr.id === f.relationId);
        return r && r.aType.kind === 'entity' && f.a === entity.id && !classRelIds.has(f.relationId);
    });
    for (const f of otherFacts) {
        const r = relations.find(rr => rr.id === f.relationId);
        if (f.derived) {
            classRelList.appendChild(el('li', { id: `fact-${f.id}` }, [
                el('span', { class: 'muted' }, `${r?.name ?? '?'} (${formatType(r?.bType)}): `),
                el('strong', {}, formatValue(r?.bType.kind, f.b)),
                derivedBadge(f),
            ]));
        } else {
            classRelList.appendChild(el('li', { id: `fact-${f.id}` }, [
                el('span', { class: 'muted' }, `${r?.name ?? '?'} (${formatType(r?.bType)}): `),
                el('strong', {}, formatValue(r?.bType.kind, f.b)),
                r?.locked ? null : el('button', {
                    class: 'primary transparent',
                    onClick: () => store.deleteFact(f.id),
                }, '×'),
            ].filter(Boolean)));
        }
    }

    // Add-fact controls: only offer relations where this entity still has outgoing
    // capacity (for entity->entity relations); non-entity-B relations aren't
    // slot-limited here (they use the class-relation section).
    const addable = relations.filter(r => {
        if (r.aType.kind !== 'entity') return false;
        if (r.aType.classId && !store.entityMatchesClass(entity, r.aType.classId)) return false;
        if (r.bType.kind === 'entity') {
            const maxOut = r.maxOutgoing ?? 1;
            if (maxOut > 0) {
                const out = store.outgoingBaseCount(r.id, entity.id);
                if (out >= maxOut) return false;
            }
        }
        return true;
    });
    const relSelect = el('select', {},
        [el('option', { value: '' }, '— pick relation —')]
            .concat(addable.map(r => el('option', { value: r.id },
                `${r.name} (${formatType(r.aType)} → ${formatType(r.bType)})`)))
    );
    const valueSlot = el('span', {});
    let currentInput = null;
    relSelect.addEventListener('change', () => {
        clear(valueSlot);
        currentInput = null;
        const rel = relations.find(r => r.id === relSelect.value);
        if (!rel) return;
        if (rel.bType.kind === 'entity') {
            const usedBIds = new Set(
                facts
                    .filter(f => f.relationId === rel.id && !f.derived && f.a === entity.id)
                    .map(f => f.b)
            );
            const sel = buildEntityBSelect(rel, null, usedBIds);
            currentInput = { el: sel, getValue: () => sel.value || null };
        } else {
            currentInput = createBValueInput(rel.bType, entities);
        }
        valueSlot.appendChild(currentInput.el);
    });
    const addBtn = el('button', {
        class: 'primary transparent',
        onClick: () => {
            const rel = relations.find(r => r.id === relSelect.value);
            if (!rel || !currentInput) return;
            const val = currentInput.getValue();
            if (val === null || val === '') return;
            store.addFact(rel.id, entity.id, val);
        },
    }, 'Add fact');

    return el('div', { class: 'flex-col' }, [
        classRelList,
        el('div', { class: 'flex-row' }, [relSelect, valueSlot, addBtn]),
    ]);
}

// Reusable B-side value input. Returns { el, getValue }.
function createBValueInput(bType, entities, current) {
    const kind = bType.kind;
    if (kind === 'entity') {
        const candidates = entities.filter(en =>
            !bType.classId || store.entityMatchesClass(en, bType.classId)
        );
        const sel = document.createElement('select');
        sel.appendChild(new Option('— entity —', ''));
        for (const en of candidates) {
            const opt = new Option(en.name, en.id);
            if (current === en.id) opt.selected = true;
            sel.appendChild(opt);
        }
        return { el: sel, getValue: () => sel.value || null };
    }
    if (kind === 'date') {
        const inp = document.createElement('input');
        inp.type = 'date';
        if (current) inp.value = current;
        return { el: inp, getValue: () => inp.value || null };
    }
    if (kind === 'number') {
        const inp = document.createElement('input');
        inp.type = 'number';
        inp.step = 'any';
        if (current !== undefined && current !== null && current !== '') inp.value = current;
        return { el: inp, getValue: () => inp.value === '' ? null : Number(inp.value) };
    }
    if (kind === 'boolean') {
        const sel = document.createElement('select');
        sel.appendChild(new Option('— pick —', ''));
        const t = new Option('true', 'true');
        const f = new Option('false', 'false');
        if (current === true) t.selected = true;
        if (current === false) f.selected = true;
        sel.appendChild(t);
        sel.appendChild(f);
        return { el: sel, getValue: () => sel.value === '' ? null : sel.value === 'true' };
    }
    if (kind === 'enum') {
        const sel = document.createElement('select');
        sel.appendChild(new Option('— pick —', ''));
        for (const o of bType.options ?? []) {
            const opt = new Option(o, o);
            if (current === o) opt.selected = true;
            sel.appendChild(opt);
        }
        return { el: sel, getValue: () => sel.value || null };
    }
    const span = document.createElement('span');
    span.textContent = '(unsupported kind)';
    return { el: span, getValue: () => null };
}

// ---------- Classes tab ----------

const classesRoot = document.getElementById('main__classes');

function renderClasses() {
    const { classes, relations } = store.getState();
    clear(classesRoot);
    classesRoot.appendChild(el('h2', {}, 'Classes'));

    const nameInput = el('input', { type: 'text', placeholder: 'Class name', required: true });
    classesRoot.appendChild(el('form', {
        class: 'kg-form',
        onSubmit: (e) => {
            e.preventDefault();
            if (!nameInput.value.trim()) return;
            store.addClass(nameInput.value);
            nameInput.value = '';
        },
    }, [
        el('div', { class: 'flex-row' }, [
            nameInput,
            el('button', { class: 'primary', type: 'submit' }, 'Add class'),
        ]),
    ]));

    const list = el('div', { class: 'kg-list' });
    for (const c of classes) list.appendChild(renderClassRow(c, relations));
    if (!classes.length) list.appendChild(el('p', { class: 'muted' }, 'No classes yet.'));
    classesRoot.appendChild(list);
}

function renderClassRow(c, allRelations) {
    const { classes } = store.getState();
    const nameInput = el('input', { type: 'text', value: c.name });

    // Parent classes (exclude self and descendants to prevent cycles)
    const invalidParents = new Set([c.id]);
    for (const other of classes) {
        if (store.isAncestor(c.id, other.id)) invalidParents.add(other.id);
    }
    const eligibleParents = classes.filter(pc => !invalidParents.has(pc.id));
    const parentList = el('ul', { class: 'kg-facts' });
    for (const pc of eligibleParents) {
        const cb = el('input', {
            type: 'checkbox',
            checked: c.parentClassIds.includes(pc.id) || undefined,
        });
        cb.addEventListener('change', () => {
            const set = new Set(c.parentClassIds);
            if (cb.checked) set.add(pc.id);
            else set.delete(pc.id);
            store.updateClass(c.id, { parentClassIds: [...set] });
        });
        parentList.appendChild(el('li', {}, [
            el('label', {}, [cb, ' ', pc.name]),
        ]));
    }
    if (!eligibleParents.length) {
        parentList.appendChild(el('li', { class: 'muted' }, 'No eligible parent classes.'));
    }

    // Own relations with required checkbox + remove button
    const ownRelationsList = el('ul', { class: 'kg-facts' });
    for (const rr of c.relations) {
        const rel = allRelations.find(r => r.id === rr.relationId);
        if (!rel) continue;
        const requiredCb = el('input', { type: 'checkbox', checked: rr.required || undefined });
        requiredCb.addEventListener('change', () => {
            const nextRels = c.relations.map(x =>
                x.relationId === rr.relationId
                    ? { ...x, required: requiredCb.checked }
                    : x
            );
            store.updateClass(c.id, { relations: nextRels });
        });
        const removeBtn = el('button', {
            class: 'primary transparent',
            onClick: () => {
                const nextRels = c.relations.filter(x => x.relationId !== rr.relationId);
                store.updateClass(c.id, { relations: nextRels });
            },
        }, '×');
        ownRelationsList.appendChild(el('li', {}, [
            el('label', {}, [requiredCb, ' required']),
            ` — ${rel.name} (${formatType(rel.aType)} → ${formatType(rel.bType)}) `,
            removeBtn,
        ]));
    }
    if (!c.relations.length) {
        ownRelationsList.appendChild(el('li', { class: 'muted' }, 'None.'));
    }

    // Add-relation control (only relations not already on the class)
    const alreadyIds = new Set(c.relations.map(rr => rr.relationId));
    const availableRelations = allRelations.filter(r => !alreadyIds.has(r.id));
    const addRelSelect = el('select', {},
        [el('option', { value: '' }, '— pick relation —')].concat(
            availableRelations.map(r => el('option', { value: r.id },
                `${r.name} (${formatType(r.aType)} → ${formatType(r.bType)})`))
        )
    );
    const addRequiredCb = el('input', { type: 'checkbox' });
    const addBtn = el('button', {
        class: 'primary transparent',
        onClick: () => {
            if (!addRelSelect.value) return;
            const nextRels = [...c.relations, {
                relationId: addRelSelect.value,
                required: addRequiredCb.checked,
            }];
            store.updateClass(c.id, { relations: nextRels });
        },
    }, 'Add');

    // Inherited relations (read-only, informational)
    const inheritedList = el('ul', { class: 'kg-facts' });
    const inherited = store.getEffectiveClassRelations(c.id)
        .filter(x => x.inheritedFrom !== null);
    for (const x of inherited) {
        const rel = allRelations.find(r => r.id === x.relationId);
        if (!rel) continue;
        inheritedList.appendChild(el('li', { class: 'muted' }, [
            `${x.required ? '★ required' : 'optional'} — ${rel.name} `,
            `(from ${store.getClassName(x.inheritedFrom)})`,
        ]));
    }
    if (!inherited.length) {
        inheritedList.appendChild(el('li', { class: 'muted' }, 'None.'));
    }

    return el('div', { class: 'kg-row' }, [
        el('div', { class: 'flex-row' }, [
            nameInput,
            el('button', {
                class: 'primary transparent',
                onClick: () => {
                    store.updateClass(c.id, { name: nameInput.value.trim() });
                },
            }, 'Save name'),
            el('button', {
                class: 'primary transparent',
                onClick: () => {
                    if (confirm(`Delete class "${c.name}"?`)) store.deleteClass(c.id);
                },
            }, 'Delete'),
        ]),
        el('div', { class: 'flex-col' }, [
            el('label', { class: 'muted' }, 'Parent classes (inherits from)'),
            parentList,
        ]),
        el('div', { class: 'flex-col' }, [
            el('label', { class: 'muted' }, 'Own relations'),
            ownRelationsList,
            el('div', { class: 'flex-row' }, [
                addRelSelect,
                el('label', {}, [addRequiredCb, ' required']),
                addBtn,
            ]),
        ]),
        el('div', { class: 'flex-col' }, [
            el('label', { class: 'muted' }, 'Inherited relations'),
            inheritedList,
        ]),
    ]);
}

// ---------- Relations tab ----------

const relationsRoot = document.getElementById('main__relations');

function renderRelations() {
    const { relations, classes } = store.getState();
    clear(relationsRoot);
    relationsRoot.appendChild(el('h2', {}, 'Relations'));

    const KINDS = ['entity', 'date', 'number', 'boolean', 'enum'];
    const nameInput = el('input', { type: 'text', placeholder: 'Relation name', required: true });
    const aKind = el('select', {}, KINDS.map(k => el('option', { value: k }, k)));
    const aClass = el('select', {}, [el('option', { value: '' }, '— any class —')].concat(
        classes.map(c => el('option', { value: c.id }, c.name))
    ));
    const aOptions = el('input', { type: 'text', placeholder: 'options (comma separated)' });
    const bKind = el('select', {}, KINDS.map(k => el('option', { value: k }, k)));
    const bClass = el('select', {}, [el('option', { value: '' }, '— any class —')].concat(
        classes.map(c => el('option', { value: c.id }, c.name))
    ));
    const bOptions = el('input', { type: 'text', placeholder: 'options (comma separated)' });

    const syncSideExtras = () => {
        aClass.hidden = aKind.value !== 'entity';
        bClass.hidden = bKind.value !== 'entity';
        aOptions.hidden = aKind.value !== 'enum';
        bOptions.hidden = bKind.value !== 'enum';
    };
    aKind.addEventListener('change', syncSideExtras);
    bKind.addEventListener('change', syncSideExtras);
    syncSideExtras();

    const parseOptions = (s) => s.split(',').map(x => x.trim()).filter(Boolean);

    const createTransitiveCb = el('input', { type: 'checkbox' });
    const createBidirectionalCb = el('input', { type: 'checkbox' });
    const createMaxOut = el('input', { type: 'number', min: '0', max: '10', value: '1' });
    const createMaxIn = el('input', { type: 'number', min: '0', max: '10', value: '1' });
    const syncPropAvailability = () => {
        const bothEntity = aKind.value === 'entity' && bKind.value === 'entity';
        const sameClass = (aClass.value || '') === (bClass.value || '');
        createTransitiveCb.disabled = !bothEntity;
        createBidirectionalCb.disabled = !(bothEntity && sameClass);
        createMaxOut.disabled = !bothEntity;
        createMaxIn.disabled = !bothEntity;
        if (createTransitiveCb.disabled) createTransitiveCb.checked = false;
        if (createBidirectionalCb.disabled) createBidirectionalCb.checked = false;
    };
    aKind.addEventListener('change', syncPropAvailability);
    bKind.addEventListener('change', syncPropAvailability);
    aClass.addEventListener('change', syncPropAvailability);
    bClass.addEventListener('change', syncPropAvailability);
    syncPropAvailability();

    const createDescInput = el('input', { type: 'text', placeholder: 'Description (optional)' });

    relationsRoot.appendChild(el('form', {
        class: 'kg-form',
        onSubmit: (e) => {
            e.preventDefault();
            if (!nameInput.value.trim()) return;
            const aType = { kind: aKind.value };
            if (aType.kind === 'entity' && aClass.value) aType.classId = aClass.value;
            if (aType.kind === 'enum') aType.options = parseOptions(aOptions.value);
            const bType = { kind: bKind.value };
            if (bType.kind === 'entity' && bClass.value) bType.classId = bClass.value;
            if (bType.kind === 'enum') bType.options = parseOptions(bOptions.value);
            if (aType.kind === 'enum' && !aType.options.length) {
                alert('Please provide at least one option for the A side.');
                return;
            }
            if (bType.kind === 'enum' && !bType.options.length) {
                alert('Please provide at least one option for the B side.');
                return;
            }
            store.addRelation(nameInput.value, aType, bType, {
                transitive: createTransitiveCb.checked && !createTransitiveCb.disabled,
                bidirectional: createBidirectionalCb.checked && !createBidirectionalCb.disabled,
                maxOutgoing: createMaxOut.disabled ? 1 : Number(createMaxOut.value),
                maxIncoming: createMaxIn.disabled ? 1 : Number(createMaxIn.value),
                description: createDescInput.value,
            });
            nameInput.value = '';
            aOptions.value = '';
            bOptions.value = '';
            createTransitiveCb.checked = false;
            createBidirectionalCb.checked = false;
            createMaxOut.value = '1';
            createMaxIn.value = '1';
            createDescInput.value = '';
        },
    }, [
        el('div', { class: 'flex-col' }, [
            el('label', {}, 'Name'),
            nameInput,
            el('label', {}, 'Description'),
            createDescInput,
            el('label', {}, 'A side'),
            el('div', { class: 'flex-row' }, [aKind, aClass, aOptions]),
            el('label', {}, 'B side'),
            el('div', { class: 'flex-row' }, [bKind, bClass, bOptions]),
            el('label', {}, 'Properties (entity↔entity only)'),
            el('div', { class: 'flex-row' }, [
                el('label', {}, [createTransitiveCb, ' transitive']),
                el('label', {}, [createBidirectionalCb, ' bidirectional']),
            ]),
            el('div', { class: 'flex-row' }, [
                el('label', {}, ['max outgoing (1–10) ', createMaxOut]),
                el('label', {}, ['max incoming (1–10) ', createMaxIn]),
            ]),
            el('button', { class: 'primary', type: 'submit' }, 'Add relation'),
        ]),
    ]));

    const list = el('div', { class: 'kg-list' });
    for (const r of relations) list.appendChild(renderRelationRow(r));
    if (!relations.length) list.appendChild(el('p', { class: 'muted' }, 'No relations yet.'));
    relationsRoot.appendChild(list);
}

function renderRelationRow(r) {
    if (r.locked) {
        return el('div', { class: 'kg-row', id: `relation-${r.id}` }, [
            el('div', { class: 'flex-row' }, [
                el('strong', {}, r.name),
                el('span', { class: 'muted' }, ` ${formatType(r.aType)} → ${formatType(r.bType)} `),
                el('span', { class: 'muted' }, '(locked)'),
            ]),
            r.description ? el('div', { class: 'muted' }, r.description) : null,
        ].filter(Boolean));
    }

    const canTrans = store.canBeTransitive(r);
    const canBidi = store.canBeBidirectional(r);
    const transitiveCb = el('input', {
        type: 'checkbox',
        checked: r.transitive || undefined,
        disabled: !canTrans || undefined,
    });
    transitiveCb.addEventListener('change', () => {
        store.updateRelation(r.id, { transitive: transitiveCb.checked });
    });
    const bidirectionalCb = el('input', {
        type: 'checkbox',
        checked: r.bidirectional || undefined,
        disabled: !canBidi || undefined,
    });
    bidirectionalCb.addEventListener('change', () => {
        store.updateRelation(r.id, { bidirectional: bidirectionalCb.checked });
    });
    const maxOutInp = el('input', {
        type: 'number', min: '0', max: '10',
        value: String(r.maxOutgoing ?? 1),
        disabled: !canTrans || undefined,
    });
    maxOutInp.addEventListener('change', () => {
        store.updateRelation(r.id, { maxOutgoing: Number(maxOutInp.value) });
    });
    const maxInInp = el('input', {
        type: 'number', min: '0', max: '10',
        value: String(r.maxIncoming ?? 1),
        disabled: !canTrans || undefined,
    });
    maxInInp.addEventListener('change', () => {
        store.updateRelation(r.id, { maxIncoming: Number(maxInInp.value) });
    });

    const descInput = el('input', { type: 'text', value: r.description || '', placeholder: 'Description (optional)' });
    descInput.addEventListener('change', () => {
        store.updateRelation(r.id, { description: descInput.value.trim() });
    });

    return el('div', { class: 'kg-row', id: `relation-${r.id}` }, [
        el('div', { class: 'flex-row' }, [
            el('strong', {}, r.name),
            el('span', { class: 'muted' }, ` ${formatType(r.aType)} → ${formatType(r.bType)} `),
            el('button', {
                class: 'primary transparent',
                onClick: () => {
                    if (confirm(`Delete relation "${r.name}"? Facts using it will be removed.`)) {
                        store.deleteRelation(r.id);
                    }
                },
            }, 'Delete'),
        ]),
        el('div', { class: 'flex-row' }, [
            el('label', {}, 'Description: '),
            descInput,
        ]),
        el('div', { class: 'flex-row' }, [
            el('label', {}, [transitiveCb, ' transitive']),
            el('label', {}, [bidirectionalCb, ' bidirectional']),
            !canTrans && el('span', { class: 'muted' }, '(entity↔entity only)'),
            canTrans && !canBidi && el('span', { class: 'muted' }, '(bidirectional needs matching class on both sides)'),
        ].filter(Boolean)),
        canTrans ? el('div', { class: 'flex-row' }, [
            el('label', {}, ['max outgoing ', maxOutInp]),
            el('label', {}, ['max incoming ', maxInInp]),
        ]) : null,
    ].filter(Boolean));
}

// ---------- Table tab ----------

const tableRoot = document.getElementById('main__table');
let tableSelection = 'generic';
let tableIncludeDerived = true;

function renderTable() {
    const { classes } = store.getState();
    clear(tableRoot);

    const viewSelect = el('select', {
        onChange: (e) => {
            tableSelection = e.target.value;
            renderTable();
        },
    }, [
        el('option', { value: 'generic', selected: tableSelection === 'generic' || undefined }, 'Generic (all facts)'),
        ...classes.map(c => el('option', {
            value: `class:${c.id}`,
            selected: tableSelection === `class:${c.id}` || undefined,
        }, `Class: ${c.name}`)),
    ]);

    const derivedCb = el('input', {
        type: 'checkbox',
        checked: tableIncludeDerived || undefined,
    });
    derivedCb.addEventListener('change', () => {
        tableIncludeDerived = derivedCb.checked;
        renderTable();
    });

    tableRoot.appendChild(el('caption', {}, [
        el('div', { class: 'flex-row', style: { gap: '8px', padding: '8px', justifyContent: 'flex-start' } }, [
            el('label', {}, 'View:'),
            viewSelect,
            el('label', {}, [derivedCb, ' include generated facts']),
            el('button', { class: 'primary', onClick: () => downloadCurrent() }, 'Download CSV'),
        ]),
    ]));

    if (tableSelection === 'generic') renderGenericTable();
    else renderClassTable(tableSelection.slice('class:'.length));
}

function renderGenericTable() {
    const { facts, relations } = store.getState();
    const visible = tableIncludeDerived ? facts : facts.filter(f => !f.derived);
    tableRoot.appendChild(el('thead', {}, el('tr', {}, [
        el('th', {}, 'A'),
        el('th', {}, 'Relation'),
        el('th', {}, 'B'),
    ])));
    const rows = visible.map((f, i) => {
        const r = relations.find(rr => rr.id === f.relationId);
        return el('tr', { class: i % 2 === 0 ? 'even' : '' }, [
            el('td', {}, formatValue(r?.aType.kind, f.a)),
            el('td', {}, r?.name ?? '(missing)'),
            el('td', {}, formatValue(r?.bType.kind, f.b)),
        ]);
    });
    tableRoot.appendChild(el('tbody', {}, rows.length ? rows : [
        el('tr', {}, el('td', { colspan: '3', class: 'muted' }, 'No facts.')),
    ]));
}

// Compute the flat column list for a class table, expanding relations that
// have multiple facts on some entity into numbered slots. Derived facts are
// included only when the caller opts in.
// Returns [{ relation, required, slotIndex, count }].
function computeClassTableColumns(classId, includeDerived) {
    const { entities, relations, facts } = store.getState();
    const effective = store.getEffectiveClassRelations(classId);
    const rowsEntities = entities.filter(e => store.entityMatchesClass(e, classId));

    const flat = [];
    for (const x of effective) {
        const rel = relations.find(r => r.id === x.relationId);
        if (!rel) continue;
        let maxN = 0;
        if (rel.aType.kind === 'entity') {
            for (const e of rowsEntities) {
                const n = facts.reduce((acc, f) => {
                    if (f.relationId !== rel.id || f.a !== e.id) return acc;
                    if (!includeDerived && f.derived) return acc;
                    return acc + 1;
                }, 0);
                if (n > maxN) maxN = n;
            }
        }
        const count = Math.max(1, maxN);
        for (let i = 0; i < count; i++) {
            flat.push({ relation: rel, required: !!x.required, slotIndex: i, count });
        }
    }
    return { columns: flat, rowsEntities };
}

function columnHeader(col) {
    const base = col.count > 1
        ? `${col.relation.name} ${col.slotIndex + 1}`
        : col.relation.name;
    return col.required ? `${base} *` : base;
}

function cellValueFor(col, entity, includeDerived, rowOrder) {
    const { facts } = store.getState();
    if (col.relation.aType.kind !== 'entity') return '';
    const own = facts.filter(f =>
        f.relationId === col.relation.id
        && f.a === entity.id
        && (includeDerived || !f.derived)
    );
    if (col.relation.bType.kind === 'entity' && rowOrder) {
        // Order by the B entity's position in the row list so slots align
        // vertically across rows. Unknown Bs fall to the end. Break ties by
        // preferring base over derived so authored values stay stable.
        const rank = new Map(rowOrder.map((e, i) => [e.id, i]));
        own.sort((a, b) => {
            const ra = rank.has(a.b) ? rank.get(a.b) : Number.MAX_SAFE_INTEGER;
            const rb = rank.has(b.b) ? rank.get(b.b) : Number.MAX_SAFE_INTEGER;
            if (ra !== rb) return ra - rb;
            return Number(!!a.derived) - Number(!!b.derived);
        });
    } else {
        // Non-entity B: base first, otherwise keep insertion order.
        own.sort((a, b) => Number(!!a.derived) - Number(!!b.derived));
    }
    const f = own[col.slotIndex];
    return f ? formatValue(col.relation.bType.kind, f.b) : '';
}

function renderClassTable(classId) {
    const cls = store.getClass(classId);
    if (!cls) return;
    const { columns, rowsEntities } = computeClassTableColumns(classId, tableIncludeDerived);

    tableRoot.appendChild(el('thead', {}, el('tr', {}, [
        el('th', {}, 'Entity'),
        ...columns.map(c => el('th', {}, columnHeader(c))),
    ])));
    const rows = rowsEntities.map((e, i) => {
        return el('tr', { class: i % 2 === 0 ? 'even' : '' }, [
            el('td', {}, e.name),
            ...columns.map(c => el('td', {}, cellValueFor(c, e, tableIncludeDerived, rowsEntities))),
        ]);
    });
    tableRoot.appendChild(el('tbody', {}, rows.length ? rows : [
        el('tr', {}, el('td', { colspan: String(columns.length + 1), class: 'muted' }, 'No entities of this class.')),
    ]));
}

function downloadCurrent() {
    const { facts, relations, entities, classes } = store.getState();
    let filename = 'knowgraph.csv';
    let csv = '';
    if (tableSelection === 'generic') {
        filename = 'knowgraph-facts.csv';
        const visible = tableIncludeDerived ? facts : facts.filter(f => !f.derived);
        csv = toCSV(
            ['Entity A', 'Relation', 'Entity B'],
            visible.map(f => {
                const r = relations.find(rr => rr.id === f.relationId);
                return [formatValue(r?.aType.kind, f.a), r?.name ?? '', formatValue(r?.bType.kind, f.b)];
            })
        );
    } else {
        const classId = tableSelection.slice('class:'.length);
        const cls = classes.find(c => c.id === classId);
        if (!cls) return;
        const { columns, rowsEntities } = computeClassTableColumns(classId, tableIncludeDerived);
        filename = `knowgraph-${cls.name.replace(/\s+/g, '_')}.csv`;
        csv = toCSV(
            ['Entity', ...columns.map(columnHeader)],
            rowsEntities.map(e => [
                e.name,
                ...columns.map(c => cellValueFor(c, e, tableIncludeDerived, rowsEntities)),
            ])
        );
    }
    downloadFile(filename, csv, 'text/csv');
}

function toCSV(headers, rows) {
    const esc = (v) => {
        const s = String(v ?? '');
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    return [headers.map(esc).join(','), ...rows.map(r => r.map(esc).join(','))].join('\n');
}

function downloadFile(name, content, mime) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = el('a', { href: url, download: name });
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
}

// ---------- Graph info panel ----------

const graphInfoEl = document.getElementById('graph-info');
let selectedEntityId = null;

// ---------- Hidden entities / classes ----------

const HIDDEN_STORAGE_KEY = 'knowgraph:v1:hidden';
let hiddenState = { entities: [], classes: [], relations: [] };
try {
    const raw = localStorage.getItem(HIDDEN_STORAGE_KEY);
    if (raw) {
        const parsed = JSON.parse(raw);
        hiddenState = {
            entities: Array.isArray(parsed.entities) ? parsed.entities : [],
            classes: Array.isArray(parsed.classes) ? parsed.classes : [],
            relations: Array.isArray(parsed.relations) ? parsed.relations : [],
        };
    }
} catch { /* ignore */ }

function persistHidden() {
    localStorage.setItem(HIDDEN_STORAGE_KEY, JSON.stringify(hiddenState));
}

function computeHiddenEntitySet() {
    const { entities } = store.getState();
    const set = new Set(hiddenState.entities);
    const hiddenClassSet = new Set(hiddenState.classes);
    if (hiddenClassSet.size) {
        for (const e of entities) {
            for (const cid of hiddenClassSet) {
                if (store.entityMatchesClass(e, cid)) {
                    set.add(e.id);
                    break;
                }
            }
        }
    }
    // Drop ids that no longer exist to keep the badge count honest.
    const existingIds = new Set(entities.map(e => e.id));
    hiddenState.entities = hiddenState.entities.filter(id => existingIds.has(id));
    const existingClassIds = new Set(store.getState().classes.map(c => c.id));
    hiddenState.classes = hiddenState.classes.filter(id => existingClassIds.has(id));
    const existingRelationIds = new Set(store.getState().relations.map(r => r.id));
    hiddenState.relations = hiddenState.relations.filter(id => existingRelationIds.has(id));
    return set;
}

const hiddenBadge = document.getElementById('graph-hidden-toggle');
const hiddenPopover = document.getElementById('graph-hidden-popover');
const hiddenCountEl = hiddenBadge.querySelector('.graph-hidden-count');

function refreshHiddenBadge() {
    const total = hiddenState.entities.length + hiddenState.classes.length + hiddenState.relations.length;
    if (!total) {
        hiddenBadge.hidden = true;
        hiddenPopover.hidden = true;
    } else {
        hiddenBadge.hidden = false;
        hiddenCountEl.textContent = String(total);
    }
    renderHiddenPopover();
}

function applyHidden() {
    graph.setHiddenEntities(computeHiddenEntitySet());
    graph.setHiddenRelations(new Set(hiddenState.relations));
    persistHidden();
    refreshHiddenBadge();
    // If the currently selected entity became hidden, close its info panel.
    if (selectedEntityId && graph.hiddenEntityIds.has(selectedEntityId)) {
        graph.clearPendingSource();
        hideEntityInfo();
    }
}

function hideEntity(id) {
    if (!hiddenState.entities.includes(id)) hiddenState.entities.push(id);
    applyHidden();
}
function hideClass(id) {
    if (!hiddenState.classes.includes(id)) hiddenState.classes.push(id);
    applyHidden();
}
function hideRelation(id) {
    if (!hiddenState.relations.includes(id)) hiddenState.relations.push(id);
    applyHidden();
}
function unhideEntity(id) {
    hiddenState.entities = hiddenState.entities.filter(x => x !== id);
    applyHidden();
}
function unhideClass(id) {
    hiddenState.classes = hiddenState.classes.filter(x => x !== id);
    applyHidden();
}
function unhideRelation(id) {
    hiddenState.relations = hiddenState.relations.filter(x => x !== id);
    applyHidden();
}
function unhideAll() {
    hiddenState.entities = [];
    hiddenState.classes = [];
    hiddenState.relations = [];
    applyHidden();
}

function renderHiddenPopover() {
    clear(hiddenPopover);
    if (!hiddenState.entities.length && !hiddenState.classes.length && !hiddenState.relations.length) return;
    hiddenPopover.appendChild(el('h4', {}, 'Hidden'));
    if (hiddenState.classes.length) {
        const list = el('ul', {});
        for (const cid of hiddenState.classes) {
            const name = store.getClassName(cid);
            list.appendChild(el('li', {}, [
                el('span', {}, `All ${name}`),
                el('button', {
                    class: 'primary transparent',
                    onClick: () => unhideClass(cid),
                }, 'Show'),
            ]));
        }
        hiddenPopover.appendChild(el('div', {}, [
            el('span', { class: 'muted' }, 'Classes'),
            list,
        ]));
    }
    if (hiddenState.relations.length) {
        const list = el('ul', {});
        for (const rid of hiddenState.relations) {
            const rel = store.getRelation(rid);
            list.appendChild(el('li', {}, [
                el('span', {}, rel?.name ?? '(missing)'),
                el('button', {
                    class: 'primary transparent',
                    onClick: () => unhideRelation(rid),
                }, 'Show'),
            ]));
        }
        hiddenPopover.appendChild(el('div', {}, [
            el('span', { class: 'muted' }, 'Relations'),
            list,
        ]));
    }
    if (hiddenState.entities.length) {
        const list = el('ul', {});
        for (const eid of hiddenState.entities) {
            const name = store.getEntityName(eid);
            list.appendChild(el('li', {}, [
                el('span', {}, name),
                el('button', {
                    class: 'primary transparent',
                    onClick: () => unhideEntity(eid),
                }, 'Show'),
            ]));
        }
        hiddenPopover.appendChild(el('div', {}, [
            el('span', { class: 'muted' }, 'Entities'),
            list,
        ]));
    }
    hiddenPopover.appendChild(el('button', {
        class: 'primary transparent',
        onClick: () => unhideAll(),
    }, 'Show all'));
}

hiddenBadge.addEventListener('click', () => {
    hiddenPopover.hidden = !hiddenPopover.hidden;
});
document.addEventListener('click', (e) => {
    if (hiddenPopover.hidden) return;
    if (hiddenPopover.contains(e.target)) return;
    if (hiddenBadge.contains(e.target)) return;
    hiddenPopover.hidden = true;
});

// Recompute hidden set whenever the graph store changes (entities/classes
// may have appeared, been deleted, or class membership may have shifted).
store.subscribe(() => applyHidden());
// Prime the initial state.
applyHidden();

function hideEntityInfo() {
    selectedEntityId = null;
    graphInfoEl.hidden = true;
    clear(graphInfoEl);
}

function showEntityInfo(entityId) {
    selectedEntityId = entityId;
    renderEntityInfo();
}

function renderEntityInfo() {
    if (!selectedEntityId) return;
    const { entities, relations, facts } = store.getState();
    const entity = entities.find(e => e.id === selectedEntityId);
    if (!entity) {
        hideEntityInfo();
        return;
    }
    clear(graphInfoEl);
    graphInfoEl.hidden = false;

    const closeBtn = el('button', {
        class: 'primary transparent graph-info-close',
        onClick: () => {
            graph.clearPendingSource();
            hideEntityInfo();
        },
    }, 'Close');

    graphInfoEl.appendChild(el('div', { class: 'graph-info-header flex-row' }, [
        el('h3', {}, entity.name),
        closeBtn,
    ]));

    const classNames = entity.classIds
        .map(cid => store.getClassName(cid))
        .filter(Boolean);
    if (classNames.length) {
        graphInfoEl.appendChild(el('div', { class: 'muted' }, `Classes: ${classNames.join(', ')}`));
    }

    // Hide actions
    const actions = el('div', { class: 'graph-info-actions' }, [
        el('button', {
            class: 'primary transparent',
            onClick: () => hideEntity(entity.id),
        }, `Hide ${entity.name}`),
        ...entity.classIds.map(cid => el('button', {
            class: 'primary transparent',
            onClick: () => hideClass(cid),
        }, `Hide all ${store.getClassName(cid)}`)),
    ]);

    // Most frequent entity↔entity relation touching this entity (base + derived).
    const relCounts = new Map();
    for (const f of facts) {
        const r = relations.find(rr => rr.id === f.relationId);
        if (!r) continue;
        if (r.aType.kind !== 'entity' || r.bType.kind !== 'entity') continue;
        if (f.a !== entity.id && f.b !== entity.id) continue;
        relCounts.set(r.id, (relCounts.get(r.id) ?? 0) + 1);
    }
    let mostRelId = null;
    let mostCount = 0;
    for (const [rid, c] of relCounts) {
        if (c > mostCount) { mostCount = c; mostRelId = rid; }
    }
    if (mostRelId && !hiddenState.relations.includes(mostRelId)) {
        const rel = relations.find(r => r.id === mostRelId);
        actions.appendChild(el('button', {
            class: 'primary transparent',
            onClick: () => hideRelation(mostRelId),
        }, `Hide most frequent: ${rel?.name ?? '?'} (${mostCount})`));
    }

    graphInfoEl.appendChild(actions);

    const valueFacts = [];
    const outgoing = [];
    const incoming = [];
    const bidirectional = [];
    const bidiSeen = new Set(); // key `${relationId}|${otherEntityId}`

    // Base facts before derived so a base fact wins when both are present.
    const orderedFacts = [...facts].sort(
        (a, b) => Number(!!a.derived) - Number(!!b.derived),
    );

    for (const f of orderedFacts) {
        const r = relations.find(rr => rr.id === f.relationId);
        if (!r) continue;
        const aMatches = r.aType.kind === 'entity' && f.a === entity.id;
        const bMatches = r.bType.kind === 'entity' && f.b === entity.id;

        if (r.bidirectional && (aMatches || bMatches)) {
            const other = aMatches ? f.b : f.a;
            const key = `${r.id}|${other}`;
            if (bidiSeen.has(key)) continue;
            bidiSeen.add(key);
            bidirectional.push({ f, r, other });
            continue;
        }

        if (aMatches && r.bType.kind !== 'entity') {
            valueFacts.push({ f, r });
        } else if (aMatches && r.bType.kind === 'entity') {
            outgoing.push({ f, r });
        } else if (bMatches && r.aType.kind === 'entity') {
            incoming.push({ f, r });
        }
    }

    const renderSection = (title, items, renderer) => {
        if (!items.length) return;
        const list = el('ul', {});
        for (const item of items) list.appendChild(renderer(item));
        graphInfoEl.appendChild(el('div', { class: 'graph-info-section' }, [
            el('span', { class: 'graph-info-section-label' }, title),
            list,
        ]));
    };

    const relSpan = (r, text) => el('span', { title: r.description || r.name }, text || r.name);

    renderSection('Value facts', valueFacts, ({ f, r }) => el('li', {}, [
        relSpan(r, `${r.name}: ${formatValue(r.bType.kind, f.b)}`),
        f.derived ? el('span', { class: 'muted' }, ' (derived)') : null,
    ].filter(Boolean)));

    renderSection('Bidirectional', bidirectional, ({ f, r, other }) => el('li', {}, [
        relSpan(r, `${r.name} ↔ ${store.getEntityName(other)}`),
        f.derived ? el('span', { class: 'muted' }, ' (derived)') : null,
    ].filter(Boolean)));

    renderSection('Outgoing', outgoing, ({ f, r }) => el('li', {}, [
        relSpan(r, `${r.name} → ${store.getEntityName(f.b)}`),
        f.derived ? el('span', { class: 'muted' }, ' (derived)') : null,
    ].filter(Boolean)));

    renderSection('Incoming', incoming, ({ f, r }) => el('li', {}, [
        relSpan(r, `${store.getEntityName(f.a)} → ${r.name}`),
        f.derived ? el('span', { class: 'muted' }, ' (derived)') : null,
    ].filter(Boolean)));

    // --- Notes section ---
    const notesTextarea = el('textarea', {
        class: 'graph-info-notes',
        placeholder: 'Write notes here... Use [Entity Name] to link to other entities.',
    });
    notesTextarea.value = entity.notes || '';
    let notesTimeout = null;
    notesTextarea.addEventListener('input', () => {
        clearTimeout(notesTimeout);
        notesTimeout = setTimeout(() => {
            store.updateEntityNotes(entity.id, notesTextarea.value);
        }, 500);
    });
    graphInfoEl.appendChild(el('div', { class: 'graph-info-section' }, [
        el('span', { class: 'graph-info-section-label' }, 'Notes'),
        notesTextarea,
    ]));
}

// Keep the info panel fresh when data changes (e.g. facts added via modal).
store.subscribe(() => {
    if (selectedEntityId) {
        // Don't re-render if the notes textarea is focused (avoids stealing focus
        // when the user is typing notes and the debounced save triggers persist).
        if (graphInfoEl.contains(document.activeElement) && document.activeElement.tagName === 'TEXTAREA') return;
        renderEntityInfo();
    }
});

// ---------- Graph modal ----------

const modalEl = document.getElementById('kg-modal');
const modalTitleEl = modalEl.querySelector('.kg-modal-title');
const modalBodyEl = modalEl.querySelector('.kg-modal-body');
const modalOkBtn = modalEl.querySelector('[data-modal-ok]');
const modalCancelBtn = modalEl.querySelector('[data-modal-cancel]');
let modalOnSubmit = null;

function closeModal() {
    modalEl.hidden = true;
    modalOnSubmit = null;
    clear(modalBodyEl);
}
modalCancelBtn.addEventListener('click', closeModal);
modalOkBtn.addEventListener('click', () => {
    if (!modalOnSubmit) { closeModal(); return; }
    try {
        const result = modalOnSubmit();
        if (result === false) return;
    } catch (err) {
        alert(err.message || String(err));
        return;
    }
    closeModal();
});
modalEl.addEventListener('click', (e) => {
    if (e.target === modalEl) closeModal();
});
window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        if (!modalEl.hidden) closeModal();
        else if (graph.pendingSourceId) {
            graph.clearPendingSource();
            hideEntityInfo();
        }
    }
});

// Compute the transitive class-id set for a given classIds list (as if it were
// an entity), reusing store.getEntityEffectiveClassIds.
function effectiveClassIdsFor(classIds) {
    return store.getEntityEffectiveClassIds({ classIds });
}

function openGraphModal({ title, needsEntity, needsRelation, sourceId = null, targetId = null }) {
    modalTitleEl.textContent = title;
    clear(modalBodyEl);

    const { classes, relations, entities } = store.getState();

    // Optional entity fields
    let nameInput = null;
    const classCheckboxes = [];
    if (needsEntity) {
        nameInput = el('input', { type: 'text', placeholder: 'Entity name', required: true });
        modalBodyEl.appendChild(el('label', {}, 'Name'));
        modalBodyEl.appendChild(nameInput);

        modalBodyEl.appendChild(el('label', {}, 'Classes'));
        const classList = el('ul', { class: 'kg-facts' });
        for (const c of classes) {
            const cb = el('input', { type: 'checkbox', value: c.id });
            classCheckboxes.push(cb);
            classList.appendChild(el('li', {}, [el('label', {}, [cb, ' ', c.name])]));
        }
        if (!classes.length) {
            classList.appendChild(el('li', { class: 'muted' }, 'No classes defined.'));
        }
        modalBodyEl.appendChild(classList);
    }

    // Optional relation picker
    let relSelect = null;
    let hint = null;
    const rebuildRelationOptions = () => {
        if (!relSelect) return;
        const source = entities.find(e => e.id === sourceId);
        if (!source) return;
        const sourceEffective = new Set(store.getEntityEffectiveClassIds(source));

        let targetEffective = new Set();
        if (targetId) {
            const t = entities.find(e => e.id === targetId);
            if (t) targetEffective = new Set(store.getEntityEffectiveClassIds(t));
        } else {
            const picked = classCheckboxes.filter(cb => cb.checked).map(cb => cb.value);
            targetEffective = new Set(effectiveClassIdsFor(picked));
        }

        const candidates = relations.filter(r => {
            if (r.aType.kind !== 'entity' || r.bType.kind !== 'entity') return false;
            if (r.aType.classId && !sourceEffective.has(r.aType.classId)) return false;
            if (r.bType.classId && !targetEffective.has(r.bType.classId)) return false;
            const maxOut = r.maxOutgoing ?? 1;
            if (maxOut > 0 && store.outgoingBaseCount(r.id, sourceId) >= maxOut) return false;
            const maxIn = r.maxIncoming ?? 1;
            if (targetId && maxIn > 0 && store.incomingBaseCount(r.id, targetId) >= maxIn) return false;
            return true;
        });
        const currentVal = relSelect.value;
        relSelect.innerHTML = '';
        relSelect.appendChild(new Option('— pick relation —', ''));
        for (const r of candidates) {
            const opt = new Option(`${r.name} (${formatType(r.aType)} → ${formatType(r.bType)})`, r.id);
            if (r.id === currentVal) opt.selected = true;
            relSelect.appendChild(opt);
        }
        if (hint) {
            hint.textContent = candidates.length
                ? ''
                : 'No compatible relations available (check slots and class types).';
        }
    };
    if (needsRelation) {
        const source = entities.find(e => e.id === sourceId);
        const target = targetId ? entities.find(e => e.id === targetId) : null;
        modalBodyEl.appendChild(el('div', { class: 'muted' }, [
            'From: ', el('strong', {}, source?.name ?? '?'),
            ' → To: ', el('strong', {}, target?.name ?? '(new entity)'),
        ]));
        modalBodyEl.appendChild(el('label', {}, 'Relation'));
        relSelect = el('select', {});
        modalBodyEl.appendChild(relSelect);
        hint = el('div', { class: 'muted' }, '');
        modalBodyEl.appendChild(hint);
        rebuildRelationOptions();
        for (const cb of classCheckboxes) cb.addEventListener('change', rebuildRelationOptions);
    }

    modalOnSubmit = () => {
        let newEntityId = null;
        if (needsEntity) {
            const name = nameInput.value.trim();
            if (!name) { alert('Please provide a name.'); return false; }
            const classIds = classCheckboxes.filter(cb => cb.checked).map(cb => cb.value);
            newEntityId = store.addEntity(name, classIds).id;
        }
        if (needsRelation) {
            const relId = relSelect.value;
            if (!relId) { alert('Please pick a relation.'); return false; }
            const finalTargetId = targetId ?? newEntityId;
            store.addFact(relId, sourceId, finalTargetId);
        }
    };

    modalEl.hidden = false;
    if (nameInput) nameInput.focus();
    else if (relSelect) relSelect.focus();
}

// ---------- Boot ----------

setTab('graph');
