// Task l4-wire-real: script runs located in session transcripts join to pairs by the static scan and shape into the /api/layer1-script-runs wire view.

import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { LAYER1_PROGRESS_LABEL_READING_SCRIPT_RUNS, buildScriptRunsView } from "../src/layer1_script_runs_wire.ts";
import { Path } from "../src/structures/domain.ts";
import { WireScriptExecutorKind } from "../webapp/layer1-wire.ts";
import { WireScriptLanguage } from "../webapp/layer1-script-language.ts";
import { SESSION_A, SESSION_B, buildWriteRecordPair, makeSourceTree, writeTranscriptFixture } from "./multi-source-test-helpers.ts";
import { makeTempDir } from "./overrides-test-helpers.ts";

const APPLY_BODY = 'import pathlib\npathlib.Path("billing.py").write_text("x")\n';

type ProjectFixture = { projectFolder: string; sessionDir: string };

function makeProject(): ProjectFixture {
    const projectFolder = makeTempDir();
    writeFileSync(join(projectFolder, "billing.py"), "a\n");
    writeFileSync(join(projectFolder, "ledger.py"), "a\n");
    return { projectFolder, sessionDir: makeSourceTree("-script-runs").projectDir };
}

function buildBashToolUseRecord(sessionId: string, projectFolder: string, toolId: string, timestamp: string, command: string): object {
    return {
        type: "assistant",
        uuid: `${toolId}-assistant`,
        parentUuid: null,
        sessionId,
        timestamp,
        cwd: projectFolder,
        message: { role: "assistant", content: [{ type: "tool_use", id: toolId, name: "Bash", input: { command } }] },
    };
}

function writeBashSession(fixture: ProjectFixture, name: string, sessionId: string, bashRuns: { toolId: string; timestamp: string; command: string }[]): Path {
    const records = bashRuns.map((run) => buildBashToolUseRecord(sessionId, fixture.projectFolder, run.toolId, run.timestamp, run.command));
    writeTranscriptFixture(fixture.sessionDir, name, records);
    return new Path(join(fixture.sessionDir, name));
}

function readRunsOf(view: ReturnType<typeof buildScriptRunsView>, relativePath: string) {
    return view.pairs.find((pair) => pair.path.toString() === relativePath)?.scriptRuns ?? [];
}

test("test_python_indirection_run_lands_on_named_pair", () => {
    const fixture = makeProject();
    const envelope = { sessionId: SESSION_A, cwd: fixture.projectFolder, timestamp: "2026-07-24T10:00:00.000Z", toolId: "toolu_w1", parentUuid: null };
    const writePair = buildWriteRecordPair(envelope, join(fixture.projectFolder, "apply.py"), APPLY_BODY);
    const bashRecord = buildBashToolUseRecord(SESSION_A, fixture.projectFolder, "toolu_b1", "2026-07-24T10:01:00.000Z", "python3 apply.py");
    writeTranscriptFixture(fixture.sessionDir, "a.jsonl", [...writePair.records, bashRecord]);
    const sessionFile = new Path(join(fixture.sessionDir, "a.jsonl"));
    const runs = readRunsOf(buildScriptRunsView(new Path(fixture.projectFolder), [sessionFile]), "billing.py");
    assert.equal(runs.length, 1);
    assert.equal(runs[0]!.executorKind, WireScriptExecutorKind.python);
    assert.equal(runs[0]!.code, APPLY_BODY);
    assert.equal(runs[0]!.label, "python run apply.py");
    assert.equal(runs[0]!.language, WireScriptLanguage.python);
    // The Bash record follows the Write pair's records, one JSONL line each.
    assert.equal(runs[0]!.line, writePair.records.length + 1);
    assert.equal(runs[0]!.toolUseId.toString(), "toolu_b1");
    assert.equal(runs[0]!.sessionId.toString(), SESSION_A);
    assert.equal(runs[0]!.sessionFile.toString(), sessionFile.toString());
});

test("test_read_only_run_is_dropped", () => {
    const fixture = makeProject();
    const sessionFile = writeBashSession(fixture, "a.jsonl", SESSION_A, [{ toolId: "toolu_b1", timestamp: "2026-07-24T10:01:00.000Z", command: "cat billing.py" }]);
    assert.deepEqual(buildScriptRunsView(new Path(fixture.projectFolder), [sessionFile]), { pairs: [] });
});

test("test_bash_run_keeps_bash_kind_and_sends_no_label", () => {
    const fixture = makeProject();
    const sessionFile = writeBashSession(fixture, "a.jsonl", SESSION_A, [{ toolId: "toolu_b1", timestamp: "2026-07-24T10:01:00.000Z", command: "sed -i '' 's/a/b/' billing.py" }]);
    const runs = readRunsOf(buildScriptRunsView(new Path(fixture.projectFolder), [sessionFile]), "billing.py");
    assert.equal(runs.length, 1);
    assert.equal(runs[0]!.executorKind, WireScriptExecutorKind.bash);
    assert.equal(runs[0]!.language, WireScriptLanguage.bash);
    assert.equal("label" in runs[0]!, false);
});

