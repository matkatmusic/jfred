import { test } from "node:test";
import assert from "node:assert/strict";
import {
    PROGRESS_LABEL_NON_PYTHON_SKIP_PREFIX,
    computeRunExecutionKey,
    executeRunOnce,
} from "../src/reconstruction_script_runs.ts";
import {
    ScriptExecutorKind,
    findScriptExecutionRuns,
} from "../src/reconstruction_script_execution.ts";
import {
    ReconstructionCounter,
    resetReconstructionCounters,
    snapshotReconstructionCounters,
} from "../src/reconstruction_counters.ts";
import { reconstructSurvivingFileHistory } from "../src/reconstruction_target.ts";
import { setReconstructionProgressSink } from "../src/reconstruction_progress.ts";
import { EventKind, ToolName } from "../src/structures/vocabulary.ts";
import { Path } from "../src/structures/domain.ts";
import type { BackupReader } from "../src/reconstruction_sidecar.ts";
import { buildToolRecord } from "./script-execution-test-helpers.ts";

// A reader with no backups to offer — pre-state seeds come from the authored Writes.
const emptyReader: BackupReader = () => "";

// Collect every progress label announced while `action` runs.
function collectProgressLabels(action: () => void): string[] {
    const labels: string[] = [];
    setReconstructionProgressSink((event) => {
        labels.push(event.label);
    });
    try {
        action();
    } finally {
        setReconstructionProgressSink(undefined);
    }
    return labels;
}

test("test_bash_run_skips_prestate_and_sandbox", () => {
    // Scenario: a Bash-origin run (compound shell, may-write verbs) must not build pre-state or enter the python3 sandbox — its result stays post:undefined, exactly what the crashing sandbox produced before the gate.
    resetReconstructionCounters();
    const records = [
        buildToolRecord(ToolName.Write, { file_path: "/proj/hook.sh", content: "echo hi\n" }, "2026-01-01T00:00:01Z"),
        buildToolRecord(ToolName.Bash, { command: "chmod +x /proj/hook.sh && rm -f /tmp/x && /proj/hook.sh" }, "2026-01-01T00:00:02Z"),
    ];
    const runs = findScriptExecutionRuns(records);
    const bashRun = runs.find((run) => run.executorKind === ScriptExecutorKind.bash);
    assert.ok(bashRun !== undefined);
    const labels = collectProgressLabels(() => {
        const execution = executeRunOnce(bashRun, records, emptyReader);
        assert.equal(execution.post, undefined);
    });
    // the skip is announced with its distinct reason, and no expensive work ran.
    assert.ok(labels.some((label) => label.startsWith(PROGRESS_LABEL_NON_PYTHON_SKIP_PREFIX)));
    const snapshot = snapshotReconstructionCounters();
    assert.equal(snapshot[ReconstructionCounter.preStateBuilds], 0);
    assert.equal(snapshot[ReconstructionCounter.sandboxSpawns], 0);
});

test("test_python_run_still_executes", () => {
    // Scenario: an MCP python run keeps its full pre-state build and sandbox execution.
    resetReconstructionCounters();
    const records = [
        buildToolRecord(ToolName.Write, { file_path: "/proj/data.txt", content: "before\n" }, "2026-01-01T00:00:01Z", "/proj"),
        buildToolRecord(ToolName.CtxExecute, { cwd: "/proj", code: 'open("data.txt", "w").write("after\\n")\n' }, "2026-01-01T00:00:02Z"),
    ];
    const runs = findScriptExecutionRuns(records);
    const pythonRun = runs.find((run) => run.executorKind === ScriptExecutorKind.python);
    assert.ok(pythonRun !== undefined);
    const execution = executeRunOnce(pythonRun, records, emptyReader);
    // the sandbox produced a post-state with the transformed file.
    assert.ok(execution.post !== undefined);
    assert.equal(execution.post.get("data.txt"), "after\n");
    const snapshot = snapshotReconstructionCounters();
    assert.equal(snapshot[ReconstructionCounter.preStateBuilds], 1);
});

test("test_bash_indirection_to_python_file_executes", () => {
    // Scenario: a Bash `python3 apply.py` run whose invoked .py file has a Written body is python-executable — indirection promotes its executor kind (the s34/s37 mechanism).
    const body = 'open("data.txt", "w").write("scripted\\n")\n';
    const records = [
        buildToolRecord(ToolName.Write, { file_path: "/proj/apply.py", content: body }, "2026-01-01T00:00:01Z"),
        buildToolRecord(ToolName.Bash, { command: "python3 apply.py" }, "2026-01-01T00:00:02Z"),
    ];
    const runs = findScriptExecutionRuns(records);
    const resolved = runs.find((run) => run.code === body);
    assert.ok(resolved !== undefined);
    assert.equal(resolved.executorKind, ScriptExecutorKind.python);
});

test("test_run_execution_key_carries_instant_executor_and_code", () => {
    // Scenario: the executionsByRun memo key is `${instantMs}|${executorKind}|${code}`, with an absent executor kind defaulting to python (the synthetic-test-run rule from task 192).  Steps: a recorded python run's key reproduces the exact format executeRunOnce memoizes under.
    const records = [
        buildToolRecord(ToolName.CtxExecute, { cwd: "/proj", code: 'print("x")\n' }, "2026-01-01T00:00:02Z"),
    ];
    const run = findScriptExecutionRuns(records)[0]!;
    assert.equal(
        computeRunExecutionKey(run),
        `${run.timestamp.getTime()}|${ScriptExecutorKind.python}|${run.code}`,
    );
    // a synthetic run without an executor kind keys exactly like a python run.
    const synthetic = { ...run, executorKind: undefined };
    assert.equal(computeRunExecutionKey(synthetic), computeRunExecutionKey(run));
    // two runs differing only in code get different keys.
    const differentCode = { ...run, code: 'print("y")\n' };
    assert.notEqual(computeRunExecutionKey(differentCode), computeRunExecutionKey(run));
});

test("test_bash_static_rename_evidence_survives_gate", () => {
    // Scenario: a bash `mv` run is skipped by the sandbox gate, but its statically extracted rename evidence still lands in the reconstructed history.
    const records = [
        buildToolRecord(ToolName.Write, { file_path: "/proj/a.py", content: "a = 1\n" }, "2026-01-01T00:00:01Z"),
        buildToolRecord(ToolName.Bash, { command: "mv /proj/a.py /proj/b.py" }, "2026-01-01T00:00:02Z"),
    ];
    const history = reconstructSurvivingFileHistory(records, new Path("/proj/b.py"));
    assert.ok(history !== undefined);
    assert.ok(history.revisions.some((revision) => revision.kind === EventKind.rename));
});
