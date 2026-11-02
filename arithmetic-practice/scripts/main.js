import { OPS, makeQuestion } from './arithmetic.js';

const STORAGE_KEY = 'arithmetic-practice';
const KEY_TO_INDEX = {
    ArrowUp: 0, w: 0, W: 0,
    ArrowLeft: 1, a: 1, A: 1,
    ArrowRight: 2, d: 2, D: 2,
    ArrowDown: 3, s: 3, S: 3,
};
const FEEDBACK_MS = { correct: 350, wrong: 1300 };
// Sampling: pairs lagging the most-sampled pair by 2+ samples get boosted,
// and likelihood is divided by 1 + BETA * accuracy (EMA) to punish mastered pairs
const UNDERSAMPLED_BOOST = 10;
const UNDERSAMPLED_GAP = 2;
const BETA = 2;
const EMA_INITIAL = 0.5;
const EMA_WARMUP_UPDATES = 5;
const EMA_ALPHA_WARMUP = 0.5;
const EMA_ALPHA = 0.2;
const NO_REPEAT_WITHIN = 2;
const START_LIVES = 3;
// Top-5 error rates blend in the transposed pair. Only multiplication: a÷b and b÷a are different facts
const TRANSPOSE_BLEND = { mul: 0.33, div: 0 };
// Blues ramp from the shared theme, light (low accuracy) to dark (high accuracy)
const RAMP = ['#A5CDE3', '#78B5D8', '#4F9BCB', '#2F7FBC', '#1662AA', '#08448A', '#08306B'];
const UNTRIED = '#e8e8e8';

const opSelect = document.getElementById('op');
const sizeSelect = document.getElementById('size');
const limitSelect = document.getElementById('limit');
const heatmapOpSelect = document.getElementById('heatmap-op');
const btnStart = document.getElementById('btn-start');
const btnReset = document.getElementById('btn-reset');
const promptEl = document.getElementById('prompt');
const feedbackEl = document.getElementById('feedback');
const timerFill = document.querySelector('.timer-fill');
const optionButtons = [...document.querySelectorAll('.option')];
const canvas = document.getElementById('heatmap');
const tooltip = document.getElementById('tooltip');
const worstList = document.getElementById('worst-list');
const slot = (name) => document.querySelector(`[data-slot="${name}"]`);

// stats[op]["a,b"] = [attempts, errors, totalMs, emaAccuracy]
let state = load();
let game = { phase: 'idle', question: null, startedAt: 0, timeoutId: null, recentKeys: [] };
let session = newSession();
let hoverCell = null;

function load() {
    const fallback = {
        settings: { op: 'mul', n: 10, limit: 2, heatmapOp: 'mul' },
        stats: { mul: {}, div: {} },
        highScores: {},
    };
    try {
        const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
        if (!saved) return fallback;
        return {
            settings: { ...fallback.settings, ...saved.settings },
            stats: { mul: saved.stats?.mul ?? {}, div: saved.stats?.div ?? {} },
            highScores: saved.highScores ?? {},
        };
    } catch {
        return fallback;
    }
}

function save() {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (err) {
        console.error('Failed to save arithmetic stats:', err);
    }
}

/* Question selection */

function emaAccuracy(entry) {
    if (!entry) return EMA_INITIAL;
    // Entries saved before the EMA existed fall back to their raw accuracy
    return entry[3] ?? (entry[0] - entry[1]) / entry[0];
}

