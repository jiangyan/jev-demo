const on = process.stdout.isTTY && !process.env["NO_COLOR"];
const wrap = (code: string) => (text: string) => (on ? `\u001b[${code}m${text}\u001b[0m` : text);

export const dim = wrap("2");
export const bold = wrap("1");
export const red = wrap("31");
export const green = wrap("32");
export const yellow = wrap("33");
export const blue = wrap("34");
export const magenta = wrap("35");
export const cyan = wrap("36");

/**
 * A confidence bar, coloured by which side of the automation gate it falls on.
 * The colour carries the decision, so no separate threshold marker is needed.
 */
export function bar(value: number, colour: (t: string) => string, width = 20): string {
  const filled = Math.max(0, Math.min(width, Math.round(value * width)));
  return colour("█".repeat(filled)) + dim("░".repeat(width - filled));
}

/** Probabilities are printed as probabilities, not rounded percentages. */
export function prob(n: number): string {
  return n.toFixed(2);
}

export function pad(text: string, width: number): string {
  // Padding is computed on the visible text, so it survives colour codes.
  const visible = text.replace(/\u001b\[[0-9;]*m/g, "");
  return text + " ".repeat(Math.max(0, width - visible.length));
}

export function rule(width = 78): string {
  return dim("─".repeat(width));
}
