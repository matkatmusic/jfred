// Screen tests of the terminal UI root component (plan Stage B8): what the frame shows.

import assert from "node:assert/strict";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { createElement } from "react";
import { render } from "ink-testing-library";
import { Path } from "../src/structures/domain.ts";
import { FileWalkStatus, TuiCommand } from "../src/structures/vocabulary.ts";
import { FileEventType } from "../engineV3/engineV3_replay_reverse_events.ts";
import { App } from "../engineV3/tui/engineV3_tui_app.tsx";
import type { AppProps } from "../engineV3/tui/engineV3_tui_app_types.ts";
import { formatKeyBinding, loadKeymap, type Keymap } from "../engineV3/tui/engineV3_tui_keymap.ts";
import type { FileEventCounts, ProjectEventEntry } from "../engineV3/tui/engineV3_tui_project_cache.ts";
import { ROW_MARKS } from "../engineV3/tui/engineV3_tui_row.tsx";
import { createWalkState, setFileRunState, type FileRunState, type WalkState } from "../engineV3/tui/engineV3_tui_walk_state.ts";
import type { HistoryWalker, StepPool, StepRequest } from "../engineV3/tui/engineV3_tui_walk_types.ts";
import type { InverseCommitWire, InverseRepoFileWire } from "../webapp/layer1-components/bars-view/layer1-bars-wire.ts";
import { makeInstant } from "./engineV3_step_test_projects.ts";

const PROJECT_FOLDER_TEXT = "/made-up-project-folder-for-tui-app-test";
const KEYMAP_FILE = new Path(join(import.meta.dirname, "..", "engineV3", "tui", "keymap.json"));
const FILE_COUNT = 50;
const SECONDS_PER_DAY = 86_400;
const MILLISECONDS_PER_DAY = 86_400_000;
const NEWEST_EVENT_DAY = 30;
const SETTLE_MILLISECONDS = 50;
const DOWN_ARROW = "\x1b[B";
const RIGHT_ARROW = "\x1b[C";
const LEFT_ARROW = "\x1b[D";
const SHIFT_RIGHT_ARROW = "\x1b[1;2C";

type AppHarness = {
    props: AppProps;
    files: Path[];
    walkState: WalkState;
    walkHistoryToCalls: { currentTime: Date; file: Path; isVisible: boolean }[];
    requestWalkCalls: StepRequest[];
    notifyStatusChange: () => void;
};

function settle(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, SETTLE_MILLISECONDS));
}

function makeFileName(index: number): string {
    return `f${String(index).padStart(2, "0")}.txt`;
}

function makeFiles(): Path[] {
    const files: Path[] = [];
    for (let index = 0; index < FILE_COUNT; index++) {
        files.push(new Path(`${PROJECT_FOLDER_TEXT}/${makeFileName(index)}`));
    }
    return files;
}

// One event for each day, newest first: day 30 down to day 0, so the events span 30 days.
function makeEvents(files: Path[]): ProjectEventEntry[] {
    const events: ProjectEventEntry[] = [];
    for (let day = NEWEST_EVENT_DAY; day >= 0; day--) {
        const file = files[day % files.length]!;
        events.push({ instant: makeInstant(day * SECONDS_PER_DAY), file, eventType: FileEventType.EditRow, source: null });
    }
    return events;
}

function makeZeroCounts(): FileEventCounts {
    const counts = {} as FileEventCounts;
    for (const eventType of Object.values(FileEventType)) {
        counts[eventType] = 0;
    }
    return counts;
}

function makeCountsByFile(files: Path[]): Map<string, FileEventCounts> {
    const countsByFile = new Map<string, FileEventCounts>();
    for (const file of files) {
        countsByFile.set(file.toString(), makeZeroCounts());
    }
    return countsByFile;
}

