// Tests for src/viewer_api.ts document building: project documents over one-or-many JSONLs,
// the script-consent decision, and consent-scoped building. Pure logic only — the HTTP wiring
// in viewer_server.ts stays thin.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
    buildProjectDocument,
    buildProjectReconstruction,
    decideDocumentResponse,
    buildDocumentWithConsent,
} from "../src/viewer_api.ts";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { makeTempDir } from "./overrides-test-helpers.ts";
import { isImpureExecutionAllowed, setImpureExecutionAllowed } from "../src/reconstruction_exec_gate.ts";
import { scriptCodeMayWriteFiles } from "../src/reconstruction_script_prestate.ts";
import { runCli } from "../src/reconstruction_cli.ts";
import { BlockType, DocumentResponseKind, EventKind, RecordType, ToolName } from "../src/structures/vocabulary.ts";
import { Path } from "../src/structures/domain.ts";
import type { TranscriptRecord } from "../src/structures/envelope.ts";
import { loadRecords } from "./utilities.ts";
import { jsonlPathsForScenario } from "./fixtures.ts";
import { S19_JSONL, S37_JSONL } from "./fixtures.ts";


test("test_buildProjectDocument_single_jsonl_matches_cli_json", () => {
    // Scenario: for one JSONL, the viewer's document is byte-identical (after JSON
    // round-trip) to what the CLI --json path produces for the same file.
    const viaViewer = JSON.parse(JSON.stringify(buildProjectDocument([new Path(S19_JSONL)], undefined)));
    const viaCli = JSON.parse(runCli([S19_JSONL, "--json"]));
    assert.deepEqual(viaViewer, viaCli);
});

test("test_buildProjectDocument_multi_jsonl_unifies_records", () => {
    // Scenario: s53's two agent transcripts unify into ONE document whose filesTouched
    // covers the files of both.
    const paths = jsonlPathsForScenario("s53");
    assert.ok(paths.length >= 2, "s53 spans multiple JSONLs");
    const perTranscriptTargets = paths.map((path) =>
        buildProjectDocument([path], undefined).filesTouched.map((history) => history.target.toString()),
    );
    const unified = buildProjectDocument(paths, undefined);
    const unifiedTargets = unified.filesTouched.map((history) => history.target.toString());
    for (const targets of perTranscriptTargets) {
        for (const target of targets) {
            assert.ok(unifiedTargets.includes(target), `unified document covers ${target}`);
        }
    }
});

test("test_build_project_reconstruction_accepts_two_source_transcripts", () => {
    // Scenario (spec S4a): one reconstruction over JSONLs from TWO conversation-log
    // folders, with the sources list riding to the sidecar reader (per-source blob
    // resolution is proven at the reader unit level in reconstruction_sidecar_reader.test.ts).
    const treeRoots = [makeTempDir(), makeTempDir()];
    const jsonlPaths: Path[] = [];
    const sources = [];
    for (const [index, treeRoot] of treeRoots.entries()) {
        const projectDir = join(treeRoot, "projects", "-two-source-project");
        mkdirSync(projectDir, { recursive: true });
        const jsonlPath = join(projectDir, `session-${index}.jsonl`);
        const minimalRecord = { type: RecordType.aiTitle, sessionId: `dddddddd-1111-2222-3333-44444444444${index}`, aiTitle: "t" };
        writeFileSync(jsonlPath, `${JSON.stringify(minimalRecord)}\n`);
        jsonlPaths.push(new Path(jsonlPath));
        sources.push({ projectsDir: new Path(join(treeRoot, "projects")) });
    }
    const built = buildProjectReconstruction(jsonlPaths, undefined, undefined, sources);
    assert.ok(built.document);
    assert.ok(Array.isArray(built.document.filesTouched));
});


test("test_decideDocumentResponse_requires_consent_when_scripts_present", () => {
    // Scenario: a transcript with script-execution runs and no consent yields a
    // consent-required decision carrying each script's code for the dialog.
    const records = loadRecords(S37_JSONL);
    const decision = decideDocumentResponse(records, false);
    assert.equal(decision.kind, DocumentResponseKind.consentRequired);
    assert.ok(decision.kind === DocumentResponseKind.consentRequired && decision.scripts.length > 0);
    for (const script of decision.kind === DocumentResponseKind.consentRequired ? decision.scripts : []) {
        assert.ok(script.code.length > 0, "each script surfaces non-empty code");
    }
});

test("test_decideDocumentResponse_tags_each_script_with_read_only_flag", () => {
    // Scenario: the consent-required decision tags every script with readOnly, and the
    // tag agrees with the execution gate's classifier (item 68) for that script's code.
    const records = loadRecords(S37_JSONL);
    const decision = decideDocumentResponse(records, false);
    assert.equal(decision.kind, DocumentResponseKind.consentRequired);
    for (const script of decision.kind === DocumentResponseKind.consentRequired ? decision.scripts : []) {
        assert.equal(typeof script.readOnly, "boolean");
        assert.equal(script.readOnly, !scriptCodeMayWriteFiles(script.code));
    }
});

test("test_decideDocumentResponse_builds_when_consented", () => {
    // Scenario: the same script-bearing records WITH consent decide to build.
    const records = loadRecords(S37_JSONL);
    const decision = decideDocumentResponse(records, true);
    assert.equal(decision.kind, DocumentResponseKind.document);
});

test("test_decideDocumentResponse_builds_when_no_scripts", () => {
    // Scenario: a script-free transcript never prompts, consent or not. Synthetic fixture:
    // every executed scenario carries harness-probe script runs (ls/pytest), so no real
    // captured transcript is script-free.
    const records = [
        {
            type: RecordType.assistant,
            timestamp: new Date("2026-01-01T00:00:01Z"),
            message: {
                content: [{
                    type: BlockType.tool_use,
                    id: "toolu_x",
                    name: ToolName.Write,
                    input: { file_path: "/proj/a.py", content: "x = 1\n" },
                    caller: { type: "direct" },
                }],
            },
        } as unknown as TranscriptRecord,
    ];
    const decision = decideDocumentResponse(records, false);
    assert.equal(decision.kind, DocumentResponseKind.document);
});


test("test_buildDocumentWithConsent_declined_still_returns_document", () => {
    // Scenario: declining consent on a script scenario still yields a document — degraded
    // (no script-derived revisions), with the gate off for the whole build.
    try {
        const document = buildDocumentWithConsent([new Path(S37_JSONL)], undefined, false);
        assert.ok(Array.isArray(document.filesTouched));
        for (const history of document.filesTouched) {
            for (const revision of history.revisions) {
                assert.ok(revision.kind !== EventKind.scriptExecution, "no script-derived revision when declined");
            }
        }
        assert.equal(isImpureExecutionAllowed(), false);
    } finally {
        setImpureExecutionAllowed(true);
    }
});

test("test_buildDocumentWithConsent_restores_gate_after_build", () => {
    // Scenario: a CONSENTED build enables the gate only for its own duration — script
    // revisions appear in the document, and the gate is off again afterwards.
    try {
        const document = buildDocumentWithConsent([new Path(S37_JSONL)], undefined, true);
        const scriptRevisions = document.filesTouched.flatMap((history) =>
            history.revisions.filter((revision) => revision.kind === EventKind.scriptExecution),
        );
        assert.ok(scriptRevisions.length > 0, "consented build carries script-derived revisions");
        assert.equal(isImpureExecutionAllowed(), false);
    } finally {
        setImpureExecutionAllowed(true);
    }
});
