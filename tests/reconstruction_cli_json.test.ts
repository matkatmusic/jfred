// Integration tests for the CLI's --json / --allRecords output (Steps 5–6 of the JSON-output plan).
// Each runs runCli and JSON.parse's the result, the same shape as tests/reconstruction_cli_s19_steps.test.ts.

import { test } from "node:test";
import assert from "node:assert/strict";
import { runCli } from "../src/reconstruction_cli.ts";
import { parseArgs } from "../src/reconstruction_cli_args.ts";
import { loadRecords } from "./utilities.ts";
import { S19_JSONL } from "./fixtures.ts";

test("test_cli_json_flag_emits_parseable_complete_document", () => {
    // Behavior: bare --json parses to a document with the core sections.
    const document = JSON.parse(runCli([S19_JSONL, "--json"]));
    // Verify.
    assert.ok(Array.isArray(document.messages));
    assert.ok(Array.isArray(document.branches));
    assert.ok(Array.isArray(document.filesTouched));
    assert.ok(Array.isArray(document.steps));
});

test("test_cli_json_branch_tip_is_a_string", () => {
    // Behavior: Uuid.toJSON renders branch tips as strings.
    const document = JSON.parse(runCli([S19_JSONL, "--json"]));
    // Verify.
    assert.equal(typeof document.branches[0].tip, "string");
});

test("test_cli_json_document_steps_carry_no_file_contents", () => {
    // Behavior: the full --json document's step snapshots are SKELETONS — no inlined per-step file map
    // (the >512 MB wire-size fix). File text is resolved per step via --step / the step-files API.
    const document = JSON.parse(runCli([S19_JSONL, "--json"]));
    // Verify: steps exist but carry no `files`.
    assert.ok(document.steps.length > 0);
    assert.equal(document.steps[0].files, undefined);
});

test("test_cli_json_step_includes_change_ids", () => {
    // Behavior: each step carries a non-empty array of string changeIds.
    const document = JSON.parse(runCli([S19_JSONL, "--json"]));
    const changeIds = document.steps[0].changeIds;
    // Verify.
    assert.ok(Array.isArray(changeIds));
    assert.ok(changeIds.length > 0);
    assert.equal(typeof changeIds[0], "string");
});

test("test_cli_json_step_flag_emits_one_step_file_map", () => {
    // Behavior: --json --step 1 emits a { path: content } object.
    const files = JSON.parse(runCli([S19_JSONL, "--json", "--step", "1"]));
    // Verify.
    assert.equal(typeof files, "object");
    assert.ok(!Array.isArray(files));
    for (const value of Object.values(files)) {
        assert.equal(typeof value, "string");
    }
});

test("test_cli_allRecords_flag_emits_array_of_all_records", () => {
    // Behavior: --allRecords dumps every parsed record.
    const all = JSON.parse(runCli([S19_JSONL, "--allRecords"]));
    // Verify.
    assert.ok(Array.isArray(all));
    assert.equal(all.length, loadRecords(S19_JSONL).length);
});

test("test_cli_allRecords_each_record_carries_verdict_and_prompt_flag", () => {
    // Behavior: every dumped record is enriched with verdict + isGenuinePrompt.
    const all = JSON.parse(runCli([S19_JSONL, "--allRecords"]));
    // Verify.
    for (const record of all) {
        assert.equal(typeof record.verdict, "string");
        assert.equal(typeof record.isGenuinePrompt, "boolean");
    }
});

test("test_cli_json_document_includes_line_verdicts", () => {
    // Behavior: the document's lineVerdicts is one-per-record, line-indexed from 0.
    const document = JSON.parse(runCli([S19_JSONL, "--json"]));
    const all = JSON.parse(runCli([S19_JSONL, "--allRecords"]));
    // Verify.
    assert.ok(Array.isArray(document.lineVerdicts));
    assert.equal(document.lineVerdicts.length, all.length);
    assert.equal(document.lineVerdicts[0].line, 0);
});

test("test_cli_json_target_narrows_files_touched_to_one_path", () => {
    // Behavior: --json --target <one path> narrows filesTouched to that single file.
    const full = JSON.parse(runCli([S19_JSONL, "--json"]));
    const onePath = full.filesTouched[0].target;
    const narrowed = JSON.parse(runCli([S19_JSONL, "--json", "--target", onePath]));
    // Verify.
    assert.equal(narrowed.filesTouched.length, 1);
});

test("test_parseArgs_sets_json_flag_when_json_present", () => {
    // Behavior: --json sets the json flag.
    assert.equal(parseArgs([S19_JSONL, "--json"]).json, true);
});

test("test_parseArgs_allRecords_flag_implies_json_output", () => {
    // Behavior: --allRecords implies json.
    const options = parseArgs([S19_JSONL, "--allRecords"]);
    // Verify.
    assert.equal(options.json, true);
    assert.equal(options.allRecords, true);
});

test("test_parseArgs_file_is_alias_for_target", () => {
    // Behavior: --file resolves to the same target as --target.
    const full = JSON.parse(runCli([S19_JSONL, "--json"]));
    const onePath = full.filesTouched[0].target;
    const viaFile = parseArgs([S19_JSONL, "--file", onePath]).target;
    const viaTarget = parseArgs([S19_JSONL, "--target", onePath]).target;
    // Verify.
    assert.equal(viaFile?.toString(), viaTarget?.toString());
});

