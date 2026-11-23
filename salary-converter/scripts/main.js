const form = document.getElementById('salary-form');
const contextIds = ['workdayHours', 'workdaysPerWeek', 'weeksPerYear', 'paidDaysOff', 'taxRate'];
const salaryInputs = [...form.querySelectorAll('[data-salary]')];
const hoursSummary = form.querySelector('[data-slot="hours-summary"]');

const defaults = Object.fromEntries(contextIds.map((id) => [id, document.getElementById(id).value]));

// The field the user last typed into; everything else is derived from it.
let source = null;

function num(id) {
    const value = parseFloat(document.getElementById(id).value);
    return Number.isFinite(value) ? value : 0;
}

function getContext() {
    const hoursPerDay = num('workdayHours');
    const workdays = num('workdaysPerWeek') * num('weeksPerYear') - num('paidDaysOff');
    return {
        hoursPerYear: Math.max(0, workdays * hoursPerDay),
        workdays,
        keepRate: 1 - num('taxRate') / 100,
    };
}

/** Convert a salary value of the given period to a yearly, before-tax amount. */
function toYearlyGross(value, period, taxed, ctx) {
    let yearly;
    if (period === 'yearly') yearly = value;
    else if (period === 'monthly') yearly = value * 12;
    else yearly = value * ctx.hoursPerYear;
    return taxed ? (ctx.keepRate > 0 ? yearly / ctx.keepRate : NaN) : yearly;
}

function fromYearlyGross(yearlyGross, period, taxed, ctx) {
    const yearly = taxed ? yearlyGross * ctx.keepRate : yearlyGross;
    if (period === 'yearly') return yearly;
    if (period === 'monthly') return yearly / 12;
    return ctx.hoursPerYear > 0 ? yearly / ctx.hoursPerYear : NaN;
}

function format(value, period) {
    if (!Number.isFinite(value)) return '';
    const decimals = period === 'hourly' ? 2 : 0;
    return (Math.round(value * 10 ** decimals) / 10 ** decimals).toString();
}

function update() {
    const ctx = getContext();
    hoursSummary.textContent =
        `${ctx.workdays.toLocaleString()} workdays · ${ctx.hoursPerYear.toLocaleString()} working hours per year`;

    if (!source) return;
    const raw = source.value.trim();
    if (raw === '') {
        salaryInputs.forEach((input) => { if (input !== source) input.value = ''; });
        return;
    }

    const yearlyGross = toYearlyGross(
        parseFloat(raw),
        source.dataset.salary,
        source.dataset.taxed === 'true',
        ctx,
    );

    for (const input of salaryInputs) {
        if (input === source) continue;
        input.value = format(
            fromYearlyGross(yearlyGross, input.dataset.salary, input.dataset.taxed === 'true', ctx),
            input.dataset.salary,
        );
    }
}

salaryInputs.forEach((input) => {
    input.addEventListener('input', () => {
        source = input;
        update();
    });
});

contextIds.forEach((id) => document.getElementById(id).addEventListener('input', update));

form.addEventListener('submit', (e) => e.preventDefault());

document.getElementById('btn-reset').addEventListener('click', () => {
    contextIds.forEach((id) => { document.getElementById(id).value = defaults[id]; });
    salaryInputs.forEach((input) => { input.value = ''; });
    source = null;
    update();
});

update();
