import * as store from './store.js';

// ---------- Console query engine ----------
//
// RESTful-style command language:
//
//   GET  /entities                     — list all entities
//   GET  /entities?class=<class>       — list entities of a class
//   GET  /entity/<name>                — entity details (classes, facts, notes)
//   POST /entity/<name>                — create entity (body: class=A,B)
//   PUT  /entity/<name>                — update entity (body: name=NewName | class+=C | class-=C | notes=...)
//   DELETE /entity/<name>              — delete entity
//
//   GET  /classes                      — list all classes
//   GET  /class/<name>                 — class details
//   POST /class/<name>                 — create class
//   DELETE /class/<name>               — delete class
//
//   GET  /relations                    — list all relations
//   GET  /relation/<name>              — relation details
//   POST /relation/<name>              — create relation (body: a=entity b=entity | a=entity b=date ...)
//   DELETE /relation/<name>            — delete relation
//
//   GET  /facts                        — list all facts
//   GET  /facts?entity=<name>          — facts involving an entity
//   GET  /facts?relation=<name>        — facts for a relation
//   POST /fact                         — create fact (body: relation=R a=EntityA b=EntityB)
//   DELETE /fact/<id>                  — delete fact by id
//
//   GET  /traverse/<entity>/<relation> — follow relation from entity (optionally ?depth=N)
//   GET  /search/<query>               — search entities/classes/relations by substring
//
//   HELP                               — show all commands

export function execute(input) {
    const trimmed = input.trim();
    if (!trimmed) return '';

    // HELP
    if (/^help$/i.test(trimmed)) return helpText();

    // Parse: VERB /path?query  body
    const m = trimmed.match(/^(GET|POST|PUT|DELETE|PATCH)\s+\/?([^\s?]*)\s*(\?[^\s]*)?\s*(.*)?$/i);
    if (!m) return `❌ Unknown command. Type HELP for usage.`;

    const verb = m[1].toUpperCase();
    const path = decodeURIComponent(m[2] || '');
    const query = parseQuery(m[3] || '');
    const body = parseBody(m[4] || '');

    const segments = path.split('/').filter(Boolean);
    const resource = segments[0]?.toLowerCase();

    try {
        // --- Entities ---
        if (resource === 'entities' && verb === 'GET') return getEntities(query);
        if (resource === 'entity' && segments.length >= 2) {
            const name = segments.slice(1).join('/');
            if (verb === 'GET') return getEntity(name);
            if (verb === 'POST') return postEntity(name, body);
            if (verb === 'PUT') return putEntity(name, body);
            if (verb === 'DELETE') return deleteEntity(name);
        }

        // --- Classes ---
        if (resource === 'classes' && verb === 'GET') return getClasses();
        if (resource === 'class' && segments.length >= 2) {
            const name = segments.slice(1).join('/');
            if (verb === 'GET') return getClassInfo(name);
            if (verb === 'POST') return postClass(name, body);
            if (verb === 'DELETE') return deleteClass(name);
        }

        // --- Relations ---
        if (resource === 'relations' && verb === 'GET') return getRelations();
        if (resource === 'relation' && segments.length >= 2) {
            const name = segments.slice(1).join('/');
            if (verb === 'GET') return getRelationInfo(name);
            if (verb === 'POST') return postRelation(name, body);
            if (verb === 'DELETE') return deleteRelation(name);
        }

        // --- Facts ---
        if (resource === 'facts' && verb === 'GET') return getFacts(query);
        if (resource === 'fact') {
            if (verb === 'POST') return postFact(body);
            if (verb === 'DELETE' && segments.length >= 2) return deleteFact(segments[1]);
        }

        // --- Traverse ---
        if (resource === 'traverse' && verb === 'GET' && segments.length >= 3) {
            const entityName = segments[1];
            const relName = segments.slice(2).join('/');
            const depth = parseInt(query.depth) || 1;
            return traverse(entityName, relName, depth);
        }

        // --- Search ---
        if (resource === 'search' && verb === 'GET' && segments.length >= 2) {
            const q = segments.slice(1).join('/');
            return search(q);
        }

        return `❌ Unknown route: ${verb} /${path}`;
    } catch (e) {
        return `❌ ${e.message}`;
    }
}

// ---------- Helpers ----------

