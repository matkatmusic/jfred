// The two report writers that decide how much of a failing visual run reaches the reader.

import type { Violation } from "./violation-geometry.ts";

// Group a run's violations by rule so the report is a handful of lines rather than one per bubble.
export function formatViolationSummary(violations: Violation[]): string[] {
  const counts = new Map<string, number>();
  for (const violation of violations) {
    const key = `${violation.state} · ${violation.rule}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const lines: string[] = [];
  for (const [key, count] of counts) {
    lines.push(`  FAIL ${key} × ${count}`);
  }
  return lines;
}

// The first few examples of each rule — enough to fix from, without printing 800 rectangles.
export function listExamples(violations: Violation[], perRule: number): string[] {
  const shown = new Map<string, number>();
  const lines: string[] = [];
  for (const violation of violations) {
    const seen = shown.get(violation.rule) ?? 0;
    if (seen >= perRule) {
      continue;
    }
    shown.set(violation.rule, seen + 1);
    lines.push(`    ${violation.rule}: ${violation.detail}`);
  }
  return lines;
}
