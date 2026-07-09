const FORM_ELEMENT = document.getElementById('nutrition-form');
const OUTPUT_ELEMENT = document.getElementById('output');
const MEAL_FORM_ELEMENT = document.getElementById('meal-planner-form');
const MEAL_OUTPUT_ELEMENT = document.getElementById('output-meals');

const btn = FORM_ELEMENT.querySelector('button');
const mealBtn = MEAL_FORM_ELEMENT.querySelector('button');

let lastColumns = null;

const ACTIVITY_LEVELS = {
    sedentary: 1.2,
    light: 1.375,
    moderate: 1.55,
    active: 1.725,
};

const MEDITERRANEAN_DIET = {
    calories: 2080,
    protein: 110,
    fatTotal: 90,
    SFA: 16,
    MUFA: 52,
    PUFA: 22,
    carbs: 225,
    sugars: 50,
    fiber: 40,
    salt: 2,
};

const ARIC_DIET = {
    calories: 2150,
    protein: 110,
    fatTotal: 80,
    SFA: 12,
    MUFA: 48,
    PUFA: 20,
    carbs: 270, // https://pmc.ncbi.nlm.nih.gov/articles/PMC6339822/
    sugars: 30,
    fiber: 50,
    salt: 2,
};

function interpolateDiet(diet1, diet2, ratio) {
    const interpolatedDiet = {};
    for (const key in diet1) {
        if (diet1.hasOwnProperty(key) && diet2.hasOwnProperty(key)) {
            interpolatedDiet[key] = diet1[key] * (1 - ratio) + diet2[key] * ratio;
        }
    }
    return interpolatedDiet;
}

function normalizeDietCalories(diet, targetCalories = 2000) {
    diet = { ...diet }; // Create a shallow copy to avoid mutating the original diet
    const currentCalories = diet.calories;
    const scalingFactor = targetCalories / currentCalories;
    for (const key in diet) {
        if (diet.hasOwnProperty(key)) {
            diet[key] *= scalingFactor;
        }
    }
    return diet;
}

var meals = [];
fetch('meals.json')
    .then(response => response.json())
    .then(data => {
        meals = data;
        populateMealSelects();
    });

var ingredients = [];
fetch('ingredients.json')
    .then(response => response.json())
    .then(data => {
        ingredients = data;
    });

function findIngredient(name) {
    return ingredients.find(i => i.name === name);
}

function findMeal(name) {
    return meals.find(m => m.name === name);
}

// Compute total nutrients (per full recipe) for a meal by summing ingredients.
function computeMealNutrients(meal) {
    const totals = {
        calories: 0, protein: 0, fatTotal: 0, SFA: 0, MUFA: 0, PUFA: 0,
        carbs: 0, sugars: 0, fiber: 0, salt: 0,
    };
    for (const item of meal.ingredients) {
        const ing = findIngredient(item.name);
        if (!ing) continue;
        const factor = item.amount / 100; // ingredient values are per 100g
        for (const key in totals) {
            totals[key] += (ing.per100g[key] || 0) * factor;
        }
    }
    return totals;
}

// Compute total glycemic load for a meal at a given scaling factor.
// Standard formula: GL = GI × (available carbs grams) / 100.
function computeMealGL(meal, scale = 1) {
    let gl = 0;
    for (const item of meal.ingredients) {
        const ing = findIngredient(item.name);
        if (!ing || !ing.metabolism) continue;
        const grams = item.amount * scale;
        const carbGrams = (ing.per100g.carbs || 0) * grams / 100;
        gl += (ing.metabolism.glycemicIndex || 0) * carbGrams / 100;
    }
    return gl;
}

function populateMealSelects() {
    const selects = MEAL_FORM_ELEMENT.querySelectorAll('[data-meal-select]');
    selects.forEach(sel => {
        sel.innerHTML = meals.map((m, i) =>
            `<option value="${m.name}"${i === 0 ? ' selected' : ''}>${m.name}</option>`
        ).join('');
    });
}

// Live-update slider value labels and share total.
MEAL_FORM_ELEMENT.addEventListener('input', () => {
    const sliders = MEAL_FORM_ELEMENT.querySelectorAll('input[type="range"]');
    let total = 0;
    sliders.forEach(slider => {
        total += Number(slider.value);
        const out = MEAL_FORM_ELEMENT.querySelector(`output[for="${slider.id}"]`);
        if (out) out.textContent = `${slider.value}%`;
    });
    const totalEl = MEAL_FORM_ELEMENT.querySelector('#share-total');
    if (totalEl) totalEl.textContent = `Total: ${total}% of daily calories`;
});

