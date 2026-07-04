import { describe, it, expect } from "bun:test";
import { selectTiers } from "./tiers.js";

describe("selectTiers", () => {
  it("keeps only requested tiers in ascending order", () => {
    expect(selectTiers([2, 0, 1])).toEqual([0, 1, 2]);
    expect(selectTiers([0, 2])).toEqual([0, 2]);
  });
  it("ignores unknown tiers", () => {
    expect(selectTiers([0, 5, 1])).toEqual([0, 1]);
  });
});
