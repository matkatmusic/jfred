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
function loadMinimalTranscript(projectDir: string, name: string): TranscriptRecord[] {
    const jsonlPath = join(projectDir, name);
    const minimalRecord = { type: RecordType.aiTitle, sessionId: "11111111-2222-3333-4444-555555555555", aiTitle: "t" };
    writeFileSync(jsonlPath, `${JSON.stringify(minimalRecord)}\n`);
    return loadTranscript(jsonlPath).records;
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

test("test_build_sidecar_reader_reads_blob_from_derived_sibling_root", () => {
    // Scenario: the audit use case end-to-end at the reader level — a transcript COPIED
    // into <X>/projects/<project>/ with its blobs copied into <X>/file-history/<session>/
    // must be readable without touching ~/.claude.
    // Step: find a real s43 transcript whose session has on-disk blobs to copy from.
    const fixture = findTranscriptWithBlobs();
    assert.ok(fixture, "expected an s43 transcript with on-disk file-history blobs");
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
