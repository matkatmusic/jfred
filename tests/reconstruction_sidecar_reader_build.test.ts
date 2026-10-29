// Spec S4a: buildSidecarReader reads each session's blob from the source that owns it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Path, Uuid } from "../src/structures/domain.ts";
import type { TranscriptRecord } from "../src/structures/envelope.ts";
import { buildSidecarReader, findFileHistoryRootFromRecords, findSessionId, getDefaultFileHistoryRoot } from "../src/reconstruction_sidecar_reader.ts";
import { loadTranscript } from "../src/parse/loadTranscript.ts";
import { S43_JSONL_PATHS } from "./fixtures.ts";
import { createTempDir } from "./overrides-test-helpers.ts";
import { createCopiedTree, loadMinimalTranscript, writeBlobForSession } from "./sidecar-reader-test-helpers.ts";

// Spec-S4 two-source fixture: same blob name in both trees, so only per-source resolution reads both correctly.
const SHARED_BLOB_NAME = "aaaa0000@v1";
function makeTwoSourceFixture(): {
    treeA: { treeRoot: string; projectDir: string };
    treeB: { treeRoot: string; projectDir: string };
    sessionA: string;
    sessionB: string;
    records: TranscriptRecord[];
} {
    const treeA = createCopiedTree(true);
    const treeB = createCopiedTree(true);
    const sessionA = "aaaaaaaa-1111-2222-3333-444444444444";
    const sessionB = "bbbbbbbb-1111-2222-3333-444444444444";
    const recordsA = loadMinimalTranscript(treeA.projectDir, "a.jsonl", sessionA);
    const recordsB = loadMinimalTranscript(treeB.projectDir, "b.jsonl", sessionB);
    writeBlobForSession(treeA.treeRoot, sessionA, SHARED_BLOB_NAME, "content from tree A");
    writeBlobForSession(treeB.treeRoot, sessionB, SHARED_BLOB_NAME, "content from tree B");
    return { treeA, treeB, sessionA, sessionB, records: [...recordsA, ...recordsB] };
}

test("test_build_sidecar_reader_reads_each_sessions_blob_from_its_own_source", () => {
    // Spec S4a: each session's blob comes from the root of the source that OWNS it, not the first.
    const fixture = makeTwoSourceFixture();
    const reader = buildSidecarReader(fixture.records, [
        { projectsDir: new Path(join(fixture.treeA.treeRoot, "projects")) },
        { projectsDir: new Path(join(fixture.treeB.treeRoot, "projects")) },
    ]);
    assert.ok(reader, "expected merged two-source records to yield a sidecar reader");
    assert.equal(reader(new Path(SHARED_BLOB_NAME), new Uuid(fixture.sessionA)), "content from tree A");
    assert.equal(reader(new Path(SHARED_BLOB_NAME), new Uuid(fixture.sessionB)), "content from tree B");
});

test("test_build_sidecar_reader_source_fileHistoryDir_wins_over_sibling_derivation", () => {
    // Config-first: a source's explicit fileHistoryDir outranks the derivable sibling.
    const fixture = makeTwoSourceFixture();
    const customHistoryDir = createTempDir();
    // writeBlobForSession appends file-history/<session>, so write the custom dir's blob directly.
    mkdirSync(join(customHistoryDir, fixture.sessionB), { recursive: true });
    writeFileSync(join(customHistoryDir, fixture.sessionB, SHARED_BLOB_NAME), "content from custom dir");
    const reader = buildSidecarReader(fixture.records, [
        { projectsDir: new Path(join(fixture.treeA.treeRoot, "projects")) },
        { projectsDir: new Path(join(fixture.treeB.treeRoot, "projects")), fileHistoryDir: new Path(customHistoryDir) },
    ]);
    assert.ok(reader);
    assert.equal(reader(new Path(SHARED_BLOB_NAME), new Uuid(fixture.sessionB)), "content from custom dir");
    assert.equal(reader(new Path(SHARED_BLOB_NAME), new Uuid(fixture.sessionA)), "content from tree A");
});

test("test_build_sidecar_reader_single_source_matches_no_sources_behavior", () => {
    // Spec S4a degenerate case: a one-entry sources list must read what the sources-less reader does.
    const tree = createCopiedTree(true);
    const sessionId = "cccccccc-1111-2222-3333-444444444444";
    const records = loadMinimalTranscript(tree.projectDir, "c.jsonl", sessionId);
    writeBlobForSession(tree.treeRoot, sessionId, SHARED_BLOB_NAME, "single source content");
    const readerWithoutSources = buildSidecarReader(records);
    const readerWithOneSource = buildSidecarReader(records, [{ projectsDir: new Path(join(tree.treeRoot, "projects")) }]);
    assert.ok(readerWithoutSources);
    assert.ok(readerWithOneSource);
    const blobPath = new Path(SHARED_BLOB_NAME);
    const owner = new Uuid(sessionId);
    assert.equal(readerWithOneSource(blobPath, owner), readerWithoutSources(blobPath, owner));
});

// Reads the LIVE default file-history root, so results are machine-bound.
function findTranscriptWithBlobs(): { jsonlPath: Path; sessionId: Uuid; blobName: string } | undefined {
    for (const jsonlPath of S43_JSONL_PATHS) {
        const { records } = loadTranscript(jsonlPath.toString());
        const sessionId = findSessionId(records);
        if (!sessionId) {
            continue;
        }
        const blobDir = join(getDefaultFileHistoryRoot().toString(), sessionId.toString());
        if (!existsSync(blobDir)) {
            continue;
        }
        const blobNames = readdirSync(blobDir);
        if (blobNames.length === 0) {
            continue;
        }
        return { jsonlPath, sessionId, blobName: blobNames[0]! };
    }
    return undefined;
}

test("test_build_sidecar_reader_reads_blob_from_derived_sibling_root", (t) => {
    // Audit use case end-to-end: a copied tree must be readable without touching ~/.claude.
    const fixture = findTranscriptWithBlobs();
    if (fixture === undefined) {
        // Task 165: live blobs exist only on the capture machine, so skip rather than fail in CI.
        t.skip("no live ~/.claude/file-history blobs for s43 on this machine");
        return;
    }
    const { treeRoot, projectDir } = createCopiedTree(true);
    const copiedJsonlPath = join(projectDir, "copy.jsonl");
    copyFileSync(fixture.jsonlPath.toString(), copiedJsonlPath);
    const originalBlobPath = join(
        getDefaultFileHistoryRoot().toString(), fixture.sessionId.toString(), fixture.blobName);
    const copiedBlobDir = join(treeRoot, "file-history", fixture.sessionId.toString());
    mkdirSync(copiedBlobDir, { recursive: true });
    copyFileSync(originalBlobPath, join(copiedBlobDir, fixture.blobName));
    // Loading from the COPY is what points each record's source into the temp tree.
    const { records } = loadTranscript(copiedJsonlPath);
    assert.equal(findFileHistoryRootFromRecords(records)?.toString(), join(treeRoot, "file-history"));
    const reader = buildSidecarReader(records);
    assert.ok(reader, "expected the copied transcript to yield a sidecar reader");
    const content = reader(new Path(fixture.blobName), fixture.sessionId);
    assert.equal(content, readFileSync(originalBlobPath, "utf8"));
});
