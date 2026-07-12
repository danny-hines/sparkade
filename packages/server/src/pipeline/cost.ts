// Cost math. Prices are USD per million tokens; every job snapshots the rows
// it uses, so later price edits never rewrite history. Unknown model → null
// (displayed as "cost unavailable", never $0.00).
import type { PriceRow, ProviderUsage } from '@sparkade/shared';

export type PriceSnapshot = Record<string, PriceRow>;

export function costOf(model: string, usage: ProviderUsage, snapshot: PriceSnapshot): number | null {
  const price = snapshot[model];
  if (!price) return null;
  // Cache-served input bills at the cached rate; missing cachedInputPerM means
  // "no discount known" — bill conservatively at the full input rate.
  const cached = Math.min(usage.cachedInput ?? 0, usage.input);
  const fresh = usage.input - cached;
  const cachedRate = price.cachedInputPerM ?? price.inputPerM;
  return (
    (fresh / 1_000_000) * price.inputPerM +
    (cached / 1_000_000) * cachedRate +
    (usage.output / 1_000_000) * price.outputPerM
  );
}

/** Sums entries; null if any entry is unknown-cost (never under-report). */
export function sumCosts(costs: (number | null)[]): number | null {
  let total = 0;
  for (const c of costs) {
    if (c === null) return null;
    total += c;
  }
  return total;
}

/**
 * Review-screen estimate from typical happy-path token counts (design + 3 spec
 * passes). Labeled an estimate in the UI; returns null when the model has no
 * pricing row.
 */
export function estimateGenerationCost(model: string, snapshot: PriceSnapshot): number | null {
  const price = snapshot[model];
  if (!price) return null;
  const typical: ProviderUsage[] = [
    { input: 5200, output: 1800 }, // design
    { input: 7400, output: 4200 }, // levels
    { input: 6800, output: 3200 }, // entities
    { input: 5600, output: 2600 }, // music
  ];
  let total = 0;
  for (const u of typical) total += (u.input / 1e6) * price.inputPerM + (u.output / 1e6) * price.outputPerM;
  return total;
}

export function formatUsd(v: number | null): string {
  if (v === null) return 'cost unavailable';
  return `$${v.toFixed(3)}`;
}
