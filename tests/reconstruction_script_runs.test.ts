import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { executeInRealBox } from "../src/reconstruction_script_sandbox_box.ts";
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
    getReconstructionCounterSnapshot,
} from "../src/reconstruction_counters.ts";
import { getSurvivingFileHistory } from "../src/reconstruction_target.ts";
import { setReconstructionProgressSink } from "../src/reconstruction_progress.ts";
import { EventKind, ToolName } from "../src/structures/vocabulary.ts";
import { Path } from "../src/structures/domain.ts";
import type { BackupReader } from "../src/reconstruction_sidecar.ts";
import { buildToolRecord } from "./script-execution-test-helpers.ts";

// A reader with no backups: pre-state seeds come from the authored Writes.
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
    // Scenario: a Bash-origin run builds no pre-state, skips the python3 sandbox, and keeps post undefined.
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
    const snapshot = getReconstructionCounterSnapshot();
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
    const snapshot = getReconstructionCounterSnapshot();
    assert.equal(snapshot[ReconstructionCounter.preStateBuilds], 1);
});

test("test_run_with_no_start_files_replays_only_inside_real_box_with_commit", () => {
    // Scenario: with a commit and no start files, a run replays only inside executeInRealBox.
    const repo = realpathSync(mkdtempSync(join(tmpdir(), "reveng-runs-box-")));
    try {
        // a temp repo has one commit dated before the run.
        const gitEnv = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", GIT_COMMITTER_DATE: "2025-12-31T00:00:00Z", GIT_AUTHOR_DATE: "2025-12-31T00:00:00Z" };
        const runGit = (args: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t.invalid", "-c", "commit.gpgsign=false", ...args], { cwd: repo, env: gitEnv });
        runGit(["init", "-q", "-b", "main"]);
        writeFileSync(join(repo, "seed.txt"), "seed\n");
        runGit(["add", "seed.txt"]);
        runGit(["commit", "-q", "-m", "seed"]);
        // the run writes a file and no Write record gives it start files.
        const buildRecords = () => [
            buildToolRecord(ToolName.CtxExecute, { cwd: "/proj", code: 'open("out.txt", "w").write("after\\n")\n' }, "2026-01-01T00:00:02Z"),
        ];
        // outside the real box the run has no start files, so it is not replayed.
        const outsideRecords = buildRecords();
        const outsideRun = findScriptExecutionRuns(outsideRecords)[0]!;
        const outside = executeRunOnce(outsideRun, outsideRecords, emptyReader);
        assert.equal(outside.post, undefined);
        // inside the real box the commit counts as a start, so the run replays and writes its file.
        const insideRecords = buildRecords();
        const insideRun = findScriptExecutionRuns(insideRecords)[0]!;
        const inside = executeInRealBox(new Path(repo), () => executeRunOnce(insideRun, insideRecords, emptyReader));
        assert.ok(inside.post !== undefined);
        assert.equal(inside.post.get("out.txt"), "after\n");
    } finally {
        rmSync(repo, { recursive: true, force: true });
    }
});

test("test_bash_indirection_to_python_file_executes", () => {
    // Scenario: a Bash `python3 apply.py` run with a Written body is promoted to python (s34/s37).
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
    // Scenario: the memo key is `${instantMs}|${executorKind}|${code}`; an absent executor kind means python.
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
    // Scenario: a bash `mv` run skips the sandbox gate, but its static rename evidence still lands.
    const records = [
        buildToolRecord(ToolName.Write, { file_path: "/proj/a.py", content: "a = 1\n" }, "2026-01-01T00:00:01Z"),
        buildToolRecord(ToolName.Bash, { command: "mv /proj/a.py /proj/b.py" }, "2026-01-01T00:00:02Z"),
    ];
    const history = getSurvivingFileHistory(records, new Path("/proj/b.py"));
    assert.ok(history !== undefined);
    assert.ok(history.revisions.some((revision) => revision.kind === EventKind.rename));
});
