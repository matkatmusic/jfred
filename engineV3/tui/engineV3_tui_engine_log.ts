// The engine log of the terminal UI: every engine output line and one summary line per engine action.

import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { spawn } from "node:child_process";
import { Path } from "../../src/structures/domain.ts";
import { PlayOutcomeKind, StepProcessOutcomeKind } from "../../src/structures/vocabulary.ts";
import { getRelativePathInProject } from "../engineV3_inverse_repos_for_project.ts";
import { getProjectCacheFile } from "./engineV3_tui_project_cache.ts";
import { describeCrash } from "./engineV3_tui_walk_stop_text.ts";
import type { PlayOutcome, StepProcessOutcome, StepRequest } from "./engineV3_tui_walk_types.ts";

export const ENGINE_LOG_MEMORY_LINE_COUNT = 5000;
const ENGINE_LOG_FILE_NAME = "engine.log";
const CLOCK_LETTER_COUNT = 8;
const COMMIT_HASH_LETTER_COUNT = 8;

export enum EngineLogLineKind { Summary = "summary", Raw = "raw" }
export type EngineLogLine = { kind: EngineLogLineKind; text: string };

const FILE_PREFIX_BY_KIND: Record<EngineLogLineKind, string> = { [EngineLogLineKind.Summary]: "S ", [EngineLogLineKind.Raw]: "R " };

export type EngineLog = {
    appendRawLine(file: Path, text: string): void;
    appendSummaryLine(text: string): void;
    listLines(): EngineLogLine[];
};

export type LogForwarder = { write: (chunk: string) => void; flush: () => void };
const FORWARDER_THAT_DOES_NOTHING: LogForwarder = { write: () => {}, flush: () => {} };

// Splits the chunks of one stream into lines (a line may span chunks) and gives each non-empty line to the engine log.
// A carriage return ends a line too: the engine prints its progress as "\rC: 1/1 logs read".
export function createLogForwarder(logFile: Path | undefined, engineLog: EngineLog | undefined): LogForwarder {
    if (engineLog === undefined) {
        return FORWARDER_THAT_DOES_NOTHING;
    }
    if (logFile === undefined) {
        return FORWARDER_THAT_DOES_NOTHING;
    }
    let pendingText = "";
    return {
        write: (chunk) => {
            const lines = (pendingText + chunk).split(/\r?\n|\r/);
            pendingText = lines.pop()!;
            lines.filter((line) => line !== "").forEach((line) => engineLog.appendRawLine(logFile, line));
        },
        flush: () => {
            if (pendingText !== "") {
                engineLog.appendRawLine(logFile, pendingText);
            }
            pendingText = "";
        },
    };
}

// The log names a file by its path relative to the project folder.
export function getRelativeLogPath(projectFolder: Path, file: Path): Path {
    return new Path(getRelativePathInProject(projectFolder, file));
}

export function getEngineLogFile(storeFolder: Path): Path {
    return new Path(join(dirname(getProjectCacheFile(storeFolder).toString()), ENGINE_LOG_FILE_NAME));
}

export function createEngineLog(logFile: Path): EngineLog {
    mkdirSync(dirname(logFile.toString()), { recursive: true });
    const memoryLines: EngineLogLine[] = [];
    function appendLine(line: EngineLogLine): void {
        appendFileSync(logFile.toString(), `${FILE_PREFIX_BY_KIND[line.kind]}${line.text}\n`);
        memoryLines.push(line);
        if (memoryLines.length > ENGINE_LOG_MEMORY_LINE_COUNT) {
            memoryLines.shift();
        }
    }
    return {
        appendRawLine: (file, text) => appendLine({ kind: EngineLogLineKind.Raw, text: `[${file}] ${text}` }),
        appendSummaryLine: (text) => appendLine({ kind: EngineLogLineKind.Summary, text }),
        listLines: () => [...memoryLines],
    };
}

function formatClock(now: Date): string {
    return now.toTimeString().slice(0, CLOCK_LETTER_COUNT);
}

function formatTargetTime(startAt: Date): string {
    return startAt.toISOString().replace(/\.\d+Z$/, "Z");
}

function joinLines(text: string): string {
    return text.replaceAll("\n", " ");
}

export function describeStepSummary(now: Date, request: StepRequest, outcome: StepProcessOutcome): string {
    const prefix = `${formatClock(now)} walk  ${request.file}`;
    switch (outcome.kind) {
        case StepProcessOutcomeKind.Covered:
            return `${prefix} -> ${formatTargetTime(request.startAt)}  ${outcome.lastLine.commitsWritten} commits added`;
        case StepProcessOutcomeKind.Finished:
            return `${prefix}  finished (no older change)`;
        case StepProcessOutcomeKind.Stopped:
            return `${prefix}  stopped at ${outcome.eventType} (${outcome.lastLine.commit.slice(0, COMMIT_HASH_LETTER_COUNT)}:${outcome.lastLine.position})`;
        case StepProcessOutcomeKind.Crashed:
            return `${prefix}  CRASHED ${joinLines(describeCrash(outcome))}`;
    }
}

export function describePlaySummary(now: Date, file: Path, outcome: PlayOutcome): string {
    const prefix = `${formatClock(now)} play  ${file}`;
    switch (outcome.kind) {
        case PlayOutcomeKind.Replayed:
            return `${prefix}  replayed`;
        case PlayOutcomeKind.ReplayRefused:
            return `${prefix}  replay refused: ${outcome.reasonText}`;
        case PlayOutcomeKind.Crashed:
            return `${prefix}  CRASHED: ${outcome.reasonText}`;
    }
}

export function openFolderOfLogFile(logFile: Path): void {
    spawn("open", [dirname(logFile.toString())], { detached: true, stdio: "ignore" }).unref();
}