function buildPool() {
    const { n } = state.settings;
    const ops = state.settings.op === 'both' ? ['mul', 'div'] : [state.settings.op];
    const pool = [];
    let total = 0;
    for (const op of ops) {
        const stats = state.stats[op];
        let mostSamples = 0;
        for (let a = 1; a <= n; a++) {
            for (let b = 1; b <= n; b++) mostSamples = Math.max(mostSamples, stats[`${a},${b}`]?.[0] ?? 0);
        }
        const threshold = Math.max(UNDERSAMPLED_GAP, mostSamples) - UNDERSAMPLED_GAP;
        for (let a = 1; a <= n; a++) {
            for (let b = 1; b <= n; b++) {
                const entry = stats[`${a},${b}`];
                let likelihood = 1;
                if ((entry?.[0] ?? 0) <= threshold) likelihood *= UNDERSAMPLED_BOOST;
                likelihood /= 1 + BETA * emaAccuracy(entry);
                total += likelihood;
                pool.push({ op, a, b, key: `${op}:${a},${b}`, cumulative: total });
            }
        }
    }
    return { pool, total };
}

function sample({ pool, total }) {
    const target = Math.random() * total;
    return pool.find((p) => p.cumulative >= target) ?? pool.at(-1);
}

function pickQuestion() {
    const weighted = buildPool();
    // A pair may not re-appear within the last NO_REPEAT_WITHIN questions; resample if it does
    let pick = sample(weighted);
    for (let tries = 0; game.recentKeys.includes(pick.key) && tries < 100; tries++) pick = sample(weighted);
    game.recentKeys = [pick.key, ...game.recentKeys].slice(0, NO_REPEAT_WITHIN);
    return makeQuestion(pick.op, pick.a, pick.b);
}

function record(question, isError, elapsedMs) {
    const key = `${question.a},${question.b}`;
    const entry = state.stats[question.op][key] ?? [0, 0, 0, EMA_INITIAL];
    const ema = emaAccuracy(entry[0] ? entry : null);
    const alpha = entry[0] < EMA_WARMUP_UPDATES ? EMA_ALPHA_WARMUP : EMA_ALPHA;
    entry[0] += 1;
    entry[1] += isError ? 1 : 0;
    entry[2] += Math.round(elapsedMs);
    entry[3] = ema + alpha * ((isError ? 0 : 1) - ema);
    state.stats[question.op][key] = entry;
    save();
}

/* Game loop */

function newSession() {
    return { lives: START_LIVES, score: 0, answered: 0, correct: 0, streak: 0 };
}

// High scores are kept per operation, matrix size and time limit so runs are comparable
function highScoreKey() {
    const { op, n, limit } = state.settings;
    return `${op}-${n}-${limit}`;
}

// Harder pairs (low accuracy) and faster answers are worth more
function reward(accuracy, seconds) {
    return (100 * (1 - 0.5 * accuracy)) / (1 + 0.25 * seconds);
}

function startGame() {
    document.activeElement?.blur();
    clearTimeout(game.timeoutId);
    session = newSession();
    renderSession();
    btnStart.textContent = 'Stop';
    nextQuestion();
}

function clearBoard() {
    clearTimeout(game.timeoutId);
    resetTimer();
    for (const btn of optionButtons) {
        btn.querySelector('.option-value').textContent = '';
        btn.className = 'option';
    }
    btnStart.textContent = 'Start';
}

function stopGame() {
    clearBoard();
    game.phase = 'idle';
    promptEl.textContent = 'Press Space to start';
    feedbackEl.innerHTML = '&nbsp;';
}

function gameOver() {
    clearBoard();
    game.phase = 'over';
    const key = highScoreKey();
    const previous = state.highScores[key] ?? 0;
    const isRecord = session.score > previous;
    if (isRecord) {
        state.highScores[key] = session.score;
        save();
    }
    promptEl.innerHTML = `
        <div class="game-over">
            <span class="game-over-title">💀 Game over</span>
            <span>Score <strong>${session.score}</strong></span>
            <span class="muted">High score <strong>${Math.max(previous, session.score)}</strong></span>
        </div>`;
    feedbackEl.textContent = isRecord ? '🏆 New high score!' : 'Press Space to play again';
    feedbackEl.dataset.tone = isRecord ? 'good' : '';
    renderSession();
}

function resetTimer() {
    timerFill.style.transition = 'none';
    timerFill.style.width = '100%';
    timerFill.classList.remove('urgent');
}

