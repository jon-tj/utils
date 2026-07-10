// Form handling and orchestration for the nutrition calculator. This module
// only touches the DOM; all output tables and summary blocks live in
// index.html and are populated in place — no HTML strings are constructed
// here.

import { ready, meals, ingredients, findMeal } from './data.js';
import {
    ACTIVITY_LEVELS,
    MEDITERRANEAN_DIET,
    ARIC_DIET,
    NUTRIENT_LABELS,
    interpolateDiet,
    normalizeDietCalories,
    normalizeRatios,
    computeMealNutrients,
    estimateLBM,
} from './nutrition.js';
import { drawGlucoseChart, drawKetoneChart } from './chart.js';
import {
    simulateFastingDay,
    estimateLongevityGainPercent,
    bhbTargetToKmax,
    FASTING,
} from './fasting.js';

const FORM_ELEMENT = document.getElementById('nutrition-form');
const btn = FORM_ELEMENT.querySelector('button');

// Meal times (minutes from midnight) used for the blood-glucose model.
const MEAL_TIMES = {
    Breakfast: 7 * 60,
    Lunch: 12 * 60,
    Dinner: 19 * 60,
};

// -----------------------------------------------------------------------------
// DOM helpers
// -----------------------------------------------------------------------------

// Set every element matching [data-slot="name"] to the same text value.
function setSlot(name, value) {
    document.querySelectorAll(`[data-slot="${name}"]`).forEach(el => {
        el.textContent = value;
    });
}

// Populate <select data-meal-select data-default="..."> with meal names.
function populateMealSelects() {
    FORM_ELEMENT.querySelectorAll('[data-meal-select]').forEach(sel => {
        const preferred = sel.dataset.default;
        sel.replaceChildren();
        meals.forEach((m, i) => {
            const opt = document.createElement('option');
            opt.value = m.name;
            opt.textContent = m.name;
            const isDefault = preferred ? m.name === preferred : i === 0;
            if (isDefault) opt.selected = true;
            sel.appendChild(opt);
        });
    });
}

// Reset any existing data columns on a table with one <th> header column and
// a fixed set of <tr data-nutrient|data-row> rows.
function resetTableColumns(table) {
    const headerRow = table.tHead.rows[0];
    while (headerRow.cells.length > 1) headerRow.deleteCell(-1);
    for (const row of table.tBodies[0].rows) {
        while (row.cells.length > 1) row.deleteCell(-1);
    }
}

function appendCell(row, tag = 'td') {
    const cell = document.createElement(tag);
    row.appendChild(cell);
    return cell;
}

// Populate the diet table with one column per entry in `columns`.
// `columns` items: { label: string, diet: dietObject }
function setDietTable(columns) {
    const table = document.getElementById('diet-table');
    resetTableColumns(table);
    const headerRow = table.tHead.rows[0];
    for (const col of columns) {
        appendCell(headerRow, 'th').textContent = col.label;
    }
    for (const row of table.tBodies[0].rows) {
        const key = row.dataset.nutrient;
        if (!key) continue;
        const [, unit] = NUTRIENT_LABELS[key];
        for (const col of columns) {
            appendCell(row).textContent = `${Math.round(col.diet[key])} ${unit}`;
        }
    }
}

// Populate the per-meal breakdown table with one column per planned meal,
// plus a final "Total" column.
function setMealsTable(plannedMeals) {
    const table = document.getElementById('meals-table');
    resetTableColumns(table);
    const headerRow = table.tHead.rows[0];

    for (const pm of plannedMeals) {
        const mealName = pm.meal ? pm.meal.name : '—';
        const th = appendCell(headerRow, 'th');
        th.appendChild(document.createTextNode(pm.slot.label));
        th.appendChild(document.createElement('br'));
        const small = document.createElement('small');
        small.textContent = `${mealName} (${Math.round(pm.share * 100)}%)`;
        th.appendChild(small);
    }
    appendCell(headerRow, 'th').textContent = 'Total';

    const nutrientKeys = Object.keys(NUTRIENT_LABELS);
    const totals = Object.fromEntries(nutrientKeys.map(k => [k, 0]));
    plannedMeals.forEach(pm => {
        if (!pm.nutrients) return;
        for (const k of nutrientKeys) totals[k] += pm.nutrients[k];
    });

    for (const row of table.tBodies[0].rows) {
        if (row.dataset.row === 'servings') {
            for (const pm of plannedMeals) {
                const cell = appendCell(row);
                if (!pm.meal || pm.scale === 0) {
                    cell.textContent = '—';
                } else {
                    const amount = pm.meal.makes.amount * pm.scale;
                    cell.textContent = `${amount.toFixed(2)} ${pm.meal.makes.unit}(s)`;
                }
            }
            appendCell(row).textContent = '—';
            continue;
        }

        const key = row.dataset.nutrient;
        if (!key) continue;
        const [, unit] = NUTRIENT_LABELS[key];
        for (const pm of plannedMeals) {
            const v = pm.nutrients ? pm.nutrients[key] : 0;
            appendCell(row).textContent = `${Math.round(v)} ${unit}`;
        }
        const totalCell = appendCell(row);
        const strong = document.createElement('strong');
        strong.textContent = `${Math.round(totals[key])} ${unit}`;
        totalCell.appendChild(strong);
    }
}

