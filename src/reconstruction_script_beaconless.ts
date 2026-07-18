// Beaconless script-execution detection, split from reconstruction_script_stage.ts (task 115).
// When a script modifies a file but no user-edit beacon echoes the result, the modification is
// detected by running the script forward; runs CHAIN through the target's rolling content.

import { EventKind } from "./structures/vocabulary.ts";
import { Path } from "./structures/domain.ts";
import type { TranscriptRecord } from "./structures/envelope.ts";
import type { BackupReader } from "./reconstruction_sidecar.ts";
import {
    computeScriptExecutionChangeId,
    formatRunSource,
    type ScriptExecutionEvent,
    type ScriptRun,
} from "./reconstruction_script_execution.ts";
import { scriptCodeMayWriteFiles, type LineageContentBefore } from "./reconstruction_script_prestate.ts";
import { runScriptAgainstState } from "./reconstruction_script_sandbox.ts";
import {
    executeRunOnce,
    refForTarget,
    runTouchesTarget,
} from "./reconstruction_script_runs.ts";

// The target's known state on its chained lineage: the sandbox key it lives under and its content
// after the last injected run.
type RollingTargetState = { key: string; content: string };

// The post-execution content of `target` after `run`, or undefined when the run doesn't change it.
// With no rolling state this is the direct gate (the run names the target or provably touches it);
// with rolling state the run is re-executed against a sandbox seeded with the target's current
// content — a script-born file never appears in the run's own cached pre-state (s85's glob rename).
function runOutcomeForTarget(
    run: ScriptRun,
    target: Path,
    records: TranscriptRecord[],
    reader: BackupReader,
    seedContent: LineageContentBefore | undefined,
    rolling: RollingTargetState | undefined,
): RollingTargetState | undefined {
    // Item 68: a read-only run can never produce an outcome; bail before any sandbox work
    // (the rolling branch below would otherwise spawn a sandbox per chained run).
    if (!scriptCodeMayWriteFiles(run.code)) return undefined;
    if (rolling === undefined) {
        const basename = target.toString().split("/").pop() ?? "";
        if (!run.code.includes(basename) && !runTouchesTarget(run, target, records, reader, seedContent)) {
            return undefined;
        }
        const { pre: preState, post: postState } = executeRunOnce(run, records, reader, seedContent);
        if (postState === undefined) return undefined;
        // post keys included so a file the script CREATES resolves to its ref.
        const ref = refForTarget(target, [...preState.keys(), ...postState.keys()]);
        if (ref === undefined) return undefined;
        const pre = preState.get(ref);
        const post = postState.get(ref);
        // An undefined pre with a defined post is a legitimate birth.
        if (post === undefined || pre === post) return undefined;
        return { key: ref, content: post };
    }
    const { pre: preState } = executeRunOnce(run, records, reader, seedContent);
    const augmentedPre = new Map(preState);
    augmentedPre.set(rolling.key, rolling.content);
    const postState = runScriptAgainstState(run.code, augmentedPre, formatRunSource(run), run.cwd);
    if (postState === undefined) return undefined;
    const content = postState.get(rolling.key);
    if (content === undefined || content === rolling.content) return undefined;
    return { key: rolling.key, content };
}

// When a script modifies a file but no user-edit beacon echoes the result (e.g. multi-session
// baseline+main where the baseline Write predates the script run), detect the modification by
// running the script and inject a ScriptExecutionEvent directly. Runs CHAIN: once one run births
// or changes the target, every later run is executed against the target's rolling content, so a
// move-then-rename pair yields two events even though the rename never names the born file.
export function beaconlessScriptExecutions(
    target: Path,
    runs: ScriptRun[],
    records: TranscriptRecord[],
    reader: BackupReader,
    seedContent?: LineageContentBefore,
): ScriptExecutionEvent[] {
    const events: ScriptExecutionEvent[] = [];
    let rolling: RollingTargetState | undefined;
    for (const run of runs) {
        const outcome = runOutcomeForTarget(run, target, records, reader, seedContent, rolling);
        if (outcome === undefined) continue;
        events.push({
            kind: EventKind.scriptExecution,
            changeId: computeScriptExecutionChangeId(run, target),
            target,
            content: outcome.content,
            timestamp: run.timestamp,
        });
        rolling = outcome;
    }
    return events;
}
