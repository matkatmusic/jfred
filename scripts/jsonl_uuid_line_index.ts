// Maps each record uuid to its 1-based line number across a scenario's session jsonls.

import { readFileSync } from "node:fs";
import type { Path } from "../src/structures/domain.ts";

function parseUuidOfLine(line: string): string | undefined {
  const trimmedLine = line.trim();
  if (trimmedLine.length === 0) {
    return undefined;
  }
  try {
    const uuid = (JSON.parse(line) as { uuid?: unknown }).uuid;
    return typeof uuid === "string" ? uuid : undefined;
  }
  catch {
    return undefined;
  }
}

// Uuid-less lines are skipped but still counted, so line numbers stay true to the file.
function addJsonlToIndex(jsonlPath: Path, index: Map<string, number>): void {
  const lines = readFileSync(jsonlPath.toString(), "utf8").split("\n");
  for (const [offset, line] of lines.entries()) {
    const uuid = parseUuidOfLine(line);
    if (uuid !== undefined) {
      index.set(uuid, offset + 1);
    }
  }
}

// Spans every session jsonl: uuids are globally unique, so the merged index is unambiguous.
export function buildUuidLineIndex(jsonlPaths: Path[]): Map<string, number> {
  console.log(`   Building uuid→line index from ${jsonlPaths.length} JSONL files`);
  const index = new Map<string, number>();
  for (const jsonlPath of jsonlPaths) {
    addJsonlToIndex(jsonlPath, index);
  }
  return index;
}