function parseQuery(qs) {
    const obj = {};
    if (!qs) return obj;
    const params = qs.replace(/^\?/, '').split('&');
    for (const p of params) {
        const [k, ...rest] = p.split('=');
        obj[decodeURIComponent(k)] = decodeURIComponent(rest.join('='));
    }
    return obj;
}

function parseBody(text) {
    const obj = {};
    if (!text) return obj;
    // key=value pairs separated by spaces (values can be quoted)
    const re = /(\w[\w+\-]*)=("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\S+)/g;
    let m;
    while ((m = re.exec(text)) !== null) {
        let val = m[2];
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
            val = val.slice(1, -1).replace(/\\(.)/g, '$1');
        }
        obj[m[1]] = val;
    }
    return obj;
}

function findEntity(name) {
    const { entities } = store.getState();
    const lower = name.toLowerCase();
    const exact = entities.find(e => e.name.toLowerCase() === lower);
    if (exact) return exact;
    // Partial match
    const partial = entities.filter(e => e.name.toLowerCase().includes(lower));
    if (partial.length === 1) return partial[0];
    if (partial.length > 1) throw new Error(`Ambiguous entity "${name}": ${partial.map(e => e.name).join(', ')}`);
    throw new Error(`Entity "${name}" not found.`);
}

function findClass(name) {
    const { classes } = store.getState();
    const lower = name.toLowerCase();
    const exact = classes.find(c => c.name.toLowerCase() === lower);
    if (exact) return exact;
    const partial = classes.filter(c => c.name.toLowerCase().includes(lower));
    if (partial.length === 1) return partial[0];
    if (partial.length > 1) throw new Error(`Ambiguous class "${name}": ${partial.map(c => c.name).join(', ')}`);
    throw new Error(`Class "${name}" not found.`);
}

function findRelation(name) {
    const { relations } = store.getState();
    const lower = name.toLowerCase();
    const exact = relations.find(r => r.name.toLowerCase() === lower);
    if (exact) return exact;
    const partial = relations.filter(r => r.name.toLowerCase().includes(lower));
    if (partial.length === 1) return partial[0];
    if (partial.length > 1) throw new Error(`Ambiguous relation "${name}": ${partial.map(r => r.name).join(', ')}`);
    throw new Error(`Relation "${name}" not found.`);
}

function formatType(t) {
    if (t.kind === 'entity') return t.classId ? `Entity<${store.getClassName(t.classId)}>` : 'Entity';
    if (t.kind === 'enum') return `Enum(${(t.options ?? []).join('|')})`;
    return t.kind;
}

function formatValue(kind, value) {
    if (value === undefined || value === null || value === '') return '(empty)';
    if (kind === 'entity') return store.getEntityName(value);
    if (kind === 'boolean') return value ? 'true' : 'false';
    return String(value);
}

// ---------- Route handlers ----------

function getEntities(query) {
    let { entities } = store.getState();
    if (query.class) {
        const cls = findClass(query.class);
        entities = entities.filter(e => store.entityMatchesClass(e, cls.id));
    }
    if (!entities.length) return 'No entities found.';
    const lines = entities.map(e => {
        const classNames = e.classIds.map(cid => store.getClassName(cid)).filter(Boolean);
        return `  ${e.name}${classNames.length ? ` [${classNames.join(', ')}]` : ''}`;
    });
    return `Entities (${entities.length}):\n${lines.join('\n')}`;
}

function getEntity(name) {
    const entity = findEntity(name);
    const { relations, facts } = store.getState();
    const classNames = entity.classIds.map(cid => store.getClassName(cid)).filter(Boolean);

    const lines = [`Entity: ${entity.name}`];
    lines.push(`  id: ${entity.id}`);
    if (classNames.length) lines.push(`  classes: ${classNames.join(', ')}`);
    if (entity.notes) lines.push(`  notes: ${entity.notes}`);

    const entityFacts = facts.filter(f => {
        const r = relations.find(rr => rr.id === f.relationId);
        if (!r) return false;
        return (r.aType.kind === 'entity' && f.a === entity.id) ||
               (r.bType.kind === 'entity' && f.b === entity.id);
    });

    if (entityFacts.length) {
        lines.push(`  facts:`);
        for (const f of entityFacts) {
            const r = relations.find(rr => rr.id === f.relationId);
            if (!r) continue;
            const isA = r.aType.kind === 'entity' && f.a === entity.id;
            const derived = f.derived ? ' (derived)' : '';
            if (isA) {
                lines.push(`    → ${r.name} → ${formatValue(r.bType.kind, f.b)}${derived}`);
            } else {
                lines.push(`    ← ${formatValue(r.aType.kind, f.a)} → ${r.name}${derived}`);
            }
        }
    }
    return lines.join('\n');
}

