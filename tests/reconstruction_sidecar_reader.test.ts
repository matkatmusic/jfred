// Phase-2 file-history-root resolution tests (item 46): sibling-root derivation from
// copied-out-of-~/.claude trees, override precedence, the ~/.claude default fallback,
// and the sidecar reader reading blobs from a derived sibling root.
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

// A copied-out-of-~/.claude tree: <X>/projects (with one project dir) and, when asked
// for, the <X>/file-history sibling. Returns the tree root and the project dir path.
function makeCopiedTree(withSibling: boolean): { treeRoot: string; projectDir: string } {
    const treeRoot = makeTempDir();
    const projectDir = join(treeRoot, "projects", "-copied-project");
    mkdirSync(projectDir, { recursive: true });
    if (withSibling) {
        mkdirSync(join(treeRoot, "file-history"));
    }
    return { treeRoot, projectDir };
}

// A minimal one-record transcript written into <projectDir>/<name>, loaded through
// loadTranscript so each record carries a real source (file path + line number).
function loadMinimalTranscript(projectDir: string, name: string, sessionId: string = "11111111-2222-3333-4444-555555555555"): TranscriptRecord[] {
    const jsonlPath = join(projectDir, name);
    const minimalRecord = { type: RecordType.aiTitle, sessionId, aiTitle: "t" };
    writeFileSync(jsonlPath, `${JSON.stringify(minimalRecord)}\n`);
    return loadTranscript(jsonlPath).records;
}

// One blob file under <treeRoot>/file-history/<sessionId>/<blobName>.
function writeBlobForSession(treeRoot: string, sessionId: string, blobName: string, content: string): void {
    const blobDir = join(treeRoot, "file-history", sessionId);
    mkdirSync(blobDir, { recursive: true });
    writeFileSync(join(blobDir, blobName), content);
}

// Two copied-out-of-~/.claude trees, each holding one single-session transcript and one
// file-history blob of the SAME name with tree-specific content — the spec-S4 two-source
// fixture: only per-source root resolution can read both blobs correctly.
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
    // Scenario: a projects folder copied out of ~/.claude keeps its file-history dir
    // as a sibling — the derivation must find it.
    // Step: build a temp tree with both <X>/projects and <X>/file-history.
    const { treeRoot } = makeCopiedTree(true);
    // Step: derivation from <X>/projects lands on <X>/file-history.
    const derived = deriveSiblingFileHistoryRoot(new Path(join(treeRoot, "projects")));
    assert.equal(derived?.toString(), join(treeRoot, "file-history"));
});

test("test_derive_sibling_file_history_root_returns_undefined_without_sibling", () => {
    // Scenario: a projects folder with no file-history sibling yields no derived root.
    // Step: build a temp tree holding only <X>/projects.
    const { treeRoot } = makeCopiedTree(false);
    // Step: derivation returns undefined (the resolution chain moves on to the default).
    assert.equal(deriveSiblingFileHistoryRoot(new Path(join(treeRoot, "projects"))), undefined);
});

test("test_resolve_file_history_root_prefers_override_over_derivation", () => {
    // Scenario: an explicit fileHistoryRoot override outranks the transcript-derived sibling.
    // Step: build a copied tree whose transcript WOULD derive a sibling root.
    const { treeRoot, projectDir } = makeCopiedTree(true);
    const records = loadMinimalTranscript(projectDir, "session.jsonl");
    // Step: sanity — without an override, derivation does find the sibling.
    assert.equal(deriveFileHistoryRootFromRecords(records)?.toString(), join(treeRoot, "file-history"));
    // Step: set an explicit override.
    setPathOverrides({ fileHistoryRoot: new Path("/tmp/override-file-history") });
    // Step: resolution returns the override, not the derivable sibling.
    assert.equal(resolveFileHistoryRoot(records).toString(), "/tmp/override-file-history");
});

test("test_resolve_file_history_root_falls_back_to_default_without_source_or_override", () => {
    // Scenario: records that never went through loadTranscript carry no source; with no
    // override either, resolution lands on the ~/.claude default (today's exact behavior).
    // Step: build a record that has no recorded source and set no override.
    const records = [{ type: RecordType.aiTitle } as unknown as TranscriptRecord];
    // Step: resolution returns getDefaultFileHistoryRoot().
    assert.equal(resolveFileHistoryRoot(records).toString(), getDefaultFileHistoryRoot().toString());
});

test("test_build_sidecar_reader_reads_each_sessions_blob_from_its_own_source", () => {
    // Scenario (spec S4a, design §c5): with records merged from two sources, each session's
    // blob must be read from the file-history root of the source that OWNS the session —
    // never from the first source's root for everyone.
    // Step: two trees, two sessions, the SAME blob name with different content in each.
    const fixture = makeTwoSourceFixture();
    // Step: build the reader with both sources declared (sibling file-history derivation).
    const reader = buildSidecarReader(fixture.records, [
        { projectsDir: new Path(join(fixture.treeA.treeRoot, "projects")) },
        { projectsDir: new Path(join(fixture.treeB.treeRoot, "projects")) },
    ]);
    assert.ok(reader, "expected merged two-source records to yield a sidecar reader");
    // Step: session A's blob comes from tree A, session B's from tree B.
    assert.equal(reader(new Path(SHARED_BLOB_NAME), new Uuid(fixture.sessionA)), "content from tree A");
    assert.equal(reader(new Path(SHARED_BLOB_NAME), new Uuid(fixture.sessionB)), "content from tree B");
});

