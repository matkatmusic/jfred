import { test } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
    isImpureExecutionAllowed,
    setImpureExecutionAllowed,
} from "../src/reconstruction_exec_gate.ts";
import { injectScriptExecutions } from "../src/reconstruction_script_stage.ts";
import {
    PROGRESS_LABEL_PRE_BASELINE_SKIP_PREFIX,
    discoverScriptCreatedPaths,
    executeRunOnce,
} from "../src/reconstruction_script_runs.ts";
import { setPreBaselineReconstructionAllowed } from "../src/reconstruction_base_commit.ts";
import { setPathOverrides } from "../src/reconstruction_overrides.ts";
import { setReconstructionProgressSink } from "../src/reconstruction_progress.ts";
import { findScriptExecutionRuns } from "../src/reconstruction_script_execution.ts";
import type { BackupReader } from "../src/reconstruction_sidecar.ts";
import { BlockType, RecordType, ToolName } from "../src/structures/vocabulary.ts";
import type { TranscriptRecord } from "../src/structures/envelope.ts";
import { Path, Uuid } from "../src/structures/domain.ts";

// An assistant record with one `name` tool_use carrying `input`, plus the record-level cwd.
function buildToolRecord(name: ToolName, input: Record<string, unknown>, timestamp: string, cwd?: string): TranscriptRecord {
    return {
        type: RecordType.assistant,
        timestamp: new Date(timestamp),
        cwd: cwd !== undefined ? new Path(cwd) : undefined,
        message: { content: [{ type: BlockType.tool_use, id: "toolu_x", name, input, caller: { type: "direct" } }] },
    } as unknown as TranscriptRecord;
}

const emptyReader: BackupReader = () => "";

test("test_exec_gate_defaults_to_enabled", () => {
    // The gate must default ON so the CLI and tests behave as before; a fresh process allows it.
    assert.equal(isImpureExecutionAllowed(), true);
});

test("test_exec_gate_disable_blocks_script_injection", () => {
    // Gate off: injectScriptExecutions returns its events argument unchanged (same identity), even for a script-birthing fixture.
    const records = [
        buildToolRecord(ToolName.Write, { file_path: "/proj/runit.py", content: "x" }, "2026-01-01T00:00:01Z"),
        buildToolRecord(
            ToolName.CtxExecute,
            { cwd: "/proj", code: 'open("out.txt", "w").write("created\\n")\n' },
            "2026-01-01T00:00:02Z",
        ),
    ];
    const events: never[] = [];
    try {
        // disable the gate.
        setImpureExecutionAllowed(false);
        // run the stage that would otherwise inject one scriptExecution event.
        const result = injectScriptExecutions(records, events, emptyReader, new Path("/proj/out.txt"));
        // assert the stage passed its events argument through untouched.
        assert.equal(result, events);
    } finally {
        setImpureExecutionAllowed(true);
    }
});

test("test_exec_gate_disable_blocks_script_created_path_discovery", () => {
    // Gate off: discoverScriptCreatedPaths runs nothing and returns no paths; gate-on is tested in reconstruction_script_stage.test.ts.
    const records = [
        buildToolRecord(ToolName.Write, { file_path: "/proj/runit.py", content: "x" }, "2026-01-01T00:00:01Z"),
        buildToolRecord(
            ToolName.CtxExecute,
            { cwd: "/proj", code: 'open("out.txt", "w").write("created\\n")\n' },
            "2026-01-01T00:00:02Z",
        ),
    ];
    try {
        // disable the gate.
        setImpureExecutionAllowed(false);
        // run the discovery that would otherwise execute the run and report out.txt as born.
        assert.deepEqual(discoverScriptCreatedPaths(records, emptyReader), []);
    } finally {
        setImpureExecutionAllowed(true);
    }
});

test("test_execute_run_once_skips_a_run_at_or_before_a_declined_baseline", () => {
    // Scenario (task 151): after a declined pre-baseline question, executeRunOnce skips runs at or before the baseline commit.
    const repo = mkdtempSync(join(tmpdir(), "reveng-prebaseline-"));
    const capturedLabels: string[] = [];
    try {
        writeFileSync(join(repo, "orders.py"), "committed\n");
        execSync(
            'git init -q && git add -A && git -c user.name=t -c user.email=t@t commit -q -m baseline',
            { cwd: repo, env: { ...process.env, GIT_COMMITTER_DATE: "2026-01-01T00:00:10Z" } },
        );
        const commitHash = execSync("git rev-parse HEAD", { cwd: repo }).toString().trim();
        setPathOverrides({ repoDir: new Path(repo), baseCommit: new Uuid(commitHash) });
        // decline pre-baseline reconstruction and capture progress labels.
        setPreBaselineReconstructionAllowed(false);
        setReconstructionProgressSink((event) => capturedLabels.push(event.label));
        // one writing run BEFORE the commit instant, one AFTER; both would otherwise execute.
        const records = [
            buildToolRecord(ToolName.CtxExecute, { cwd: "/proj", code: 'open("early.txt", "w").write("x")\n' }, "2026-01-01T00:00:05Z"),
            buildToolRecord(ToolName.CtxExecute, { cwd: "/proj", code: 'open("late.txt", "w").write("x")\n' }, "2026-01-01T00:00:20Z"),
        ];
        const [earlyRun, lateRun] = findScriptExecutionRuns(records);
        // the pre-baseline run is skipped: no post state, and the skip label was announced.
        const skipped = executeRunOnce(earlyRun!, records, emptyReader);
        assert.equal(skipped.post, undefined);
        assert.ok(capturedLabels.some((label) => label.startsWith(PROGRESS_LABEL_PRE_BASELINE_SKIP_PREFIX)));
        // the post-baseline run is NOT skipped under that label.
        capturedLabels.length = 0;
        executeRunOnce(lateRun!, records, emptyReader);
        assert.ok(!capturedLabels.some((label) => label.startsWith(PROGRESS_LABEL_PRE_BASELINE_SKIP_PREFIX)));
    } finally {
        setReconstructionProgressSink(undefined);
        setPreBaselineReconstructionAllowed(true);
        setPathOverrides({});
        rmSync(repo, { recursive: true, force: true });
    }
});
