// Form handling and orchestration for the nutrition calculator.

import { ready, meals, ingredients, findMeal } from './data.js';
import {
    ACTIVITY_LEVELS,
    MEDITERRANEAN_DIET,
    ARIC_DIET,
    NUTRIENT_LABELS,
    interpolateDiet,
    normalizeDietCalories,
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
const OUTPUT_ELEMENT = document.getElementById('output');
const MEAL_OUTPUT_ELEMENT = document.getElementById('output-meals');

const btn = FORM_ELEMENT.querySelector('button');

// Meal times (minutes from midnight) used for the blood-glucose model.
const MEAL_TIMES = {
    Breakfast: 7 * 60,
    Lunch: 12 * 60,
    Dinner: 19 * 60,
};

ready.then(() => populateMealSelects());

function populateMealSelects() {
    const selects = FORM_ELEMENT.querySelectorAll('[data-meal-select]');
    selects.forEach(sel => {
        const preferred = sel.dataset.default;
        sel.innerHTML = meals.map((m, i) => {
            const isSelected = preferred
                ? m.name === preferred
                : i === 0;
            return `<option value="${m.name}"${isSelected ? ' selected' : ''}>${m.name}</option>`;
        }).join('');
    });
}

// Live-update slider value labels and share total.
FORM_ELEMENT.addEventListener('input', () => {
    const shareIds = ['breakfast-share', 'lunch-share', 'dinner-share'];
    let total = 0;
    FORM_ELEMENT.querySelectorAll('input[type="range"]').forEach(slider => {
        const out = FORM_ELEMENT.querySelector(`output[for="${slider.id}"]`);
        if (slider.id === 'post-meal-walk') {
            if (out) out.textContent = `${slider.value} min`;
            return;
        }
        if (shareIds.includes(slider.id)) total += Number(slider.value);
        if (out) out.textContent = `${slider.value}%`;
    });
    const totalEl = FORM_ELEMENT.querySelector('#share-total');
    if (totalEl) totalEl.textContent = `Total: ${total}% of daily calories`;
});

btn.addEventListener('click', (event) => {
    event.preventDefault();

    // -------------------------------------------------------------------
    // 1. BMR / TDEE / diet targets
    // -------------------------------------------------------------------
    const age = Number(FORM_ELEMENT.querySelector('#age').value);
    const weight = Number(FORM_ELEMENT.querySelector('#weight').value);
    const height = Number(FORM_ELEMENT.querySelector('#height').value);
    const gender = FORM_ELEMENT.querySelector('#gender').value;
    const activity = ACTIVITY_LEVELS[FORM_ELEMENT.querySelector('#activity').value];
    const fatPrc = Number(FORM_ELEMENT.querySelector('#fat-prc').value);
    const dietRatio = Number(FORM_ELEMENT.querySelector('#interpolate-diet').value) * 0.01;
    const caloricRestriction = Number(FORM_ELEMENT.querySelector('#caloric-restriction').value) * 0.01;
    const bhb24h = Number(FORM_ELEMENT.querySelector('#bhb-24h').value) || 1.5;

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

    // Adjust calories based on current-vs-target BMI. Rule of thumb:
    // ~500 kcal/day deficit ≈ 0.45 kg/week weight change. 1 BMI unit for a
    // typical adult ≈ 3 kg, so we scale by 500 kcal per BMI unit off target,
    // capped at ±750 kcal/day to keep the change safe.
    const targetBMI = Number(FORM_ELEMENT.querySelector('#target-bmi').value) || 25;
    const heightM = height / 100;
    const currentBMI = heightM > 0 ? weight / (heightM * heightM) : targetBMI;
    const bmiDelta = targetBMI - currentBMI; // >0 = user wants to gain, <0 = lose
    const bmiCalorieDelta = Math.max(-750, Math.min(750, bmiDelta * 500));

    const caloryTarget = restrictedTdee + bmiCalorieDelta;
    const lbm = estimateLBM(weight, fatPrc, gender);

    const targetDiet = normalizeDietCalories(interpolatedDiet, caloryTarget);

    let goalLabel;
    if (bmiCalorieDelta < -100) goalLabel = 'Weight Loss';
    else if (bmiCalorieDelta > 100) goalLabel = 'Weight Gain';
    else goalLabel = 'Maintenance';

    const columns = [[goalLabel, targetDiet]];

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
            <div><strong>Current BMI:</strong> ${currentBMI.toFixed(1)}
                (target ${targetBMI.toFixed(1)},
                ${bmiCalorieDelta >= 0 ? '+' : ''}${Math.round(bmiCalorieDelta)} kcal/day)</div>
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

    // -------------------------------------------------------------------
    // 2. Meal planning + glucose + fasting
    // -------------------------------------------------------------------
    if (!meals.length || !ingredients.length) {
        MEAL_OUTPUT_ELEMENT.innerHTML = `<em>Loading meal/ingredient data…</em>`;
        return;
    }

    const dailyCalories = targetDiet.calories;

    const slots = [
        { label: 'Breakfast', shareId: 'breakfast-share', mealId: 'breakfast-meal' },
        { label: 'Lunch',     shareId: 'lunch-share',     mealId: 'lunch-meal' },
        { label: 'Dinner',    shareId: 'dinner-share',    mealId: 'dinner-meal' },
    ];

    const dailyIngredientGrams = {};
    const plannedMeals = slots.map(slot => {
        const share = Number(FORM_ELEMENT.querySelector('#' + slot.shareId).value) * 0.01;
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

    const nutrientKeys = Object.keys(NUTRIENT_LABELS);
    const nutrientTotals = Object.fromEntries(nutrientKeys.map(k => [k, 0]));
    plannedMeals.forEach(pm => {
        if (!pm.nutrients) return;
        for (const k of nutrientKeys) nutrientTotals[k] += pm.nutrients[k];
    });

    const nutrientRows = nutrientKeys.map(key => {
        const [label, unit] = NUTRIENT_LABELS[key];
        const cells = plannedMeals.map(pm =>
            `<td>${pm.nutrients ? Math.round(pm.nutrients[key]) : 0} ${unit}</td>`
        ).join('');
        return `<tr><td>${label}</td>${cells}<td><strong>${Math.round(nutrientTotals[key])} ${unit}</strong></td></tr>`;
    }).join('');

    const mealHeaderCells = plannedMeals.map(pm => {
        const mealName = pm.meal ? pm.meal.name : '—';
        return `<th>${pm.slot.label}<br><small>${mealName} (${Math.round(pm.share * 100)}%)</small></th>`;
    }).join('');

    const servingRow = `<tr><td>Servings</td>${
        plannedMeals.map(pm => {
            if (!pm.meal || pm.scale === 0) return `<td>—</td>`;
            const amount = pm.meal.makes.amount * pm.scale;
            return `<td>${amount.toFixed(2)} ${pm.meal.makes.unit}(s)</td>`;
        }).join('')
    }<td>—</td></tr>`;

    const ingredientRows = Object.keys(dailyIngredientGrams).sort().map(name => {
        const grams = dailyIngredientGrams[name];
        const ing = ingredients.find(i => i.name === name);
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
        <h4>Estimated plasma &beta;-hydroxybutyrate &amp; fasting benefit</h4>
        <canvas id="ketone-chart" width="720" height="260"></canvas>
        <div id="longevity-summary"></div>
        <em id="longevity-explanation"></em>
    `;

    const walkMinutes = Number(FORM_ELEMENT.querySelector('#post-meal-walk').value) || 0;
    drawGlucoseChart(document.getElementById('glucose-chart'), plannedMeals, walkMinutes, weight);

    const kMax = bhbTargetToKmax(bhb24h);
    const sim = simulateFastingDay({ plannedMeals, walkMinutes, kMax, lbm, weight });
    const gainPercent = estimateLongevityGainPercent(sim.benefitAucHours);

    const mealMarkers = plannedMeals
        .filter(pm => pm.meal && pm.scale > 0)
        .map(pm => ({ label: pm.slot.label, time: pm.mealTime }));
    drawKetoneChart(document.getElementById('ketone-chart'), sim, mealMarkers);

    const rodentPerHour =
        FASTING.RODENT_LIFESPAN_GAIN_PERCENT / FASTING.RODENT_DAILY_BENEFIT_HOURS;
    const humanPerHour = rodentPerHour * FASTING.HUMAN_TRANSLATION_FACTOR;

    document.getElementById('longevity-summary').innerHTML = `
        <div class="summary">
            <div><strong>Peak &beta;-HB:</strong> ${Math.max(...sim.B).toFixed(2)} mmol/L</div>
            <div><strong>Daily benefit AUC:</strong> ${sim.benefitAucHours.toFixed(2)} h/day
                <small>(hours-equivalent above the benefit threshold)</small></div>
            <div><strong>Estimated lifespan gain:</strong> ${gainPercent.toFixed(2)}%
                <small>(if sustained daily)</small></div>
        </div>
    `;

    document.getElementById('longevity-explanation').innerHTML = `
        The &beta;-HB curve is produced by a simple two-compartment model.
        Meal carbohydrates enter the bloodstream via each ingredient's own
        gamma-shaped impulse (per-ingredient GI &rarr; peak time; the
        co-ingested fat and fiber in the same meal reduce peak amplitude
        and delay it; a post-meal walk uniformly reduces amplitude via
        muscle GLUT4 uptake). A fraction &eta; = ${FASTING.ETA_BASE.toFixed(2)}
        of absorbed carbs replenishes liver glycogen (saturating at
        G<sub>max</sub> = ${sim.G_max.toFixed(0)} g, computed as
        ${FASTING.G_MAX_PER_KG_LBM} g/kg lean body mass); a walk reduces
        that fraction proportionally. The liver drains glycogen at ~2
        mg/kg/min at rest and ${FASTING.K_OUT_WALK_MULT}&times; faster
        during a walk. Once glycogen falls below ~${FASTING.G_THR} g the
        ketogenesis gate opens (soft sigmoid) and &beta;-HB rises toward a
        steady state of K<sub>max</sub>/K<sub>clr</sub> =
        ${bhb24h.toFixed(1)} mmol/L (your input). A benefit-rate sigmoid
        centred at ${FASTING.B_50} mmol/L converts &beta;-HB into a 0&ndash;1
        “beneficial state” indicator; its daily integral is the AUC
        above.
        <br><br>
        <strong>Longevity translation.</strong> Rodent time-restricted
        feeding studies
        (<a href="https://pubmed.ncbi.nlm.nih.gov/31465934/" target="_blank">Mitchell 2019</a>,
        <a href="https://pubmed.ncbi.nlm.nih.gov/35476621/" target="_blank">Acosta-Rodríguez 2022</a>)
        report roughly ${FASTING.RODENT_LIFESPAN_GAIN_PERCENT}% median
        lifespan extension in mice whose daily fasted window plausibly
        yields ~${FASTING.RODENT_DAILY_BENEFIT_HOURS} h/day in an elevated
        &beta;-HB state. This gives a rodent slope of
        ${rodentPerHour.toFixed(2)}% lifespan per hour of daily benefit
        AUC. We halve this (factor
        ${FASTING.HUMAN_TRANSLATION_FACTOR}) as a conservative rodent&rarr;human
        translation, giving ${humanPerHour.toFixed(2)}% per h/day. Your
        result: ${sim.benefitAucHours.toFixed(2)} h/day &times;
        ${humanPerHour.toFixed(2)}%/h = <strong>${gainPercent.toFixed(2)}%</strong>.
        This is an order-of-magnitude estimate, not a personal prediction:
        there is no direct human-lifespan RCT of intermittent fasting, and
        individual variation in &beta;-HB kinetics is large.
    `;
});
