import { test } from "node:test";
import assert from "node:assert/strict";
import {
    createAuditFindings,
    auditJsonlText,
    SYNTHETIC_RECONSTRUCTED_VERSION,
} from "../scripts/audit_unmodeled_fields.ts";
import { RecordType } from "../src/structures/vocabulary.ts";

test("test_auditJsonlText_collects_unknown_types_and_unmodeled_fields", () => {
    // Scenario: one transcript carries an unknown record type, a known record with an
    // unmodeled field, a fully modeled record, and a synthetic reconstructed record
    // with a tool-invented field. The auditor reports the first two, keyed with counts
    // and a file:line example, and skips the synthetic record entirely.
    // Steps:
    // build the four-line transcript text.
    const lines = [
        JSON.stringify({ type: "made-up-type", payload: 1 }),
        JSON.stringify({ type: RecordType.mode, sessionId: "s", mode: "normal", bogusKey: 1 }),
        JSON.stringify({ type: RecordType.mode, sessionId: "s", mode: "normal" }),
        JSON.stringify({
            type: RecordType.user,
            version: SYNTHETIC_RECONSTRUCTED_VERSION,
            reconstructed: true,
        }),
    ].join("\n");
    // audit the text under a file label.
    const findings = createAuditFindings();
    auditJsonlText("proj/a.jsonl", lines, findings);
    // the unknown type is reported once with its example line.
    assert.equal(findings.unknownTypes.size, 1);
    const unknownType = findings.unknownTypes.get("made-up-type");
    assert.equal(unknownType?.count, 1);
    assert.equal(unknownType?.example, "proj/a.jsonl:1");
    // the unmodeled field is reported once under its type::field key.
    assert.equal(findings.unmodeledFields.size, 1);
    const unmodeledField = findings.unmodeledFields.get(`${RecordType.mode}::bogusKey`);
    assert.equal(unmodeledField?.count, 1);
    assert.equal(unmodeledField?.example, "proj/a.jsonl:2");
    // the synthetic record's tool-invented field is NOT reported.
    assert.equal(findings.unmodeledFields.has(`${RecordType.user}::reconstructed`), false);
    // the synthetic skip is counted for the report footer.
    assert.equal(findings.syntheticRecordsSkipped, 1);
});

test("test_auditJsonlText_accumulates_across_files", () => {
    // Scenario: the same unmodeled field seen in two files counts both occurrences
    // and both distinct files, keeping the FIRST example.
    // Steps:
    // audit the same one-line transcript under two file labels.
    const line = JSON.stringify({ type: RecordType.mode, sessionId: "s", mode: "normal", bogusKey: 1 });
    const findings = createAuditFindings();
    auditJsonlText("proj/a.jsonl", line, findings);
    auditJsonlText("proj/b.jsonl", line, findings);
    // both occurrences and both files are counted; the first example wins.
    const unmodeledField = findings.unmodeledFields.get(`${RecordType.mode}::bogusKey`);
    assert.equal(unmodeledField?.count, 2);
    assert.equal(unmodeledField?.files.size, 2);
    assert.equal(unmodeledField?.example, "proj/a.jsonl:1");
});

