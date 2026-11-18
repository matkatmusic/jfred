// The walker writes one summary line to the engine log for each walk outcome and each play outcome.

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { Path } from "../src/structures/domain.ts";
import { PlayOutcomeKind, ScriptAction, StepProcessOutcomeKind } from "../src/structures/vocabulary.ts";
import { FileEventType } from "../engineV3/engineV3_replay_reverse_events.ts";
import { EngineLogLineKind, createEngineLog, type EngineLog } from "../engineV3/tui/engineV3_tui_engine_log.ts";
import { createWalkState } from "../engineV3/tui/engineV3_tui_walk_state.ts";
import { createHistoryWalker } from "../engineV3/tui/engineV3_tui_walk.ts";
import type { HistoryWalker, StepRequest } from "../engineV3/tui/engineV3_tui_walk_types.ts";
import { makeInstant } from "./engineV3_step_test_projects.ts";

function makeWalker(t: TestContext, decideAction: ScriptAction): { walker: HistoryWalker; engineLog: EngineLog; file: Path; projectFolder: Path } {
    const rootFolder = mkdtempSync(join(tmpdir(), "engineV3-tui-walk-log-"));
    t.after(() => rmSync(rootFolder, { recursive: true, force: true }));
    const engineLog = createEngineLog(new Path(join(rootFolder, "engine.log")));
    const projectFolder = new Path(join(rootFolder, "project"));
    const walker = createHistoryWalker({
        storeFolder: new Path(join(rootFolder, "store")),
        projectFolder,
        walkState: createWalkState(),
        requestWalk: () => {},
        requestPlay: async () => ({ kind: PlayOutcomeKind.Replayed, reasonText: undefined }),
        decideScriptAction: () => decideAction,
        onStatusChange: () => {},
        playKeyName: "p",
        engineLog,
    });
    return { walker, engineLog, file: new Path(join(projectFolder.toString(), "a.txt")), projectFolder };
}

test("test_a_crashed_walk_writes_one_summary_line", async (t) => {
    // Scenario: a walk of a.txt to second 20 crashes.
    const { walker, engineLog, file, projectFolder } = makeWalker(t, ScriptAction.Refuse);
    const request: StepRequest = { file, startAt: makeInstant(20), isPassingStops: false };
    await walker.handleOutcome(request, { kind: StepProcessOutcomeKind.Crashed, exitCode: 1, signal: null, crashedAt: null, stderrTail: "boom" });
    // one summary line names walk, the project-relative file and CRASHED; the project folder is not in it.
    const lines = engineLog.listLines();
    assert.equal(lines.length, 1);
    assert.equal(lines[0]!.kind, EngineLogLineKind.Summary);
    assert.match(lines[0]!.text, /walk  a\.txt  CRASHED/);
    assert.ok(!lines[0]!.text.includes(projectFolder.toString()));
});

test("test_a_replayed_play_writes_one_summary_line", async (t) => {
    // Scenario: a walk stops at a script; the script is allowed to wait for the key; then the play key replays it.
    const { walker, engineLog, file, projectFolder } = makeWalker(t, ScriptAction.WaitForKey);
    const request: StepRequest = { file, startAt: makeInstant(20), isPassingStops: false };
    const stoppedOutcome = { kind: StepProcessOutcomeKind.Stopped, eventType: FileEventType.ScriptMayWrite, source: "toolu_x", lastLine: { commitsWritten: 0, commit: "abcdef123456", position: 1 } } as never;
    await walker.handleOutcome(request, stoppedOutcome);
    const summaryCountBeforePlay = engineLog.listLines().length;
    await walker.playScript(file, makeInstant(20));
    // the play adds one summary line that names play, the project-relative file and replayed; the project folder is not in it.
    const playLines = engineLog.listLines().slice(summaryCountBeforePlay);
    assert.equal(playLines.length, 1);
    assert.match(playLines[0]!.text, /play  a\.txt  replayed/);
    assert.ok(!playLines[0]!.text.includes(projectFolder.toString()));
});