// Replace the ingredients-table body with one row per ingredient.
function setIngredientsTable(dailyIngredientGrams) {
    const tbody = document.querySelector('#ingredients-table tbody');
    tbody.replaceChildren();
    for (const name of Object.keys(dailyIngredientGrams).sort()) {
        const grams = dailyIngredientGrams[name];
        const ing = ingredients.find(i => i.name === name);
        let freq = '—';
        if (ing && ing.purchaseAmount && grams > 0) {
            const p = ing.purchaseAmount;
            const days = p.convertedToGrams / grams;
            const daysDisplay = days >= 1 ? days.toFixed(1) : days.toFixed(2);
            freq = `1×${p.advertisedAmount}${p.advertisedUnit} every ${daysDisplay} day${days === 1 ? '' : 's'}`;
        }
        const tr = document.createElement('tr');
        appendCell(tr).textContent = name;
        appendCell(tr).textContent = `${Math.round(grams)} g/day`;
        appendCell(tr).textContent = freq;
        tbody.appendChild(tr);
    }
}

// -----------------------------------------------------------------------------
// Slider labels
// -----------------------------------------------------------------------------

// IDs of the three meal-share sliders. Their raw values need not sum to 100;
// they are treated as ratios that get normalized to shares before display
// and before calculation.
const SHARE_SLIDER_IDS = ['breakfast-share', 'lunch-share', 'dinner-share'];

function readShareRatios() {
    const raw = {};
    for (const id of SHARE_SLIDER_IDS) {
        raw[id] = Number(FORM_ELEMENT.querySelector('#' + id).value);
    }
    return normalizeRatios(raw);
}

FORM_ELEMENT.addEventListener('input', () => {
    const walkSlider = FORM_ELEMENT.querySelector('#post-meal-walk');
    if (walkSlider) {
        const out = FORM_ELEMENT.querySelector(`output[for="${walkSlider.id}"]`);
        if (out) out.textContent = `${walkSlider.value} min`;
    }
    const shares = readShareRatios();
    for (const id of SHARE_SLIDER_IDS) {
        const out = FORM_ELEMENT.querySelector(`output[for="${id}"]`);
        if (out) out.textContent = `${Math.round(shares[id] * 100)}%`;
    }
});

ready.then(() => populateMealSelects());

// -----------------------------------------------------------------------------
// Main click handler
// -----------------------------------------------------------------------------

