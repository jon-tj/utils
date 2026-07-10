// Post-prandial blood-glucose model.
//
// Approach:
// 1. Meal carbohydrates enter the blood via a per-ingredient rate-of-appearance
//    Ra(t) — a gamma-like impulse whose peak time is GI-dependent and whose
//    amplitude is damped by co-ingested fat/fiber and any post-meal walk.
// 2. Plasma glucose G(t) is then integrated by a Bergman-style minimal
//    model (Bergman 1979):
//
//        dG/dt = -k_G · (G - G_b) - X · G + Ra(t) / V_G
//        dX/dt = -p2 · X + p3 · I
//        dI/dt =  β · max(0, G - G_h) - n · I
//
//    where X is a "remote insulin action" compartment (minutes-lagged effect
//    of plasma insulin I on glucose disposal). Insulin secretion is a linear
//    threshold response to hyperglycemia. This structure produces the
//    post-prandial dip below baseline that a pure impulse model cannot.
//
//    Parameter values are within the published range for healthy adults
//    (see Bergman et al. 1979/1989, Dalla Man et al. 2007 for context).
//    They are population averages, not personal fits.

import { findIngredient } from './data.js';
import { computeMealNutrients } from './nutrition.js';

export const BASELINE_MG_DL = 90;

// GI-dependent peak time: pure glucose (~100) peaks fastest, low-GI foods
// (~30) slowest. Clamped to a plausible range.
function tPeakForGI(gi) {
    const t = 75 - 0.4 * gi; // GI 100 -> 35 min, GI 30 -> 63 min
    return Math.max(25, Math.min(75, t));
}

// Piecewise-linear peak-amplitude reduction from a post-meal walk (Buffey et
// al. 2022 / Reynolds et al. 2016). Anchor points requested:
//   0 min  -> 0%
//   10 min -> 22%
//   20 min -> 28%
//   30 min -> 32%
export function walkPeakReduction(mins) {
    if (mins <= 0) return 0;
    if (mins >= 30) return 0.32;
    if (mins <= 10) return (mins / 10) * 0.22;
    if (mins <= 20) return 0.22 + ((mins - 10) / 10) * (0.28 - 0.22);
    return 0.28 + ((mins - 20) / 10) * (0.32 - 0.28);
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

// Build the list of glucose-appearance events (one per carb-bearing
// ingredient). Fat/fiber damping is applied by *stretching* the per-event
// tPeak (which delays and lowers the Ra peak while preserving the integral
// = carbGrams, i.e. total glucose absorbed). The walk effect is *not*
// applied here — it acts on plasma glucose clearance (k_G) inside the ODE
// during the walk window, since its mechanism is contraction-stimulated
// muscle uptake rather than delayed gastric emptying.
export function buildGlucoseEvents(plannedMeals, _walkMinutes = 0) {
    const events = [];
    for (const pm of plannedMeals) {
        if (!pm.meal || pm.scale <= 0) continue;

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

            const baseTPeak = ing.metabolism.tPeakMin || tPeakForGI(gi);
            // Fat/fiber: stretch tPeak (delayed gastric emptying).
            const tPeak = (baseTPeak + delayMin) / ampFactor;

            events.push({
                mealLabel: pm.slot ? pm.slot.label : '',
                mealName: pm.meal.name,
                ingredient: ing.name,
                time: pm.mealTime,
                carbGrams,
                GL: gl,
                tPeak,
            });
        }
    }
    return events;
}

// -----------------------------------------------------------------------------
// ODE integration
// -----------------------------------------------------------------------------

// Bergman minimal-model parameters (healthy adult population averages).
const V_G_DL_PER_KG = 1.6;   // glucose distribution volume (dL/kg)
const K_G           = 0.025; // glucose effectiveness (min^-1)
const P2            = 0.025; // remote insulin action decay (min^-1)
const P3            = 1.2e-5;// remote insulin sensitivity ( (min^-1)^2 per μU/mL )
const BETA_INS      = 0.10;  // β-cell secretion ( μU/mL/min per mg/dL above threshold )
const N_INS         = 0.15;  // insulin clearance (min^-1, ~5 min half-life)
const G_H           = 90;    // insulin release threshold (mg/dL)

