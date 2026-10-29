import { test } from "node:test";
import assert from "node:assert/strict";
import { buildAllFileHistories } from "../src/reconstruction_engine.ts";
import { getLinesText } from "../src/reconstruction_revisions.ts";
import { EventKind } from "../src/structures/vocabulary.ts";
import { buildSidecarReader } from "../src/reconstruction_sidecar_reader.ts";
import { loadTranscript } from "../src/parse/loadTranscript.ts";
import { getScenarioJsonlPaths } from "./scenario-locator.ts";

const COMMENT = "# names normalized via rename script";

function reconstructLedger() {
    // Task 165: the reader needs each record's on-disk source to find sidecars; source-less records fall back to live file-history.
    const records = getScenarioJsonlPaths("s37").flatMap((path) => loadTranscript(path.toString()).records);
    const reader = buildSidecarReader(records)!;
    const histories = buildAllFileHistories(records, reader);
    const ledger = histories.find(
        (history) =>
            history.target.toString().endsWith("/ledger.py") &&
            !history.target.toString().endsWith("test_ledger.py"),
    );
    assert.ok(ledger !== undefined, "ledger.py history present");
    return ledger;
}

// The engine computes post-script content, so renames apply but stray comments do not.
test("test_s37_ledger_has_a_script_execution_revision_renamed_without_the_comment", () => {
    const ledger = reconstructLedger();
    const scriptRev = ledger.revisions.find(
        (revision) => revision.kind === EventKind.scriptExecution,
    );
    assert.ok(scriptRev !== undefined, "a script-execution revision exists");
    const text = getLinesText(scriptRev).join("\n");
    assert.ok(text.includes("def record_entry("), "applied add_entry -> record_entry");
    assert.ok(text.includes("def total_debits("), "applied tot_debits -> total_debits");
    assert.ok(!text.includes("add_entry"), "no pre-rename name survives");
    assert.ok(!text.includes(COMMENT), "the out-of-band comment is not in the post-script revision");
});
