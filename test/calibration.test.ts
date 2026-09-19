import { describe, expect, it } from "vitest";
import { operatingPoints, reliability, type Outcome } from "../src/core/calibration.js";

/** `n` predictions at `confidence`, of which `rightShare` were right. */
function batch(confidence: number, n: number, rightShare: number): Outcome[] {
  const right = Math.round(n * rightShare);
  return Array.from({ length: n }, (_, i) => ({ confidence, correct: i < right }));
}

describe("reliability", () => {
  it("reports no error when claims match reality", () => {
    const outcomes = [...batch(0.9, 100, 0.9), ...batch(0.6, 100, 0.6)];
    const report = reliability(outcomes);
    expect(report.ece).toBeLessThan(0.01);
    expect(report.accuracy).toBeCloseTo(0.75, 2);
  });

  it("catches overconfidence", () => {
    const report = reliability(batch(0.95, 100, 0.6));
    expect(report.ece).toBeCloseTo(0.35, 2);
    expect(report.meanConfidence - report.accuracy).toBeGreaterThan(0.3);
  });

  it("catches underconfidence too", () => {
    const report = reliability(batch(0.55, 100, 0.95));
    expect(report.meanConfidence - report.accuracy).toBeLessThan(-0.3);
  });

  it("puts predictions in the bucket they belong to", () => {
    const report = reliability(batch(0.95, 10, 1), 10);
    const populated = report.bins.filter((b) => b.count > 0);
    expect(populated).toHaveLength(1);
    expect(populated[0]?.from).toBeCloseTo(0.9, 5);
  });

  it("keeps a confidence of exactly 1 in the top bin rather than off the end", () => {
    const report = reliability(batch(1, 5, 1), 10);
    expect(report.bins.at(-1)?.count).toBe(5);
    expect(report.n).toBe(5);
  });

  it("survives an empty set", () => {
    const report = reliability([]);
    expect(report).toMatchObject({ n: 0, ece: 0, brier: 0, accuracy: 0 });
  });

  it("scores Brier lower for being unsure when wrong", () => {
    const cocky = reliability(batch(0.99, 10, 0.5)).brier;
    const humble = reliability(batch(0.55, 10, 0.5)).brier;
    expect(humble).toBeLessThan(cocky);
  });
});

describe("operating points", () => {
  const outcomes = [...batch(0.95, 50, 1), ...batch(0.7, 50, 0.6)];

  it("trades coverage for precision as the threshold rises", () => {
    const [low, high] = [
      operatingPoints(outcomes, [0.6])[0],
      operatingPoints(outcomes, [0.9])[0],
    ];
    expect(low?.coverage).toBeGreaterThan(high?.coverage ?? 1);
    expect(low?.precision).toBeLessThan(high?.precision ?? 0);
  });

  it("counts the wrong answers that would be acted on unattended", () => {
    const point = operatingPoints(outcomes, [0.6])[0];
    expect(point?.escapes).toBe(20);
  });

  it("reports full precision when nothing clears the bar", () => {
    const point = operatingPoints(outcomes, [0.999])[0];
    expect(point).toMatchObject({ coverage: 0, precision: 1, escapes: 0 });
  });
});
