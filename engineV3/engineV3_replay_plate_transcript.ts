// Cuts a subagent transcript at a capture time, so the plate hook sees only what the agent had done by then.

import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { Path } from "../src/structures/domain.ts";

function isLineAfterTime(line: string, timeMs: number): boolean {
  if (line === "") {
    return false;
  }
  const timestamp = (JSON.parse(line) as { timestamp?: string }).timestamp;
  if (timestamp === undefined) {
    return false;
  }
  return Date.parse(timestamp) > timeMs;
}

function listLinesUpToTime(text: string, timeMs: number): string[] {
  const keptLines: string[] = [];
  for (const line of text.split("\n")) {
    if (isLineAfterTime(line, timeMs)) {
      break;
    }
    keptLines.push(line);
  }
  return keptLines;
}

// Returns a temp copy of the transcript that stops before the first line later than timeMs.
export function writeCutTranscript(transcriptPath: Path, timeMs: number): Path {
  const text = readFileSync(transcriptPath.toString(), "utf8");
  const cutFile = join(mkdtempSync(join(tmpdir(), "engine-v3-plate-transcript-")), basename(transcriptPath.toString()));
  writeFileSync(cutFile, listLinesUpToTime(text, timeMs).join("\n"));
  return new Path(cutFile);
}
