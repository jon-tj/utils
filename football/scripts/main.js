import { poissonProbability } from './math.js';

const scoreTable = document.getElementById('score-table');
const tableBody = scoreTable.querySelector('tbody');

const tableSize = 7;
function setTableValues(valuesMatrix = null) {
    tableBody.innerHTML = ''; // Clear existing rows
    for (let k = 0; k < tableSize; k++) {
        const row = document.createElement('tr');
        const i = tableSize - 1 - k; // Reverse the order of rows
        for (let j = 0; j < tableSize; j++) {
            const cell = document.createElement('td');
            const prefix = i > j ? "A" : (i == j ? "" : "B");
            const prob = valuesMatrix ? valuesMatrix[i][j] : 0;
            let hue = "inferno-" + Math.min(9, Math.floor(prob * 200));
            cell.innerHTML = `<p>${i + 1}-${j + 1} ${prefix}</p><p class='muted'>${(prob * 100).toFixed(2)}%</p>`;
            cell.setAttribute('data-tone', hue);
            row.appendChild(cell);
        }
        tableBody.appendChild(row);
    }
}

// Initialize the table with zero values
setTableValues();

const btnCalculate = document.getElementById('btn-calculate');
btnCalculate.addEventListener('click', (e) => {
    e.preventDefault();
    const eloTeamA = parseFloat(document.getElementById('elo-team-a').value);
    const eloTeamB = parseFloat(document.getElementById('elo-team-b').value);
    const oddsDraw = parseFloat(document.getElementById('odds-draw').value);

    const resultMatrix = [];
    const xGA = 3;
    const xGB = 3;

    for (let i = 0; i < tableSize; i++) {
        const row = [];
        for (let j = 0; j < tableSize; j++) {
            const prob = poissonProbability(i, xGA) * poissonProbability(j, xGB);
            row.push(prob);
        }
        resultMatrix.push(row);
    }
    setTableValues(resultMatrix);

    // Verify probabilities sum to 100
    const totalProbability = resultMatrix.flat().reduce((sum, prob) => sum + prob, 0);
    console.log(`Total Probability: ${(totalProbability * 100).toFixed(2)}%`);
});