btn.addEventListener('click', (event) => {
    event.preventDefault();

    const age = Number(FORM_ELEMENT.querySelector('#age').value);
    const weight = Number(FORM_ELEMENT.querySelector('#weight').value);
    const height = Number(FORM_ELEMENT.querySelector('#height').value);
    const gender = FORM_ELEMENT.querySelector('#gender').value;
    const activity = ACTIVITY_LEVELS[FORM_ELEMENT.querySelector('#activity').value];
    const fatPrc = Number(FORM_ELEMENT.querySelector('#fat-prc').value);
    const dietRatio = Number(FORM_ELEMENT.querySelector('#interpolate-diet').value) * 0.01;
    const caloricRestriction = Number(FORM_ELEMENT.querySelector('#caloric-restriction').value) * 0.01;

    const interpolatedDiet = interpolateDiet(MEDITERRANEAN_DIET, ARIC_DIET, dietRatio);

    let bmr;
    let modelToUse;

    if (fatPrc) {
        modelToUse = 'Katch-McArdle';

        const leanBodyMass = weight * (1 - fatPrc / 100);
        bmr = 370 + (21.6 * leanBodyMass);
    } else {
        modelToUse = 'Mifflin-St Jeor';
        bmr = (10 * weight) + (6.25 * height) - (5 * age) + (gender === 'male' ? 5 : -161);
    }

    const tdee = bmr * activity;
    const caloryTarget = tdee * (1 - caloricRestriction);

    const targetDietHealthy = normalizeDietCalories(interpolatedDiet, caloryTarget);
    const targetDietWeightLoss = normalizeDietCalories(interpolatedDiet, caloryTarget - 500);
    const targetDietWeightGain = normalizeDietCalories(interpolatedDiet, caloryTarget + 500);

    const NUTRIENT_LABELS = {
        calories: ['Calories', 'kcal'],
        protein: ['Protein', 'g'],
        fatTotal: ['Total Fat', 'g'],
        SFA: ['Saturated Fat', 'g'],
        MUFA: ['Monounsaturated Fat', 'g'],
        PUFA: ['Polyunsaturated Fat', 'g'],
        carbs: ['Carbohydrates', 'g'],
        sugars: ['Sugars', 'g'],
        fiber: ['Fiber', 'g'],
        salt: ['Salt', 'g'],
    };

    const columns = [
        ['Weight Loss', targetDietWeightLoss],
        ['Maintenance', targetDietHealthy],
        ['Weight Gain', targetDietWeightGain],
    ];
    lastColumns = columns;

    const rows = Object.keys(NUTRIENT_LABELS).map(key => {
        const [label, unit] = NUTRIENT_LABELS[key];
        const cells = columns.map(([, diet]) => `<td>${Math.round(diet[key])} ${unit}</td>`).join('');
        return `<tr><td>${label}</td>${cells}</tr>`;
    }).join('');

    OUTPUT_ELEMENT.innerHTML = `
        <div class="summary">
            <div><strong>Model:</strong> ${modelToUse}</div>
            <div><strong>BMR:</strong> ${Math.round(bmr)} kcal/day</div>
            <div><strong>TDEE:</strong> ${Math.round(tdee)} kcal/day</div>
        </div>
        <table>
            <thead>
                <tr>
                    <th>Nutrient</th>
                    ${columns.map(([name]) => `<th>${name}</th>`).join('')}
                </tr>
            </thead>
            <tbody>
                ${rows}
            </tbody>
        </table>
    `;
});

const NUTRIENT_LABELS_GLOBAL = {
    calories: ['Calories', 'kcal'],
    protein: ['Protein', 'g'],
    fatTotal: ['Total Fat', 'g'],
    SFA: ['Saturated Fat', 'g'],
    MUFA: ['Monounsaturated Fat', 'g'],
    PUFA: ['Polyunsaturated Fat', 'g'],
    carbs: ['Carbohydrates', 'g'],
    sugars: ['Sugars', 'g'],
    fiber: ['Fiber', 'g'],
    salt: ['Salt', 'g'],
};

