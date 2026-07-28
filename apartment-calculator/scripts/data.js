// Historical price-per-m² data keyed by location. Each value has parallel
// arrays: `dates` (ISO date strings, quarterly) and `sqmPrice` (numbers).
export const historicalHomePrices = {};

export const ready = Promise.all([
    fetch('data/historical-home-prices.json').then(r => r.json()).then(d => {
        Object.assign(historicalHomePrices, d);
    }),
]);

export function findHistoricalHomePrice(location) {
    return historicalHomePrices[location];
}

// Return the most recent { date, price } observation for a location, or null.
export function latestPricePerSqm(location) {
    const entry = historicalHomePrices[location];
    if (!entry || !entry.sqmPrice?.length) return null;
    const i = entry.sqmPrice.length - 1;
    return { date: entry.dates[i], price: entry.sqmPrice[i] };
}
