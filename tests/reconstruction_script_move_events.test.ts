import { test } from "node:test";
import assert from "node:assert/strict";
import { appendScriptMoveRenames } from "../src/reconstruction_script_move_events.ts";
import { extractFileEvents } from "../src/reconstruction_extract.ts";
import { reconstructFilesOver } from "../src/reconstruction_renderable.ts";
import { setImpureExecutionAllowed } from "../src/reconstruction_exec_gate.ts";
import { SCRIPT_RUN_CHANGE_ID_PREFIX } from "../src/reconstruction_script_execution.ts";
import type { BackupReader } from "../src/reconstruction_sidecar.ts";
import type { FileEvent, RenameEvent } from "../src/reconstruction_engine.ts";
import { BlockType, EventKind, RecordType, ToolName } from "../src/structures/vocabulary.ts";
import type { TranscriptRecord } from "../src/structures/envelope.ts";
import { Path, Uuid } from "../src/structures/domain.ts";

// A synthetic assistant record carrying one tool_use of `name` with `input`, at `timestamp`
// (the reconstruction_script_stage.test.ts fixture pattern).
function buildToolRecord(name: ToolName, input: Record<string, unknown>, timestamp: string): TranscriptRecord {
    return {
        type: RecordType.assistant,
        timestamp: new Date(timestamp),
        message: { content: [{ type: BlockType.tool_use, id: "toolu_x", name, input, caller: { type: "direct" } }] },
    } as unknown as TranscriptRecord;
}

// A reader with no backups to offer — every pre-state seed comes from the authored Writes.
const emptyReader: BackupReader = () => "";

// The s85 shape: a glob-driven move — no printed `old -> new` line, no two-string-literal
// move call — so only the sandbox pre/post diff can prove the rename.
const GLOB_MOVE_SCRIPT = 'import glob, shutil\n'
    + 'for path in sorted(glob.glob("*.py")):\n'
    + '    if path.startswith("core_"):\n'
    + '        continue\n'
    + '    shutil.move(path, "core_" + path)\n';

// Records where one.py is Written, then a glob-driven script moves it to core_one.py.
function buildGlobMoveRecords(): TranscriptRecord[] {
    return [
        buildToolRecord(ToolName.Write, { file_path: "/proj/one.py", content: "def f_one(x):\n    return x + 1\n" }, "2026-01-01T00:00:01Z"),
        buildToolRecord(ToolName.CtxExecute, { cwd: "/proj", code: GLOB_MOVE_SCRIPT }, "2026-01-01T00:00:02Z"),
    ];
}

// The rename events among `events`.
function renameEventsOf(events: FileEvent[]): RenameEvent[] {
    const renames: RenameEvent[] = [];
    for (const event of events) {
        if (event.kind === EventKind.rename) {
            renames.push(event);
        }
    }
    return renames;
}

test("test_sandbox_proven_move_becomes_rename_event", () => {
    // Scenario: a glob-driven shutil.move leaves no arrow line and no literal call — the
    // sandbox diff is the only proof, and the channel must emit it as a rename event.
    // Steps:
    // build records with a Write of /proj/one.py and the glob-move run.
    const records = buildGlobMoveRecords();
    const extracted = extractFileEvents(records);
    // append the sandbox-proven moves.
    const events = appendScriptMoveRenames(extracted, records, emptyReader);
    // assert exactly one rename event was appended, from one.py to core_one.py.
    const renames = renameEventsOf(events);
    assert.equal(renames.length, 1);
    assert.equal(renames[0]!.from.toString(), "/proj/one.py");
    assert.equal(renames[0]!.to.toString(), "/proj/core_one.py");
    // assert the changeId is the deterministic run x SOURCE-path id.
    assert.ok(renames[0]!.changeId.toString().startsWith(SCRIPT_RUN_CHANGE_ID_PREFIX));
    assert.ok(renames[0]!.changeId.toString().endsWith(":/proj/one.py"));
    // assert the event is stamped at the run's instant.
    assert.equal(renames[0]!.timestamp.toISOString(), "2026-01-01T00:00:02.000Z");
});

test("test_declined_consent_appends_nothing", () => {
    // Scenario: a declined build may execute nothing — the channel must return its input as-is.
    // Steps:
    // build the same glob-move records, then decline consent.
    const records = buildGlobMoveRecords();
    const extracted = extractFileEvents(records);
    setImpureExecutionAllowed(false);
    try {
        // append with the gate off.
        const events = appendScriptMoveRenames(extracted, records, emptyReader);
        // assert nothing was appended.
        assert.deepEqual(events, extracted);
    } finally {
        setImpureExecutionAllowed(true);
    }
});

test("test_missing_reader_appends_nothing", () => {
    // Scenario: without a sidecar reader the channel cannot execute runs — input unchanged.
    const records = buildGlobMoveRecords();
    const extracted = extractFileEvents(records);
    const events = appendScriptMoveRenames(extracted, records, undefined);
    assert.deepEqual(events, extracted);
});

test("test_pair_already_evidenced_is_not_duplicated", () => {
    // Scenario: the stdout / code-literal channels already evidenced the same move — this
    // channel must not add a second rename event for the identical from/to pair.
    // Steps:
    // build the glob-move records and fabricate the rename event another channel produced.
    const records = buildGlobMoveRecords();
    const priorRename: FileEvent = {
        kind: EventKind.rename,
        changeId: new Uuid("toolu_x"),
        from: new Path("/proj/one.py"),
        to: new Path("/proj/core_one.py"),
        timestamp: new Date("2026-01-01T00:00:02Z"),
    };
    const extracted = [...extractFileEvents(records), priorRename];
    // append the sandbox-proven moves.
    const events = appendScriptMoveRenames(extracted, records, emptyReader);
    // assert the pair still appears exactly once.
    assert.equal(renameEventsOf(events).length, 1);
});

test("test_move_source_history_merges_into_destination", () => {
    // Scenario: with the rename in the chain, the moved-away source must stop being its own
    // alive history — its Write merges into the destination's ladder (the task-155 fix).
    // Steps:
    // reconstruct every file over the glob-move records.
    const records = buildGlobMoveRecords();
    const histories = reconstructFilesOver(records, emptyReader);
    // assert no history is keyed by the moved-away source path.
    assert.ok(!histories.some((history) => history.target.toString() === "/proj/one.py"));
    // assert the destination history exists.
    const destination = histories.find((history) => history.target.toString() === "/proj/core_one.py");
    assert.ok(destination !== undefined);
    // assert the ladder starts with the source's write revision.
    assert.equal(destination.revisions[0]!.kind, EventKind.write);
    // assert a rename revision carries the from/to provenance, after the write.
    const renameIndex = destination.revisions.findIndex((revision) => revision.kind === EventKind.rename);
    assert.ok(renameIndex > 0);
    assert.equal(destination.revisions[renameIndex]!.rename!.from.toString(), "/proj/one.py");
});