function postEntity(name, body) {
    const classIds = [];
    if (body.class) {
        for (const cn of body.class.split(',')) {
            const cls = findClass(cn.trim());
            classIds.push(cls.id);
        }
    }
    const e = store.addEntity(name, classIds);
    return `✅ Created entity "${e.name}" (id: ${e.id})`;
}

function putEntity(name, body) {
    const entity = findEntity(name);
    const patch = {};
    if (body.name) patch.name = body.name;
    if (body['class+']) {
        const cls = findClass(body['class+']);
        patch.classIds = [...new Set([...entity.classIds, cls.id])];
    }
    if (body['class-']) {
        const cls = findClass(body['class-']);
        patch.classIds = entity.classIds.filter(id => id !== cls.id);
    }
    if (body.notes !== undefined) {
        store.updateEntityNotes(entity.id, body.notes);
    }
    if (Object.keys(patch).length) store.updateEntity(entity.id, patch);
    return `✅ Updated entity "${entity.name}"`;
}

function deleteEntity(name) {
    const entity = findEntity(name);
    store.deleteEntity(entity.id);
    return `✅ Deleted entity "${entity.name}"`;
}

function getClasses() {
    const { classes } = store.getState();
    if (!classes.length) return 'No classes defined.';
    const lines = classes.map(c => {
        const parents = c.parentClassIds.map(pid => store.getClassName(pid)).filter(Boolean);
        return `  ${c.name}${parents.length ? ` extends ${parents.join(', ')}` : ''}`;
    });
    return `Classes (${classes.length}):\n${lines.join('\n')}`;
}

function getClassInfo(name) {
    const cls = findClass(name);
    const { relations } = store.getState();
    const lines = [`Class: ${cls.name}`, `  id: ${cls.id}`];
    const parents = cls.parentClassIds.map(pid => store.getClassName(pid)).filter(Boolean);
    if (parents.length) lines.push(`  extends: ${parents.join(', ')}`);

    const effective = store.getEffectiveClassRelations(cls.id);
    if (effective.length) {
        lines.push(`  relations:`);
        for (const x of effective) {
            const rel = relations.find(r => r.id === x.relationId);
            if (!rel) continue;
            const req = x.required ? ' (required)' : '';
            const inh = x.inheritedFrom ? ` [from ${store.getClassName(x.inheritedFrom)}]` : '';
            lines.push(`    ${rel.name}: ${formatType(rel.aType)} → ${formatType(rel.bType)}${req}${inh}`);
        }
    }

    const { entities } = store.getState();
    const members = entities.filter(e => store.entityMatchesClass(e, cls.id));
    if (members.length) {
        lines.push(`  members (${members.length}): ${members.map(e => e.name).join(', ')}`);
    }
    return lines.join('\n');
}

function postClass(name) {
    const c = store.addClass(name);
    return `✅ Created class "${c.name}" (id: ${c.id})`;
}

function deleteClass(name) {
    const cls = findClass(name);
    store.deleteClass(cls.id);
    return `✅ Deleted class "${cls.name}"`;
}

function getRelations() {
    const { relations } = store.getState();
    if (!relations.length) return 'No relations defined.';
    const lines = relations.map(r => {
        const flags = [];
        if (r.transitive) flags.push('transitive');
        if (r.bidirectional) flags.push('bidirectional');
        if (r.locked) flags.push('locked');
        const flagStr = flags.length ? ` [${flags.join(', ')}]` : '';
        return `  ${r.name}: ${formatType(r.aType)} → ${formatType(r.bType)}${flagStr}`;
    });
    return `Relations (${relations.length}):\n${lines.join('\n')}`;
}