btn.addEventListener('click', (event) => {
    event.preventDefault();

    // ---- 1. BMR / TDEE / diet targets --------------------------------------
    const age = Number(FORM_ELEMENT.querySelector('#age').value);
    const weight = Number(FORM_ELEMENT.querySelector('#weight').value);
    const height = Number(FORM_ELEMENT.querySelector('#height').value);
    const gender = FORM_ELEMENT.querySelector('#gender').value;
    const activity = ACTIVITY_LEVELS[FORM_ELEMENT.querySelector('#activity').value];
    const fatPrc = Number(FORM_ELEMENT.querySelector('#fat-prc').value);
    const dietRatio = Number(FORM_ELEMENT.querySelector('#interpolate-diet').value) * 0.01;
    const caloricRestriction = Number(FORM_ELEMENT.querySelector('#caloric-restriction').value) * 0.01;
    const bhb24h = Number(FORM_ELEMENT.querySelector('#bhb-24h').value) || 1.5;
    const targetBMI = Number(FORM_ELEMENT.querySelector('#target-bmi').value) || 25;

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
    const restrictedTdee = tdee * (1 - caloricRestriction);

    // BMI-driven calorie adjustment: ±500 kcal/day per BMI unit off target,
    // capped at ±750.
    const heightM = height / 100;
    const currentBMI = heightM > 0 ? weight / (heightM * heightM) : targetBMI;
    const bmiDelta = targetBMI - currentBMI;
    const bmiCalorieDelta = Math.max(-750, Math.min(750, bmiDelta * 500));

    const caloryTarget = restrictedTdee + bmiCalorieDelta;
    const lbm = estimateLBM(weight, fatPrc, gender);

    const targetDiet = normalizeDietCalories(interpolatedDiet, caloryTarget);

    let goalLabel;
    if (bmiCalorieDelta < -100) goalLabel = 'Weight Loss';
    else if (bmiCalorieDelta > 100) goalLabel = 'Weight Gain';
    else goalLabel = 'Maintenance';

    setSlot('model', modelToUse);
    setSlot('bmr', `${Math.round(bmr)} kcal/day`);
    setSlot('tdee', `${Math.round(tdee)} kcal/day`);
    setSlot('bmi',
        `${currentBMI.toFixed(1)} (target ${targetBMI.toFixed(1)}, ` +
        `${bmiCalorieDelta >= 0 ? '+' : ''}${Math.round(bmiCalorieDelta)} kcal/day)`);

    setDietTable([{ label: goalLabel, diet: targetDiet }]);

    // ---- 2. Meal planning --------------------------------------------------
    if (!meals.length || !ingredients.length) return;

    const dailyCalories = targetDiet.calories;

    const slots = [
        { label: 'Breakfast', shareId: 'breakfast-share', mealId: 'breakfast-meal' },
        { label: 'Lunch',     shareId: 'lunch-share',     mealId: 'lunch-meal' },
        { label: 'Dinner',    shareId: 'dinner-share',    mealId: 'dinner-meal' },
    ];

    const shares = readShareRatios();

    const dailyIngredientGrams = {};
    const plannedMeals = slots.map(slot => {
        const share = shares[slot.shareId];
        const mealName = FORM_ELEMENT.querySelector('#' + slot.mealId).value;
        const meal = findMeal(mealName);
        const mealTime = MEAL_TIMES[slot.label];
        if (!meal || share <= 0) {
            return { slot, meal, share, scale: 0, mealTime, nutrients: null, scaledIngredients: [] };
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

        return { slot, meal, share, scale, mealTime, nutrients, scaledIngredients };
    });

    setMealsTable(plannedMeals);
    setIngredientsTable(dailyIngredientGrams);

    // ---- 3. Charts + fasting sim ------------------------------------------
    const walkMinutes = Number(FORM_ELEMENT.querySelector('#post-meal-walk').value) || 0;
    drawGlucoseChart(document.getElementById('glucose-chart'), plannedMeals, walkMinutes, weight);

    const kMax = bhbTargetToKmax(bhb24h);
    const sim = simulateFastingDay({ plannedMeals, walkMinutes, kMax, lbm, weight });
    const gainPercent = estimateLongevityGainPercent(sim.benefitAucHours);

    const mealMarkers = plannedMeals
        .filter(pm => pm.meal && pm.scale > 0)
        .map(pm => ({ label: pm.slot.label, time: pm.mealTime }));
    drawKetoneChart(document.getElementById('ketone-chart'), sim, mealMarkers);

    // ---- 4. Longevity summary + explanation slots -------------------------
    const rodentPerHour =
        FASTING.RODENT_LIFESPAN_GAIN_PERCENT / FASTING.RODENT_DAILY_BENEFIT_HOURS;
    const humanPerHour = rodentPerHour * FASTING.HUMAN_TRANSLATION_FACTOR;

    setSlot('peak-bhb', `${Math.max(...sim.B).toFixed(2)} mmol/L`);
    setSlot('benefit-auc', `${sim.benefitAucHours.toFixed(2)} h/day`);
    setSlot('lifespan-gain', `${gainPercent.toFixed(2)}%`);

    setSlot('eta', FASTING.ETA_BASE.toFixed(2));
    setSlot('g-max', `${sim.G_max.toFixed(0)} g`);
    setSlot('g-per-lbm', FASTING.G_MAX_PER_KG_LBM.toFixed(1));
    setSlot('walk-out-mult', FASTING.K_OUT_WALK_MULT.toFixed(1));
    setSlot('g-thr', FASTING.G_THR.toString());
    setSlot('bhb-ss', bhb24h.toFixed(1));
    setSlot('b-50', FASTING.B_50.toString());

    setSlot('rodent-gain', FASTING.RODENT_LIFESPAN_GAIN_PERCENT.toString());
    setSlot('rodent-hours', FASTING.RODENT_DAILY_BENEFIT_HOURS.toString());
    setSlot('rodent-per-hour', rodentPerHour.toFixed(2));
    setSlot('human-factor', FASTING.HUMAN_TRANSLATION_FACTOR.toString());
    setSlot('human-per-hour', humanPerHour.toFixed(2));
});
