// Loads ingredient and meal data. Exports lookup helpers and a `ready` promise
// that resolves once both JSON files have been fetched.

export const ingredients = [];
export const meals = [];

export const ready = Promise.all([
    fetch('data/ingredients.json').then(r => r.json()).then(d => {
        ingredients.push(...d);
    }),
    fetch('data/meals.json').then(r => r.json()).then(d => {
        meals.push(...d);
    }),
]);

export function findIngredient(name) {
    return ingredients.find(i => i.name === name);
}

export function findMeal(name) {
    return meals.find(m => m.name === name);
}