function nextQuestion() {
    const question = pickQuestion();
    game.question = question;
    game.phase = 'question';
    promptEl.textContent = question.text;
    feedbackEl.innerHTML = '&nbsp;';
    optionButtons.forEach((btn, i) => {
        btn.className = 'option';
        btn.querySelector('.option-value').textContent = question.options[i];
    });

    const limitMs = state.settings.limit * 1000;
    resetTimer();
    void timerFill.offsetWidth; // restart the CSS transition
    timerFill.style.transition = `width ${limitMs}ms linear`;
    timerFill.style.width = '0%';

    game.startedAt = performance.now();
    game.timeoutId = setTimeout(() => answer(null), limitMs);
}

function answer(index) {
    if (game.phase !== 'question') return;
    clearTimeout(game.timeoutId);
    game.phase = 'feedback';

    const question = game.question;
    const limitMs = state.settings.limit * 1000;
    const elapsed = Math.min(performance.now() - game.startedAt, limitMs);
    const timedOut = index === null || elapsed >= limitMs;
    const isCorrect = !timedOut && index === question.correctIndex;

    const width = getComputedStyle(timerFill).width;
    timerFill.style.transition = 'none';
    timerFill.style.width = width;

    // Reward uses the pair's accuracy before this answer updates it
    const points = Math.round(reward(emaAccuracy(state.stats[question.op][`${question.a},${question.b}`]), elapsed / 1000));
    record(question, !isCorrect, elapsed);
    session.answered += 1;
    if (isCorrect) {
        session.correct += 1;
        session.streak += 1;
        session.score += points;
    } else {
        session.streak = 0;
        session.lives -= 1;
    }

    optionButtons[question.correctIndex].classList.add('correct');
    if (index !== null && !isCorrect) optionButtons[index].classList.add('wrong');
    if (isCorrect) {
        feedbackEl.textContent = `✓ +${points} · ${(elapsed / 1000).toFixed(2)} s`;
    } else if (timedOut) {
        feedbackEl.textContent = `⏱ Too slow! ${question.text} = ${question.answer}`;
    } else {
        feedbackEl.textContent = `✗ ${question.text} = ${question.answer}`;
    }
    feedbackEl.dataset.tone = isCorrect ? 'good' : 'bad';

    renderSession();
    renderResults();
    const next = session.lives > 0 ? nextQuestion : gameOver;
    game.timeoutId = setTimeout(next, isCorrect ? FEEDBACK_MS.correct : FEEDBACK_MS.wrong);
}

function renderSession() {
    slot('hearts').textContent = '❤️'.repeat(session.lives) + '🖤'.repeat(START_LIVES - session.lives);
    slot('score').textContent = session.score;
    slot('streak').textContent = session.streak;
    slot('high-score').textContent = state.highScores[highScoreKey()] ?? 0;
}

/* Results */

function collect(op, n) {
    const stats = state.stats[op];
    const cells = [];
    let attempts = 0;
    let errors = 0;
    let totalMs = 0;
    let tried = 0;
    for (let a = 1; a <= n; a++) {
        for (let b = 1; b <= n; b++) {
            const entry = stats[`${a},${b}`];
            if (!entry) continue;
            tried += 1;
            attempts += entry[0];
            errors += entry[1];
            totalMs += entry[2];
            cells.push({ a, b, attempts: entry[0], errors: entry[1], totalMs: entry[2] });
        }
    }
    return { cells, attempts, errors, totalMs, tried };
}

// Mixes in the transposed pair (b, a) to reduce variance; the transpose is skipped if it has no samples
function blendedAccuracy(stats, op, a, b) {
    const own = stats[`${a},${b}`];
    const accuracy = (own[0] - own[1]) / own[0];
    const transpose = stats[`${b},${a}`];
    const weight = TRANSPOSE_BLEND[op];
    if (!transpose || !weight) return accuracy;
    return (1 - weight) * accuracy + (weight * (transpose[0] - transpose[1])) / transpose[0];
}

