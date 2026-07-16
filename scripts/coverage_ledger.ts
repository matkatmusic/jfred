// Coverage ledger: sweep every covered scenario through the engine and write a human-readable PASS/FAIL
// snapshot to plans/coverage-ledger.md, preserving each scenario's "last passing reconstruction"
// timestamp across runs (a scenario passing now is stamped with the current time; a failing scenario keeps
// whatever timestamp it last earned, or "never"). The test suite (scenario_coverage.test.ts) is the runtime
// regression oracle; this file is the at-a-glance status + regression record the user reads. Run:
//   npx tsx scripts/coverage_ledger.ts
// ponytail: timestamp = last-seen-green (re-stamped on every PASS). Run it at checkpoints (after a fix +
// full re-sweep), not casually, so the diff stays meaningful.

import { fileURLToPath } from "node:url";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { listCoveredScenarios } from "./coverage_scenarios.ts";
import { checkScenarioResilient } from "./check_scenario_coverage.ts";

const LEDGER_PATH = new URL("../plans/coverage-ledger.md", import.meta.url);

// The "last passing reconstruction" cell for each scenarioId parsed out of an existing ledger, so a fix that
// flips one scenario never disturbs the others' history. Rows look like: "| s40 | FAIL | 0/3 | never |".
function readPriorTimestamps(): Map<string, string> {
    const prior = new Map<string, string>();
    const path = fileURLToPath(LEDGER_PATH);
    if (!existsSync(path)) {
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
function scenarioNumber(scenarioId: string): number {
    return Number(scenarioId.replace(/^s/, ""));
}

function main(): void {
    const now = new Date().toISOString();
    const prior = readPriorTimestamps();
    const covered = listCoveredScenarios();
    const results = covered.map(checkScenarioResilient);
    results.sort((a, b) => scenarioNumber(a.scenario.scenarioId) - scenarioNumber(b.scenario.scenarioId));

    const rows = results.map((result) => {
        const id = result.scenario.scenarioId;
        const passing = result.mismatches.length === 0;
        const lastPassing = passing ? now : (prior.get(id) ?? "never");
        return `| ${id} | ${passing ? "PASS" : "FAIL"} | ${result.passed}/${result.total} | ${lastPassing} |`;
    });

    const passCount = results.filter((r) => r.mismatches.length === 0).length;
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

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    main();
}

