// Builds the props of the root component from the pieces that jfredTUI creates.

import type { Path } from "../../src/structures/domain.ts";
import { isInstantSpannedByWalkCoverage, type WalkCoverage } from "../engineV3_walk_coverage.ts";
import type { AppProps } from "./engineV3_tui_app_types.ts";
import { listInverseRepoFileWire } from "./engineV3_tui_bars.ts";
import type { readProjectCache } from "./engineV3_tui_project_cache.ts";

export type AppPropsInput = Pick<AppProps, "projectFolder" | "storeFolder" | "keymap" | "keyBoxes" | "engineLog" | "openLogFolder" | "walkState" | "walker" | "pool" | "consentAnswers" | "staleRepoCount" | "subscribeToStatusChanges" | "onResetSelectedStores" | "onResetAllStores"> & {
    cache: ReturnType<typeof readProjectCache>;
    readCoverageOfFile: (file: Path) => WalkCoverage | undefined;
    consentGate: { notifyAnswerGiven: () => void };
};

export function createAppProps(input: AppPropsInput): AppProps {
    const { cache, readCoverageOfFile, consentGate, ...passedProps } = input;
    return {
        terminalRows: process.stdout.rows,
        terminalColumns: process.stdout.columns,
        ...passedProps,
        files: cache.projectFiles,
        events: cache.events,
        countsByFile: cache.countsByFile,
        scriptCounts: cache.scriptCounts,
        cacheStatusText: undefined,
        loadFileWire: (file) => listInverseRepoFileWire(input.storeFolder, input.projectFolder, file),
        isTimeSpannedForFile: (file, instant) => {
            const coverage = readCoverageOfFile(file);
            if (coverage === undefined) {
                return false;
            }
            return isInstantSpannedByWalkCoverage(coverage, instant);
        },
        onConsentAnswered: (answerKey, answer) => {
            input.consentAnswers[answerKey] = answer;
            consentGate.notifyAnswerGiven();
        },
        // onPlayScript: (file) => pool.requestPlay({ file }, listWalkToEndFiles(file)),
        onPlayScript: (file, startAt) => input.walker.playScript(file, startAt),
    };
}
