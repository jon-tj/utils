// Whole-day simulation of liver glycogen, plasma β-hydroxybutyrate (β-HB) and
// a "fasting benefit" rate, plus translation of the daily benefit AUC to an
// approximate lifespan gain via rodent time-restricted-feeding calibration.
//
// This is an intentionally simple phenomenological model. The *shape* of each
// component matches accepted physiology; the *absolute numbers* are not
// individually calibrated and should be interpreted as an educated estimate,
// not a personal prediction. See explanation rendered in the UI.

import { findIngredient } from './data.js';
import { computeMealNutrients } from './nutrition.js';
import { walkPeakReduction, mealDamping } from './glucose.js';

// -----------------------------------------------------------------------------
// Parameters
// -----------------------------------------------------------------------------

export const FASTING = {
    // Liver glycogen.
    G_MAX_PER_KG_LBM: 1.5,      // g glycogen / kg lean body mass
    ETA_BASE: 0.35,             // fraction of absorbed carbs stored in liver
    K_OUT_PER_KG: 0.002,        // g/min hepatic glucose output per kg body mass at rest
    K_OUT_WALK_MULT: 3.5,       // hepatic output multiplier during a walk

    // Ketogenesis gate on glycogen level (sigmoid).
    G_THR: 20,                  // g — midpoint of the "low glycogen" gate
    K_G: 10,                    // g — gate softness

    // β-HB kinetics. K_MAX is set per-user via the "expected 24h β-HB" input:
    //   K_MAX = target_bhb_24h * K_CLR
    // (steady state β-HB with the gate fully open = K_MAX / K_CLR).
    K_CLR: 0.02,                // 1/min — clearance (~35 min half-life)
    B_BASELINE: 0.1,            // mmol/L fed baseline

    // Benefit sigmoid on β-HB.
    B_50: 0.3,                  // mmol/L — midpoint
    K_B: 0.15,                  // mmol/L — softness

    // Rodent → human longevity calibration.
    //
    // Anchor: Acosta-Rodriguez et al. 2022 / Mitchell et al. 2019 report
    // ~11% median lifespan extension in mice on isocaloric time-restricted
    // feeding with an eating window of a few hours (i.e. long daily fast).
    // Such mice plausibly spend on the order of 10 h/day in an elevated
    // β-HB / benefit state. That gives ~1.1% lifespan per h/day of benefit
    // AUC in rodents; halved for the human translation as requested.
    RODENT_LIFESPAN_GAIN_PERCENT: 11,
    RODENT_DAILY_BENEFIT_HOURS: 10,
    HUMAN_TRANSLATION_FACTOR: 0.5,
};

export function bhbTargetToKmax(targetBhb24h) {
    return targetBhb24h * FASTING.K_CLR;
}

function sigmoid(x) {
    return 1 / (1 + Math.exp(-x));
}

// -----------------------------------------------------------------------------
// Simulation
// -----------------------------------------------------------------------------

// Per-minute carb-appearance rate (g/min) into portal blood from a single
// ingredient event. Gamma-like impulse normalized so the total integral
// equals `carbGrams` exactly — fat/fiber effects are modeled by stretching
// `tPeak` upstream, not by scaling the amplitude, so total absorbed carbs
// are preserved (matches the glucose ODE convention).
function ingredientCarbRate(minutesSinceMeal, carbGrams, tPeak) {
    if (minutesSinceMeal <= 0 || carbGrams <= 0) return 0;
    const x = minutesSinceMeal / tPeak;
    return carbGrams * x * Math.exp(1 - x) / (tPeak * Math.E);
}

// Build the list of carb-appearance events for the fasting model. Same shape
// as glucose events but keyed on grams-of-carbs (not GL). The walk effect is
// applied to η (fraction reaching liver), not to Ra: physiologically, a walk
// diverts glucose to working muscle rather than reducing gut absorption.
function buildCarbEvents(plannedMeals) {
    const events = [];
    for (const pm of plannedMeals) {
        if (!pm.meal || pm.scale <= 0) continue;

        const mealNutrients = computeMealNutrients(pm.meal);
        const fatG   = (mealNutrients.fatTotal || 0) * pm.scale;
        const fiberG = (mealNutrients.fiber    || 0) * pm.scale;
        const { ampFactor, delayMin } = mealDamping(fatG, fiberG);

        for (const item of pm.meal.ingredients) {
            const ing = findIngredient(item.name);
            if (!ing) continue;
            const grams = item.amount * pm.scale;
            const carbGrams = (ing.per100g.carbs || 0) * grams / 100;
            if (carbGrams <= 0) continue;
            const gi = ing.metabolism ? (ing.metabolism.glycemicIndex || 50) : 50;
            const tPeakBase = ing.metabolism && ing.metabolism.tPeakMin
                ? ing.metabolism.tPeakMin
                : Math.max(25, Math.min(75, 75 - 0.4 * gi));
            events.push({
                time: pm.mealTime,
                carbGrams,
                tPeak: (tPeakBase + delayMin) / ampFactor,
            });
        }
    }
    return events;
}

