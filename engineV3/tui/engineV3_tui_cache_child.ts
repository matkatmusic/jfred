// The loading screen and the child process that builds the project cache while the TUI shows progress.

import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { Box, Text } from "ink";
import { createElement } from "react";
import { Path } from "../../src/structures/domain.ts";
import { Barbershop } from "./engineV3_tui_barbershop.tsx";
import { LegendFrame } from "./engineV3_tui_legend_frame.tsx";
import { getFlagArguments } from "./engineV3_tui_settings.ts";

export const BARBERSHOP_WIDTH = 30;

export function createLoadingScreen(progressText: string) {
    return createElement(LegendFrame, null, createElement(Box, { gap: 1 }, createElement(Text, null, progressText), createElement(Barbershop, { width: BARBERSHOP_WIDTH })));
}

export function runProjectCacheChild(jfredFolder: Path, showProgress: (progressText: string) => void): Promise<void> {
    // const cacheChildArguments = ["--import", "tsx", "engineV3/tui/engineV3_tui_project_cache_main.ts", ...process.argv.slice(2)];
    const cacheChildArguments = ["--import", "tsx", "engineV3/tui/engineV3_tui_project_cache_main.ts", ...getFlagArguments(process.argv.slice(2))];
    const child = spawn(process.execPath, cacheChildArguments, { cwd: jfredFolder.toString(), stdio: ["ignore", "ignore", "pipe"] });
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
            if (exitCode !== 0) {
                reject(new Error(`the project cache child exited with code ${exitCode}: ${standardErrorLines.slice(-20).join("\n")}`));
                return;
            }
            resolve();
        });
    });
}