function makeCommitWire(eventType: FileEventType, instant: Date | null): InverseCommitWire {
    return {
        commitHash: "hash0",
        treeHash: "tree0",
        eventType,
        moment: "at-event",
        confidence: "proven",
        position: 0,
        instant: instant === null ? null : instant.toISOString(),
        readerInstant: instant === null ? null : instant.toISOString(),
        isFileAbsent: false,
        isRemoved: false,
        movedAwayTo: null,
    };
}

// A file with one disk-now commit.
function makeDiskNowWire(file: Path): InverseRepoFileWire {
    return { file: file.toString().replace(`${PROJECT_FOLDER_TEXT}/`, ""), commits: [makeCommitWire(FileEventType.DiskNow, null)] };
}

// A file whose single commit is its birth, at the given instant.
function makeBornWire(file: Path, bornInstant: Date): InverseRepoFileWire {
    return { file: file.toString().replace(`${PROJECT_FOLDER_TEXT}/`, ""), commits: [makeCommitWire(FileEventType.WriteRow, bornInstant)] };
}

function makeRunState(status: FileWalkStatus, reasonText: string | undefined): FileRunState {
    return { status, reasonText, failedReplayCount: 0 };
}

function makeFailingPool(requestWalkCalls: StepRequest[]): StepPool {
    return {
        requestWalk: (request) => {
            requestWalkCalls.push(request);
        },
        requestPlay: () => {
            throw new Error("unexpected pool.requestPlay");
        },
        cancelFile: () => {
            throw new Error("unexpected pool.cancelFile");
        },
        cancelAll: () => {
            throw new Error("unexpected pool.cancelAll");
        },
        stopStarting: () => {
            throw new Error("unexpected pool.stopStarting");
        },
        waitUntilIdle: () => {
            throw new Error("unexpected pool.waitUntilIdle");
        },
        listRunningFiles: () => {
            throw new Error("unexpected pool.listRunningFiles");
        },
    };
}

// A pool whose child never answers: every promise it returns stays pending.
function makeNeverAnsweringPool(requestWalkCalls: StepRequest[]): StepPool {
    const neverAnswer = <Answer>(): Promise<Answer> => new Promise<Answer>(() => {});
    return {
        requestWalk: (request) => {
            requestWalkCalls.push(request);
        },
        requestPlay: () => neverAnswer(),
        cancelFile: () => neverAnswer(),
        cancelAll: () => neverAnswer(),
        stopStarting: () => {},
        waitUntilIdle: () => neverAnswer(),
        listRunningFiles: () => [],
    };
}

function makeAppProps(overrides: Partial<AppProps>): AppHarness {
    const files = makeFiles();
    const walkState = createWalkState();
    const listeners: (() => void)[] = [];
    const walkHistoryToCalls: AppHarness["walkHistoryToCalls"] = [];
    const requestWalkCalls: StepRequest[] = [];
    const walker: HistoryWalker = {
        walkHistoryTo: (currentTime, file, isVisible) => {
            walkHistoryToCalls.push({ currentTime, file, isVisible });
            return true;
        },
        handleOutcome: () => {
            throw new Error("unexpected walker.handleOutcome");
        },
    };
    const props: AppProps = {
        terminalRows: 10,
        projectFolder: new Path(PROJECT_FOLDER_TEXT),
        storeFolder: new Path("/made-up-store-folder-for-tui-app-test"),
        files,
        events: makeEvents(files),
        countsByFile: makeCountsByFile(files),
        keymap: loadKeymap(KEYMAP_FILE),
        walkState,
        walker,
        pool: makeFailingPool(requestWalkCalls),
        scriptCounts: { mayWrite: 0, readOnly: 0 },
        consentAnswers: { runScripts: false, runModifyingScriptsAutomatically: false },
        staleRepoCount: 0,
        cacheStatusText: undefined,
        subscribeToStatusChanges: (listener) => {
            listeners.push(listener);
            return () => {
                listeners.splice(listeners.indexOf(listener), 1);
            };
        },
        loadFileWire: (file) => makeDiskNowWire(file),
        isTimeSpannedForFile: () => true,
        onConsentAnswered: () => {},
        onResetSelectedStores: async () => {},
        onResetAllStores: async () => {},
        onPlayScript: () => {
            throw new Error("unexpected onPlayScript");
        },
        ...overrides,
    };
    const notifyStatusChange = (): void => {
        for (const listener of [...listeners]) {
            listener();
        }
    };
    return { props, files, walkState, walkHistoryToCalls, requestWalkCalls, notifyStatusChange };
}

