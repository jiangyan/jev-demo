/**
 * Measuring the calibration claim instead of repeating it.
 *
 * "Calibrated confidence" means something specific and falsifiable: of the
 * decisions a model reports at 0.9, about 90% should be right. That is checkable
 * against labelled data, and it is the property the automation gate depends on.
 * If confidence is not calibrated, every threshold in `gate.ts` is guesswork.
 */

/** One prediction paired with whether it turned out to be right. */
export interface Outcome {
  /** The model's reported probability for the answer it gave, in [0, 1]. */
  confidence: number;
  /** Whether that answer matched the human label. */
  correct: boolean;
}

export interface ReliabilityBin {
  /** Lower edge of the confidence bucket, inclusive. */
  from: number;
  /** Upper edge, exclusive (inclusive for the final bin). */
  to: number;
  count: number;
  /** Mean reported confidence of the predictions in this bucket. */
  meanConfidence: number;
  /** Share of them that were actually right. */
  accuracy: number;
}

export interface CalibrationReport {
  n: number;
  bins: ReliabilityBin[];
  /** Expected calibration error: mean gap between confidence and accuracy, weighted by bin size. Lower is better; 0 is perfect. */
  ece: number;
  /** Mean squared error of the probabilities. Rewards being both right and appropriately unsure. */
  brier: number;
  /** Overall share correct, ignoring confidence. */
  accuracy: number;
  /** Mean reported confidence. Compare with `accuracy`: higher means overconfident. */
  meanConfidence: number;
}

/**
 * Bucket predictions by reported confidence and compare each bucket's confidence
 * with how often it was actually right.
 */
export function reliability(outcomes: readonly Outcome[], binCount = 10): CalibrationReport {
  if (outcomes.length === 0) {
    return { n: 0, bins: [], ece: 0, brier: 0, accuracy: 0, meanConfidence: 0 };
  }

  const buckets: Outcome[][] = Array.from({ length: binCount }, () => []);
  for (const o of outcomes) {
    // The top edge belongs to the last bin rather than opening a bin of its own.
    const index = Math.min(binCount - 1, Math.floor(o.confidence * binCount));
    buckets[index]?.push(o);
  }

  const bins: ReliabilityBin[] = [];
  let ece = 0;
  for (const [index, bucket] of buckets.entries()) {
    const from = index / binCount;
    const to = (index + 1) / binCount;
    if (bucket.length === 0) {
      bins.push({ from, to, count: 0, meanConfidence: 0, accuracy: 0 });
      continue;
    }
    const meanConfidence = mean(bucket.map((o) => o.confidence));
    const accuracy = mean(bucket.map((o) => (o.correct ? 1 : 0)));
    bins.push({ from, to, count: bucket.length, meanConfidence, accuracy });
    ece += (bucket.length / outcomes.length) * Math.abs(meanConfidence - accuracy);
  }

  return {
    n: outcomes.length,
    bins,
    ece,
    brier: mean(outcomes.map((o) => (o.confidence - (o.correct ? 1 : 0)) ** 2)),
    accuracy: mean(outcomes.map((o) => (o.correct ? 1 : 0))),
    meanConfidence: mean(outcomes.map((o) => o.confidence)),
  };
}

export interface OperatingPoint {
  threshold: number;
  /** Share of all decisions that clear the threshold, i.e. how much work gets automated. */
  coverage: number;
  /** Share of the automated decisions that are right. */
  precision: number;
  /** Decisions that clear the threshold and are wrong: the ones that reach a customer. */
  escapes: number;
}

/**
 * The operations question the reliability curve exists to answer: if I automate
 * everything above threshold t, how much of the queue do I cover, and how many
 * mistakes do I ship? Coverage rises and precision falls as t drops, and this is
 * the table you pick a threshold from.
 */
export function operatingPoints(
  outcomes: readonly Outcome[],
  thresholds: readonly number[] = [0.5, 0.6, 0.7, 0.8, 0.85, 0.9, 0.95, 0.99],
): OperatingPoint[] {
  return thresholds.map((threshold) => {
    const automated = outcomes.filter((o) => o.confidence >= threshold);
    const wrong = automated.filter((o) => !o.correct).length;
    return {
      threshold,
      coverage: outcomes.length === 0 ? 0 : automated.length / outcomes.length,
      precision: automated.length === 0 ? 1 : (automated.length - wrong) / automated.length,
      escapes: wrong,
    };
  });
}

function mean(xs: readonly number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}
