// Layer 1 cold-start defaults, read from the gitignored `.config/debugConfig.json`.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Every field is optional: a config naming only `dir` is valid.
export interface Layer1Defaults {
  dir?: string;
  repo?: string;
  jsonl?: string[];
  fileHistory?: string[];
}

export const DEBUG_CONFIG_PATH = resolve(import.meta.dirname, "..", ".config", "debugConfig.json");

// A hand-edited typo must give "no default for that field", never a wrong shape.
function readStringArray(value: unknown): string[] | undefined {
  const isArray = Array.isArray(value);
  if (!isArray) {
    return undefined;
  }
  for (const entry of value) {
    if (typeof entry !== "string") {
      return undefined;
    }
  }
  return value;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

export function computeLayer1Defaults(): Layer1Defaults {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(readFileSync(DEBUG_CONFIG_PATH, "utf8")) as Record<string, unknown>;
  }
  catch {
    // No file, or not JSON: the normal case. Defaults are a convenience, never a requirement.
    return {};
  }
  return {
    dir: readString(parsed.dir),
    repo: readString(parsed.repo),
    jsonl: readStringArray(parsed.jsonl),
    fileHistory: readStringArray(parsed.fileHistory),
  };
}
