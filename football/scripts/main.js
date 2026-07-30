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
            let hue = "blues-" + Math.min(9, Math.floor(prob * 200));
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
    const readNumber = (id, fallback) => {
        const value = parseFloat(document.getElementById(id).value);
        return Number.isFinite(value) ? value : fallback;
    };
    const eloTeamA = readNumber('elo-team-a', 0);
    const eloTeamB = readNumber('elo-team-b', 0);
    const oddsDraw = readNumber('odds-draw', 1);
    const oddsTeamA = readNumber('odds-team-a', 1);
    const oddsTeamB = readNumber('odds-team-b', 1);

    const resultMatrix = [];
    const xGA = 2 + (eloTeamB - eloTeamA) / 400 + (1 / oddsDraw) * 0.5;
    console.log(eloTeamA ?? 0, eloTeamB, oddsDraw, xGA);
    const xGB = 2 + (eloTeamA - eloTeamB) / 400 + (1 / oddsDraw) * 0.5;

    for (let i = 0; i < tableSize; i++) {
        const row = [];
        for (let j = 0; j < tableSize; j++) {
            const prob = poissonProbability(i, xGA) * poissonProbability(j, xGB);
            row.push(prob);
        }
        resultMatrix.push(row);
    }
    setTableValues(resultMatrix);
});