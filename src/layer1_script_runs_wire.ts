// Task l4-wire-real: located script runs join to pairs by the static path scan and shape into the /api/layer1-script-runs wire view.

import { WireScriptExecutorIcon, WireScriptExecutorKind, type WireScriptRunOf, type WireScriptRunsViewOf } from "../webapp/layer1-wire.ts";
import { walkCurrentFileState } from "./layer1_disk_walk.ts";
import { loadTranscript, type ProgressSink } from "./parse/loadTranscript.ts";
import { ScriptExecutorKind, findScriptExecutionRuns, type ScriptRun } from "./reconstruction_script_execution.ts";
import { affectedPathsForRun } from "./reconstruction_script_probe.ts";
import { scriptCodeMayWriteFiles } from "./reconstruction_script_prestate.ts";
import { findSessionId } from "./reconstruction_sidecar_reader.ts";
import { Path, Uuid } from "./structures/domain.ts";
import { DocumentResponseKind } from "./structures/vocabulary_views.ts";

// Named so tests assert the same string the route emits.
export const LAYER1_PROGRESS_LABEL_READING_SCRIPT_RUNS = "reading script runs";

export type Layer1WireScriptRunsView = WireScriptRunsViewOf<Date, Path, Uuid>;
type WireScriptRunWithoutAxis = Omit<WireScriptRunOf<Date, Path, Uuid>, "axisPx">;

// An absent kind executes like python (src/reconstruction_script_execution.ts ScriptRun).
function mapToWireExecutorKind(kind: ScriptExecutorKind | undefined): WireScriptExecutorKind {
    return kind === ScriptExecutorKind.bash ? WireScriptExecutorKind.bash : WireScriptExecutorKind.python;
}

function buildWireScriptRun(run: ScriptRun, sessionId: Uuid, sessionFile: Path): WireScriptRunWithoutAxis {
    if (run.toolUseId === undefined) {
        throw new Error(`script run at ${run.timestamp.toISOString()} in ${sessionFile.toString()} has no tool_use id`);
    }
    const executorKind = mapToWireExecutorKind(run.executorKind);
    return {
        instant: run.timestamp,
        toolUseId: run.toolUseId,
        executorKind,
        code: run.code,
        // An absent label must stay absent: a `label: undefined` KEY differs under deep equality.
        ...(run.invokedScriptFile === undefined ? {} : { label: `${WireScriptExecutorIcon[executorKind]} ${run.invokedScriptFile}` }),
        sessionId,
        sessionFile,
    };
}

// Sessions run in lexical order and the first entry per pair and tool_use id stands: a resumed session repeats its parent's runs.
export function buildScriptRunsView(
    projectFolder: Path,
    sessionFiles: readonly Path[],
    reportProgress: ProgressSink = () => {},
): Layer1WireScriptRunsView {
    const candidatePaths = walkCurrentFileState(projectFolder).map((file) => file.relativePath);
    const runsByPath = new Map<string, Map<string, WireScriptRunWithoutAxis>>();
    const orderedSessionFiles = [...sessionFiles].sort((left, right) => left.toString().localeCompare(right.toString()));
    orderedSessionFiles.forEach((sessionFile, index) => {
        reportProgress({
            kind: DocumentResponseKind.progress,
            label: LAYER1_PROGRESS_LABEL_READING_SCRIPT_RUNS,
            current: index + 1,
            total: orderedSessionFiles.length,
        });
        const { records } = loadTranscript(sessionFile.toString(), undefined, true);
        const sessionId = findSessionId(records);
        if (sessionId === undefined) {
            throw new Error(`no session id in ${sessionFile.toString()}`);
        }
        for (const run of findScriptExecutionRuns(records).filter((candidate) => scriptCodeMayWriteFiles(candidate.code))) {
            const wireRun = buildWireScriptRun(run, sessionId, sessionFile);
            for (const path of affectedPathsForRun(run, candidatePaths)) {
                const runsByToolUseId = runsByPath.get(path.toString()) ?? new Map<string, WireScriptRunWithoutAxis>();
                runsByPath.set(path.toString(), runsByToolUseId);
                if (!runsByToolUseId.has(wireRun.toolUseId.toString())) {
                    runsByToolUseId.set(wireRun.toolUseId.toString(), wireRun);
                }
            }
        }
    });
    return {
        pairs: [...runsByPath].map(([path, runsByToolUseId]) => ({
            path: new Path(path),
            scriptRuns: [...runsByToolUseId.values()].sort((left, right) => left.instant.getTime() - right.instant.getTime()),
        })),
    };
}
