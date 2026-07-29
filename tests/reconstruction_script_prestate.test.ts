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

test("test_scriptCodeMayWriteFiles_accepts_a_read_only_analysis_script", () => {
    // Read-only analysis scripts must classify read-only so the sandbox is skipped (item 68).
    const script = 'import os\nimport re\nimport json\n'
        + 'text = open("ledger.py").read()\n'
        + 'hits = [line for line in text.splitlines() if re.search(r"def ", line)]\n'
        + 'print(json.dumps(len(hits)))\n';
    assert.equal(scriptCodeMayWriteFiles(script), false);
});

test("test_scriptCodeMayWriteFiles_flags_write_mode_opens", () => {
    // Literal "w"/"a" open modes are the classic write channel.
    assert.equal(scriptCodeMayWriteFiles('open("out.txt", "w").write("x")\n'), true);
    assert.equal(scriptCodeMayWriteFiles('open("log.txt", "a").write("x")\n'), true);
});

test("test_scriptCodeMayWriteFiles_flags_an_unprovable_open_mode", () => {
    // Unparseable modes must fall to may-write: a false may-write is harmless, the reverse is not.
    assert.equal(scriptCodeMayWriteFiles("open(p, mode)\n"), true);
    assert.equal(scriptCodeMayWriteFiles("open(os.path.join(a, b))\n"), true);
});

test("test_scriptCodeMayWriteFiles_accepts_read_mode_opens", () => {
    assert.equal(scriptCodeMayWriteFiles('open("f.py", "r").read()\n'), false);
    assert.equal(scriptCodeMayWriteFiles('open("f.py", "rb").read()\n'), false);
    assert.equal(scriptCodeMayWriteFiles('open("f.py", encoding="utf-8").read()\n'), false);
});

test("test_scriptCodeMayWriteFiles_flags_pathlib_and_os_write_methods", () => {
    // Path.open takes the mode as its FIRST argument.
    assert.equal(scriptCodeMayWriteFiles('from pathlib import Path\nPath("f").write_text("x")\n'), true);
    assert.equal(scriptCodeMayWriteFiles('from pathlib import Path\nPath("f").open("w")\n'), true);
    assert.equal(scriptCodeMayWriteFiles('import os\nos.rename("a", "b")\n'), true);
    assert.equal(scriptCodeMayWriteFiles('import os\nos.remove("a")\n'), true);
});

test("test_scriptCodeMayWriteFiles_flags_unknown_and_escaping_imports", () => {
    // A non-allowlisted import may be a seeded local module that writes at top level (s34 family).
    assert.equal(scriptCodeMayWriteFiles('import shutil\nshutil.move("a", "b")\n'), true);
    assert.equal(scriptCodeMayWriteFiles("import apply_renames\n"), true);
    assert.equal(scriptCodeMayWriteFiles('from os import remove\nremove("a")\n'), true);
    assert.equal(scriptCodeMayWriteFiles("exec(compiled)\n"), true);
});

test("test_scriptCodeMayWriteFiles_flags_shell_write_verbs", () => {
    // The python-only gate once labeled the s2 `mv` run read-only.
    assert.equal(scriptCodeMayWriteFiles("mv /tmp/s2_original.py /tmp/s2_moved.py"), true);
    assert.equal(scriptCodeMayWriteFiles("cp a.py b.py"), true);
    assert.equal(scriptCodeMayWriteFiles("rm -f stale.txt"), true);
    assert.equal(scriptCodeMayWriteFiles("mkdir -p out && touch out/marker"), true);
    assert.equal(scriptCodeMayWriteFiles("cat notes.md | tee copy.md"), true);
    assert.equal(scriptCodeMayWriteFiles("ln -s target link"), true);
    assert.equal(scriptCodeMayWriteFiles("sed -i 's/a/b/' config.py"), true);
});

test("test_scriptCodeMayWriteFiles_flags_shell_output_redirects_to_files", () => {
    // An output redirect whose target looks like a file path writes it.
    assert.equal(scriptCodeMayWriteFiles("echo hello > out.txt"), true);
    assert.equal(scriptCodeMayWriteFiles("python3 check.py >> logs/run.log"), true);
});

test("test_scriptCodeMayWriteFiles_accepts_read_only_shell_probes", () => {
    // Harness probes and fd-dup / /dev/null redirects must stay read-only or the item-68 skip breaks.
    assert.equal(scriptCodeMayWriteFiles("ls -la"), false);
    assert.equal(scriptCodeMayWriteFiles("pytest -q tests/"), false);
    assert.equal(scriptCodeMayWriteFiles("grep -n def ledger.py 2>&1"), false);
    assert.equal(scriptCodeMayWriteFiles("pytest -q 2>/dev/null"), false);
    assert.equal(scriptCodeMayWriteFiles("cat ledger.py | head -20"), false);
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
