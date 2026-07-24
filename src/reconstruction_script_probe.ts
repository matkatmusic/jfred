// Script-execution replay, the target probes: which recorded run produced a given file's
// change, and whether an executed run provably touches a target. Split from
// reconstruction_script_runs.ts (task 192: that file sat at the 250-line cap); the memoized
// execution layer these probes drive stays there.

import { Path } from "./structures/domain.ts";
import type { TranscriptRecord } from "./structures/envelope.ts";
import { type BackupReader } from "./reconstruction_sidecar.ts";
import type { ScriptRun } from "./reconstruction_script_execution.ts";
import type { LineageContentBefore } from "./reconstruction_script_prestate.ts";
import { executeRunOnce } from "./reconstruction_script_runs.ts";

// The pre/post-state key that denotes `target`, or undefined when the run's sandbox never saw it.
export function refForTarget(target: Path, stateKeys: string[]): string | undefined {
    const targetStr = target.toString();
    return stateKeys.find((ref) => targetStr === ref || targetStr.endsWith(`/${ref}`));
}

// Whether executing the run shows `target` changed or created — the glob-agnostic gate for a
// script that finds its files (glob.glob) instead of naming them.
export function runTouchesTarget(
    run: ScriptRun,
    target: Path,
    records: TranscriptRecord[],
    reader: BackupReader,
    seedContent?: LineageContentBefore,
): boolean {
    const execution = executeRunOnce(run, records, reader, seedContent);
    if (execution.post === undefined) return false;
    const ref = refForTarget(target, [...execution.pre.keys(), ...execution.post.keys()]);
    if (ref === undefined) return false;
    const contentBefore = execution.pre.get(ref);
    const contentAfter = execution.post.get(ref);
    return contentAfter !== undefined && contentAfter !== contentBefore;
}

// The latest run at or before `when` whose source mentions `target`'s basename — or, when no run
// names it, the latest whose EXECUTION provably changes it. False positives are harmless — the
// forward test rejects them. Substring stays primary so existing scenarios keep their run selection.
export function runForTarget(
    runs: ScriptRun[],
    target: Path,
    when: Date,
    records: TranscriptRecord[],
    reader: BackupReader,
    seedContent?: LineageContentBefore,
): ScriptRun | undefined {
    const basename = target.toString().split("/").pop() ?? "";
    let chosen: ScriptRun | undefined;
    for (const run of runs) {
        if (run.timestamp.getTime() > when.getTime()) continue;
        if (run.code.includes(basename)) chosen = run;
    }
    if (chosen !== undefined) return chosen;
    for (const run of runs) {
        if (run.timestamp.getTime() > when.getTime()) continue;
        if (runTouchesTarget(run, target, records, reader, seedContent)) chosen = run;
    }
    return chosen;
}
