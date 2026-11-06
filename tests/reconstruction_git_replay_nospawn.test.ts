// Prints which call site makes earlier-run entries in a guarded build; asserts git replay makes none and nothing spawns.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getFileRevisionsOver } from "../src/reconstruction_branches.ts";
import { getPathOverrides } from "../src/reconstruction_overrides.ts";
import { isImpureExecutionAllowed, setImpureExecutionAllowed } from "../src/reconstruction_exec_gate.ts";
import { setRecordSource } from "../src/parse/loadTranscript.ts";
import { getReconstructionCounterSnapshot, resetReconstructionCounters } from "../src/reconstruction_counters.ts";
import { setSandboxMemoPersistence, writePendingSandboxMemoToDisk } from "../src/reconstruction_script_sandbox_memo.ts";
import { collectEarlierRuns } from "../src/reconstruction_script_sandbox_spawn_guard.ts";
import type { BackupReader } from "../src/reconstruction_sidecar.ts";
import { BlockType, RecordType, ToolName } from "../src/structures/vocabulary.ts";
import type { TranscriptRecord } from "../src/structures/envelope.ts";
import { Path } from "../src/structures/domain.ts";

const emptyReader: BackupReader = () => "";
const SCRIPT = 'text = open("a.txt").read()\nopen("a.txt", "w").write(text + "z\\n")\n';
interface Shape { name: string; blob: string; hasCommitRecord: boolean; isMemoWarm: boolean }
const SHAPES: Shape[] = [
    { name: "pure addition, cold memo", blob: "a\nb\nz\n", hasCommitRecord: true, isMemoWarm: false },
    { name: "pure addition, warm memo", blob: "a\nb\nz\n", hasCommitRecord: true, isMemoWarm: true },
    { name: "blob equals lineage, warm memo", blob: "a\nz\n", hasCommitRecord: true, isMemoWarm: true },
    { name: "no commit record, warm memo", blob: "a\nb\nz\n", hasCommitRecord: false, isMemoWarm: true },
];

function buildToolRecord(name: ToolName, input: Record<string, unknown>, second: number, repo: string): TranscriptRecord {
    const timestamp = new Date(Date.UTC(2026, 0, 1, 0, 0, second));
    const block = { type: BlockType.tool_use, id: "toolu_x", name, input, caller: { type: "direct" } };
    const record = { type: RecordType.assistant, timestamp, cwd: new Path(repo), message: { content: [block] } } as unknown as TranscriptRecord;
    setRecordSource(record, { filePath: "/tmp/nospawn.jsonl", lineNumber: second });
    return record;
}

function buildRepo(blob: string): string {
    const repo = mkdtempSync(join(tmpdir(), "reveng-nospawn-"));
    writeFileSync(join(repo, "a.txt"), blob);
    const env = { ...process.env, GIT_COMMITTER_DATE: "2026-01-01T00:00:20Z" };
    execSync("git init -q && git add a.txt && git -c user.name=t -c user.email=t@t commit -q -m c", { cwd: repo, env });
    return repo;
}

function buildRecords(repo: string, hasCommitRecord: boolean): TranscriptRecord[] {
    const records = [
        buildToolRecord(ToolName.Write, { file_path: join(repo, "a.txt"), content: "a\n" }, 1, repo),
        buildToolRecord(ToolName.CtxExecute, { cwd: repo, code: SCRIPT }, 5, repo),
    ];
    if (hasCommitRecord)
        records.push(buildToolRecord(ToolName.Bash, { command: `git -C ${repo} commit -m c` }, 19, repo));
    return records;
}

function runWithImpureOn(compute: () => void): void {
    const previous = isImpureExecutionAllowed();
    setImpureExecutionAllowed(true);
    try {
        compute();
    }
    finally {
        setImpureExecutionAllowed(previous);
    }
}

function collectReports(repo: string, shape: Shape, target: Path): { label: string }[] {
    let reports: { label: string }[] = [];
    runWithImpureOn(() => {
        const records = buildRecords(repo, shape.hasCommitRecord);
        reports = collectEarlierRuns(new Set(), () => getFileRevisionsOver(records, target, new Set(), getPathOverrides(), emptyReader));
    });
    return reports;
}

interface Row { fromExecuteRunOnce: number; fromGitReplay: number; spawns: number; isMemoSame: boolean }

function measureShape(repo: string, memoFile: string, shape: Shape): Row {
    const target = new Path(join(repo, "a.txt"));
    setSandboxMemoPersistence(new Path(memoFile));
    if (shape.isMemoWarm)
        runWithImpureOn(() => getFileRevisionsOver(buildRecords(repo, false), target, new Set(), getPathOverrides(), emptyReader));
    writePendingSandboxMemoToDisk();
    const memoBefore = readFileSync(memoFile, "utf8");
    resetReconstructionCounters();
    const reports = collectReports(repo, shape, target);
    writePendingSandboxMemoToDisk();
    const fromGitReplay = reports.filter((report) => report.label === "").length;
    const isMemoSame = readFileSync(memoFile, "utf8") === memoBefore;
    return { fromExecuteRunOnce: reports.length - fromGitReplay, fromGitReplay, spawns: getReconstructionCounterSnapshot().sandboxSpawns!, isMemoSame };
}

function runShape(shape: Shape): Row {
    const repo = buildRepo(shape.blob);
    const memoFile = `${repo}.memo.json`;
    try {
        return measureShape(repo, memoFile, shape);
    }
    finally {
        setSandboxMemoPersistence(undefined);
        rmSync(repo, { recursive: true, force: true });
        rmSync(memoFile, { force: true });
    }
}

test("test_guardedBuild_never_spawns_and_prints_the_call_site_table", () => {
    const rows: Record<string, unknown> = {};
    for (const shape of SHAPES) {
        const row = runShape(shape);
        rows[shape.name] = { executeRunOnce: row.fromExecuteRunOnce, gitReplay: row.fromGitReplay };
        assert.equal(row.fromGitReplay, 0, shape.name);
        assert.equal(row.spawns, 0, shape.name);
        assert.equal(row.isMemoSame, true, shape.name);
    }
    console.table(rows);
});
