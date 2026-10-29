// Writes a PASS/FAIL coverage snapshot to plans/coverage-ledger.md.
// ponytail: timestamp = last-seen-green (re-stamped on every PASS). Run it at checkpoints (after a fix + full re-sweep), not casually, so the diff stays meaningful.

import { fileURLToPath } from "node:url";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { listCoveredScenarios } from "./coverage_scenarios.ts";
import { validateScenarioResilient } from "./check_scenario_coverage.ts";
import type { ScenarioResult } from "./coverage_report.ts";

const LEDGER_PATH = new URL("../plans/coverage-ledger.md", import.meta.url);

// Preserve prior timestamps so fixing one scenario doesn't reset others.
function readPriorTimestamps(): Map<string, string> {
  const prior = new Map<string, string>();
  const path = fileURLToPath(LEDGER_PATH);
  const hasLedger = existsSync(path);
  if (!hasLedger) {
    return prior;
  }
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const match = line.match(/^\|\s*(s\d+)\s*\|[^|]*\|[^|]*\|\s*(.+?)\s*\|$/);
    if (match) {
      prior.set(match[1]!, match[2]!);
    }
  }
  return prior;
}

// Numeric order by scenario number (s9 before s10), so the ledger reads in attack order.
function getScenarioNumber(scenarioId: string): number {
  return Number(scenarioId.replace(/^s/, ""));
}

function compareByScenarioNumber(a: ScenarioResult, b: ScenarioResult): number {
  return getScenarioNumber(a.scenario.scenarioId) - getScenarioNumber(b.scenario.scenarioId);
}

function executeLedgerWrite(): void {
  const now = new Date().toISOString();
  const prior = readPriorTimestamps();
  const results: ScenarioResult[] = [];
  for (const scenario of listCoveredScenarios()) {
    results.push(validateScenarioResilient(scenario));
  }
  results.sort(compareByScenarioNumber);

  const rows: string[] = [];
  let passCount = 0;
  for (const result of results) {
    const id = result.scenario.scenarioId;
    const passing = result.mismatches.length === 0;
    const lastPassing = passing ? now : (prior.get(id) ?? "never");
    if (passing) {
      passCount += 1;
    }
    rows.push(`| ${id} | ${passing ? "PASS" : "FAIL"} | ${result.passed}/${result.total} | ${lastPassing} |`);
  }
  const header = [
    "# Scenario coverage ledger",
    "",
    `Swept ${now} — **${passCount}/${results.length}** scenarios fully reproduced.`,
    "Regenerate with `npx tsx scripts/coverage_ledger.ts`. A FAIL here is a known engine gap; do not let a",
    "PASS regress to FAIL. \"Last passing reconstruction\" is the most recent sweep that found it green.",
    "",
    "| Scenario | Status | Steps | Last passing reconstruction |",
    "|----------|--------|-------|------------------------------|",
  ];
  writeFileSync(fileURLToPath(LEDGER_PATH), header.concat(rows).join("\n") + "\n");
  console.log(`${passCount}/${results.length} passing — wrote ${fileURLToPath(LEDGER_PATH)}`);
}

const isEntryPoint = process.argv[1] === fileURLToPath(import.meta.url);
if (isEntryPoint) {
  executeLedgerWrite();
}


