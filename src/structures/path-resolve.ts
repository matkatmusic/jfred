// Leaf module: one cwd path resolver shared by extraction and the sidecar.
import { resolve } from "node:path";
import { Path } from "./domain.ts";

// Relative and absolute paths both become absolute, so snapshot and event paths match.
export function normalizeAgainstCwd(cwd: Path | undefined, path: Path): string {
  if (!cwd) {
    return path.toString();
  }
  return resolve(cwd.toString(), path.toString());
}