test("test_build_sidecar_reader_source_fileHistoryDir_wins_over_sibling_derivation", () => {
    // Scenario (design §b analog: config-first): a source's explicit fileHistoryDir
    // outranks the derivable <treeRoot>/file-history sibling.
    // Step: the two-tree fixture, plus a custom history dir holding tree B's session blob
    // with distinct content.
    const fixture = makeTwoSourceFixture();
    const customHistoryDir = makeTempDir();
    // writeBlobForSession appends file-history/<session>, so write the custom dir's blob directly.
    mkdirSync(join(customHistoryDir, fixture.sessionB), { recursive: true });
    writeFileSync(join(customHistoryDir, fixture.sessionB, SHARED_BLOB_NAME), "content from custom dir");
    // Step: declare source B WITH fileHistoryDir.
    const reader = buildSidecarReader(fixture.records, [
        { projectsDir: new Path(join(fixture.treeA.treeRoot, "projects")) },
        { projectsDir: new Path(join(fixture.treeB.treeRoot, "projects")), fileHistoryDir: new Path(customHistoryDir) },
    ]);
    assert.ok(reader);
    // Step: session B reads from the custom dir, not the derivable sibling.
    assert.equal(reader(new Path(SHARED_BLOB_NAME), new Uuid(fixture.sessionB)), "content from custom dir");
    // Step: session A is unaffected — still the sibling derivation.
    assert.equal(reader(new Path(SHARED_BLOB_NAME), new Uuid(fixture.sessionA)), "content from tree A");
});

test("test_build_sidecar_reader_single_source_matches_no_sources_behavior", () => {
    // Scenario (spec S4a): single source is the degenerate case — passing a one-entry
    // sources list must read exactly the bytes the sources-less reader reads.
    // Step: one tree, one session, one blob.
    const tree = makeCopiedTree(true);
    const sessionId = "cccccccc-1111-2222-3333-444444444444";
    const records = loadMinimalTranscript(tree.projectDir, "c.jsonl", sessionId);
    writeBlobForSession(tree.treeRoot, sessionId, SHARED_BLOB_NAME, "single source content");
    // Step: build both readers over the same records.
    const readerWithoutSources = buildSidecarReader(records);
    const readerWithOneSource = buildSidecarReader(records, [{ projectsDir: new Path(join(tree.treeRoot, "projects")) }]);
    assert.ok(readerWithoutSources);
    assert.ok(readerWithOneSource);
    // Step: identical bytes from both.
    const blobPath = new Path(SHARED_BLOB_NAME);
    const owner = new Uuid(sessionId);
    assert.equal(readerWithOneSource(blobPath, owner), readerWithoutSources(blobPath, owner));
});

// The first scenario transcript (among the s43 captures) whose session left real blob
// files under the live default file-history root, with one blob name to copy.
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
    // Scenario: the audit use case end-to-end at the reader level — a transcript COPIED
    // into <X>/projects/<project>/ with its blobs copied into <X>/file-history/<session>/
    // must be readable without touching ~/.claude.
    // Step: find a real s43 transcript whose session has on-disk blobs to copy from.
    const fixture = findTranscriptWithBlobs();
    if (fixture === undefined) {
        // Machine-bound input (task 165): the live ~/.claude/file-history blobs exist only
        // on the capture machine — absent (e.g. CI), skip rather than fail.
        t.skip("no live ~/.claude/file-history blobs for s43 on this machine");
        return;
    }
    // Step: build the copied tree — the transcript under <X>/projects/<project>/copy.jsonl.
    const { treeRoot, projectDir } = makeCopiedTree(true);
    const copiedJsonlPath = join(projectDir, "copy.jsonl");
    copyFileSync(fixture.jsonlPath.toString(), copiedJsonlPath);
    // Step: copy ONE real blob file under <X>/file-history/<sessionId>/.
    const originalBlobPath = join(
        getDefaultFileHistoryRoot().toString(), fixture.sessionId.toString(), fixture.blobName);
    const copiedBlobDir = join(treeRoot, "file-history", fixture.sessionId.toString());
    mkdirSync(copiedBlobDir, { recursive: true });
    copyFileSync(originalBlobPath, join(copiedBlobDir, fixture.blobName));
    // Step: load records from the COPY so their source points into the temp tree.
    const { records } = loadTranscript(copiedJsonlPath);
    // Step: derivation from those records lands on the temp tree's sibling file-history dir.
    assert.equal(deriveFileHistoryRootFromRecords(records)?.toString(), join(treeRoot, "file-history"));
    // Step: the reader built from these records resolves the SIBLING root and reads the blob.
    const reader = buildSidecarReader(records);
    assert.ok(reader, "expected the copied transcript to yield a sidecar reader");
    const content = reader(new Path(fixture.blobName), fixture.sessionId);
    // Step: the bytes match the original blob file's.
    assert.equal(content, readFileSync(originalBlobPath, "utf8"));
});