function renderResults() {
    const op = state.settings.heatmapOp;
    const n = state.settings.n;
    const { cells, attempts, errors, totalMs, tried } = collect(op, n);

    slot('accuracy').textContent = attempts ? `${Math.round((100 * (attempts - errors)) / attempts)}%` : '–';
    slot('attempts').textContent = attempts;
    slot('coverage').textContent = `${Math.round((100 * tried) / (n * n))}%`;
    slot('avg-time').textContent = attempts ? `${(totalMs / attempts / 1000).toFixed(2)} s` : '–';

    const stats = state.stats[op];
    const worst = cells
        .map((c) => ({ ...c, errorRate: 1 - blendedAccuracy(stats, op, c.a, c.b) }))
        .filter((c) => c.errorRate > 0)
        .sort((x, y) => y.errorRate - x.errorRate || y.errors - x.errors)
        .slice(0, 5);
    worstList.innerHTML = '';
    if (!worst.length) {
        worstList.innerHTML = '<li class="muted">No errors yet 🎉</li>';
    }
    for (const c of worst) {
        const li = document.createElement('li');
        const answerText = `${c.a} ${OPS[op].symbol} ${c.b}`;
        const rate = Math.round(100 * c.errorRate);
        li.innerHTML = `<strong>${answerText}</strong><span>${rate}% errors</span><span class="muted">${c.errors} / ${c.attempts}</span>`;
        worstList.append(li);
    }

    drawHeatmap();
}

function hexToRgb(hex) {
    const v = parseInt(hex.slice(1), 16);
    return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}
const RAMP_RGB = RAMP.map(hexToRgb);

function accuracyColor(accuracy) {
    const pos = accuracy * (RAMP_RGB.length - 1);
    const i = Math.min(Math.floor(pos), RAMP_RGB.length - 2);
    const t = pos - i;
    const [r, g, b] = RAMP_RGB[i].map((c, k) => Math.round(c + (RAMP_RGB[i + 1][k] - c) * t));
    return `rgb(${r}, ${g}, ${b})`;
}

function heatmapGeometry() {
    const n = state.settings.n;
    const size = Math.min(canvas.parentElement.clientWidth, 640);
    const label = n >= 100 ? 26 : 22;
    const cell = (size - label) / n;
    const gap = n <= 20 ? 2 : n <= 50 ? 1 : 0;
    return { n, size, label, cell, gap };
}

function drawHeatmap() {
    const { n, size, label, cell, gap } = heatmapGeometry();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    canvas.style.width = `${size}px`;
    canvas.style.height = `${size}px`;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);

    const stats = state.stats[state.settings.heatmapOp];
    for (let a = 1; a <= n; a++) {
        for (let b = 1; b <= n; b++) {
            const entry = stats[`${a},${b}`];
            ctx.fillStyle = entry ? accuracyColor((entry[0] - entry[1]) / entry[0]) : UNTRIED;
            const x = label + (b - 1) * cell;
            const y = label + (a - 1) * cell;
            ctx.fillRect(x + gap / 2, y + gap / 2, cell - gap, cell - gap);
        }
    }

    if (hoverCell) {
        ctx.strokeStyle = '#111';
        ctx.lineWidth = 2;
        const x = label + (hoverCell.b - 1) * cell;
        const y = label + (hoverCell.a - 1) * cell;
        ctx.strokeRect(x, y, Math.max(cell, 3), Math.max(cell, 3));
    }

    ctx.fillStyle = '#444';
    ctx.font = `${n >= 50 ? 10 : 11}px sans-serif`;
    const step = n <= 20 ? 1 : n <= 50 ? 5 : 10;
    for (let i = 1; i <= n; i++) {
        if (i !== 1 && i % step !== 0) continue;
        const mid = label + (i - 0.5) * cell;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(i, mid, label / 2);
        ctx.textAlign = 'right';
        ctx.fillText(i, label - 4, mid);
    }
}

