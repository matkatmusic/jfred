// The /api/layer1-inverse-repos wire: one InverseCommit maps to strings, and the result has one entry per project file.

import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { StateConfidence, StateMoment } from "../engineV3/engineV3_file_known_states.ts";
import type { InverseCommit } from "../engineV3/engineV3_inverse_repo.ts";
import { FileEventType } from "../engineV3/engineV3_replay_reverse_events.ts";
import { buildInverseCommitWire, buildInverseReposWire } from "../src/layer1_inverse_repos_wire.ts";
import { Path, Uuid } from "../src/structures/domain.ts";
import { SESSION_A, createSourceTree, writeTranscriptFixture } from "./multi-source-test-helpers.ts";
import { buildWriteRecordPair } from "./tool-call-record-pair-builders.ts";
import { createTempDir } from "./overrides-test-helpers.ts";

const COMMIT_HASH = "0123456789abcdef0123456789abcdef01234567";

function buildInverseCommit(instant: Date | undefined): InverseCommit {
    return {
        commitHash: new Uuid(COMMIT_HASH),
        position: 3,
        eventType: FileEventType.WriteRow,
        moment: StateMoment.BeforeEvent,
        confidence: StateConfidence.Proven,
        instant,
        isFileAbsent: false,
        text: "file text that must not reach the wire\n",
    };
}

// A project folder holding a.py and sub/b.py, plus a log folder whose Write rows name both.
function writeProjectWithLogs(): { projectFolder: Path; jsonlFolder: Path; snapshotsFolder: Path; storeFolder: Path } {
    const projectFolder = createTempDir();
    mkdirSync(join(projectFolder, "sub"));
    writeFileSync(join(projectFolder, "a.py"), "one\n");
    writeFileSync(join(projectFolder, "sub", "b.py"), "two\n");
    const tree = createSourceTree("-inverse-repos-wire");
    const envelopeA = { sessionId: SESSION_A, cwd: projectFolder, timestamp: "2026-07-24T10:01:00.000Z", toolId: "toolu_w1", parentUuid: null };
    const envelopeB = { ...envelopeA, timestamp: "2026-07-24T10:02:00.000Z", toolId: "toolu_w2" };
    const writeA = buildWriteRecordPair(envelopeA, join(projectFolder, "a.py"), "one\n");
    const writeB = buildWriteRecordPair(envelopeB, join(projectFolder, "sub", "b.py"), "two\n");
    writeTranscriptFixture(tree.projectDir, "a.jsonl", [...writeA.records, ...writeB.records]);
    const storeFolder = mkdtempSync(join(tmpdir(), "inverse-repos-wire-store-"));
    return { projectFolder: new Path(projectFolder), jsonlFolder: new Path(tree.projectDir), snapshotsFolder: new Path(join(tree.treeRoot, "file-history")), storeFolder: new Path(join(storeFolder, "store")) };
}

test("test_inverse_commit_wire_maps_instant_to_iso_string", () => {
    const wire = buildInverseCommitWire(buildInverseCommit(new Date("2026-07-24T10:01:00.000Z")));
    assert.deepEqual(wire, {
        commitHash: COMMIT_HASH,
        eventType: "WriteRow",
        moment: "before-event",
        confidence: "proven",
        position: 3,
        instant: "2026-07-24T10:01:00.000Z",
        isFileAbsent: false,
    });
});

test("test_inverse_commit_wire_maps_undefined_instant_to_null", () => {
    const wire = buildInverseCommitWire(buildInverseCommit(undefined));
    assert.equal(wire.instant, null);
});

test("test_inverse_repos_wire_has_one_entry_per_file", () => {
    const { projectFolder, jsonlFolder, snapshotsFolder, storeFolder } = writeProjectWithLogs();
    const wire = buildInverseReposWire(projectFolder, [jsonlFolder], [snapshotsFolder], storeFolder);
    rmSync(storeFolder.toString(), { recursive: true, force: true });
    assert.deepEqual(wire.files.map((fileWire) => fileWire.file), ["a.py", "sub/b.py"]);
    assert.equal(wire.files[0]!.commits[0]!.eventType, "DiskNow");
});
