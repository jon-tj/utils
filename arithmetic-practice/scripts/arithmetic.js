export const OPS = {
    mul: { name: 'Multiplication', symbol: '×', compute: (a, b) => a * b },
    div: { name: 'Division', symbol: '÷', compute: (a, b) => a / b },
};

function isExact(value) {
    const scaled = value * 1000;
    return Math.abs(scaled - Math.round(scaled)) < 1e-6;
}

// Answers must be correct to at least 3 decimals: 1/1 -> "1", 1/2 -> "0.5", 1/3 -> "0.333"
export function formatAnswer(value) {
    if (isExact(value)) return String(Math.round(value * 1000) / 1000);
    return value.toFixed(3);
}

function shuffle(items) {
    for (let i = items.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [items[i], items[j]] = [items[j], items[i]];
    }
    return items;
}

function multiplicationCandidates(a, b) {
    const product = a * b;
    const candidates = [
        a * (b + 1),
        a * (b - 1),
        (a + 1) * b,
        (a - 1) * b,
        product + 10,
        product - 10,
        (a + 1) * (b - 1),
    ];
    const digits = String(product);
    if (digits.length >= 2) {
        candidates.push(Number(digits.slice(0, -2) + digits.at(-1) + digits.at(-2)));
    }
    return candidates.filter((x) => x > 0).map(formatAnswer);
}

function divisionCandidates(a, b) {
    const value = a / b;
    const candidates = [];
    if (!isExact(value)) {
        // Precision traps: truncated instead of rounded, and too few decimals
        candidates.push((Math.trunc(value * 1000) / 1000).toFixed(3));
        if (Math.random() < 0.4) candidates.push(value.toFixed(2));
    }
    const pairs = [
        [a, b + 1],
        [a, b - 1],
        [a + 1, b],
        [a - 1, b],
        [b, a],
        [a * 10, b],
        [a, b * 10],
    ];
    for (const [x, y] of pairs) {
        if (x > 0 && y > 0) candidates.push(formatAnswer(x / y));
    }
    return candidates;
}

function fallbackCandidate(op, a, b) {
    const offset = (Math.floor(Math.random() * 20) + 1) * (Math.random() < 0.5 ? -1 : 1);
    if (op === 'mul') return formatAnswer(Math.max(1, a * b + offset));
    return formatAnswer(Math.max(1, a + offset) / b);
}

export function makeQuestion(op, a, b) {
    const answer = formatAnswer(OPS[op].compute(a, b));
    const candidates = op === 'mul' ? multiplicationCandidates(a, b) : divisionCandidates(a, b);
    const distractors = [...new Set(shuffle(candidates))].filter((x) => x !== answer).slice(0, 3);
    let attempts = 0;
    while (distractors.length < 3 && attempts++ < 100) {
        const extra = fallbackCandidate(op, a, b);
        if (extra !== answer && !distractors.includes(extra)) distractors.push(extra);
    }
    const options = shuffle([answer, ...distractors]);
    return {
        op,
        a,
        b,
        text: `${a} ${OPS[op].symbol} ${b}`,
        answer,
        options,
        correctIndex: options.indexOf(answer),
    };
}
