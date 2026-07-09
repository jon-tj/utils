const FORM_ELEMENT = document.getElementById('nutrition-form');
const OUTPUT_ELEMENT = document.getElementById('output');

const btn = FORM_ELEMENT.querySelector('button');

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