function getRelationInfo(name) {
    const rel = findRelation(name);
    const { facts } = store.getState();
    const lines = [`Relation: ${rel.name}`, `  id: ${rel.id}`];
    lines.push(`  type: ${formatType(rel.aType)} → ${formatType(rel.bType)}`);
    if (rel.description) lines.push(`  description: ${rel.description}`);
    if (rel.transitive) lines.push(`  transitive: yes`);
    if (rel.bidirectional) lines.push(`  bidirectional: yes`);
    if (rel.locked) lines.push(`  locked: yes`);
    lines.push(`  max outgoing: ${rel.maxOutgoing || '∞'}  max incoming: ${rel.maxIncoming || '∞'}`);

    const relFacts = facts.filter(f => f.relationId === rel.id && !f.derived);
    if (relFacts.length) {
        lines.push(`  facts (${relFacts.length}):`);
        for (const f of relFacts) {
            lines.push(`    ${formatValue(rel.aType.kind, f.a)} → ${formatValue(rel.bType.kind, f.b)}`);
        }
    }
    return lines.join('\n');
}

function postRelation(name, body) {
    const a = body.a || 'entity';
    const b = body.b || 'entity';
    const buildType = (kind) => {
        const t = { kind };
        if (kind === 'entity' && body[`${kind}_class`]) {
            const cls = findClass(body[`${kind}_class`]);
            t.classId = cls.id;
        }
        return t;
    };
    const aType = buildType(a);
    const bType = buildType(b);
    const r = store.addRelation(name, aType, bType, {
        description: body.description || '',
        transitive: body.transitive === 'true',
        bidirectional: body.bidirectional === 'true',
    });
    return `✅ Created relation "${r.name}" (id: ${r.id})`;
}

function deleteRelation(name) {
    const rel = findRelation(name);
    if (rel.locked) throw new Error(`Relation "${rel.name}" is locked and cannot be deleted.`);
    store.deleteRelation(rel.id);
    return `✅ Deleted relation "${rel.name}"`;
}

function getFacts(query) {
    const { facts, relations } = store.getState();
    let filtered = facts.filter(f => !f.derived);

    if (query.entity) {
        const entity = findEntity(query.entity);
        filtered = filtered.filter(f => {
            const r = relations.find(rr => rr.id === f.relationId);
            if (!r) return false;
            return (r.aType.kind === 'entity' && f.a === entity.id) ||
                   (r.bType.kind === 'entity' && f.b === entity.id);
        });
    }
    if (query.relation) {
        const rel = findRelation(query.relation);
        filtered = filtered.filter(f => f.relationId === rel.id);
    }

    if (!filtered.length) return 'No facts found.';
    const lines = filtered.map(f => {
        const r = relations.find(rr => rr.id === f.relationId);
        if (!r) return `  (unknown relation) [${f.id}]`;
        return `  ${formatValue(r.aType.kind, f.a)} —[${r.name}]→ ${formatValue(r.bType.kind, f.b)}  [${f.id}]`;
    });
    return `Facts (${filtered.length}):\n${lines.join('\n')}`;
}

function postFact(body) {
    if (!body.relation) throw new Error('Missing relation= in body.');
    if (!body.a) throw new Error('Missing a= (entity A name) in body.');
    if (!body.b) throw new Error('Missing b= (entity B / value) in body.');

    const rel = findRelation(body.relation);
    if (rel.locked) throw new Error(`Relation "${rel.name}" is locked. Facts cannot be added manually.`);

    let aVal, bVal;
    if (rel.aType.kind === 'entity') {
        aVal = findEntity(body.a).id;
    } else {
        aVal = coerceValue(rel.aType.kind, body.a);
    }
    if (rel.bType.kind === 'entity') {
        bVal = findEntity(body.b).id;
    } else {
        bVal = coerceValue(rel.bType.kind, body.b);
    }

    const f = store.addFact(rel.id, aVal, bVal);
    return `✅ Created fact [${f.id}]: ${body.a} —[${rel.name}]→ ${body.b}`;
}

function coerceValue(kind, raw) {
    if (kind === 'number') return Number(raw);
    if (kind === 'boolean') return raw === 'true';
    return raw;
}

function deleteFact(id) {
    const { facts } = store.getState();
    const f = facts.find(x => x.id === id);
    if (!f) throw new Error(`Fact "${id}" not found.`);
    if (f.derived) throw new Error('Cannot delete a derived fact.');
    const rel = store.getRelation(f.relationId);
    if (rel?.locked) throw new Error(`Relation "${rel.name}" is locked. Facts cannot be deleted manually.`);
    store.deleteFact(id);
    return `✅ Deleted fact ${id}`;
}

