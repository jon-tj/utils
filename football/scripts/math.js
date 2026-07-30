export function poissonProbability(k, lambda) {
    return (Math.pow(lambda, k) * Math.exp(-lambda)) / factorial(k);
}

export function factorial(n) {
    if (n === 0 || n === 1) {
        return 1;
    }
    return n * factorial(n - 1);
}