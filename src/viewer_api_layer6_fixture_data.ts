// Layer 6 fixture data: the canned replay result of each runnable fixture run, and which runs block which.

import { WireConfidence } from "../webapp/layer1-wire-edits.ts";
import { WireRunOutcome, type WireScriptOutputLine } from "../webapp/layer1-wire-script-results.ts";
import { FIXTURE_RUN_ID } from "./viewer_api_layer6_fixture_blocked_runs.ts";

export interface CannedFixtureRun {
  outcome: WireRunOutcome;
  reason?: string;
  confidence?: WireConfidence;
  lines: Pick<WireScriptOutputLine, "stream" | "text">[];
  exitCode?: number;
  lineDelayMs: number;
}

function buildStdoutLines(...texts: string[]): CannedFixtureRun["lines"] {
  const lines: CannedFixtureRun["lines"] = [];
  for (const text of texts) {
    lines.push({ stream: "stdout", text });
  }
  return lines;
}

const CANNED_RUNS: Record<string, CannedFixtureRun> = {
  [FIXTURE_RUN_ID.pre]: { outcome: WireRunOutcome.replayed, confidence: WireConfidence.verified, exitCode: 0, lineDelayMs: 0,
    lines: buildStdoutLines("reading README.md", "writing README.md", "done") },
  [FIXTURE_RUN_ID.blocker]: { outcome: WireRunOutcome.replayed, confidence: WireConfidence.verified, exitCode: 0, lineDelayMs: 0,
    lines: buildStdoutLines("wrote the blocker file") },
  [FIXTURE_RUN_ID.blocked]: { outcome: WireRunOutcome.replayed, confidence: WireConfidence.verified, exitCode: 0, lineDelayMs: 0,
    lines: buildStdoutLines("wrote the blocked file") },
  [FIXTURE_RUN_ID.slow]: { outcome: WireRunOutcome.replayed, confidence: WireConfidence.verified, exitCode: 0, lineDelayMs: 150,
    lines: buildStdoutLines("step 1 of 6", "step 2 of 6", "step 3 of 6", "step 4 of 6", "step 5 of 6", "step 6 of 6") },
  [FIXTURE_RUN_ID.replayMismatch]: { outcome: WireRunOutcome.replayed, confidence: WireConfidence.mismatch, exitCode: 0, lineDelayMs: 0,
    lines: buildStdoutLines("wrote the file", "the file differs from the later proof") },
  [FIXTURE_RUN_ID.skipAfter]: { outcome: WireRunOutcome.replayed, confidence: WireConfidence.injectedUnverified, exitCode: 0, lineDelayMs: 0,
    lines: buildStdoutLines("wrote the file") },
  [FIXTURE_RUN_ID.skipFailed]: { outcome: WireRunOutcome.originalFailed, confidence: WireConfidence.originalFailed, lineDelayMs: 0,
    reason: "the original run failed, so there is nothing to replay", lines: [] },
  [FIXTURE_RUN_ID.crashBlocker]: { outcome: WireRunOutcome.replayFailed, exitCode: 1, lineDelayMs: 0,
    reason: "the script crashed with exit code 1",
    lines: [{ stream: "stderr", text: "Traceback (most recent call last):" }, { stream: "stderr", text: "FileNotFoundError: missing/input.txt" }] },
  [FIXTURE_RUN_ID.replayNotReplayed]: { outcome: WireRunOutcome.notReplayed, lineDelayMs: 0,
    reason: "this script only reads files, so it is not replayed", lines: [] },
};

// The earlier runs each run needs before it may start.
export const FIXTURE_RUN_BLOCKERS: Record<string, string[]> = {
  [FIXTURE_RUN_ID.blocked]: [FIXTURE_RUN_ID.blocker],
  [FIXTURE_RUN_ID.crashBlocked]: [FIXTURE_RUN_ID.crashBlocker],
};

export function findCannedFixtureRun(toolUseId: string): CannedFixtureRun {
  const canned = CANNED_RUNS[toolUseId];
  if (canned === undefined) {
    throw new Error(`no canned fixture result for ${toolUseId}`);
  }
  return canned;
}
