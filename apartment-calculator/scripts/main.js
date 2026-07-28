import {
    ready,
    historicalHomePrices,
    latestPricePerSqm,
} from './data.js';
import { calculate_apartment_value } from './apartment-calculator.js';

const FORM_ELEMENT = document.getElementById('apartment-form');
const locationSelect = FORM_ELEMENT.querySelector('#location');
const pricePerSqmInput = FORM_ELEMENT.querySelector('#price-per-sqm');
const btnCalculate = FORM_ELEMENT.querySelector('#btn-calculate');
const btnReset = FORM_ELEMENT.querySelector('#btn-reset');

const numberFmt = new Intl.NumberFormat(undefined, {
    maximumFractionDigits: 0,
});

function setSlot(name, value) {
    document.querySelectorAll(`[data-slot="${name}"]`).forEach(el => {
        el.textContent = value;
    });
}

function populateLocationSelect() {
    const names = Object.keys(historicalHomePrices);
    for (const name of names) {
        const opt = document.createElement('option');
        opt.value = name;
        opt.textContent = name;
        locationSelect.appendChild(opt);
    }
    if (names.length && !locationSelect.value) {
        locationSelect.value = names[0];
    }
}

function fillPricePerSqmFromLocation() {
    const latest = latestPricePerSqm(locationSelect.value);
    pricePerSqmInput.placeholder = latest ? String(latest.price) : '';
}

function effectivePricePerSqm(rawValue) {
    if (rawValue !== null && rawValue !== '') return Number(rawValue);
    const placeholder = pricePerSqmInput.placeholder;
    return placeholder === '' ? 0 : Number(placeholder);
}

function renderHistoryTable(location) {
    const tbody = document.querySelector('#history-table tbody');
    tbody.replaceChildren();
    const entry = historicalHomePrices[location];
    if (!entry) return;
    // Show most recent first, limit to a reasonable number of rows.
    const rows = entry.dates
        .map((d, i) => ({ date: d, price: entry.sqmPrice[i] }))
        .reverse()
        .slice(0, 20);
    rows.forEach((r, i) => {
        const tr = document.createElement('tr');
        if (i % 2 === 1) tr.classList.add('even');
        const tdDate = document.createElement('td');
        tdDate.textContent = r.date;
        const tdPrice = document.createElement('td');
        tdPrice.textContent = numberFmt.format(r.price);
        tr.append(tdDate, tdPrice);
        tbody.appendChild(tr);
    });
}

function readForm() {
    const data = new FormData(FORM_ELEMENT);
    const num = k => {
        const v = data.get(k);
        return v === null || v === '' ? 0 : Number(v);
    };
    return {
        location: data.get('location') || '',
        sqm: num('sqm'),
        pricePerSqm: effectivePricePerSqm(data.get('price-per-sqm')),
        bedrooms: num('bedrooms'),
        floor: num('floor'),
        taxMonthly: num('tax-monthly'),
        feesMonthly: num('fees-monthly'),
    };
}

function render(result) {
    setSlot('apartment-value', numberFmt.format(result.value));
    setSlot('location', result.location || '—');
    setSlot('sqm', `${numberFmt.format(result.sqm)} m²`);
    setSlot('price-per-sqm', numberFmt.format(result.pricePerSqm));
    setSlot('bedrooms', result.bedrooms);
    setSlot('floor', result.floor);
    setSlot('monthly-costs', numberFmt.format(result.monthlyCosts));
    setSlot('annual-costs', numberFmt.format(result.annualCosts));
}

function calculate() {
    const f = readForm();
    const result = calculate_apartment_value(
        f.sqm,
        f.pricePerSqm,
        f.bedrooms,
        f.location,
        f.floor,
        f.taxMonthly,
        f.feesMonthly,
    );
    render(result);
    renderHistoryTable(f.location);
}

btnCalculate.addEventListener('click', event => {
    event.preventDefault();
    if (!FORM_ELEMENT.checkValidity()) {
        FORM_ELEMENT.reportValidity();
        return;
    }
    calculate();
});

btnReset.addEventListener('click', event => {
    event.preventDefault();
    FORM_ELEMENT.reset();
    fillPricePerSqmFromLocation();
    if (FORM_ELEMENT.checkValidity()) calculate();
});

locationSelect.addEventListener('change', () => {
    fillPricePerSqmFromLocation();
});

ready.then(() => {
    populateLocationSelect();
    fillPricePerSqmFromLocation();
    if (FORM_ELEMENT.checkValidity()) calculate();
});