mealBtn.addEventListener('click', (event) => {
    event.preventDefault();

    if (!lastColumns) {
        MEAL_OUTPUT_ELEMENT.innerHTML = `<em>Please click "Calculate" first.</em>`;
        return;
    }
    if (!meals.length || !ingredients.length) {
        MEAL_OUTPUT_ELEMENT.innerHTML = `<em>Loading meal/ingredient data…</em>`;
        return;
    }

    // Use the Maintenance column as the daily calorie target for meal planning.
    const maintenanceDiet = lastColumns.find(([name]) => name === 'Maintenance')[1];
    const dailyCalories = maintenanceDiet.calories;

    const slots = [
        { label: 'Breakfast', shareId: 'breakfast-share', mealId: 'breakfast-meal' },
        { label: 'Lunch',     shareId: 'lunch-share',     mealId: 'lunch-meal' },
        { label: 'Dinner',    shareId: 'dinner-share',    mealId: 'dinner-meal' },
    ];

    // Compute scaled meals + aggregate ingredient usage per day.
    const dailyIngredientGrams = {}; // name -> grams/day
    const plannedMeals = slots.map(slot => {
        const share = Number(MEAL_FORM_ELEMENT.querySelector('#' + slot.shareId).value) * 0.01;
        const mealName = MEAL_FORM_ELEMENT.querySelector('#' + slot.mealId).value;
        const meal = findMeal(mealName);
        if (!meal || share <= 0) {
            return { slot, meal, share, scale: 0, nutrients: null, scaledIngredients: [] };
        }

        const baseNutrients = computeMealNutrients(meal);
        const targetCalories = dailyCalories * share;
        const scale = baseNutrients.calories > 0 ? targetCalories / baseNutrients.calories : 0;

        const nutrients = {};
        for (const key in baseNutrients) nutrients[key] = baseNutrients[key] * scale;

        const scaledIngredients = meal.ingredients.map(item => {
            const grams = item.amount * scale;
            dailyIngredientGrams[item.name] = (dailyIngredientGrams[item.name] || 0) + grams;
            return { name: item.name, grams };
        });

        return { slot, meal, share, scale, nutrients, scaledIngredients };
    });

    // Nutrient breakdown table.
    const nutrientKeys = Object.keys(NUTRIENT_LABELS_GLOBAL);
    const nutrientTotals = Object.fromEntries(nutrientKeys.map(k => [k, 0]));
    plannedMeals.forEach(pm => {
        if (!pm.nutrients) return;
        for (const k of nutrientKeys) nutrientTotals[k] += pm.nutrients[k];
    });

    const nutrientRows = nutrientKeys.map(key => {
        const [label, unit] = NUTRIENT_LABELS_GLOBAL[key];
        const cells = plannedMeals.map(pm =>
            `<td>${pm.nutrients ? Math.round(pm.nutrients[key]) : 0} ${unit}</td>`
        ).join('');
        return `<tr><td>${label}</td>${cells}<td><strong>${Math.round(nutrientTotals[key])} ${unit}</strong></td></tr>`;
    }).join('');

    const mealHeaderCells = plannedMeals.map(pm => {
        const mealName = pm.meal ? pm.meal.name : '—';
        return `<th>${pm.slot.label}<br><small>${mealName} (${Math.round(pm.share * 100)}%)</small></th>`;
    }).join('');

    // "Makes" row: how many servings of each meal to prepare.
    const servingRow = `<tr><td>Servings</td>${
        plannedMeals.map(pm => {
            if (!pm.meal || pm.scale === 0) return `<td>—</td>`;
            const amount = pm.meal.makes.amount * pm.scale;
            return `<td>${amount.toFixed(2)} ${pm.meal.makes.unit}(s)</td>`;
        }).join('')
    }<td>—</td></tr>`;

    // Ingredient table: daily grams + purchase frequency.
    const ingredientRows = Object.keys(dailyIngredientGrams).sort().map(name => {
        const grams = dailyIngredientGrams[name];
        const ing = findIngredient(name);
        let freq = '—';
        if (ing && ing.purchaseAmount && grams > 0) {
            const p = ing.purchaseAmount;
            const days = p.convertedToGrams / grams;
            const daysDisplay = days >= 1 ? days.toFixed(1) : days.toFixed(2);
            freq = `1×${p.advertisedAmount}${p.advertisedUnit} every ${daysDisplay} day${days === 1 ? '' : 's'}`;
        }
        return `<tr><td>${name}</td><td>${Math.round(grams)} g/day</td><td>${freq}</td></tr>`;
    }).join('');

    MEAL_OUTPUT_ELEMENT.innerHTML = `
        <h4>Per-meal breakdown</h4>
        <table>
            <thead>
                <tr>
                    <th>Nutrient</th>
                    ${mealHeaderCells}
                    <th>Total</th>
                </tr>
            </thead>
            <tbody>
                ${servingRow}
                ${nutrientRows}
            </tbody>
        </table>
        <h4>Ingredients (daily)</h4>
        <table>
            <thead>
                <tr>
                    <th>Ingredient</th>
                    <th>Amount</th>
                    <th>Purchase frequency</th>
                </tr>
            </thead>
            <tbody>
                ${ingredientRows}
            </tbody>
        </table>
        <h4>Estimated blood glucose</h4>
        <canvas id="glucose-chart" width="720" height="260"></canvas>
    `;

    drawGlucoseChart(plannedMeals);
});

// Meal times (minutes from midnight) used for the blood-glucose model.
const MEAL_TIMES = {
    Breakfast: 7 * 60,
    Lunch: 12 * 60,
    Dinner: 19 * 60,
};

