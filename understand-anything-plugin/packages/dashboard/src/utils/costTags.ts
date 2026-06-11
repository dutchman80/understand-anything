// Knowledge wikis encode operational cost data as node tags:
//   cost:$205k/yr   — annual dollar cost (also accepts $950/yr, cost:$1.5m/yr)
//   hours:3150/yr   — annual hours spent
//   leak            — marks the node as a cost leak
// This module is the single parser for those tags so the canvas, legend,
// and detail panels all agree on the numbers.

export interface CostTagInfo {
  hours?: number;
  costPerYear?: number;
  isLeak: boolean;
}

// `cost:` prefix is the authored form; bare `$205k/yr` is tolerated.
const COST_RE = /^(?:cost:)?\$([\d,]+(?:\.\d+)?)\s*([km])?\/yr$/i;
const HOURS_RE = /^hours:([\d,]+(?:\.\d+)?)\/yr$/i;

const UNIT_MULTIPLIERS: Record<string, number> = {
  k: 1_000,
  m: 1_000_000,
};

function parseNumber(raw: string): number | undefined {
  const value = Number(raw.replace(/,/g, ""));
  return Number.isFinite(value) ? value : undefined;
}

/** Extract cost metadata from a node's tags. Unparseable tags are ignored. */
export function parseCostTags(tags: string[] | undefined): CostTagInfo {
  const info: CostTagInfo = { isLeak: false };
  if (!tags) return info;

  for (const tag of tags) {
    const trimmed = tag.trim();
    if (trimmed === "leak") {
      info.isLeak = true;
      continue;
    }
    const costMatch = COST_RE.exec(trimmed);
    if (costMatch) {
      const value = parseNumber(costMatch[1]);
      if (value !== undefined) {
        const unit = costMatch[2]?.toLowerCase();
        info.costPerYear = value * (unit ? UNIT_MULTIPLIERS[unit] : 1);
      }
      continue;
    }
    const hoursMatch = HOURS_RE.exec(trimmed);
    if (hoursMatch) {
      const value = parseNumber(hoursMatch[1]);
      if (value !== undefined) info.hours = value;
    }
  }

  return info;
}

function trimTrailingZero(value: number): string {
  const fixed = value.toFixed(1);
  return fixed.endsWith(".0") ? fixed.slice(0, -2) : fixed;
}

/** Format an annual dollar amount compactly: 205000 → "$205k/yr". */
export function formatCostPerYear(value: number): string {
  if (value >= 1_000_000) return `$${trimTrailingZero(value / 1_000_000)}M/yr`;
  if (value >= 1_000) return `$${trimTrailingZero(value / 1_000)}k/yr`;
  return `$${Math.round(value)}/yr`;
}

/** Sum the parsed costPerYear across a set of tag lists. */
export function sumCostPerYear(tagLists: Array<string[] | undefined>): number {
  let total = 0;
  for (const tags of tagLists) {
    total += parseCostTags(tags).costPerYear ?? 0;
  }
  return total;
}