// Instantaneous rate of appearance (g/min) at time `t` from all events, with
// a +/- one-day wrap so the simulation is periodic.
function carbAppearanceRate(events, t, DAY) {
    let r = 0;
    for (const ev of events) {
        for (const shift of [0, -DAY, DAY]) {
            const dt = t - (ev.time + shift);
            if (dt <= 0) continue;
            const x = dt / ev.tPeak;
            r += ev.carbGrams * x * Math.exp(1 - x) / (ev.tPeak * Math.E);
        }
    }
    return r;
}

// Multiplier on glucose effectiveness k_G at time t (min), due to any
// post-meal walks. Walk peak-reduction anchors (0/10/20/30 min -> 0/22/28/32%)
// are interpreted as fractional peak-glucose reductions relative to no walk;
// they are converted into an effective k_G multiplier during the walk window
// that reproduces that peak-reduction magnitude to first order.
function walkKgMultiplier(t, walkWindows, walkMinutes) {
    if (walkMinutes <= 0 || walkWindows.length === 0) return 1;
    const inWalk = walkWindows.some(w => t > w.start && t <= w.end);
    if (!inWalk) return 1;
    // Peak reduction r maps to a k_G multiplier ~ 1 / (1 - r). This gives
    // ~1.28x at 10 min (22% reduction) up to ~1.47x at 30 min (32%).
    const r = walkPeakReduction(walkMinutes);
    return 1 / Math.max(0.5, 1 - r);
}

// Integrate the minimal model over 48h at 1-min resolution and return day 2
// down-sampled every `stepMin` minutes so morning values reflect last night's
// dinner tail. `weight` (kg) sets the glucose distribution volume.
// `walkMinutes` and `plannedMeals` are used to boost k_G during post-meal
// walk windows (contraction-stimulated muscle glucose uptake).
export function sampleGlucose(events, { weight = 70, stepMin = 5, walkMinutes = 0, plannedMeals = [] } = {}) {
    const DAY = 24 * 60;
    const N = 2 * DAY;
    const V_G = V_G_DL_PER_KG * weight;
    const dt = 1;

    const walkWindowsBase = walkMinutes > 0
        ? plannedMeals
            .filter(pm => pm.meal && pm.scale > 0)
            .map(pm => ({ start: pm.mealTime, end: pm.mealTime + walkMinutes }))
        : [];
    const walkWindows = [
        ...walkWindowsBase,
        ...walkWindowsBase.map(w => ({ start: w.start + DAY, end: w.end + DAY })),
    ];

    let G = BASELINE_MG_DL;
    let I = 0; // insulin above basal (μU/mL)
    let X = 0; // remote insulin action (min^-1)

    const trace = new Float64Array(N + 1);
    trace[0] = G;

    for (let step = 1; step <= N; step++) {
        const t = step * dt;
        const Ra_g_per_min    = carbAppearanceRate(events, t, DAY);
        const Ra_mgdl_per_min = Ra_g_per_min * 1000 / V_G;

        const kGeff = K_G * walkKgMultiplier(t, walkWindows, walkMinutes);
        const dG = -kGeff * (G - BASELINE_MG_DL) - X * G + Ra_mgdl_per_min;
        const dX = -P2 * X + P3 * I;
        const dI =  BETA_INS * Math.max(0, G - G_H) - N_INS * I;

        G += dG * dt;
        I += dI * dt;
        X += dX * dt;
        trace[step] = G;
    }

    const samples = [];
    for (let t = 0; t <= DAY; t += stepMin) {
        samples.push({ t, g: trace[DAY + t] });
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
