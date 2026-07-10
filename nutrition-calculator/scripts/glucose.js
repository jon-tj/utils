// Post-prandial blood-glucose model.
//
// Approach:
// 1. Each ingredient with a known GI contributes its own glucose response
//    curve (linear superposition across ingredients).
// 2. The curve for a single ingredient is the classic gamma-like impulse
//        rise(t) = GL × PEAK_SCALE × x × exp(1 - x),   x = t / tPeak
//    which peaks at t = tPeak with value = GL × PEAK_SCALE.
// 3. `tPeak` is loosely modulated by the ingredient's own GI (high-GI foods
//    peak earlier).
// 4. Meal-level composition (fat + fiber grams co-ingested) then applies a
//    damping to *all* curves belonging to that meal:
//      - `ampFactor` reduces peak amplitude (co-ingested fat/fiber slow the
//        appearance of glucose).
//      - `delayMin` pushes the peak later.
//    Parameter ranges are chosen to match rough magnitudes reported in
//    Wolpert 2013 / Bell 2015 (fat delay) and Livesey 2008 / EFSA β-glucan
//    claims (viscous-fiber peak reduction). They are order-of-magnitude
//    estimates only — individual variation is large.

import { findIngredient } from './data.js';
import { computeMealNutrients } from './nutrition.js';

export const BASELINE_MG_DL = 90;
export const PEAK_SCALE = 2.0; // mg/dL per unit GL at peak

// Base peak time (min) if the ingredient had no GI info at all.
const T_PEAK_DEFAULT = 45;

// GI-dependent peak time: pure glucose (~100) peaks fastest, low-GI foods
// (~30) slowest. Clamped to a plausible range.
function tPeakForGI(gi) {
    const t = 75 - 0.4 * gi; // GI 100 -> 35 min, GI 30 -> 63 min
    return Math.max(25, Math.min(75, t));
}

// Meal-level damping from total co-ingested fat + fiber (grams).
export function mealDamping(fatG, fiberG) {
    // Amplitude reduction saturates: fat contributes up to ~30%, fiber up to
    // ~30%, total floor at 40% of the unmodified amplitude.
    const fatAmp   = 0.30 * (1 - Math.exp(-fatG   / 30));
    const fiberAmp = 0.30 * (1 - Math.exp(-fiberG / 10));
    const ampFactor = Math.max(0.4, 1 - fatAmp - fiberAmp);

    // Peak delay in minutes, dominated by fat, saturating near +75 min.
    const delayMin = 75 * (1 - Math.exp(-fatG / 25));

    return { ampFactor, delayMin };
}

// Compute total glycemic load for a meal at a given scaling factor.
export function computeMealGL(meal, scale = 1) {
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

// Build the list of glucose events (one per carb-bearing ingredient) for a
// day's planned meals. `plannedMeals` items must have {meal, scale, mealTime}.
export function buildGlucoseEvents(plannedMeals) {
    const events = [];
    for (const pm of plannedMeals) {
        if (!pm.meal || pm.scale <= 0) continue;

        // Meal-level totals drive the damping applied to every ingredient
        // curve belonging to this meal.
        const mealNutrients = computeMealNutrients(pm.meal);
        const fatG   = (mealNutrients.fatTotal || 0) * pm.scale;
        const fiberG = (mealNutrients.fiber    || 0) * pm.scale;
        const { ampFactor, delayMin } = mealDamping(fatG, fiberG);

        for (const item of pm.meal.ingredients) {
            const ing = findIngredient(item.name);
            if (!ing || !ing.metabolism) continue;
            const gi = ing.metabolism.glycemicIndex || 0;
            if (gi <= 0) continue;
            const grams = item.amount * pm.scale;
            const carbGrams = (ing.per100g.carbs || 0) * grams / 100;
            const gl = gi * carbGrams / 100;
            if (gl <= 0) continue;

            events.push({
                mealLabel: pm.slot ? pm.slot.label : '',
                mealName: pm.meal.name,
                ingredient: ing.name,
                time: pm.mealTime,
                GL: gl,
                tPeak: (ing.metabolism.tPeakMin || tPeakForGI(gi)) + delayMin,
                amp: ampFactor,
            });
        }
    }
    return events;
}

// Single ingredient's contribution at a given minute-offset from its meal.
export function glucoseResponse(minutesSinceMeal, GL, tPeak = T_PEAK_DEFAULT, amp = 1) {
    if (minutesSinceMeal <= 0 || GL <= 0) return 0;
    const x = minutesSinceMeal / tPeak;
    return amp * GL * PEAK_SCALE * x * Math.exp(1 - x);
}

// Sample the full 24h glucose trace given a list of events.
export function sampleGlucose(events, stepMin = 5) {
    const samples = [];
    for (let t = 0; t <= 24 * 60; t += stepMin) {
        let g = BASELINE_MG_DL;
        for (const ev of events) {
            g += glucoseResponse(t - ev.time, ev.GL, ev.tPeak, ev.amp);
        }
        samples.push({ t, g });
    }
    return samples;
}

// Aggregate events per meal for chart annotation (sum of GL contributions).
export function summarizeEventsByMeal(events) {
    const byMeal = new Map();
    for (const ev of events) {
        const key = ev.mealLabel || ev.mealName;
        if (!byMeal.has(key)) {
            byMeal.set(key, { label: ev.mealLabel, mealName: ev.mealName, time: ev.time, GL: 0 });
        }
        byMeal.get(key).GL += ev.GL;
    }
    return [...byMeal.values()];
}
