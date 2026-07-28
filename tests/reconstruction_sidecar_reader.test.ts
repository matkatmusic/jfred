// Item 46: file-history-root resolution — sibling derivation, override precedence, default fallback.
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
    copyFileSync,
    existsSync,
    mkdirSync,
    readFileSync,
    readdirSync,
    writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { Path, Uuid } from "../src/structures/domain.ts";
import type { TranscriptRecord } from "../src/structures/envelope.ts";
import { RecordType } from "../src/structures/vocabulary.ts";
import { setPathOverrides } from "../src/reconstruction_overrides.ts";
import {
    buildSidecarReader,
    deriveFileHistoryRootFromRecords,
    deriveSiblingFileHistoryRoot,
    findSessionId,
    getDefaultFileHistoryRoot,
    resolveFileHistoryRoot,
} from "../src/reconstruction_sidecar_reader.ts";
import { loadTranscript } from "../src/parse/loadTranscript.ts";
import { S43_JSONL_PATHS } from "./fixtures.ts";
import { makeTempDir } from "./overrides-test-helpers.ts";

// Overrides are process-wide module state — never let one test's state leak into the next.
afterEach(() => {
    setPathOverrides({});
});

// A copied-out-of-~/.claude tree: <X>/projects plus, optionally, the <X>/file-history sibling.
function makeCopiedTree(withSibling: boolean): { treeRoot: string; projectDir: string } {
    const treeRoot = makeTempDir();
    const projectDir = join(treeRoot, "projects", "-copied-project");
    mkdirSync(projectDir, { recursive: true });
    if (withSibling) {
        mkdirSync(join(treeRoot, "file-history"));
    }
    return { treeRoot, projectDir };
}

// Goes through loadTranscript so each record carries a real source, which drives root derivation.
function loadMinimalTranscript(projectDir: string, name: string, sessionId: string = "11111111-2222-3333-4444-555555555555"): TranscriptRecord[] {
    const jsonlPath = join(projectDir, name);
    const minimalRecord = { type: RecordType.aiTitle, sessionId, aiTitle: "t" };
    writeFileSync(jsonlPath, `${JSON.stringify(minimalRecord)}\n`);
    return loadTranscript(jsonlPath).records;
}

function writeBlobForSession(treeRoot: string, sessionId: string, blobName: string, content: string): void {
    const blobDir = join(treeRoot, "file-history", sessionId);
    mkdirSync(blobDir, { recursive: true });
    writeFileSync(join(blobDir, blobName), content);
}

// Spec-S4 two-source fixture: same blob name in both trees, so only per-source resolution reads both correctly.
const SHARED_BLOB_NAME = "aaaa0000@v1";
function makeTwoSourceFixture(): {
    treeA: { treeRoot: string; projectDir: string };
    treeB: { treeRoot: string; projectDir: string };
    sessionA: string;
    sessionB: string;
    records: TranscriptRecord[];
} {
    const treeA = makeCopiedTree(true);
    const treeB = makeCopiedTree(true);
    const sessionA = "aaaaaaaa-1111-2222-3333-444444444444";
    const sessionB = "bbbbbbbb-1111-2222-3333-444444444444";
    const recordsA = loadMinimalTranscript(treeA.projectDir, "a.jsonl", sessionA);
    const recordsB = loadMinimalTranscript(treeB.projectDir, "b.jsonl", sessionB);
    writeBlobForSession(treeA.treeRoot, sessionA, SHARED_BLOB_NAME, "content from tree A");
    writeBlobForSession(treeB.treeRoot, sessionB, SHARED_BLOB_NAME, "content from tree B");
    return { treeA, treeB, sessionA, sessionB, records: [...recordsA, ...recordsB] };
}

test("test_derive_sibling_file_history_root_finds_existing_sibling", () => {
    // A tree copied out of ~/.claude keeps file-history as a sibling of projects.
    const { treeRoot } = makeCopiedTree(true);
    const derived = deriveSiblingFileHistoryRoot(new Path(join(treeRoot, "projects")));
    assert.equal(derived?.toString(), join(treeRoot, "file-history"));
});

test("test_derive_sibling_file_history_root_returns_undefined_without_sibling", () => {
    // No sibling means no derived root, so the resolution chain moves on to the default.
    const { treeRoot } = makeCopiedTree(false);
    assert.equal(deriveSiblingFileHistoryRoot(new Path(join(treeRoot, "projects"))), undefined);
});

test("test_resolve_file_history_root_prefers_override_over_derivation", () => {
    // An explicit fileHistoryRoot override outranks the transcript-derived sibling.
    const { treeRoot, projectDir } = makeCopiedTree(true);
    const records = loadMinimalTranscript(projectDir, "session.jsonl");
    assert.equal(deriveFileHistoryRootFromRecords(records)?.toString(), join(treeRoot, "file-history"));
    setPathOverrides({ fileHistoryRoot: new Path("/tmp/override-file-history") });
    assert.equal(resolveFileHistoryRoot(records).toString(), "/tmp/override-file-history");
});

test("test_resolve_file_history_root_falls_back_to_default_without_source_or_override", () => {
    // Records that never went through loadTranscript carry no source to derive from.
    const records = [{ type: RecordType.aiTitle } as unknown as TranscriptRecord];
    assert.equal(resolveFileHistoryRoot(records).toString(), getDefaultFileHistoryRoot().toString());
});

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
    const customHistoryDir = makeTempDir();
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
    const tree = makeCopiedTree(true);
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
    const { treeRoot, projectDir } = makeCopiedTree(true);
    const copiedJsonlPath = join(projectDir, "copy.jsonl");
    copyFileSync(fixture.jsonlPath.toString(), copiedJsonlPath);
    const originalBlobPath = join(
        getDefaultFileHistoryRoot().toString(), fixture.sessionId.toString(), fixture.blobName);
    const copiedBlobDir = join(treeRoot, "file-history", fixture.sessionId.toString());
    mkdirSync(copiedBlobDir, { recursive: true });
    copyFileSync(originalBlobPath, join(copiedBlobDir, fixture.blobName));
    // Loading from the COPY is what points each record's source into the temp tree.
    const { records } = loadTranscript(copiedJsonlPath);
    assert.equal(deriveFileHistoryRootFromRecords(records)?.toString(), join(treeRoot, "file-history"));
    const reader = buildSidecarReader(records);
    assert.ok(reader, "expected the copied transcript to yield a sidecar reader");
    const content = reader(new Path(fixture.blobName), fixture.sessionId);
    assert.equal(content, readFileSync(originalBlobPath, "utf8"));
});
