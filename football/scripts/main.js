import { poissonProbability, calculateImpliedProbabilities } from './math.js';

const scoreTable = document.getElementById('score-table');
const tableBody = scoreTable.querySelector('tbody');
const xGASlot = document.querySelector('[data-slot="xGA"]');
const xGBSlot = document.querySelector('[data-slot="xGB"]');
const mostLikelyOutcome = document.querySelector('[data-slot="most-likely-outcome"]');
const mostLikelyOutcomeProbability = document.querySelector('[data-slot="most-likely-outcome-probability"]');

const tableSize = 7;
function setTableValues(valuesMatrix = null) {
    const maxProb = valuesMatrix ? Math.max(...valuesMatrix.flat()) : 1;
    tableBody.innerHTML = ''; // Clear existing rows
    for (let k = 0; k < tableSize; k++) {
        const row = document.createElement('tr');
        const i = tableSize - 1 - k; // Reverse the order of rows
        for (let j = 0; j < tableSize; j++) {
            const cell = document.createElement('td');
            const prefix = i > j ? "H" : (i == j ? "D" : "A");
            const prob = valuesMatrix ? valuesMatrix[i][j] : 0;
            let hue = "inferno-" + Math.min(9, Math.floor(Math.pow(prob / maxProb, 0.3)*9.5));
            cell.innerHTML = `<p>${i}-${j} ${prefix}</p><p class='muted'>${(prob * 100).toFixed(1)}%</p>`;
            cell.setAttribute('data-tone', hue);
            row.appendChild(cell);
        }
        tableBody.appendChild(row);
    }
}

const goalsPriors = {
    "NF": { home: 1.23, away: 1.23 },
    "AF": { home: 1.62, away: 0.94 },
    "NC": { home: 1.44, away: 1.44 },
    "AC": { home: 1.69, away: 1.06 },
}

const goalsPriorsDraw = 0.85

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
    const eloIsGiven = eloTeamA !== 0 && eloTeamB !== 0;
    const oddsDraw = readNumber('odds-draw', 100);
    const oddsTeamA = readNumber('odds-team-a', 1);
    const oddsTeamB = readNumber('odds-team-b', 1);
    const oddsAreGiven = oddsDraw !== 100 && oddsTeamA !== 1 && oddsTeamB !== 1;
    const impliedProbs = calculateImpliedProbabilities(oddsDraw, oddsTeamA, oddsTeamB);

    const oddsOver2_5 = readNumber('odds-over-2-5', 1);
    const oddsUnder2_5 = readNumber('odds-under-2-5', 1);
    const pOver2_5 = (1 / oddsOver2_5) / ((1 / oddsOver2_5) + (1 / oddsUnder2_5));

    const isNeutral = document.getElementById('neutral').checked;
    const isFriendly = document.getElementById('friendly').checked;
    const priors = goalsPriors[(isNeutral ? "N" : "A") + (isFriendly ? "F" : "C")];
    const priorA = priors["home"] * (1 - impliedProbs.draw) + goalsPriorsDraw * impliedProbs.draw + (pOver2_5-0.5) * 5;
    const priorB = priors["away"] * (1 - impliedProbs.draw) + goalsPriorsDraw * impliedProbs.draw + (pOver2_5-0.5) * 5;

    let delta = 0;
    if (eloIsGiven && oddsAreGiven) {
        delta = (eloTeamA - eloTeamB) * 0.001 * 0.909 + (impliedProbs.teamA - impliedProbs.teamB) * 1.160;
    } else if (eloIsGiven) {
        delta = (eloTeamA - eloTeamB) * 0.001 * 2.449;
    } else if (oddsAreGiven) {
        delta = (impliedProbs.teamA - impliedProbs.teamB) * 1.541;
    }
    const xGA = Math.exp(Math.log(priorA) + delta);
    const xGB = Math.exp(Math.log(priorB) - delta);

    const resultMatrix = [];
    for (let i = 0; i < tableSize; i++) {
        const row = [];
        for (let j = 0; j < tableSize; j++) {
            const prob = poissonProbability(i, xGA) * poissonProbability(j, xGB);
            row.push(prob);
        }
        resultMatrix.push(row);
    }
    resultMatrix[0][0] += 0.0149;
    resultMatrix[1][1] -= 0.0062;
    setTableValues(resultMatrix);

    xGASlot.textContent = xGA.toFixed(2);
    xGBSlot.textContent = xGB.toFixed(2);

    // Find most likely outcome
    let maxProb = 0;
    let mostLikely = { home: 0, away: 0 };
    for (let i = 0; i < tableSize; i++) {
        for (let j = 0; j < tableSize; j++) {
            if (resultMatrix[i][j] > maxProb) {
                maxProb = resultMatrix[i][j];
                mostLikely = { home: i, away: j };
            }
        }
    }
    mostLikelyOutcome.textContent = `${mostLikely.home}-${mostLikely.away} ${mostLikely.home > mostLikely.away ? "H" : (mostLikely.home == mostLikely.away ? "D" : "A")}`;
    mostLikelyOutcomeProbability.textContent = `${(maxProb * 100).toFixed(1)}%`;
});