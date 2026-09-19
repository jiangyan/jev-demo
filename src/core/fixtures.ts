import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

/**
 * Where the recordings live, from wherever this code ended up running.
 *
 * Locally that is simply `../../fixtures` from this source file. A serverless
 * bundler flattens the tree and rewrites `import.meta.url`, so that one relative
 * path stops being true; the working directory is right there instead. Try both
 * and take the first that exists, rather than assuming either.
 */
export function fixturePath(name: string): string {
  const candidates = [
    fileURLToPath(new URL(`../../fixtures/${name}`, import.meta.url)),
    resolve(process.cwd(), "fixtures", name),
    resolve(process.cwd(), "../fixtures", name),
  ];
  return candidates.find((path) => existsSync(path)) ?? candidates[0]!;
}
