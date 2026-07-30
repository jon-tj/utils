// Pure calculation helpers for the apartment calculator. No DOM access.

// Map from a location name to its `region_*` key in the params. Locations
// not listed here fall back to `region_Other`.
export const LOCATION_TO_REGION = {
    Brazil: {
        'Leblon': 'Leblon',
        'Ipanema': 'Ipanema',
        'Lagoa': 'Lagoa',
        'Barra da Tijuca': 'Other',
        'Copacabana': 'Copacabana',
        'Botafogo': 'Botafogo',
        'Flamengo': 'Flamengo',
        'Laranjeiras': 'Laranjeiras',
        'Recreio dos Bandeirantes': 'Recreio',
        'Tijuca': 'Tijuca',
        'Rio de Janeiro Average': 'Other',
        'Niterói: Centro': 'Niterói_Centro',
        'Niterói: Fonseca': 'Fonseca',
        'Niterói: Icaraí': 'Icaraí',
        'Niterói: Ingá': 'Ingá',
    },
};

// Determine which country + region a location belongs to. Anything not in a
// known Brazil neighborhood defaults to Norway.
export function classifyLocation(location) {
    const brazil = LOCATION_TO_REGION.Brazil;
    if (location in brazil) {
        return { country: 'Brazil', region: brazil[location] };
    }
    return { country: 'Norway', region: 'Other' };
}

// Log-linear price model. Params come from params.json[country]:
//   log(value) = intercept
//              + logSqm      * ln(sqm)
//              + bedrooms    * bedrooms
//              + expectedFloor * floor
//              + feesTotal   * feesTotal
//              + region_<region>   (falls back to region_Other)
// Any missing coefficient is treated as 0. Returns the predicted value.
export function predictValue(params, { sqm = 0, bedrooms = 0, floor = 0, feesTotal = 0, region = 'Other' } = {}) {
    if (!params) return 0;
    let log = params.intercept ?? 0;
    if (sqm > 0) log += (params.logSqm ?? 0) * Math.log(sqm);
    log += (params.bedrooms ?? 0) * bedrooms;
    log += (params.expectedFloor ?? 0) * floor;
    log += (params.feesTotal ?? 0) * feesTotal;
    const regionCoeff = params[`region_${region}`] ?? params.region_Other ?? 0;
    log += regionCoeff;
    return Math.exp(log);
}

export function calculate_apartment_value(
    sqm,
    pricePerSqm,
    bedrooms,
    location,
    floor,
    tax_monthly,
    fees_monthly,
    countryParams,
    region,
) {
    const feesTotal = (tax_monthly || 0) + (fees_monthly || 0);
    const value = predictValue(countryParams, { sqm, bedrooms, floor, feesTotal, region });
    return {
        value,
        sqm,
        pricePerSqm: value / sqm,
        bedrooms,
        location,
        floor,
    };
}