type ScreenHandle = { readFrameLines: () => string[]; stdin: { write: (data: string) => void } };

function startScreen(t: TestContext, props: AppProps): ScreenHandle {
    const { lastFrame, stdin, unmount } = render(createElement(App, props));
    t.after(() => unmount());
    const readFrameLines = (): string[] => {
        const frame = lastFrame() ?? "";
        return frame.replace(/\x1b\[[0-9;]*m/g, "").split("\n");
    };
    return { readFrameLines, stdin };
}

function findRowLine(lines: string[], fileName: string): string {
    const rowLine = lines.find((line) => line.includes(fileName));
    assert.notEqual(rowLine, undefined, `no row shows ${fileName}`);
    return rowLine as string;
}

function getHeaderRow(lines: string[]): string {
    return lines[0]!;
}

function getInfoRow(lines: string[]): string {
    return lines[lines.length - 2]!;
}

function getMenuRow(lines: string[]): string {
    return lines[lines.length - 1]!;
}

function readMarkerInstantFromHeader(lines: string[]): Date {
    const headerMatch = /marker (\d{4}-\d\d-\d\dT[\d:.]+Z)/.exec(getHeaderRow(lines));
    assert.notEqual(headerMatch, null, `the header shows no marker time: ${getHeaderRow(lines)}`);
    return new Date((headerMatch as RegExpExecArray)[1]!);
}

function readOwnTimeFromInfoRow(lines: string[]): Date {
    const infoMatch = /own time (\d{4}-\d\d-\d\dT[\d:.]+Z)/.exec(getInfoRow(lines));
    assert.notEqual(infoMatch, null, `the info row shows no own time: ${getInfoRow(lines)}`);
    return new Date((infoMatch as RegExpExecArray)[1]!);
}

test("test_screen_draws_only_the_visible_file_names", async (t) => {
    // Scenario: 50 files and a terminal of 10 rows: 1 header row, 7 file rows, 1 info row, 1 menu row.
    const harness = makeAppProps({});
    // Draw the screen.
    const screen = startScreen(t, harness.props);
    await settle();
    // The frame holds the names f00 to f06.
    const frameText = screen.readFrameLines().join("\n");
    for (let index = 0; index < 7; index++) {
        assert.ok(frameText.includes(makeFileName(index)), `${makeFileName(index)} is missing`);
    }
    // The frame does not hold the 8th name, nor the last name.
    assert.ok(!frameText.includes(makeFileName(7)));
    assert.ok(!frameText.includes(makeFileName(49)));
});

test("test_a_running_row_shows_the_barbershop_and_a_finished_row_shows_its_dots", async (t) => {
    // Scenario: file f00 is Running, file f01 is Idle.
    const harness = makeAppProps({});
    const screen = startScreen(t, harness.props);
    await settle();
    // Set f00 to Running and tell the screen that the walk state changed.
    setFileRunState(harness.walkState, harness.files[0]!, makeRunState(FileWalkStatus.Running, undefined));
    harness.notifyStatusChange();
    await settle();
    const lines = screen.readFrameLines();
    // The f00 row has the Running mark, and not the Idle mark.
    const runningRow = findRowLine(lines, makeFileName(0));
    assert.ok(runningRow.includes(ROW_MARKS[FileWalkStatus.Running]));
    assert.ok(!runningRow.includes(ROW_MARKS[FileWalkStatus.Idle]));
    // The f01 row has the Idle mark, and not the Running mark.
    const finishedRow = findRowLine(lines, makeFileName(1));
    assert.ok(finishedRow.includes(ROW_MARKS[FileWalkStatus.Idle]));
    assert.ok(!finishedRow.includes(ROW_MARKS[FileWalkStatus.Running]));
});

test("test_two_rows_can_show_the_barbershop_at_the_same_time", async (t) => {
    // Scenario: files f00 and f01 are both Running, file f02 is Idle.
    const harness = makeAppProps({});
    const screen = startScreen(t, harness.props);
    await settle();
    setFileRunState(harness.walkState, harness.files[0]!, makeRunState(FileWalkStatus.Running, undefined));
    setFileRunState(harness.walkState, harness.files[1]!, makeRunState(FileWalkStatus.Running, undefined));
    harness.notifyStatusChange();
    await settle();
    const lines = screen.readFrameLines();
    // Both running rows have the Running mark in the same frame.
    assert.ok(findRowLine(lines, makeFileName(0)).includes(ROW_MARKS[FileWalkStatus.Running]));
    assert.ok(findRowLine(lines, makeFileName(1)).includes(ROW_MARKS[FileWalkStatus.Running]));
    // The Idle row has the Idle mark and no Running mark.
    const idleRow = findRowLine(lines, makeFileName(2));
    assert.ok(idleRow.includes(ROW_MARKS[FileWalkStatus.Idle]));
    assert.ok(!idleRow.includes(ROW_MARKS[FileWalkStatus.Running]));
});

test("test_the_menu_row_shows_the_keys_of_the_keymap_file", async (t) => {
    // Scenario: the keymap file is loaded, then the key of PlayScript is changed to x in memory.
    const keymap: Keymap = loadKeymap(KEYMAP_FILE);
    keymap.set(TuiCommand.PlayScript, { input: "x" });
    const harness = makeAppProps({ keymap });
    const screen = startScreen(t, harness.props);
    await settle();
    const menuRow = getMenuRow(screen.readFrameLines());
    // The menu row shows x.
    assert.ok(menuRow.includes("x"));
    // The menu row shows every key of the keymap, joined by two spaces, in the order of the keymap.
    const keysText = [...keymap.values()].map(formatKeyBinding).join("  ");
    assert.ok(menuRow.includes(keysText), `menu row: ${menuRow}`);
});

test("test_the_info_row_shows_the_error_of_a_crashed_file", async (t) => {
    // Scenario: the file under the cursor (f00) is Crashed with a reason text.
    const harness = makeAppProps({});
    setFileRunState(harness.walkState, harness.files[0]!, makeRunState(FileWalkStatus.Crashed, "reason-of-f00"));
    const screen = startScreen(t, harness.props);
    await settle();
    const lines = screen.readFrameLines();
    // The info row shows the reason text.
    assert.ok(getInfoRow(lines).includes("reason-of-f00"), `info row: ${getInfoRow(lines)}`);
    // The row of f00 has the Crashed mark.
    assert.ok(findRowLine(lines, makeFileName(0)).includes(ROW_MARKS[FileWalkStatus.Crashed]));
});

test("test_the_ui_does_not_wait_for_a_running_child", async (t) => {
    // Scenario: the pool never answers. Files f00 and f01 are Crashed with different reason texts.
    const requestWalkCalls: StepRequest[] = [];
    const harness = makeAppProps({ pool: makeNeverAnsweringPool(requestWalkCalls) });
    setFileRunState(harness.walkState, harness.files[0]!, makeRunState(FileWalkStatus.Crashed, "reason-of-f00"));
    setFileRunState(harness.walkState, harness.files[1]!, makeRunState(FileWalkStatus.Crashed, "reason-of-f01"));
    const screen = startScreen(t, harness.props);
    await settle();
    // The cursor is on f00: the info row shows the reason of f00.
    assert.ok(getInfoRow(screen.readFrameLines()).includes("reason-of-f00"));
    // Send a down arrow.
    screen.stdin.write(DOWN_ARROW);
    await settle();
    // The info row moved to the second file.
    const infoRow = getInfoRow(screen.readFrameLines());
    assert.ok(infoRow.includes("reason-of-f01"), `info row: ${infoRow}`);
    assert.ok(!infoRow.includes("reason-of-f00"));
});

test("test_a_row_not_walked_to_the_marker_shows_not_walked_to_this_time", async (t) => {
    // Scenario: the history of f00 does not cover the marker time, the history of every other file does.
    const harness = makeAppProps({});
    const notSpannedFile = harness.files[0]!;
    harness.props.isTimeSpannedForFile = (file) => file.value !== notSpannedFile.value;
    const screen = startScreen(t, harness.props);
    await settle();
    // The cursor is on f00: the info row says it is not walked to this time.
    assert.ok(getInfoRow(screen.readFrameLines()).includes("not walked to this time"));
    // The cursor moves to f01, which is walked: the info row does not say it.
    screen.stdin.write(DOWN_ARROW);
    await settle();
    assert.ok(!getInfoRow(screen.readFrameLines()).includes("not walked to this time"));
});

test("test_manual_shift_right_past_a_birth_shows_did_not_exist_yet", async (t) => {
    // Scenario: every file has one commit, its birth, at the newest event time. The marker starts at the newest event.
    const harness = makeAppProps({});
    const bornInstant = harness.props.events[0]!.instant;
    harness.props.loadFileWire = (file) => makeBornWire(file, bornInstant);
    const screen = startScreen(t, harness.props);
    await settle();
    // At the birth time the row does not say that the file did not exist.
    assert.ok(!findRowLine(screen.readFrameLines(), makeFileName(0)).includes("did not exist yet"));
    // Shift-right moves the marker to the next older event, which is older than the birth.
    screen.stdin.write(SHIFT_RIGHT_ARROW);
    await settle();
    const lines = screen.readFrameLines();
    assert.ok(readMarkerInstantFromHeader(lines).getTime() < bornInstant.getTime());
    // The row text contains "did not exist yet".
    assert.ok(findRowLine(lines, makeFileName(0)).includes("did not exist yet"), `row: ${findRowLine(lines, makeFileName(0))}`);
});

test("test_the_menu_row_shows_the_speed_and_the_d_key_toggles_day_on_and_off", async (t) => {
    // Scenario: a fresh screen.
    const harness = makeAppProps({});
    const screen = startScreen(t, harness.props);
    await settle();
    // The speed starts at event.
    assert.ok(getMenuRow(screen.readFrameLines()).includes("speed: event"));
    // The d key turns the day speed on.
    screen.stdin.write("d");
    await settle();
    assert.ok(getMenuRow(screen.readFrameLines()).includes("speed: day"));
    // The d key again turns it off: the speed is event again.
    screen.stdin.write("d");
    await settle();
    const menuRow = getMenuRow(screen.readFrameLines());
    assert.ok(menuRow.includes("speed: event"));
    assert.ok(!menuRow.includes("speed: day"));
});

test("test_the_w_key_replaces_day_speed_by_week_speed", async (t) => {
    // Scenario: the day speed is on.
    const harness = makeAppProps({});
    const screen = startScreen(t, harness.props);
    await settle();
    screen.stdin.write("d");
    await settle();
    assert.ok(getMenuRow(screen.readFrameLines()).includes("speed: day"));
    // The w key replaces it by the week speed.
    screen.stdin.write("w");
    await settle();
    const menuRow = getMenuRow(screen.readFrameLines());
    assert.ok(menuRow.includes("speed: week"));
    assert.ok(!menuRow.includes("speed: day"));
    // The w key again turns the week speed off.
    screen.stdin.write("w");
    await settle();
    assert.ok(getMenuRow(screen.readFrameLines()).includes("speed: event"));
});

test("test_shift_right_in_day_speed_moves_the_marker_time_by_one_day", async (t) => {
    // Scenario: the marker starts at the newest event (day 30). The day speed is on.
    const harness = makeAppProps({});
    const screen = startScreen(t, harness.props);
    await settle();
    const markerBefore = readMarkerInstantFromHeader(screen.readFrameLines());
    assert.equal(markerBefore.toISOString(), makeInstant(NEWEST_EVENT_DAY * SECONDS_PER_DAY).toISOString());
    screen.stdin.write("d");
    await settle();
    // Shift-right moves the marker towards the earliest time.
    screen.stdin.write(SHIFT_RIGHT_ARROW);
    await settle();
    // The header shows a time exactly one day older.
    const markerAfter = readMarkerInstantFromHeader(screen.readFrameLines());
    assert.equal(markerBefore.getTime() - markerAfter.getTime(), MILLISECONDS_PER_DAY);
    assert.equal(markerAfter.toISOString(), makeInstant((NEWEST_EVENT_DAY - 1) * SECONDS_PER_DAY).toISOString());
});

test("test_left_in_week_speed_moves_the_selected_files_time_by_seven_days", async (t) => {
    // Scenario: the week speed is on and the marker moved two weeks older: day 30 to day 16.
    const harness = makeAppProps({});
    const screen = startScreen(t, harness.props);
    await settle();
    screen.stdin.write("w");
    await settle();
    screen.stdin.write(SHIFT_RIGHT_ARROW);
    await settle();
    screen.stdin.write(SHIFT_RIGHT_ARROW);
    await settle();
    const markerInstant = readMarkerInstantFromHeader(screen.readFrameLines());
    assert.equal(markerInstant.toISOString(), makeInstant(16 * SECONDS_PER_DAY).toISOString());
    // Select the file under the cursor with the toggleSelection key.
    screen.stdin.write("s");
    await settle();
    // Left moves the time of the selected file towards now by seven days.
    screen.stdin.write(LEFT_ARROW);
    await settle();
    const lines = screen.readFrameLines();
    // The info row shows an own time seven days newer than the marker (day 23, not above the newest event).
    const ownTime = readOwnTimeFromInfoRow(lines);
    assert.equal(ownTime.getTime() - markerInstant.getTime(), 7 * MILLISECONDS_PER_DAY);
    assert.equal(ownTime.toISOString(), makeInstant(23 * SECONDS_PER_DAY).toISOString());
    // The marker did not move.
    assert.equal(readMarkerInstantFromHeader(lines).toISOString(), markerInstant.toISOString());
});

test("test_day_speed_walks_every_file_that_does_not_cover_the_new_time", async (t) => {
    // Scenario: no file has a history that covers any time.
    const harness = makeAppProps({ isTimeSpannedForFile: () => false });
    const screen = startScreen(t, harness.props);
    await settle();
    // Turn the day speed on, then count the walk calls made so far.
    screen.stdin.write("d");
    await settle();
    const callCountBefore = harness.walkHistoryToCalls.length;
    // Shift-right moves the marker one day older.
    screen.stdin.write(SHIFT_RIGHT_ARROW);
    await settle();
    const newMarkerInstant = readMarkerInstantFromHeader(screen.readFrameLines());
    const callsAfterMove = harness.walkHistoryToCalls.slice(callCountBefore);
    // The walker was asked to walk every one of the 50 files to the new marker time.
    const walkedFilePaths = new Set(callsAfterMove.map((call) => call.file.toString()));
    assert.equal(walkedFilePaths.size, FILE_COUNT);
    for (const file of harness.files) {
        assert.ok(walkedFilePaths.has(file.toString()), `${file.toString()} was not walked`);
    }
    for (const call of callsAfterMove) {
        assert.equal(call.currentTime.getTime(), newMarkerInstant.getTime());
    }
});
