import { test } from "node:test";
import assert from "node:assert/strict";
import {
    getPreExecutionState,
    parseScriptFileRefs,
    scriptCodeMayWriteFiles,
} from "../src/reconstruction_script_prestate.ts";
import type { ScriptRun } from "../src/reconstruction_script_execution.ts";
import type { BackupReader } from "../src/reconstruction_sidecar.ts";
import { RecordType, ToolName } from "../src/structures/vocabulary.ts";
import type { TranscriptRecord } from "../src/structures/envelope.ts";
import { Path } from "../src/structures/domain.ts";
import { buildToolRecord } from "./script-execution-test-helpers.ts";

// parseScriptFileRefs extracts all file-path-like quoted strings from script source.
test("test_parseScriptFileRefs_extracts_file_paths", () => {
    const code = `TARGETS = ["ledger.py", "tests/test_ledger.py"]\nwith open("renames.csv") as f:`;
    const refs = parseScriptFileRefs(code);
    assert.deepEqual(refs.sort(), ["ledger.py", "renames.csv", "tests/test_ledger.py"]);
});

// An assistant record writing `filePath` with `content`.
function buildWriteRecord(filePath: string, content: string, timestamp: string, cwd?: string): TranscriptRecord {
    return buildToolRecord(ToolName.Write, { file_path: filePath, content }, timestamp, cwd);
}

// A file-history snapshot record backing up `path` (cwd-relative) under `backupFileName`.
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

// A reader with no backups to offer — every seed must come from lineage or the authored Write.
const emptyReader: BackupReader = () => "";

test("test_getPreExecutionState_preserves_subdirectory_qualified_keys", () => {
    // Scenario: a script opens "tests/test_inventory.py"; the pre-state key must keep the
    // "tests/" prefix so the sandbox materializes the file where the script opens it.
    // Steps:
    // build records with a Write of /proj/tests/test_inventory.py and a run whose cwd is /proj
    // and whose code contains open("tests/test_inventory.py").
    const records = [buildWriteRecord("/proj/tests/test_inventory.py", "def test(): pass\n", "2026-01-01T00:00:01Z", "/proj")];
    const run: ScriptRun = {
        code: 'text = open("tests/test_inventory.py").read()',
        timestamp: new Date("2026-01-01T00:00:02Z"),
        cwd: new Path("/proj"),
    };
    // build the pre-state.
    const state = getPreExecutionState(run, records, emptyReader);
    // assert the state has the key "tests/test_inventory.py" and NOT "test_inventory.py".
    assert.ok(state.has("tests/test_inventory.py"));
    assert.ok(!state.has("test_inventory.py"));
});

test("test_getPreExecutionState_prefers_lineage_content_over_backups", () => {
    // Scenario: the reconstructed lineage at run time carries an Edit the last backup missed;
    // the pre-state must use the lineage content.
    // Steps:
    // build records with a Write of /proj/core.py and a later run; supply a reader whose backup
    // returns the stale pre-Edit content and a seedContent callback returning the post-Edit content.
    const records = [
        buildWriteRecord("/proj/core.py", "def add(): pass\n", "2026-01-01T00:00:01Z", "/proj"),
        buildSnapshotRecord("core.py", "core@v1", "2026-01-01T00:00:02Z"),
    ];
    const staleReader: BackupReader = () => "def add(): pass\n";
    const run: ScriptRun = { code: "print(1)", timestamp: new Date("2026-01-01T00:00:05Z"), cwd: new Path("/proj") };
    // build the pre-state with the callback.
    const state = getPreExecutionState(run, records, staleReader, () => "def add(): pass\n\ndef remove(): pass\n");
    // assert the state value for "core.py" is the post-Edit content.
    assert.equal(state.get("core.py"), "def add(): pass\n\ndef remove(): pass\n");
});

test("test_scriptCodeMayWriteFiles_accepts_a_read_only_analysis_script", () => {
    // Scenario: the dominant recorded shape — a grep/count/print analysis script that only
    // reads files — must classify read-only so the sandbox is skipped (TASKS.md item 68).
    const script = 'import os\nimport re\nimport json\n'
        + 'text = open("ledger.py").read()\n'
        + 'hits = [line for line in text.splitlines() if re.search(r"def ", line)]\n'
        + 'print(json.dumps(len(hits)))\n';
    assert.equal(scriptCodeMayWriteFiles(script), false);
});

test("test_scriptCodeMayWriteFiles_flags_write_mode_opens", () => {
    // Scenario: literal "w"/"a" open modes are the classic write channel.
    assert.equal(scriptCodeMayWriteFiles('open("out.txt", "w").write("x")\n'), true);
    assert.equal(scriptCodeMayWriteFiles('open("log.txt", "a").write("x")\n'), true);
});

test("test_scriptCodeMayWriteFiles_flags_an_unprovable_open_mode", () => {
    // Scenario: a variable mode or nested-call arguments cannot be parsed cheaply — the
    // verdict must fall to may-write (a false may-write is harmless; the reverse is not).
    assert.equal(scriptCodeMayWriteFiles("open(p, mode)\n"), true);
    assert.equal(scriptCodeMayWriteFiles("open(os.path.join(a, b))\n"), true);
});

test("test_scriptCodeMayWriteFiles_accepts_read_mode_opens", () => {
    // Scenario: single-argument opens and literal read modes (incl. keyword-only forms)
    // stay read-only.
    assert.equal(scriptCodeMayWriteFiles('open("f.py", "r").read()\n'), false);
    assert.equal(scriptCodeMayWriteFiles('open("f.py", "rb").read()\n'), false);
    assert.equal(scriptCodeMayWriteFiles('open("f.py", encoding="utf-8").read()\n'), false);
});

test("test_scriptCodeMayWriteFiles_flags_pathlib_and_os_write_methods", () => {
    // Scenario: pathlib write methods, Path.open (whose FIRST argument is the mode), and
    // os rename/remove are write channels.
    assert.equal(scriptCodeMayWriteFiles('from pathlib import Path\nPath("f").write_text("x")\n'), true);
    assert.equal(scriptCodeMayWriteFiles('from pathlib import Path\nPath("f").open("w")\n'), true);
    assert.equal(scriptCodeMayWriteFiles('import os\nos.rename("a", "b")\n'), true);
    assert.equal(scriptCodeMayWriteFiles('import os\nos.remove("a")\n'), true);
});

test("test_scriptCodeMayWriteFiles_flags_unknown_and_escaping_imports", () => {
    // Scenario: a non-allowlisted import may be a seeded local module whose top level
    // writes (the s34 script-indirection family); shutil writes outright; a from-import
    // can smuggle a writing name out of a safe root; exec escapes static analysis.
    assert.equal(scriptCodeMayWriteFiles('import shutil\nshutil.move("a", "b")\n'), true);
    assert.equal(scriptCodeMayWriteFiles("import apply_renames\n"), true);
    assert.equal(scriptCodeMayWriteFiles('from os import remove\nremove("a")\n'), true);
    assert.equal(scriptCodeMayWriteFiles("exec(compiled)\n"), true);
});
