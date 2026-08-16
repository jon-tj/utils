const ENUM_MARKER = Symbol('enumType');

export function createTypescriptInterface(schema, mappings = {}, indentation = 2, currentIndent = 0) {
    const isList = Array.isArray(schema);
    const isDict = schema !== null && typeof schema === 'object' && !isList;
    if (isDict && schema[ENUM_MARKER]) {
        return schema[ENUM_MARKER];
    }
    if (!isList && !isDict) {
        const type = typeof schema;
        if (type === 'string') {
            const interpretedType = interpretStringType(schema);
            return interpretedType || 'string';
        }
        return mappings[type] || type;
    }

    const indent = ' '.repeat(currentIndent);
    const newIndent = currentIndent + indentation;
    const innerIndent = ' '.repeat(newIndent);

    if (isDict) {
        return `{\n${Object.entries(schema).map(([key, value]) => `${innerIndent}${key}: ${createTypescriptInterface(value, mappings, indentation, newIndent)};`).join('\n')}\n${indent}}`;
    }
    if (isList) {
        const enumType = interpretEnumType(schema);
        const sample = enumType ? null : mergeSamples(schema);
        const inner = enumType || createTypescriptInterface(sample, mappings, indentation, newIndent);
        return `[\n${innerIndent}${inner}\n${indent}]`;
    }
}

export function createSchemaHtml(schema, indentation = 2, currentIndent = 0, path = []) {
    const isList = Array.isArray(schema);
    const isDict = schema !== null && typeof schema === 'object' && !isList;

    if (isDict && schema[ENUM_MARKER]) {
        return escapeHtml(schema[ENUM_MARKER]);
    }
    if (!isList && !isDict) {
        const type = typeof schema;
        if (type === 'string') {
            return escapeHtml(interpretStringType(schema) || 'string');
        }
        return escapeHtml(type);
    }

    const indent = ' '.repeat(currentIndent);
    const newIndent = currentIndent + indentation;
    const innerIndent = ' '.repeat(newIndent);

    if (isDict) {
        const entries = Object.entries(schema).map(([key, value]) => {
            const fieldPath = [...path, key];
            const typeStr = getTypeLabel(value);
            const keySpan = `<span class="field-key" data-path='${escapeAttr(JSON.stringify(fieldPath))}' data-type="${escapeAttr(typeStr)}">${escapeHtml(key)}</span>`;
            const valueHtml = createSchemaHtml(value, indentation, newIndent, fieldPath);
            return `${innerIndent}${keySpan}: ${valueHtml};`;
        });
        return `{\n${entries.join('\n')}\n${indent}}`;
    }
    if (isList) {
        const enumType = interpretEnumType(schema);
        const sample = enumType ? null : mergeSamples(schema);
        const arrayPath = [...path, 0];
        const inner = enumType
            ? escapeHtml(enumType)
            : createSchemaHtml(sample, indentation, newIndent, arrayPath);
        return `[\n${innerIndent}${inner}\n${indent}]`;
    }
}

function getTypeLabel(value) {
    if (value === null || value === undefined) return 'null';
    if (Array.isArray(value)) return 'array';
    if (typeof value === 'object') {
        if (value[ENUM_MARKER]) return 'enum';
        return 'object';
    }
    if (typeof value === 'string') return interpretStringType(value) || 'string';
    return typeof value;
}

function escapeHtml(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function escapeAttr(str) {
    return str.replace(/&/g, '&amp;').replace(/'/g, '&#39;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function mergeSamples(items) {
    if (!items.length) return undefined;
    const allObjects = items.every(v => v !== null && typeof v === 'object' && !Array.isArray(v));
    if (allObjects) {
        const merged = {};
        const keys = new Set();
        for (const obj of items) {
            for (const k of Object.keys(obj)) keys.add(k);
        }
        for (const key of keys) {
            const vals = items.map(o => o[key]).filter(v => v !== undefined);
            merged[key] = mergeFieldValues(vals);
        }
        return merged;
    }
    if (items.every(v => Array.isArray(v))) {
        return items.flat();
    }
    return items[0];
}

function mergeFieldValues(vals) {
    if (vals.length === 1) return vals[0];
    if (vals.every(v => v !== null && typeof v === 'object' && !Array.isArray(v))) {
        return mergeSamples(vals);
    }
    if (vals.every(v => Array.isArray(v))) {
        return vals.flat();
    }
    const enumType = interpretEnumType(vals);
    if (enumType) {
        return { [ENUM_MARKER]: enumType };
    }
    return vals[0];
}

function interpretEnumType(values) {
    if (!Array.isArray(values) || values.length < 2) {
        return null;
    }
    if (!values.every(v => typeof v === 'string' && interpretStringType(v) === 'string')) {
        return null;
    }
    const unique = [...new Set(values)];
    const allUppercase = unique.every(v => v === v.toUpperCase() && /[A-Z]/.test(v));
    const threshold = allUppercase
        ? Math.min(Math.ceil(values.length * 0.5), 10)
        : values.length * 0.2;
    if (unique.length > threshold) {
        return null;
    }
    return unique.map(v => `'${v.replace(/'/g, "\\'")}'`).join(' | ');
}

function interpretStringType(value) {
    if (typeof value !== 'string') {
        return null;
    }
    if (/^\d+$/.test(value)) {
        return 'str.integer';
    }
    if (/^\d+\.\d+$/.test(value)) {
        return 'str.float';
    }
    if (/^(true|false)$/.test(value)) {
        return 'str.boolean';
    }
    // 64af12c5-f522-41d0-baf2-dd7a7303e86e
    if(value.length == 36 && value.split("-").length == 5) {
        return 'str.uuid';
    }
    return 'string';
}

export function getObjectDepth(obj, currentDepth = 0) {
    if (typeof obj !== 'object' || obj === null) {
        return currentDepth;
    }

    let maxDepth = currentDepth;
    for (const key in obj) {
        if (obj.hasOwnProperty(key)) {
            const depth = getObjectDepth(obj[key], currentDepth + 1);
            maxDepth = Math.max(maxDepth, depth);
        }
    }

    return maxDepth;
}