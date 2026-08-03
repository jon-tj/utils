import { createTypescriptInterface, getObjectDepth } from './schema-generator.js';

const objectInput = document.getElementById('object-input');
const slotSchemaOutput = document.querySelector('[data-slot="schema-output"]');
const slotNumEntries = document.querySelector('[data-slot="num-entries"]');
const slotNumDepth = document.querySelector('[data-slot="num-depth"]');

const btnGenerate = document.getElementById('btn-generate');
btnGenerate.addEventListener('click', (e) => {
    e.preventDefault();
    let obj = null;
    try {
        obj = JSON.parse(objectInput.value);
    } catch (error) {
        console.error("Invalid JSON input:", error);
        slotSchemaOutput.textContent = "Invalid JSON input.";
        return;
    }

    const isList = Array.isArray(obj);
    const isDict = obj !== null && typeof obj === 'object' && !isList;

    if (!isList && !isDict) {
        console.error("Input must be a JSON object or array.");
        slotSchemaOutput.textContent = "Input must be a JSON object or array.";
        return;
    }

    slotNumEntries.textContent = isList ? obj.length : Object.keys(obj).length;
    slotNumDepth.textContent = getObjectDepth(obj);
    slotSchemaOutput.textContent = createTypescriptInterface(obj);
});