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
import { placeGitCommitEvidence } from "../src/reconstruction_git_placement.ts";
import { setPreBaselineReconstructionAllowed } from "../src/reconstruction_base_commit.ts";
import { setPathOverrides } from "../src/reconstruction_overrides.ts";
import { setReconstructionProgressSink } from "../src/reconstruction_progress.ts";
import { findScriptExecutionRuns } from "../src/reconstruction_script_execution.ts";
import type { BackupReader } from "../src/reconstruction_sidecar.ts";
import { BlockType, RecordType, ToolName } from "../src/structures/vocabulary.ts";
import type { TranscriptRecord } from "../src/structures/envelope.ts";
import { Path, Uuid } from "../src/structures/domain.ts";

// An assistant record carrying one tool_use of `name` with `input`, with the record-level cwd.
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
    // Scenario: the gate must default ON so the CLI, the test suite, and the coverage gate behave exactly as before the gate existed.  Test verification: a fresh process reports impure execution as allowed.
    assert.equal(isImpureExecutionAllowed(), true);
});

test("test_exec_gate_disable_blocks_script_injection", () => {
    // Scenario: with the gate off, injectScriptExecutions must execute nothing and
    // return its events argument unchanged (same array identity).
    // Steps:
    // build the smallest injecting fixture: a Write plus a script run that births out.txt.
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
    // Scenario: with the gate off, discoverScriptCreatedPaths must execute nothing and return no paths — discovery runs every recorded script, so a declined build must skip it (the same fixture discovers out.txt when the gate is on, per reconstruction_script_stage.test.ts).
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
    // Scenario (task 151): the user answered "No" to the pre-baseline question — a script run at-or-before the baseline commit's timestamp is superseded by the beacon, so executing it is provably wasted work. executeRunOnce (the one choke point every consumer routes through) must skip it with a progress label and no sandbox execution.  Steps: commit a baseline repo at T=10 and configure it as the override pair.
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
        // one writing run BEFORE the commit instant, one AFTER — both would otherwise execute.
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

test("test_exec_gate_disable_blocks_git_evidence", () => {
    // Scenario: with the gate off, placeGitCommitEvidence must not shell out to git and must return its events argument unchanged (same array identity) — even over a fixture that provably makes the enabled stage splice a new event (the s85-in- miniature fixture from reconstruction_git_evidence.test.ts).
    const repo = mkdtempSync(join(tmpdir(), "reveng-gate-"));
    try {
        // Steps: commit a blob whose `# reviewed by ops` line no recorded event explains.
        const moved = '"""Module two."""\n\n\ndef f_two(x):\n    return x + 2\n';
        const blob = '"""Module two."""\n\n\ndef beta(x):\n    return x + 2\n# reviewed by ops\n';
        writeFileSync(join(repo, "core_two.py"), blob);
        execSync(
            'git init -q && git add core_two.py && git -c user.name=t -c user.email=t@t commit -q -m post-rename',
            { cwd: repo, env: { ...process.env, GIT_COMMITTER_DATE: "2026-01-01T00:00:20Z" } },
        );
        const moveScript = 'import shutil\nshutil.move("two.py", "core_two.py")\n';
        const renameScript = 'import glob\nfor p in glob.glob("core_*.py"):\n'
            + '    text = open(p).read()\n'
            + '    open(p, "w").write(text.replace("f_two", "beta"))\n';
        const records = [
            buildToolRecord(ToolName.Write, { file_path: join(repo, "two.py"), content: moved }, "2026-01-01T00:00:01Z", repo),
            buildToolRecord(ToolName.CtxExecute, { cwd: repo, code: moveScript }, "2026-01-01T00:00:05Z", repo),
            buildToolRecord(ToolName.CtxExecute, { cwd: repo, code: renameScript }, "2026-01-01T00:00:15Z", repo),
            buildToolRecord(ToolName.Bash, { command: `git -C ${repo} commit -m post-rename` }, "2026-01-01T00:00:19Z", repo),
        ];
        const target = new Path(join(repo, "core_two.py"));
        // build the injected events while the gate is still ON (the enabled stage splices here).
        const events = injectScriptExecutions(records, [], emptyReader, target);
        assert.equal(events.length, 2);
        // disable the gate.
        setImpureExecutionAllowed(false);
        // run the git-evidence stage that would otherwise splice a third event.
        const placed = placeGitCommitEvidence(records, events, emptyReader, target);
        // assert the stage passed its events argument through untouched.
        assert.equal(placed, events);
    } finally {
        setImpureExecutionAllowed(true);
        rmSync(repo, { recursive: true, force: true });
    }
});

