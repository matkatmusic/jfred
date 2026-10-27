// Task 196 (spec S1): source and evidence-root discovery. Fixtures are wire records loaded via loadTranscript.

import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { writeFileSync } from "node:fs";
import { Path } from "../src/structures/domain.ts";
import {
    findEvidenceRoots,
    findJsonlPaths,
} from "../src/layered_load.ts";
import {
    SESSION_A,
    SESSION_B,
    buildEditRecordPair,
    buildPromptRecord,
    buildWriteRecordPair,
    makeSourceTree,
    writeTranscriptFixture,
} from "./multi-source-test-helpers.ts";

type LayeredFixture = {
    projectDir: string;
    treeRoot: string;
    workspaceRoot: string;
    alphaPath: string;
    betaPath: string;
    sessionARecords: import("../src/structures/envelope.ts").TranscriptRecord[];
};

// Two sessions in ONE project folder: session A (a.jsonl) writes then edits alpha.py; session B (b.jsonl) writes beta.py.
function makeLayeredFixture(): LayeredFixture {
    const tree = makeSourceTree("-layered-project");
    const workspaceRoot = join(tree.treeRoot, "workspace");
    const alphaPath = join(workspaceRoot, "alpha.py");
    const betaPath = join(workspaceRoot, "beta.py");
    const writeAlpha = buildWriteRecordPair(
        { sessionId: SESSION_A, cwd: workspaceRoot, timestamp: "2026-07-24T10:01:00.000Z", toolId: "toolu_layered_w1", parentUuid: "prompt-1" },
        alphaPath,
        "line one\n",
    );
    const editAlpha = buildEditRecordPair(
        { sessionId: SESSION_A, cwd: workspaceRoot, timestamp: "2026-07-24T10:02:00.000Z", toolId: "toolu_layered_e1", parentUuid: writeAlpha.lastUuid },
        alphaPath,
        "line one\nline two\n",
        "line one\n",
        { oldStart: 1, oldLines: 1, newStart: 1, newLines: 2, lines: [" line one", "+line two"] },
    );
    const sessionARecords = writeTranscriptFixture(tree.projectDir, "a.jsonl", [
        buildPromptRecord("prompt-1", null, "2026-07-24T10:00:00.000Z", workspaceRoot),
        ...writeAlpha.records,
        ...editAlpha.records,
    ]);
    const writeBeta = buildWriteRecordPair(
        { sessionId: SESSION_B, cwd: workspaceRoot, timestamp: "2026-07-24T10:03:00.000Z", toolId: "toolu_layered_w2", parentUuid: null },
        betaPath,
        "beta line\n",
    );
    writeTranscriptFixture(tree.projectDir, "b.jsonl", writeBeta.records);
    return { projectDir: tree.projectDir, treeRoot: tree.treeRoot, workspaceRoot, alphaPath, betaPath, sessionARecords };
}

test("test_findJsonlPaths_scans_top_level_jsonl_files", () => {
    // With no override, discovery lists the folder's top-level .jsonl files, name-sorted.
    const fixture = makeLayeredFixture();
    writeFileSync(join(fixture.projectDir, "notes.txt"), "not a transcript\n");
    const discovered = findJsonlPaths(new Path(fixture.projectDir), undefined);
    assert.deepEqual(
        discovered.map((path) => path.toString()),
        [join(fixture.projectDir, "a.jsonl"), join(fixture.projectDir, "b.jsonl")],
    );
});

test("test_findJsonlPaths_override_wins_over_folder_scan", () => {
    // An explicit jsonlPaths override is returned verbatim — the folder is not scanned.
    const fixture = makeLayeredFixture();
    const override = [new Path("/somewhere/else/c.jsonl")];
    const discovered = findJsonlPaths(new Path(fixture.projectDir), override);
    assert.deepEqual(discovered, override);
});

test("test_findEvidenceRoots_explicit_paths_win", () => {
    // Explicit repoPath/snapshotPaths overrides win over anything the records imply.
    const fixture = makeLayeredFixture();
    const repoOverride = new Path("/explicit/repo");
    const snapshotOverride = [new Path("/explicit/file-history")];
    const roots = findEvidenceRoots(fixture.sessionARecords, { repoPath: repoOverride, snapshotPaths: snapshotOverride });
    assert.equal(roots.repoPath, repoOverride);
    assert.deepEqual(roots.snapshotPaths, snapshotOverride);
});

test("test_findEvidenceRoots_discovers_from_records_without_overrides", () => {
    // Without overrides, repo root falls back to records' first cwd; snapshot root falls back to the sibling file-history dir.
    const fixture = makeLayeredFixture();
    const roots = findEvidenceRoots(fixture.sessionARecords, {});
    assert.equal(roots.repoPath?.toString(), fixture.workspaceRoot);
    assert.deepEqual(
        roots.snapshotPaths.map((path) => path.toString()),
        [join(fixture.treeRoot, "file-history")],
    );
});
