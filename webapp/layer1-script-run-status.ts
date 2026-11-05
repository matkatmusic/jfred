// Layer 1 script-run drawer marks: Verified, Located and Replayed, read from the run's stored result.

import { createElement } from "./app-dom.ts";
import { getRunOutcome, getRunResult } from "./layer1-run-results.ts";
import { WireConfidence } from "./layer1-wire-edits.ts";
import { WireRunOutcome } from "./layer1-wire-script-results.ts";
import type { WireScriptRun } from "./layer1-wire-script-runs.ts";

export interface RunStatus {
  verified: boolean;
  located: boolean;
  replayed: boolean;
}

// dpath collapses normal spaces, so each bar is padded with two non-breaking spaces.
const BAR = "  |  ";
const ALL_CHECKS: readonly (keyof RunStatus)[] = ["verified", "located", "replayed"];

// Located is true for every wire run: the static scan found its files.
export function computeRunStatus(run: WireScriptRun): RunStatus {
  return {
    verified: getRunResult(run.toolUseId)?.confidence === WireConfidence.verified,
    located: true,
    replayed: getRunOutcome(run.toolUseId) === WireRunOutcome.replayed,
  };
}

function buildStatusBadge(check: keyof RunStatus, isPassed: boolean): (string | HTMLElement)[] {
  const name = `${check[0]!.toUpperCase()}${check.slice(1)}: `;
  return [
    BAR,
    createElement("span", { class: "run-check", text: name }),
    createElement("span", { class: "run-status", text: isPassed ? "✅" : "❌", title: isPassed ? check : `not ${check}` }),
  ];
}

// A verified run needs no other check.
export function buildScriptRunStatusBadges(run: WireScriptRun): (string | HTMLElement)[] {
  const status = computeRunStatus(run);
  const checks = status.verified ? ["verified" as const] : ALL_CHECKS;
  const badges: (string | HTMLElement)[] = [];
  for (const check of checks) {
    badges.push(...buildStatusBadge(check, status[check]));
  }
  return badges;
}
