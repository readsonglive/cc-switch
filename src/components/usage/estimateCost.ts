export interface TokenBreakdown {
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
}

export interface PriceEstimate {
  modelId: string;
  displayName: string;
  costUsd: number;
  hasCachePricing: boolean;
}

export function estimateModelCost(
  tokens: TokenBreakdown,
  pricing: import("@/types/usage").ModelPricing,
): PriceEstimate {
  const calc = (value: string) => {
    const n = Number.parseFloat(value);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  };
  const inputCost =
    calc(pricing.inputCostPerMillion) * (tokens.input / 1_000_000);
  const outputCost =
    calc(pricing.outputCostPerMillion) * (tokens.output / 1_000_000);
  const cacheWriteCost =
    calc(pricing.cacheCreationCostPerMillion) * (tokens.cacheWrite / 1_000_000);
  const cacheReadCost =
    calc(pricing.cacheReadCostPerMillion) * (tokens.cacheRead / 1_000_000);
  const hasCachePricing =
    Boolean(pricing.cacheReadCostPerMillion) &&
    Boolean(pricing.cacheCreationCostPerMillion);
  const costUsd = inputCost + outputCost + cacheWriteCost + cacheReadCost;
  return {
    modelId: pricing.modelId,
    displayName: pricing.displayName,
    costUsd,
    hasCachePricing,
  };
}

export function estimateAll(
  tokens: TokenBreakdown,
  pricings: readonly import("@/types/usage").ModelPricing[],
): PriceEstimate[] {
  const sum =
    tokens.input + tokens.output + tokens.cacheWrite + tokens.cacheRead;
  if (sum === 0) return [];
  return pricings
    .filter((p) => p.modelId)
    .map((p) => estimateModelCost(tokens, p));
}
