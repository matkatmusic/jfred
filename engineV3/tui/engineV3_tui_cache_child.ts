// The loading screen and the child process that builds the project cache while the TUI shows progress.

import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
// import { Box, Text } from "ink";
import { createElement } from "react";
import { Path } from "../../src/structures/domain.ts";
// import { Barbershop } from "./engineV3_tui_barbershop.tsx";
// import { LegendFrame } from "./engineV3_tui_legend_frame.tsx";
import { createLogForwarder, describeLoadStepSummary, LoadStepPhase, type EngineLog } from "./engineV3_tui_engine_log.ts";
import { LoadingScreen } from "./engineV3_tui_loading_screen.tsx";
import { getFlagArguments } from "./engineV3_tui_settings.ts";

// export const BARBERSHOP_WIDTH = 30;
const PROJECT_CACHE_STEP_NAME = "project cache";
const PROJECT_CACHE_LOG_NAME = new Path(PROJECT_CACHE_STEP_NAME);

// export function createLoadingScreen(progressText: string) {
//     return createElement(LegendFrame, null, createElement(Box, { gap: 1 }, createElement(Text, null, progressText), createElement(Barbershop, { width: BARBERSHOP_WIDTH })));
// }
export function createLoadingScreen(progressText: string, engineLog: EngineLog) {
    return createElement(LoadingScreen, { progressText, engineLog, startSize: { terminalRows: process.stdout.rows, terminalColumns: process.stdout.columns } });
}

export type ProjectCacheProcessHandlers = { showProgress: (progressText: string) => void; engineLog: EngineLog; onLogChanged: () => void };

export function runProjectCacheProcess(command: string, childArguments: string[], workingFolder: string, handlers: ProjectCacheProcessHandlers): Promise<void> {
    const { showProgress, engineLog, onLogChanged } = handlers;
    const notifyingLog: EngineLog = {
        // appendRawLine: (file, text) => { engineLog.appendRawLine(file, text); onLogChanged(); },
        appendRawLine: (file, text) => {
            // the JSON lines (progress per file, result) are shown as the "files done" text, not as console lines.
            if (!text.startsWith("{")) {
                engineLog.appendRawLine(file, text);
                onLogChanged();
            }
        },
        appendSummaryLine: (text) => { engineLog.appendSummaryLine(text); onLogChanged(); },
        listLines: engineLog.listLines,
    };
    notifyingLog.appendSummaryLine(describeLoadStepSummary(new Date(), PROJECT_CACHE_STEP_NAME, LoadStepPhase.Started));
    const child = spawn(command, childArguments, { cwd: workingFolder, stdio: ["ignore", "pipe", "pipe"] });
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    const standardOutputForwarder = createLogForwarder(PROJECT_CACHE_LOG_NAME, notifyingLog);
    const standardErrorForwarder = createLogForwarder(PROJECT_CACHE_LOG_NAME, notifyingLog);
    child.stdout.on("data", standardOutputForwarder.write);
    child.stderr.on("data", standardErrorForwarder.write);
    const standardErrorLines: string[] = [];
    createInterface({ input: child.stderr }).on("line", (line) => {
        standardErrorLines.push(line);
        if (line.startsWith("{")) {
            const progress = JSON.parse(line) as { current: number; total: number };
            showProgress(`files done ${progress.current} of ${progress.total}`);
        }
    });
    return new Promise((resolve, reject) => {
        child.once("close", (exitCode) => {
            standardOutputForwarder.flush();
            standardErrorForwarder.flush();
            notifyingLog.appendSummaryLine(describeLoadStepSummary(new Date(), PROJECT_CACHE_STEP_NAME, LoadStepPhase.Ended));
            if (exitCode !== 0) {
                reject(new Error(`the project cache child exited with code ${exitCode}: ${standardErrorLines.slice(-20).join("\n")}`));
                return;
            }
            resolve();
        });
    });
}

// export function runProjectCacheChild(jfredFolder: Path, showProgress: (progressText: string) => void): Promise<void> {
export function runProjectCacheChild(jfredFolder: Path, handlers: ProjectCacheProcessHandlers): Promise<void> {
    // const cacheChildArguments = ["--import", "tsx", "engineV3/tui/engineV3_tui_project_cache_main.ts", ...process.argv.slice(2)];
    const cacheChildArguments = ["--import", "tsx", "engineV3/tui/engineV3_tui_project_cache_main.ts", ...getFlagArguments(process.argv.slice(2))];
    return runProjectCacheProcess(process.execPath, cacheChildArguments, jfredFolder.toString(), handlers);
}