function traverse(entityName, relName, maxDepth) {
    const entity = findEntity(entityName);
    const rel = findRelation(relName);
    const { facts } = store.getState();

    const visited = new Set();
    const results = [];

    const walk = (currentId, depth, path) => {
        if (depth > maxDepth) return;
        if (visited.has(currentId)) return;
        visited.add(currentId);

        const outgoing = facts.filter(f => f.relationId === rel.id && f.a === currentId);
        for (const f of outgoing) {
            if (rel.bType.kind !== 'entity') continue;
            const targetName = store.getEntityName(f.b);
            const derived = f.derived ? ' (derived)' : '';
            results.push(`${'  '.repeat(depth)}→ ${targetName}${derived}`);
            walk(f.b, depth + 1, [...path, targetName]);
        }

        if (rel.bidirectional) {
            const incoming = facts.filter(f => f.relationId === rel.id && f.b === currentId);
            for (const f of incoming) {
                if (rel.aType.kind !== 'entity') continue;
                if (visited.has(f.a)) continue;
                const targetName = store.getEntityName(f.a);
                const derived = f.derived ? ' (derived)' : '';
                results.push(`${'  '.repeat(depth)}↔ ${targetName}${derived}`);
                walk(f.a, depth + 1, [...path, targetName]);
            }
        }
    };

    walk(entity.id, 1, [entity.name]);

    if (!results.length) return `No connections from "${entity.name}" via "${rel.name}".`;
    return `Traverse: ${entity.name} —[${rel.name}]→ (depth ${maxDepth}):\n${results.join('\n')}`;
}

function search(query) {
    const lower = query.toLowerCase();
    const { entities, classes, relations } = store.getState();

    const matchedEntities = entities.filter(e => e.name.toLowerCase().includes(lower));
    const matchedClasses = classes.filter(c => c.name.toLowerCase().includes(lower));
    const matchedRelations = relations.filter(r => r.name.toLowerCase().includes(lower));

    const lines = [];
    if (matchedEntities.length) {
        lines.push(`Entities (${matchedEntities.length}):`);
        for (const e of matchedEntities) lines.push(`  ${e.name}`);
    }
    if (matchedClasses.length) {
        lines.push(`Classes (${matchedClasses.length}):`);
        for (const c of matchedClasses) lines.push(`  ${c.name}`);
    }
    if (matchedRelations.length) {
        lines.push(`Relations (${matchedRelations.length}):`);
        for (const r of matchedRelations) lines.push(`  ${r.name}`);
    }
    if (!lines.length) return `No results for "${query}".`;
    return lines.join('\n');
}

function helpText() {
    return `Knowgraph Console — RESTful Query Language

ENTITIES
  GET    /entities                       List all entities
  GET    /entities?class=<name>          List entities of a class
  GET    /entity/<name>                  Entity details (classes, facts, notes)
  POST   /entity/<name>                 Create entity (class=A,B)
  PUT    /entity/<name>                 Update entity (name=X | class+=C | class-=C | notes="...")
  DELETE /entity/<name>                 Delete entity

CLASSES
  GET    /classes                        List all classes
  GET    /class/<name>                   Class details & members
  POST   /class/<name>                  Create class
  DELETE /class/<name>                  Delete class

RELATIONS
  GET    /relations                      List all relations
  GET    /relation/<name>                Relation details & facts
  POST   /relation/<name>              Create relation (a=entity b=entity description="...")
  DELETE /relation/<name>              Delete relation

FACTS
  GET    /facts                          List all base facts
  GET    /facts?entity=<name>            Facts involving an entity
  GET    /facts?relation=<name>          Facts for a relation
  POST   /fact                          Create fact (relation=R a=EntityA b=EntityB)
  DELETE /fact/<id>                     Delete fact by id

TRAVERSAL & SEARCH
  GET    /traverse/<entity>/<relation>   Traverse from entity via relation (?depth=N, default 1)
  GET    /search/<query>                 Search entities, classes, relations by substring

HELP                                     Show this help message

Notes:
  • Entity/class/relation names are case-insensitive and support partial matching.
  • Body params use key=value syntax. Quote values with spaces: name="John Doe"
  • Locked relations (e.g. links-to) cannot be modified or have facts added/deleted.`;
}
