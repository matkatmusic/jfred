import { test } from "node:test";
import assert from "node:assert/strict";
import {
    getPreExecutionState,
    parseScriptFileRefs,
} from "../src/reconstruction_script_prestate.ts";
import type { ScriptRun } from "../src/reconstruction_script_execution.ts";
import type { BackupReader } from "../src/reconstruction_sidecar.ts";
import { RecordType, ToolName } from "../src/structures/vocabulary.ts";
import type { TranscriptRecord } from "../src/structures/envelope.ts";
import { Path } from "../src/structures/domain.ts";
import { buildToolRecord } from "./script-execution-test-helpers.ts";

test("test_parseScriptFileRefs_extracts_file_paths", () => {
    const code = `TARGETS = ["ledger.py", "tests/test_ledger.py"]\nwith open("renames.csv") as f:`;
    const refs = parseScriptFileRefs(code);
    assert.deepEqual(refs.sort(), ["ledger.py", "renames.csv", "tests/test_ledger.py"]);
});

function buildWriteRecord(filePath: string, content: string, timestamp: string, cwd?: string): TranscriptRecord {
    return buildToolRecord(ToolName.Write, { file_path: filePath, content }, timestamp, cwd);
}

function buildSnapshotRecord(path: string, backupFileName: string, backupTime: string): TranscriptRecord {
    return {
        type: RecordType.fileHistorySnapshot,
        messageId: "m-" + backupFileName,
        isSnapshotUpdate: false,
        snapshot: {
            messageId: "m-" + backupFileName,
            timestamp: backupTime,
            trackedFileBackups: { [path]: { backupFileName, version: 1, backupTime } },
        },
    } as unknown as TranscriptRecord;
}

// No backups on offer, so every seed must come from lineage or the authored Write.
const emptyReader: BackupReader = () => "";

test("test_getPreExecutionState_preserves_subdirectory_qualified_keys", () => {
    // The key must keep its "tests/" prefix so the sandbox materializes the file where the script opens it.
    const records = [buildWriteRecord("/proj/tests/test_inventory.py", "def test(): pass\n", "2026-01-01T00:00:01Z", "/proj")];
    const run: ScriptRun = {
        code: 'text = open("tests/test_inventory.py").read()',
        timestamp: new Date("2026-01-01T00:00:02Z"),
        cwd: new Path("/proj"),
    };
    const state = getPreExecutionState(run, records, emptyReader);
    assert.ok(state.has("tests/test_inventory.py"));
    assert.ok(!state.has("test_inventory.py"));
});

test("test_getPreExecutionState_resolves_a_referenced_file_by_a_write_with_path_and_file_text", () => {
    // The Write lands AFTER the run, so only the basename lookup can find the referenced file.
    const records = [buildToolRecord(ToolName.Write, { path: "/proj/core.py", file_text: "def add(): pass\n" }, "2026-01-01T00:00:09Z", "/proj")];
    const run: ScriptRun = {
        code: 'text = open("core.py").read()',
        timestamp: new Date("2026-01-01T00:00:02Z"),
        cwd: new Path("/proj"),
    };
    const state = getPreExecutionState(run, records, emptyReader, () => "seeded\n");
    assert.equal(state.get("core.py"), "seeded\n");
});

test("test_getPreExecutionState_prefers_lineage_content_over_backups", () => {
    // Lineage can carry an Edit the last backup missed, so it must win over the stale backup.
    const records = [
        buildWriteRecord("/proj/core.py", "def add(): pass\n", "2026-01-01T00:00:01Z", "/proj"),
        buildSnapshotRecord("core.py", "core@v1", "2026-01-01T00:00:02Z"),
    ];
    const staleReader: BackupReader = () => "def add(): pass\n";
    const run: ScriptRun = { code: "print(1)", timestamp: new Date("2026-01-01T00:00:05Z"), cwd: new Path("/proj") };
    const state = getPreExecutionState(run, records, staleReader, () => "def add(): pass\n\ndef remove(): pass\n");
    assert.equal(state.get("core.py"), "def add(): pass\n\ndef remove(): pass\n");
});

test("test_prestate_resolves_each_path_once", () => {
    // Repeated Writes to one path must cost only one content lookup (task 192).
    const records = [
        buildWriteRecord("/proj/x.py", "v1\n", "2026-01-01T00:00:01Z", "/proj"),
        buildWriteRecord("/proj/x.py", "v2\n", "2026-01-01T00:00:02Z", "/proj"),
        buildWriteRecord("/proj/x.py", "v3\n", "2026-01-01T00:00:03Z", "/proj"),
    ];
    const run: ScriptRun = { code: "print(1)", timestamp: new Date("2026-01-01T00:00:05Z"), cwd: new Path("/proj") };
    const lookups: string[] = [];
    const state = getPreExecutionState(run, records, emptyReader, (target) => {
        lookups.push(target.toString());
        return "seeded\n";
    });
    assert.deepEqual(lookups, ["/proj/x.py"]);
    assert.equal(state.get("x.py"), "seeded\n");
});

test("test_prestate_rename_collapse_keeps_last_writer", () => {
    // After a rename the collapsed current path must hold the last writer's content.
    const records = [
        buildWriteRecord("/proj/a.py", "one\n", "2026-01-01T00:00:01Z", "/proj"),
        buildToolRecord(ToolName.Bash, { command: "mv /proj/a.py /proj/b.py" }, "2026-01-01T00:00:02Z", "/proj"),
        buildWriteRecord("/proj/b.py", "two\n", "2026-01-01T00:00:03Z", "/proj"),
    ];
    const run: ScriptRun = { code: "print(1)", timestamp: new Date("2026-01-01T00:00:05Z"), cwd: new Path("/proj") };
    const state = getPreExecutionState(run, records, emptyReader);
    assert.equal(state.get("b.py"), "two\n");
    assert.ok(!state.has("a.py"));
});

test("test_prestate_basename_collision_final_writer_wins", () => {
    // Files outside the run's cwd sharing a basename collapse to one flat key; the final writer wins.
    const records = [
        buildWriteRecord("/x/data.py", "A1\n", "2026-01-01T00:00:01Z", "/proj"),
        buildWriteRecord("/y/data.py", "B\n", "2026-01-01T00:00:02Z", "/proj"),
        buildWriteRecord("/x/data.py", "A2\n", "2026-01-01T00:00:03Z", "/proj"),
    ];
    const run: ScriptRun = { code: "print(1)", timestamp: new Date("2026-01-01T00:00:05Z"), cwd: new Path("/proj") };
    const state = getPreExecutionState(run, records, emptyReader);
    assert.equal(state.get("data.py"), "A2\n");
});
