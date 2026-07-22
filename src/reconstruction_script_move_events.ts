// Sandbox-proven script moves as first-class rename events (task 155) — the third
// script-rename evidence channel. The two channels in reconstruction_script_renames.ts
// (printed `old -> new` stdout lines, two-string-literal move calls) both miss a
// glob-driven `shutil.move` that prints nothing (s85's move_files.py); there the only
// proof is the executed run's pre/post state diff (matchRenamePairs, task 143), which
// until now only rode the wire as ScriptRun.renamedPaths. Emitting the proven pair as a
// rename EVENT lets buildRenameChain merge the moved-away source's history into the
// destination — one.py's Write and the move land in core_one.py's ladder, and the source
// stops showing as an alive 1-revision history.

import { EventKind } from "./structures/vocabulary.ts";
import { Path } from "./structures/domain.ts";
import type { TranscriptRecord } from "./structures/envelope.ts";
import type { BackupReader } from "./reconstruction_sidecar.ts";
import type { FileEvent } from "./reconstruction_engine.ts";
import { isImpureExecutionAllowed } from "./reconstruction_exec_gate.ts";
import { resolveAgainstCwd } from "./structures/path-resolve.ts";
import {
    computeScriptExecutionChangeId,
    findScriptExecutionRuns,
    type ScriptRun,
} from "./reconstruction_script_execution.ts";
import { matchRenamePairs } from "./reconstruction_script_renames.ts";
import { executeRunOnce, selectRunsWithinReplayWindow } from "./reconstruction_script_runs.ts";
import type { LineageContentBefore } from "./reconstruction_script_prestate.ts";

// The `${from}|${to}` key of a rename pair, for deduping this channel against the
// stdout / code-literal channels (and against itself across runs).
function renamePairKeyOf(from: Path, to: Path): string {
    return `${from.toString()}|${to.toString()}`;
}

// Append one executed run's proven pairs as rename events, skipping every from/to pair an
// earlier channel (or an earlier run) already evidenced. The changeId is the deterministic
// run x SOURCE-path id: the destination already owns the run x destination id via its
// injected script-execution event, and a moved source never gets one (its post content is
// undefined), so the source-path id cannot collide. The timestamp is the run's tool_use
// instant, matching the same run's beaconless script-execution events so the rename and
// the destination content revision stay adjacent.
function appendPairsProvenByRun(
    run: ScriptRun,
    pre: Map<string, string>,
    post: Map<string, string>,
    knownPairKeys: Set<string>,
    appended: FileEvent[],
): void {
    for (const pair of matchRenamePairs(pre, post)) {
        const from = new Path(resolveAgainstCwd(run.cwd, new Path(pair.fromKey)));
        const to = new Path(resolveAgainstCwd(run.cwd, new Path(pair.toKey)));
        const pairKey = renamePairKeyOf(from, to);
        if (knownPairKeys.has(pairKey)) {
            continue;
        }
        knownPairKeys.add(pairKey);
        appended.push({
            kind: EventKind.rename,
            changeId: computeScriptExecutionChangeId(run, from),
            from,
            to,
            timestamp: run.timestamp,
        });
    }
}

// Append every sandbox-proven move as a rename event. Returns the input events unchanged
// on a declined build or readerless reconstruction — the source then stays a separate
// history, exactly as before this channel existed. Runs are window-filtered
// (selectRunsWithinReplayWindow) so a lineage replay in progress never re-enters its own
// in-flight execution (task 162 discipline).
export function appendScriptMoveRenames(
    events: FileEvent[],
    records: TranscriptRecord[],
    reader: BackupReader | undefined,
    seedContent?: LineageContentBefore,
): FileEvent[] {
    if (reader === undefined || !isImpureExecutionAllowed()) {
        return events;
    }
    const knownPairKeys = new Set<string>();
    for (const event of events) {
        if (event.kind === EventKind.rename) {
            knownPairKeys.add(renamePairKeyOf(event.from, event.to));
        }
    }
    const appended: FileEvent[] = [...events];
    for (const run of selectRunsWithinReplayWindow(findScriptExecutionRuns(records))) {
        const execution = executeRunOnce(run, records, reader, seedContent);
        if (execution.post === undefined) {
            continue;
        }
        appendPairsProvenByRun(run, execution.pre, execution.post, knownPairKeys, appended);
    }
    return appended;
}
