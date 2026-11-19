// A screen drawn from a real inverse repo: shared by the tests of the View File box and the Engine Console box.

import { basename, join } from "node:path";
import { type TestContext } from "node:test";
import { createElement } from "react";
import { render } from "ink-testing-library";
import { Path } from "../src/structures/domain.ts";
import { FileEventType } from "../engineV3/engineV3_replay_reverse_events.ts";
import { createFileStep } from "../engineV3/engineV3_file_step.ts";
import { stepFileAndWriteCommit } from "../engineV3/engineV3_file_step_write.ts";
import { listInverseCommits } from "../engineV3/engineV3_inverse_repo.ts";
import { buildOnDemandInverseReposForFiles, createProjectEventsLoader, getInverseRepoFolderForFile } from "../engineV3/engineV3_inverse_repos_for_project.ts";
import { App } from "../engineV3/tui/engineV3_tui_app.tsx";
import type { AppProps } from "../engineV3/tui/engineV3_tui_app_types.ts";
import { listInverseRepoFileWire } from "../engineV3/tui/engineV3_tui_bars.ts";
import { loadKeyBoxes, loadKeymap } from "../engineV3/tui/engineV3_tui_keymap.ts";
import type { FileEventCounts, ProjectEventEntry } from "../engineV3/tui/engineV3_tui_project_cache.ts";
import { createWalkState } from "../engineV3/tui/engineV3_tui_walk_state.ts";
import { makeEditRows, makeInstant, writeProject, type Project } from "./engineV3_step_test_projects.ts";

const KEYMAP_FILE = new Path(join(import.meta.dirname, "..", "engineV3", "tui", "keymap.json"));
const DISK_NOW_INSTANT = new Date(Date.UTC(2026, 5, 1, 12, 0, 0));
const INK_SETTLE_MILLISECONDS = 150;
export const DOWN_ARROW = "\x1b[B";
export const RIGHT_ARROW = "\x1b[C";
export const LEFT_ARROW = "\x1b[D";

export function waitMilliseconds(milliseconds: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function throwBecauseNotExpected(): never {
    throw new Error("the screen called a function that this test does not expect");
}

// Disk text "three" and 59 more lines; Edit one to two at second 10, Edit two to three at second 20. isWalked false leaves the store empty.
export function writeLongProject(t: TestContext, isWalked: boolean): Project {
    const diskText = "three\n" + Array.from({ length: 59 }, (_, index) => `l${index + 2}`).join("\n") + "\n";
    const project = writeProject(t, diskText, (projectFolder, filePath) => [
        ...makeEditRows(projectFolder, "toolu_a", filePath, "one", "two", null, 10),
        ...makeEditRows(projectFolder, "toolu_b", filePath, "two", "three", null, 20),
    ]);
    if (isWalked) {
        const projectFiles = [{ file: project.file, transcriptFile: project.file }];
        buildOnDemandInverseReposForFiles(project.projectFolder, projectFiles, [project.jsonlsFolder], project.storeFolder, DISK_NOW_INSTANT, () => {});
        const events = createProjectEventsLoader(projectFiles, [project.jsonlsFolder], [project.snapshotFolder])(0);
        const repoFolder = getInverseRepoFolderForFile(project.storeFolder, project.projectFolder, project.file);
        const step = createFileStep(events, listInverseCommits(repoFolder, basename(project.file.toString()), true));
        for (let stepNumber = 0; stepNumber < 3; stepNumber++) {
            stepFileAndWriteCommit(repoFolder, basename(project.file.toString()), step, undefined);
        }
    }
    return project;
}

function makeZeroEventCounts(): FileEventCounts {
    const counts = {} as FileEventCounts;
    for (const eventType of Object.values(FileEventType)) {
        counts[eventType] = 0;
    }
    return counts;
}

export function makeAppProps(project: Project, overrides: Partial<AppProps> = {}): AppProps {
    const events: ProjectEventEntry[] = [
        { instant: makeInstant(20), file: project.file, eventType: FileEventType.EditRow, source: "toolu_b" },
        { instant: makeInstant(10), file: project.file, eventType: FileEventType.EditRow, source: "toolu_a" },
    ];
    return {
        terminalRows: 40,
        terminalColumns: 100,
        projectFolder: project.projectFolder,
        storeFolder: project.storeFolder,
        files: [project.file],
        events,
        countsByFile: new Map([[project.file.toString(), makeZeroEventCounts()]]),
        guessCategoryByFile: new Map(),
        keymap: loadKeymap(KEYMAP_FILE),
        keyBoxes: loadKeyBoxes(KEYMAP_FILE),
        walkState: createWalkState(),
        walker: { walkHistoryTo: () => true, handleOutcome: async () => {}, playScript: throwBecauseNotExpected },
        pool: { requestWalk: () => {}, requestPlay: throwBecauseNotExpected, cancelFile: async () => {}, cancelAll: async () => {}, stopStarting: () => {}, waitUntilIdle: async () => {}, listRunningFiles: () => [] },
        scriptCounts: { mayWrite: 0, readOnly: 0 },
        consentAnswers: { runScripts: undefined, runModifyingScriptsAutomatically: undefined },
        staleRepoCount: 0,
        cacheStatusText: undefined,
        subscribeToStatusChanges: () => () => {},
        loadFileWire: (file) => listInverseRepoFileWire(project.storeFolder, project.projectFolder, file),
        isTimeSpannedForFile: () => true,
        onConsentAnswered: () => {},
        onResetSelectedStores: async () => {},
        onResetAllStores: async () => {},
        onPlayScript: throwBecauseNotExpected,
        engineLog: { appendRawLine: () => {}, appendSummaryLine: () => {}, listLines: () => [] },
        openLogFolder: () => {},
        ...overrides,
    };
}

export async function startScreen(t: TestContext, project: Project, overrides: Partial<AppProps> = {}) {
    const screen = render(createElement(App, makeAppProps(project, overrides)));
    t.after(() => screen.unmount());
    await waitMilliseconds(INK_SETTLE_MILLISECONDS);
    return {
        frame: (): string => screen.lastFrame() ?? "",
        press: async (keys: string): Promise<void> => {
            screen.stdin.write(keys);
            await waitMilliseconds(INK_SETTLE_MILLISECONDS);
        },
    };
}
