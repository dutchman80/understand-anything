import { describe, it, expect } from "vitest";
import { parseCostTags, formatCostPerYear, sumCostPerYear } from "../costTags";

describe("parseCostTags", () => {
  it("parses cost:$<n>k/yr into dollars", () => {
    expect(parseCostTags(["cost:$205k/yr"]).costPerYear).toBe(205_000);
  });

  it("parses plain dollar amounts without a unit suffix", () => {
    expect(parseCostTags(["cost:$950/yr"]).costPerYear).toBe(950);
  });

  it("accepts a bare $<n>k/yr tag without the cost: prefix", () => {
    expect(parseCostTags(["$12k/yr"]).costPerYear).toBe(12_000);
  });

  it("supports the m suffix for millions", () => {
    expect(parseCostTags(["cost:$1.5m/yr"]).costPerYear).toBe(1_500_000);
  });

  it("supports decimals and comma separators", () => {
    expect(parseCostTags(["cost:$2.5k/yr"]).costPerYear).toBe(2_500);
    expect(parseCostTags(["cost:$1,200/yr"]).costPerYear).toBe(1_200);
  });

  it("is case-insensitive on the unit", () => {
    expect(parseCostTags(["cost:$3K/yr"]).costPerYear).toBe(3_000);
  });

  it("parses hours:<n>/yr", () => {
    expect(parseCostTags(["hours:3150/yr"]).hours).toBe(3_150);
  });

  it("flags leak-tagged nodes", () => {
    expect(parseCostTags(["leak"]).isLeak).toBe(true);
    expect(parseCostTags(["cost:$205k/yr"]).isLeak).toBe(false);
  });

  it("combines cost, hours, and leak from one tag list", () => {
    const info = parseCostTags(["leak", "hours:3150/yr", "cost:$205k/yr", "ops"]);
    expect(info).toEqual({ isLeak: true, hours: 3_150, costPerYear: 205_000 });
  });

  it("ignores unrelated and malformed tags", () => {
    const info = parseCostTags([
      "validation",
      "cost:abc/yr",
      "cost:$5k",
      "hours:/yr",
      "$",
      "leaky",
    ]);
    expect(info).toEqual({ isLeak: false });
  });

  it("returns an empty result for undefined or empty tags", () => {
    expect(parseCostTags(undefined)).toEqual({ isLeak: false });
    expect(parseCostTags([])).toEqual({ isLeak: false });
  });
});

describe("formatCostPerYear", () => {
  it("formats thousands with a k suffix", () => {
    expect(formatCostPerYear(205_000)).toBe("$205k/yr");
  });

  it("keeps one decimal for non-round thousands", () => {
    expect(formatCostPerYear(2_500)).toBe("$2.5k/yr");
  });

  it("formats millions with an M suffix", () => {
    expect(formatCostPerYear(1_500_000)).toBe("$1.5M/yr");
    expect(formatCostPerYear(2_000_000)).toBe("$2M/yr");
  });

  it("formats sub-thousand amounts as plain dollars", () => {
    expect(formatCostPerYear(950)).toBe("$950/yr");
  });
});

describe("sumCostPerYear", () => {
  it("sums costs across tag lists, skipping nodes without cost", () => {
    expect(
      sumCostPerYear([
        ["cost:$205k/yr"],
        ["docs"],
        undefined,
        ["cost:$5k/yr", "leak"],
      ]),
    ).toBe(210_000);
  });
});
