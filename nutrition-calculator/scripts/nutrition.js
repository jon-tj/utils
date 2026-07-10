// Diet reference values and per-meal nutrient aggregation.

import { findIngredient } from './data.js';

export const ACTIVITY_LEVELS = {
    sedentary: 1.2,
    light: 1.375,
    moderate: 1.55,
    active: 1.725,
};

export const MEDITERRANEAN_DIET = {
    calories: 2080,
    protein: 110,
    fatTotal: 90,
    SFA: 16,
    MUFA: 48,
    PUFA: 22,
    carbs: 225,
    sugars: 50,
    fiber: 40,
    salt: 2,
};

export const ARIC_DIET = {
    calories: 2150,
    protein: 110,
    fatTotal: 80,
    SFA: 12,
    MUFA: 45,
    PUFA: 20,
    carbs: 270, // https://pmc.ncbi.nlm.nih.gov/articles/PMC6339822/
    sugars: 30,
    fiber: 50,
    salt: 2,
};

export const NUTRIENT_LABELS = {
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

export function interpolateDiet(diet1, diet2, ratio) {
    const out = {};
    for (const key in diet1) {
        if (diet1.hasOwnProperty(key) && diet2.hasOwnProperty(key)) {
            out[key] = diet1[key] * (1 - ratio) + diet2[key] * ratio;
        }
    }
    return out;
}

export function normalizeDietCalories(diet, targetCalories = 2000) {
    diet = { ...diet };
    const scalingFactor = targetCalories / diet.calories;
    for (const key in diet) {
        if (diet.hasOwnProperty(key)) diet[key] *= scalingFactor;
    }
    return diet;
}

// Return a clone of `ratios` with values scaled so they sum to 1. If the
// input sums to 0, values are split evenly across the keys.
export function normalizeRatios(ratios) {
    const keys = Object.keys(ratios);
    const sum = keys.reduce((s, k) => s + Number(ratios[k] || 0), 0);
    const out = {};
    if (sum <= 0) {
        const even = keys.length > 0 ? 1 / keys.length : 0;
        for (const k of keys) out[k] = even;
    } else {
        for (const k of keys) out[k] = Number(ratios[k] || 0) / sum;
    }
    return out;
}

// Estimate lean body mass (kg). Uses body fat % if provided, otherwise a
// gender-based average body fat fraction (~28% female, 20% male).
export function estimateLBM(weight, fatPrc, gender) {
    if (fatPrc && fatPrc > 0) return weight * (1 - fatPrc / 100);
    const defaultBf = gender === 'female' ? 0.28 : 0.20;
    return weight * (1 - defaultBf);
}

// Compute total nutrients (per full recipe) for a meal by summing ingredients.
export function computeMealNutrients(meal) {
    const totals = {
        calories: 0, protein: 0, fatTotal: 0, SFA: 0, MUFA: 0, PUFA: 0,
        carbs: 0, sugars: 0, fiber: 0, salt: 0,
    };
    for (const item of meal.ingredients) {
        const ing = findIngredient(item.name);
        if (!ing) continue;
        const factor = item.amount / 100;
        for (const key in totals) {
            totals[key] += (ing.per100g[key] || 0) * factor;
        }
    }
    return totals;
}