function cellAt(event) {
    const { n, label, cell } = heatmapGeometry();
    const rect = canvas.getBoundingClientRect();
    const b = Math.floor((event.clientX - rect.left - label) / cell) + 1;
    const a = Math.floor((event.clientY - rect.top - label) / cell) + 1;
    if (a < 1 || b < 1 || a > n || b > n) return null;
    return { a, b };
}

canvas.addEventListener('mousemove', (event) => {
    const hit = cellAt(event);
    if (!hit) {
        canvas.dispatchEvent(new Event('mouseleave'));
        return;
    }
    const op = state.settings.heatmapOp;
    const entry = state.stats[op][`${hit.a},${hit.b}`];
    const text = `${hit.a} ${OPS[op].symbol} ${hit.b}`;
    tooltip.innerHTML = entry
        ? `<strong>${text}</strong><br>${entry[0] - entry[1]} / ${entry[0]} correct (${Math.round((100 * (entry[0] - entry[1])) / entry[0])}%)<br>recent accuracy (EMA) ${Math.round(100 * emaAccuracy(entry))}%<br>avg ${(entry[2] / entry[0] / 1000).toFixed(2)} s`
        : `<strong>${text}</strong><br><span class="muted">not tried yet</span>`;
    tooltip.hidden = false;
    const wrapRect = canvas.parentElement.getBoundingClientRect();
    const x = event.clientX - wrapRect.left;
    const y = event.clientY - wrapRect.top;
    const flip = x > wrapRect.width - 160;
    tooltip.style.left = `${flip ? x - tooltip.offsetWidth - 12 : x + 12}px`;
    tooltip.style.top = `${y + 12}px`;
    if (hoverCell?.a !== hit.a || hoverCell?.b !== hit.b) {
        hoverCell = hit;
        drawHeatmap();
    }
});

canvas.addEventListener('mouseleave', () => {
    tooltip.hidden = true;
    if (hoverCell) {
        hoverCell = null;
        drawHeatmap();
    }
});

/* Wiring */

function applySettings() {
    opSelect.value = state.settings.op;
    sizeSelect.value = state.settings.n;
    limitSelect.value = state.settings.limit;
    heatmapOpSelect.value = state.settings.heatmapOp;
}

function onSettingChange(key, parse = (v) => v) {
    return (event) => {
        state.settings[key] = parse(event.target.value);
        if (key === 'op' && state.settings.op !== 'both') state.settings.heatmapOp = state.settings.op;
        applySettings();
        save();
        if (game.phase !== 'idle') stopGame();
        renderSession();
        renderResults();
    };
}

opSelect.addEventListener('change', onSettingChange('op'));
sizeSelect.addEventListener('change', onSettingChange('n', Number));
limitSelect.addEventListener('change', onSettingChange('limit', Number));
heatmapOpSelect.addEventListener('change', onSettingChange('heatmapOp'));

const isPlaying = () => game.phase === 'question' || game.phase === 'feedback';

btnStart.addEventListener('click', () => (isPlaying() ? stopGame() : startGame()));
optionButtons.forEach((btn, i) =>
    btn.addEventListener('click', () => {
        btn.blur();
        answer(i);
    }),
);

btnReset.addEventListener('click', () => {
    if (!confirm('Reset all multiplication and division statistics?')) return;
    state.stats = { mul: {}, div: {} };
    save();
    renderResults();
});

document.addEventListener('keydown', (event) => {
    if (event.repeat) return;
    if (!isPlaying()) {
        if (event.key === ' ' && event.target === document.body) {
            event.preventDefault();
            startGame();
        }
        return;
    }
    if (event.key === 'Escape') {
        stopGame();
        return;
    }
    if (event.key in KEY_TO_INDEX) {
        event.preventDefault();
        answer(KEY_TO_INDEX[event.key]);
    }
});

window.addEventListener('resize', drawHeatmap);

applySettings();
renderSession();
renderResults();