// Run a 48h forward-Euler simulation (same schedule repeated on both days)
// at 1-min resolution and return day 2. This keeps the morning β-HB / liver
// glycogen values consistent with last night's dinner rather than an
// arbitrary initial condition.
export function simulateFastingDay({ plannedMeals, walkMinutes, kMax, lbm, weight }) {
    const DAY = 24 * 60;
    const N = 2 * DAY;
    const dt = 1;

    const G_max = FASTING.G_MAX_PER_KG_LBM * lbm;
    const k_out_rest = FASTING.K_OUT_PER_KG * weight;
    const walkRed = walkPeakReduction(walkMinutes);

    const carbEvents = buildCarbEvents(plannedMeals);

    // Walk windows: assume the walk starts immediately at meal time.
    // Repeat on both days.
    const walkWindowsBase = walkMinutes > 0
        ? plannedMeals
            .filter(pm => pm.meal && pm.scale > 0)
            .map(pm => ({ start: pm.mealTime, end: pm.mealTime + walkMinutes }))
        : [];
    const walkWindows = [
        ...walkWindowsBase,
        ...walkWindowsBase.map(w => ({ start: w.start + DAY, end: w.end + DAY })),
    ];

    const G = new Float64Array(N + 1);
    const B = new Float64Array(N + 1);

    // Day-1 initial state is a rough guess; day 2 washes it out.
    G[0] = G_max * 0.5;
    B[0] = FASTING.B_BASELINE;

    for (let t = 1; t <= N; t++) {
        // Total carb appearance rate (g/min), including a copy of every event
        // shifted +24h so day 2 sees a full repeat of the schedule.
        let carbApp = 0;
        for (const ev of carbEvents) {
            carbApp += ingredientCarbRate(t - ev.time,         ev.carbGrams, ev.tPeak);
            carbApp += ingredientCarbRate(t - (ev.time + DAY), ev.carbGrams, ev.tPeak);
        }

        const inWalk = walkWindows.some(w => t > w.start && t <= w.end);
        // Walk diverts a fraction of portal glucose to working muscle rather
        // than to the liver: apply the walk reduction to η during the walk.
        const etaEff = FASTING.ETA_BASE * (inWalk ? (1 - walkRed) : 1);
        const inflow = etaEff * carbApp * Math.max(0, 1 - G[t - 1] / G_max);

        const kOut = k_out_rest * (inWalk ? FASTING.K_OUT_WALK_MULT : 1);
        const outflow = Math.min(kOut, G[t - 1] / 5);

        G[t] = Math.max(0, G[t - 1] + (inflow - outflow) * dt);

        const gate = sigmoid((FASTING.G_THR - G[t]) / FASTING.K_G);
        const Kprod = kMax * gate;
        B[t] = Math.max(0, B[t - 1] + (Kprod - FASTING.K_CLR * B[t - 1]) * dt);
    }

    // Extract day 2 (steady-state cycle).
    const G2 = new Float64Array(DAY + 1);
    const B2 = new Float64Array(DAY + 1);
    const r2 = new Float64Array(DAY + 1);
    for (let t = 0; t <= DAY; t++) {
        G2[t] = G[DAY + t];
        B2[t] = B[DAY + t];
        r2[t] = sigmoid((B2[t] - FASTING.B_50) / FASTING.K_B);
    }

    let benefitAucHours = 0;
    for (let t = 1; t <= DAY; t++) benefitAucHours += r2[t] * dt;
    benefitAucHours /= 60;

    return { G: G2, B: B2, r: r2, benefitAucHours, G_max };
}

// Convert daily benefit AUC (hours-equivalent) to an estimated human
// lifespan-gain percentage using rodent TRF calibration halved.
export function estimateLongevityGainPercent(benefitAucHours) {
    const rodentPerHour =
        FASTING.RODENT_LIFESPAN_GAIN_PERCENT / FASTING.RODENT_DAILY_BENEFIT_HOURS;
    return benefitAucHours * rodentPerHour * FASTING.HUMAN_TRANSLATION_FACTOR;
}
