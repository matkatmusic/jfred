// One check for the only non-trivial bit of the ledger: parsing prior pass-timestamps back out of a rendered markdown row, so a re-sweep preserves a failing scenario's history instead of clobbering it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ledgerRow } from "../src/regex_expressions.ts";

function parseRow(line: string): { id: string; lastPassing: string } | undefined {
    const m = line.match(ledgerRow);
    return m ? { id: m[1]!, lastPassing: m[2]! } : undefined;
}

test("parses scenario id and last-passing cell from a PASS row", () => {
    const row = parseRow("| s19 | PASS | 4/4 | 2026-06-25T20:41:00.000Z |");
    assert.deepEqual(row, { id: "s19", lastPassing: "2026-06-25T20:41:00.000Z" });
});

test("preserves a failing scenario's 'never' / prior timestamp", () => {
    assert.equal(parseRow("| s40 | FAIL | 0/3 | never |")?.lastPassing, "never");
});

test("ignores the table header and separator rows", () => {
    assert.equal(parseRow("| Scenario | Status | Steps | Last passing reconstruction |"), undefined);
    assert.equal(parseRow("|----------|--------|-------|------------------------------|"), undefined);
});

