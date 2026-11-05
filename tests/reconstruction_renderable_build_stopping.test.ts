// EarlierRunNotSavedError must reach the caller of getFileRevisionsOver and getFileHistoriesOver, not become an empty history.

import { test } from "node:test";
import assert from "node:assert/strict";
import { getFileRevisionsOver } from "../src/reconstruction_branches.ts";
import { executeWithImpureExecution } from "../src/reconstruction_exec_gate.ts";
import { getReconstructionCounterSnapshot, resetReconstructionCounters } from "../src/reconstruction_counters.ts";
import { clearReconstructionFailures, popReconstructionFailures } from "../src/reconstruction_health.ts";
import { getFileHistoriesOver } from "../src/reconstruction_renderable.ts";
import { setSandboxMemoPersistence } from "../src/reconstruction_script_sandbox_memo.ts";
import { EarlierRunNotSavedError, executeWithoutSpawning } from "../src/reconstruction_script_sandbox_spawn_guard.ts";
import type { BackupReader } from "../src/reconstruction_sidecar.ts";
import { Path } from "../src/structures/domain.ts";
import type { TranscriptRecord } from "../src/structures/envelope.ts";
import { BlockType, RecordType, ToolName } from "../src/structures/vocabulary.ts";

const emptyReader: BackupReader = () => "";
const SCRIPT = 'text = open("a.txt").read()\nopen("a.txt", "w").write(text + "z\\n")\n';

function buildToolRecord(name: ToolName, input: Record<string, unknown>, second: number, id: string): TranscriptRecord {
    const timestamp = new Date(Date.UTC(2026, 0, 1, 0, 0, second));
    const block = { type: BlockType.tool_use, id, name, input, caller: { type: "direct" } };
    return { type: RecordType.assistant, timestamp, cwd: new Path("/proj"), message: { content: [block] } } as unknown as TranscriptRecord;
}

// A Write of a.txt, then a script run that rewrites it: the run's result is not in the memo.
function buildRecords(): TranscriptRecord[] {
    return [
        buildToolRecord(ToolName.Write, { file_path: "/proj/a.txt", content: "a\n" }, 1, "toolu_w"),
        buildToolRecord(ToolName.CtxExecute, { cwd: "/proj", code: SCRIPT }, 5, "toolu_s"),
    ];
}

function resetBuildState(): void {
    setSandboxMemoPersistence(undefined);
    resetReconstructionCounters();
    clearReconstructionFailures();
}

test("test_getFileRevisionsOver_lets_EarlierRunNotSavedError_reach_the_caller", () => {
    resetBuildState();
    const build = () => getFileRevisionsOver(buildRecords(), new Path("/proj/a.txt"), new Set(), emptyReader);
    assert.throws(() => executeWithImpureExecution(() => executeWithoutSpawning(new Set(), build)), EarlierRunNotSavedError);
    assert.equal(getReconstructionCounterSnapshot().sandboxSpawns, 0);
    assert.equal(popReconstructionFailures().length, 0);
});

test("test_getFileHistoriesOver_lets_EarlierRunNotSavedError_reach_the_caller_and_notes_no_failure", () => {
    resetBuildState();
    const build = () => getFileHistoriesOver(buildRecords(), emptyReader);
    assert.throws(() => executeWithImpureExecution(() => executeWithoutSpawning(new Set(), build)), EarlierRunNotSavedError);
    assert.equal(getReconstructionCounterSnapshot().sandboxSpawns, 0);
    assert.equal(popReconstructionFailures().length, 0);
});
