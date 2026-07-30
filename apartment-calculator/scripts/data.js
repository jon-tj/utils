// Historical price-per-m² data keyed by location. Each value has parallel
// arrays: `dates` (ISO date strings, quarterly) and `sqmPrice` (numbers).
export const historicalHomePrices = {};

// Country-scoped price-factor parameters. See data/params.json.
export const priceFactorParams = {};

export const ready = Promise.all([
    fetch('data/historical-home-prices.json').then(r => r.json()).then(d => {
        Object.assign(historicalHomePrices, d);
    }),
    fetch('data/params.json').then(r => r.json()).then(d => {
        Object.assign(priceFactorParams, d);
    }),
]);

export function findHistoricalHomePrice(location) {
    return historicalHomePrices[location];
}

// Locations without their own series fall back to the Rio de Janeiro
// average. Returns the entry for the location, the fallback entry, or
// undefined if neither exists.
export function getHistoryFor(location) {
    return historicalHomePrices[location] ?? historicalHomePrices['Rio de Janeiro Average'];
}

// Return the most recent { date, price } observation for a location, or null.
export function latestPricePerSqm(location) {
    const entry = getHistoryFor(location);
    if (!entry || !entry.sqmPrice?.length) return null;
    const i = entry.sqmPrice.length - 1;
    return { date: entry.dates[i], price: entry.sqmPrice[i] };
}
