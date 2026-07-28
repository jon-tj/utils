// Pure calculation helpers for the apartment calculator. No DOM access.

export function calculate_apartment_value(sqm, pricePerSqm, bedrooms, location, floor, tax_monthly, fees_monthly) {
    const value = (sqm || 0) * (pricePerSqm || 0);
    const monthlyCosts = (tax_monthly || 0) + (fees_monthly || 0);
    const annualCosts = monthlyCosts * 12;
    return {
        value,
        monthlyCosts,
        annualCosts,
        sqm,
        pricePerSqm,
        bedrooms,
        location,
        floor,
    };
}