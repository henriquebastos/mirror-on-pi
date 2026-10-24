// A journey is a directory directly below a vault's `journeys/` directory.
// A Pi session belongs to the journey at or above its working directory.
import { basename, dirname, resolve } from "node:path";

export type Journey = {
  readonly dir: string;
  readonly slug: string;
};

export function findJourney(cwd: string): Journey | undefined {
  for (let dir = resolve(cwd); dirname(dir) !== dir; dir = dirname(dir)) {
    if (basename(dirname(dir)) === "journeys") return { dir, slug: basename(dir) };
  }
  return undefined;
}
