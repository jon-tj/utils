import { createSchemaHtml, getObjectDepth } from './schema-generator.js';

const objectInput = document.getElementById('object-input');
const slotSchemaOutput = document.querySelector('[data-slot="schema-output"]');
const slotNumEntries = document.querySelector('[data-slot="num-entries"]');
const slotNumDepth = document.querySelector('[data-slot="num-depth"]');
const fieldDetailCard = document.querySelector('[data-slot="field-detail"]');
const slotPythonPath = document.querySelector('[data-slot="python-path"]');
const slotJsPath = document.querySelector('[data-slot="js-path"]');
const slotFieldType = document.querySelector('[data-slot="field-type"]');
const slotFieldValues = document.querySelector('[data-slot="field-values"]');

let currentData = null;

const btnGenerate = document.getElementById('btn-generate');
btnGenerate.addEventListener('click', (e) => {
    e.preventDefault();
    let obj = null;
    try {
        obj = JSON.parse(objectInput.value);
    } catch (error) {
        console.error("Invalid JSON input:", error);
        slotSchemaOutput.textContent = "Invalid JSON input.";
        fieldDetailCard.classList.add('hidden');
        return;
    }

    const isList = Array.isArray(obj);
    const isDict = obj !== null && typeof obj === 'object' && !isList;

    if (!isList && !isDict) {
        console.error("Input must be a JSON object or array.");
        slotSchemaOutput.textContent = "Input must be a JSON object or array.";
        fieldDetailCard.classList.add('hidden');
        return;
    }

    currentData = obj;
    slotNumEntries.textContent = isList ? obj.length : Object.keys(obj).length;
    slotNumDepth.textContent = getObjectDepth(obj);

    const html = createSchemaHtml(obj);
    slotSchemaOutput.innerHTML = html;
    fieldDetailCard.classList.add('hidden');

    slotSchemaOutput.querySelectorAll('.field-key').forEach(el => {
        el.addEventListener('click', () => handleFieldClick(el));
    });
});

function handleFieldClick(el) {
    slotSchemaOutput.querySelectorAll('.field-key.active').forEach(a => a.classList.remove('active'));
    el.classList.add('active');

    const path = JSON.parse(el.dataset.path);
    const type = el.dataset.type;

    const pythonPath = buildPythonPath(path);
    const jsPath = buildJsPath(path);

    slotPythonPath.textContent = pythonPath;
    slotJsPath.textContent = jsPath;
    slotFieldType.textContent = type;

    const values = collectValues(currentData, path);
    slotFieldValues.textContent = values.length
        ? values.map(v => JSON.stringify(v)).join('\n')
        : '(no values found)';

    fieldDetailCard.classList.remove('hidden');
}

function buildPythonPath(pathParts) {
    return pathParts.map(p => {
        if (typeof p === 'number') return `[${p}]`;
        return `['${p}']`;
    }).join('');
}

function buildJsPath(pathParts) {
    let result = '';
    for (const p of pathParts) {
        if (typeof p === 'number') {
            result += `[${p}]`;
        } else if (/^\d/.test(p) || !/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(p)) {
            result += `['${p}']`;
        } else {
            result += `.${p}`;
        }
    }
    if (result.startsWith('.')) result = result.slice(1);
    return result;
}

function collectValues(data, path) {
    let current = [data];
    for (const key of path) {
        const next = [];
        for (const item of current) {
            if (item == null) continue;
            if (typeof key === 'number') {
                // Array index - collect from all array items
                if (Array.isArray(item)) {
                    next.push(...item);
                }
            } else {
                if (Array.isArray(item)) {
                    for (const el of item) {
                        if (el != null && typeof el === 'object' && key in el) {
                            next.push(el[key]);
                        }
                    }
                } else if (typeof item === 'object' && key in item) {
                    next.push(item[key]);
                }
            }
        }
        current = next;
    }
    // Flatten and deduplicate primitives, limit output
    const flat = [];
    const flatten = (arr) => {
        for (const v of arr) {
            if (Array.isArray(v)) flatten(v);
            else flat.push(v);
        }
    };
    flatten(current);

    const unique = [];
    const seen = new Set();
    for (const v of flat) {
        const key = JSON.stringify(v);
        if (!seen.has(key)) {
            seen.add(key);
            unique.push(v);
        }
        if (unique.length >= 50) break;
    }
    return unique;
}

// Copy on click for path codes
document.addEventListener('click', (e) => {
    const copyable = e.target.closest('.copyable');
    if (!copyable) return;
    navigator.clipboard.writeText(copyable.textContent);
    copyable.classList.add('copied');
    setTimeout(() => copyable.classList.remove('copied'), 1200);
});