// Simple post-prandial glucose response model:
//   rise(t) = GL × PEAK_SCALE × x × exp(1 - x),  x = t / T_PEAK
// - peaks at t = T_PEAK with value = GL × PEAK_SCALE (mg/dL)
// - returns near baseline by ~3 h
const BASELINE_MG_DL = 90;
const T_PEAK_MIN = 45;
const PEAK_SCALE = 2.0; // mg/dL per unit GL at peak

function glucoseResponse(minutesSinceMeal, GL) {
    if (minutesSinceMeal <= 0 || GL <= 0) return 0;
    const x = minutesSinceMeal / T_PEAK_MIN;
    return GL * PEAK_SCALE * x * Math.exp(1 - x);
}

function drawGlucoseChart(plannedMeals) {
    const canvas = document.getElementById('glucose-chart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const W = canvas.width;
    const H = canvas.height;

    // Compute GL per meal + arrival time.
    const events = plannedMeals
        .filter(pm => pm.meal && pm.scale > 0)
        .map(pm => ({
            label: pm.slot.label,
            mealName: pm.meal.name,
            time: MEAL_TIMES[pm.slot.label],
            GL: computeMealGL(pm.meal, pm.scale),
        }));

    // Sample glucose every 5 minutes over 24h.
    const stepMin = 5;
    const samples = [];
    for (let t = 0; t <= 24 * 60; t += stepMin) {
        let g = BASELINE_MG_DL;
        for (const ev of events) g += glucoseResponse(t - ev.time, ev.GL);
        samples.push({ t, g });
    }

    const yMin = 70;
    const yMax = Math.max(160, Math.ceil(Math.max(...samples.map(s => s.g)) / 10) * 10 + 10);

    // Layout.
    const pad = { top: 20, right: 20, bottom: 40, left: 50 };
    const plotW = W - pad.left - pad.right;
    const plotH = H - pad.top - pad.bottom;

    ctx.clearRect(0, 0, W, H);
    ctx.font = '12px sans-serif';

    const xOfMin = t => pad.left + (t / (24 * 60)) * plotW;
    const yOfMgDl = g => pad.top + (1 - (g - yMin) / (yMax - yMin)) * plotH;

    // Gridlines & y labels every 20 mg/dL.
    ctx.strokeStyle = '#eee';
    ctx.fillStyle = '#666';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (let g = Math.ceil(yMin / 20) * 20; g <= yMax; g += 20) {
        const y = yOfMgDl(g);
        ctx.beginPath();
        ctx.moveTo(pad.left, y);
        ctx.lineTo(W - pad.right, y);
        ctx.stroke();
        ctx.fillText(String(g), pad.left - 6, y);
    }

    // X-axis (hours) labels every 3h.
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (let h = 0; h <= 24; h += 3) {
        const x = xOfMin(h * 60);
        ctx.strokeStyle = '#eee';
        ctx.beginPath();
        ctx.moveTo(x, pad.top);
        ctx.lineTo(x, pad.top + plotH);
        ctx.stroke();
        ctx.fillText(`${h}:00`, x, pad.top + plotH + 6);
    }

    // Axes.
    ctx.strokeStyle = '#333';
    ctx.beginPath();
    ctx.moveTo(pad.left, pad.top);
    ctx.lineTo(pad.left, pad.top + plotH);
    ctx.lineTo(W - pad.right, pad.top + plotH);
    ctx.stroke();

    // Baseline line.
    ctx.strokeStyle = '#bbb';
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(pad.left, yOfMgDl(BASELINE_MG_DL));
    ctx.lineTo(W - pad.right, yOfMgDl(BASELINE_MG_DL));
    ctx.stroke();
    ctx.setLineDash([]);

    // Glucose curve.
    ctx.strokeStyle = '#c0392b';
    ctx.lineWidth = 2;
    ctx.beginPath();
    samples.forEach((s, i) => {
        const x = xOfMin(s.t);
        const y = yOfMgDl(s.g);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
    });
    ctx.stroke();
    ctx.lineWidth = 1;

    // Meal markers.
    ctx.fillStyle = '#2980b9';
    ctx.strokeStyle = '#2980b9';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    for (const ev of events) {
        const x = xOfMin(ev.time);
        ctx.beginPath();
        ctx.moveTo(x, pad.top);
        ctx.lineTo(x, pad.top + plotH);
        ctx.globalAlpha = 0.25;
        ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.fillText(`${ev.label} (GL ${ev.GL.toFixed(1)})`, x, pad.top - 4);
    }

    // Axis titles.
    ctx.fillStyle = '#333';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText('Time of day', pad.left + plotW / 2, H - 4);
    ctx.save();
    ctx.translate(12, pad.top + plotH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textBaseline = 'top';
    ctx.fillText('Blood glucose (mg/dL)', 0, 0);
    ctx.restore();
}