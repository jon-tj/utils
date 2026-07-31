export function poissonProbability(k, lambda) {
    return (Math.pow(lambda, k) * Math.exp(-lambda)) / factorial(k);
}

export function factorial(n) {
    if (n === 0 || n === 1) {
        return 1;
    }
    return n * factorial(n - 1);
}

export function calculateImpliedProbabilities(oddsDraw, oddsTeamA, oddsTeamB) {
    const pA = 1 / oddsTeamA;
    const pB = 1 / oddsTeamB;
    const pD = 1 / oddsDraw;
    const total = pA + pB + pD;
    return {
        draw: pD / total,
        teamA: pA / total,
        teamB: pB / total,
    };
}