test("test_ctx_shell_run_is_bash_kind_with_shell_language_and_its_line", () => {
    const fixture = makeProject();
    const record = {
        type: "assistant", uuid: "toolu_c1-assistant", parentUuid: null, sessionId: SESSION_A, timestamp: "2026-07-24T10:01:00.000Z", cwd: fixture.projectFolder,
        message: { role: "assistant", content: [{ type: "tool_use", id: "toolu_c1", name: "mcp__plugin_context-mode_context-mode__ctx_execute", input: { language: "shell", code: "sed -i '' 's/a/b/' billing.py" } }] },
    };
    writeTranscriptFixture(fixture.sessionDir, "a.jsonl", [record]);
    const runs = readRunsOf(buildScriptRunsView(new Path(fixture.projectFolder), [new Path(join(fixture.sessionDir, "a.jsonl"))]), "billing.py");
    assert.equal(runs.length, 1);
    assert.equal(runs[0]!.executorKind, WireScriptExecutorKind.bash);
    assert.equal(runs[0]!.language, WireScriptLanguage.shell);
    assert.equal(runs[0]!.line, 1);
});

test("test_run_naming_no_file_is_absent", () => {
    const fixture = makeProject();
    const sessionFile = writeBashSession(fixture, "a.jsonl", SESSION_A, [{ toolId: "toolu_b1", timestamp: "2026-07-24T10:01:00.000Z", command: "rm -f nothing.txt" }]);
    assert.deepEqual(buildScriptRunsView(new Path(fixture.projectFolder), [sessionFile]), { pairs: [] });
});

test("test_run_naming_two_files_joins_both_pairs", () => {
    const fixture = makeProject();
    const sessionFile = writeBashSession(fixture, "a.jsonl", SESSION_A, [{ toolId: "toolu_b1", timestamp: "2026-07-24T10:01:00.000Z", command: "cp billing.py ledger.py" }]);
    const view = buildScriptRunsView(new Path(fixture.projectFolder), [sessionFile]);
    assert.deepEqual(view.pairs.map((pair) => pair.path.toString()).sort(), ["billing.py", "ledger.py"]);
    assert.equal(readRunsOf(view, "billing.py")[0]!.toolUseId.toString(), "toolu_b1");
    assert.equal(readRunsOf(view, "ledger.py")[0]!.toolUseId.toString(), "toolu_b1");
});

test("test_same_tool_use_id_in_two_sessions_is_kept_once", () => {
    const fixture = makeProject();
    const run = { toolId: "toolu_b1", timestamp: "2026-07-24T10:01:00.000Z", command: "sed -i '' 's/a/b/' billing.py" };
    const sessionB = writeBashSession(fixture, "b.jsonl", SESSION_B, [run]);
    const sessionA = writeBashSession(fixture, "a.jsonl", SESSION_A, [run]);
    const runs = readRunsOf(buildScriptRunsView(new Path(fixture.projectFolder), [sessionB, sessionA]), "billing.py");
    assert.equal(runs.length, 1);
    assert.equal(runs[0]!.sessionFile.toString(), sessionA.toString());
});

test("test_runs_per_pair_ascend_by_instant", () => {
    const fixture = makeProject();
    const sessionFile = writeBashSession(fixture, "a.jsonl", SESSION_A, [
        { toolId: "toolu_late", timestamp: "2026-07-24T10:05:00.000Z", command: "sed -i '' 's/a/b/' billing.py" },
        { toolId: "toolu_early", timestamp: "2026-07-24T10:01:00.000Z", command: "sed -i '' 's/b/c/' billing.py" },
    ]);
    const runs = readRunsOf(buildScriptRunsView(new Path(fixture.projectFolder), [sessionFile]), "billing.py");
    assert.deepEqual(runs.map((run) => run.toolUseId.toString()), ["toolu_early", "toolu_late"]);
});

test("test_progress_counts_sessions", () => {
    const fixture = makeProject();
    const run = { toolId: "toolu_b1", timestamp: "2026-07-24T10:01:00.000Z", command: "cat billing.py" };
    const sessionFiles = [writeBashSession(fixture, "a.jsonl", SESSION_A, [run]), writeBashSession(fixture, "b.jsonl", SESSION_B, [run])];
    const lines: unknown[] = [];
    buildScriptRunsView(new Path(fixture.projectFolder), sessionFiles, (line) => lines.push(line));
    assert.deepEqual(lines, [
        { kind: "progress", label: LAYER1_PROGRESS_LABEL_READING_SCRIPT_RUNS, current: 1, total: 2 },
        { kind: "progress", label: LAYER1_PROGRESS_LABEL_READING_SCRIPT_RUNS, current: 2, total: 2 },
    ]);
});
