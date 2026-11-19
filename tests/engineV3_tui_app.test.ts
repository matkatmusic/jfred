// Screen tests of the terminal UI root component (plan Stage B8): what the frame shows.

import assert from "node:assert/strict";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { createElement } from "react";
import { render } from "ink-testing-library";
import { Path } from "../src/structures/domain.ts";
import { FileWalkStatus, InverseStepOutcome, PlayOutcomeKind, StepProcessOutcomeKind, TuiCommand } from "../src/structures/vocabulary.ts";
import { FileEventType } from "../engineV3/engineV3_replay_reverse_events.ts";
import type { StepResultLine } from "../engineV3/engineV3_step_start_at.ts";
import { App } from "../engineV3/tui/engineV3_tui_app.tsx";
import type { AppProps } from "../engineV3/tui/engineV3_tui_app_types.ts";
import { decideScriptAction, type ConsentAnswers } from "../engineV3/tui/engineV3_tui_consent.ts";
import { createHistoryWalker } from "../engineV3/tui/engineV3_tui_walk.ts";
import { KeyBox, formatKeyBinding, loadKeyBoxes, loadKeymap } from "../engineV3/tui/engineV3_tui_keymap.ts";
import type { FileEventCounts, ProjectEventEntry } from "../engineV3/tui/engineV3_tui_project_cache.ts";
import { ROW_MARKS } from "../engineV3/tui/engineV3_tui_row.tsx";
import { createWalkState, getFileRunState, setFileRunState, type FileRunState, type WalkState } from "../engineV3/tui/engineV3_tui_walk_state.ts";
import type { HistoryWalker, PlayRequest, StepPool, StepProcessOutcome, StepRequest } from "../engineV3/tui/engineV3_tui_walk_types.ts";
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
const SHIFT_DOWN_ARROW = "\x1b[1;2B";
const SHIFT_UP_ARROW = "\x1b[1;2A";
const SHIFT_LEFT_ARROW = "\x1b[1;2D";
const SHARED_INSTANT_GAP_DAYS = 10;

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
        playScript: () => {
            throw new Error("unexpected walker.playScript");
        },
    };
    const props: AppProps = {
        // terminalRows: 20,
        terminalRows: 24,
        terminalColumns: 100,
        projectFolder: new Path(PROJECT_FOLDER_TEXT),
        storeFolder: new Path("/made-up-store-folder-for-tui-app-test"),
        files,
        events: makeEvents(files),
        countsByFile: makeCountsByFile(files),
        keymap: loadKeymap(KEYMAP_FILE),
        keyBoxes: loadKeyBoxes(KEYMAP_FILE),
        engineLog: { appendRawLine: () => {}, appendSummaryLine: () => {}, listLines: () => [] },
        openLogFolder: () => {},
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

// The legend box and the marker box are the first two boxes of the frame: the header (status) row is the line under the bottom border of the marker box.
// function getHeaderRow(lines: string[]): string {
//     const legendBottomBorderIndex = lines.findIndex((line) => line.startsWith("╰"));
//     return lines[legendBottomBorderIndex + 1]!;
// }
function getHeaderRow(lines: string[]): string {
    const legendBottomBorderIndex = lines.findIndex((line) => line.startsWith("╰"));
    const markerBottomBorderIndex = lines.findIndex((line, index) => index > legendBottomBorderIndex && line.startsWith("╰"));
    return lines[markerBottomBorderIndex + 1]!;
}

// The text of each rounded box in the frame, top to bottom: the inner lines joined by one space.
// 20 terminal rows: the legend box (5 rows), 1 header row, the file rows, then the details box and the key footer with 100 columns.
const VISIBLE_FILE_ROW_COUNT = 4;
function readBoxTexts(lines: string[]): string[] {
    const boxTexts: string[] = [];
    let currentBoxLines: string[] | undefined;
    for (const line of lines) {
        if (line.startsWith("╭")) {
            currentBoxLines = [];
        } else if (line.startsWith("╰")) {
            boxTexts.push(currentBoxLines!.join(" "));
            currentBoxLines = undefined;
        } else if (currentBoxLines !== undefined) {
            currentBoxLines.push(line.replace(/^│\s*/, "").replace(/\s*│$/, ""));
        }
    }
    return boxTexts;
}

// the details box above the key footer
function getInfoRow(lines: string[]): string {
    const boxTexts = readBoxTexts(lines);
    return boxTexts[boxTexts.length - 2]!;
}

// the key footer, the last box
function getMenuRow(lines: string[]): string {
    const boxTexts = readBoxTexts(lines);
    return boxTexts[boxTexts.length - 1]!;
}

// function readMarkerInstantFromHeader(lines: string[]): Date {
//     const headerMatch = /marker (\d{4}-\d\d-\d\dT[\d:.]+Z)/.exec(getHeaderRow(lines));
//     assert.notEqual(headerMatch, null, `the header shows no marker time: ${getHeaderRow(lines)}`);
//     return new Date((headerMatch as RegExpExecArray)[1]!);
// }
// The header no longer shows the marker time. With no file spanned, every file without an own time is walked to the marker time: the last such walk request carries it.
function readMarkerInstantFromWalkCalls(harness: AppHarness, ownTimeFile?: Path): Date {
    const calls = harness.walkHistoryToCalls.filter((call) => call.file.value !== ownTimeFile?.value);
    assert.ok(calls.length > 0, "the walker got no request");
    return calls[calls.length - 1]!.currentTime;
}

function readOwnTimeFromInfoRow(lines: string[]): Date {
    const infoMatch = /own time: (\d{4}-\d\d-\d\dT[\d:.]+Z)/.exec(getInfoRow(lines));
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
    for (let index = 0; index < VISIBLE_FILE_ROW_COUNT; index++) {
        assert.ok(frameText.includes(makeFileName(index)), `${makeFileName(index)} is missing`);
    }
    // The frame does not hold the next name, nor the last name.
    assert.ok(!frameText.includes(makeFileName(VISIBLE_FILE_ROW_COUNT)));
    assert.ok(!frameText.includes(makeFileName(49)));
});

test("test_the_legend_box_is_at_the_top_of_the_screen_above_the_header", async (t) => {
    // Scenario: draw the screen.
    const harness = makeAppProps({});
    const screen = startScreen(t, harness.props);
    await settle();
    const lines = screen.readFrameLines();
    // The first line is the top border of the legend box and a later line of the box names the time marker symbol.
    assert.ok(lines[0]!.startsWith("╭"));
    const headerIndex = lines.indexOf(getHeaderRow(lines));
    assert.ok(lines.slice(0, headerIndex).join("\n").includes("time marker"));
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

test("test_an_open_consent_question_shows_as_a_popup_instead_of_the_file_rows_and_down_enter_answers_no", async (t) => {
    // Scenario: two script runs were found and nothing is answered yet.
    const consentCalls: Array<[string, boolean]> = [];
    const harness = makeAppProps({ scriptCounts: { mayWrite: 0, readOnly: 2 }, consentAnswers: { runScripts: undefined, runModifyingScriptsAutomatically: undefined }, onConsentAnswered: (answerKey, answer) => consentCalls.push([answerKey, answer]) });
    const screen = startScreen(t, harness.props);
    await settle();
    // the frame holds the question and the picker, and no file row.
    const frameText = screen.readFrameLines().join("\n");
    assert.ok(frameText.includes("scripts in the docker container?"), frameText);
    assert.ok(frameText.includes("> yes <"), frameText);
    assert.ok(!frameText.includes(makeFileName(0)), frameText);
    // Down then Enter answers no for the runScripts question.
    screen.stdin.write(DOWN_ARROW);
    await settle();
    screen.stdin.write("\r");
    await settle();
    assert.deepEqual(consentCalls, [["runScripts", false]]);
});

test("test_the_menu_row_shows_the_keys_of_the_keymap_file", async (t) => {
    // Scenario: the keymap file is loaded, then the key of PlayScript is changed to x in memory.
    // const keymap: Keymap = loadKeymap(KEYMAP_FILE);
    // keymap.set(TuiCommand.PlayScript, { input: "x" });
    const keyBoxes = loadKeyBoxes(KEYMAP_FILE);
    keyBoxes[KeyBox.Global].keys["playScript"]!.input = "x";
    const harness = makeAppProps({ keyBoxes });
    const screen = startScreen(t, harness.props);
    await settle();
    const menuRow = getMenuRow(screen.readFrameLines());
    // The hotkeys box shows x.
    assert.ok(menuRow.includes("x"));
    // The hotkeys box shows every key of the global box as "<key>: <text>" in its rows.
    for (const entry of Object.values(keyBoxes[KeyBox.Global].keys)) {
        assert.ok(menuRow.includes(entry.text), `menu row: ${menuRow}`);
    }
    assert.ok(menuRow.includes("x: play script"), `menu row: ${menuRow}`);
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
    const harness = makeAppProps({ isTimeSpannedForFile: () => false });
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
    assert.ok(readMarkerInstantFromWalkCalls(harness).getTime() < bornInstant.getTime());
    // The row text contains "did not exist yet".
    assert.ok(findRowLine(lines, makeFileName(0)).includes("did not exist yet"), `row: ${findRowLine(lines, makeFileName(0))}`);
});

test("test_the_menu_row_shows_the_speed_and_the_d_key_toggles_day_on_and_off", async (t) => {
    // Scenario: a fresh screen.
    const harness = makeAppProps({});
    const screen = startScreen(t, harness.props);
    await settle();
    // The speed starts at event.
    assert.ok(getMenuRow(screen.readFrameLines()).includes("Current: event"));
    // The d key turns the day speed on.
    screen.stdin.write("d");
    await settle();
    assert.ok(getMenuRow(screen.readFrameLines()).includes("Current: day"));
    // The d key again turns it off: the speed is event again.
    screen.stdin.write("d");
    await settle();
    const menuRow = getMenuRow(screen.readFrameLines());
    assert.ok(menuRow.includes("Current: event"));
    assert.ok(!menuRow.includes("Current: day"));
});

test("test_the_marker_box_marks_now_at_start_and_the_header_has_no_marker_time", async (t) => {
    // Scenario: a fresh screen; the marker is at Now.
    const harness = makeAppProps({});
    const screen = startScreen(t, harness.props);
    await settle();
    const lines = screen.readFrameLines();
    // the marker box marks Now.
    assert.ok(lines.some((line) => line.includes("[now]")), `no marked Now: ${lines.join("\n")}`);
    // the header row does not show the marker time.
    assert.ok(!getHeaderRow(lines).includes("marker "));
});

test("test_the_e_key_sets_the_event_speed_from_day_and_from_week", async (t) => {
    // Scenario: the day speed is on.
    const harness = makeAppProps({});
    const screen = startScreen(t, harness.props);
    await settle();
    screen.stdin.write("d");
    await settle();
    assert.ok(getMenuRow(screen.readFrameLines()).includes("Current: day"));
    // The e key sets the event speed.
    screen.stdin.write("e");
    await settle();
    assert.ok(getMenuRow(screen.readFrameLines()).includes("Current: event"));
    // The week speed is on, then the e key sets the event speed again.
    screen.stdin.write("w");
    await settle();
    assert.ok(getMenuRow(screen.readFrameLines()).includes("Current: week"));
    screen.stdin.write("e");
    await settle();
    assert.ok(getMenuRow(screen.readFrameLines()).includes("Current: event"));
});

test("test_the_w_key_replaces_day_speed_by_week_speed", async (t) => {
    // Scenario: the day speed is on.
    const harness = makeAppProps({});
    const screen = startScreen(t, harness.props);
    await settle();
    screen.stdin.write("d");
    await settle();
    assert.ok(getMenuRow(screen.readFrameLines()).includes("Current: day"));
    // The w key replaces it by the week speed.
    screen.stdin.write("w");
    await settle();
    const menuRow = getMenuRow(screen.readFrameLines());
    assert.ok(menuRow.includes("Current: week"));
    assert.ok(!menuRow.includes("Current: day"));
    // The w key again turns the week speed off.
    screen.stdin.write("w");
    await settle();
    assert.ok(getMenuRow(screen.readFrameLines()).includes("Current: event"));
});

test("test_shift_right_in_day_speed_moves_the_marker_time_by_one_day", async (t) => {
    // Scenario: the marker starts at the newest event (day 30). The day speed is on.
    const harness = makeAppProps({ isTimeSpannedForFile: () => false });
    const screen = startScreen(t, harness.props);
    await settle();
    const markerBefore = harness.props.events[0]!.instant;
    assert.equal(markerBefore.toISOString(), makeInstant(NEWEST_EVENT_DAY * SECONDS_PER_DAY).toISOString());
    screen.stdin.write("d");
    await settle();
    // Shift-right moves the marker towards the earliest time.
    screen.stdin.write(SHIFT_RIGHT_ARROW);
    await settle();
    // The walk requests carry a time exactly one day older.
    const markerAfter = readMarkerInstantFromWalkCalls(harness);
    assert.equal(markerBefore.getTime() - markerAfter.getTime(), MILLISECONDS_PER_DAY);
    assert.equal(markerAfter.toISOString(), makeInstant((NEWEST_EVENT_DAY - 1) * SECONDS_PER_DAY).toISOString());
});

test("test_left_in_week_speed_moves_the_selected_files_time_by_seven_days", async (t) => {
    // Scenario: the week speed is on and the marker moved two weeks older: day 30 to day 16.
    const harness = makeAppProps({ isTimeSpannedForFile: () => false });
    const screen = startScreen(t, harness.props);
    await settle();
    screen.stdin.write("w");
    await settle();
    screen.stdin.write(SHIFT_RIGHT_ARROW);
    await settle();
    screen.stdin.write(SHIFT_RIGHT_ARROW);
    await settle();
    const markerInstant = readMarkerInstantFromWalkCalls(harness);
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
    assert.equal(readMarkerInstantFromWalkCalls(harness, harness.files[0]!).toISOString(), markerInstant.toISOString());
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
    const newMarkerInstant = readMarkerInstantFromWalkCalls(harness);
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

test("test_the_header_shows_the_stale_repo_count_and_the_reset_key", async (t) => {
    // Scenario: no repo is stale, then three repos are stale.
    const freshHarness = makeAppProps({ staleRepoCount: 0 });
    const freshScreen = startScreen(t, freshHarness.props);
    await settle();
    // With zero stale repos the header row does not mention stale repos.
    assert.ok(!getHeaderRow(freshScreen.readFrameLines()).includes("repos are stale"));
    // Draw a second screen with three stale repos.
    const staleHarness = makeAppProps({ staleRepoCount: 3 });
    const staleScreen = startScreen(t, staleHarness.props);
    await settle();
    // The header row names the count and the Shift-R key that resets all stores.
    const headerRow = getHeaderRow(staleScreen.readFrameLines());
    assert.ok(headerRow.includes("3 repos are stale: press Shift-R"), `the header shows no stale repo line: ${headerRow}`);
});

test("test_a_project_with_no_events_shows_the_header_and_the_no_events_line", async (t) => {
    // Scenario: the project has no file events, no files, and no counts.
    const harness = makeAppProps({ events: [], files: [], countsByFile: new Map() });
    // Drawing the screen does not throw.
    let screen: ScreenHandle | undefined;
    assert.doesNotThrow(() => {
        screen = startScreen(t, harness.props);
    });
    await settle();
    const lines = (screen as ScreenHandle).readFrameLines();
    // Some line of the frame says the project has no file events.
    assert.ok(lines.some((line) => line.includes("This project has no file events.")), `no line says the project has no file events: ${lines.join("\n")}`);
    // The first line is the header: it is not empty and it is not the no-events line.
    const headerRow = getHeaderRow(lines);
    assert.notEqual(headerRow.trim(), "");
    assert.ok(!headerRow.includes("This project has no file events."));
    // No line shows a file row.
    assert.ok(!lines.some((line) => line.includes(".txt")), `a file row is drawn: ${lines.join("\n")}`);
});

// Newest first: two events of two files share the newest instant, then two events of two files share an instant ten days older.
function makeEventsWithSharedNewestInstant(files: Path[]): ProjectEventEntry[] {
    const newestInstant = makeInstant(NEWEST_EVENT_DAY * SECONDS_PER_DAY);
    const olderInstant = makeInstant((NEWEST_EVENT_DAY - SHARED_INSTANT_GAP_DAYS) * SECONDS_PER_DAY);
    return [
        { instant: newestInstant, file: files[0]!, eventType: FileEventType.EditRow, source: null },
        { instant: newestInstant, file: files[1]!, eventType: FileEventType.EditRow, source: null },
        { instant: olderInstant, file: files[2]!, eventType: FileEventType.EditRow, source: null },
        { instant: olderInstant, file: files[3]!, eventType: FileEventType.EditRow, source: null },
    ];
}

test("test_shift_right_in_event_speed_changes_the_header_time_when_the_newest_events_share_one_instant", async (t) => {
    // Scenario: the two newest events share one instant. The next events are ten days older.
    const harness = makeAppProps({ isTimeSpannedForFile: () => false });
    harness.props.events = makeEventsWithSharedNewestInstant(harness.files);
    const olderIso = makeInstant((NEWEST_EVENT_DAY - SHARED_INSTANT_GAP_DAYS) * SECONDS_PER_DAY).toISOString();
    const screen = startScreen(t, harness.props);
    await settle();
    // One Shift-Right press.
    screen.stdin.write(SHIFT_RIGHT_ARROW);
    await settle();
    // The walk requests carry the older instant, not the newest one.
    assert.equal(readMarkerInstantFromWalkCalls(harness).toISOString(), olderIso);
});

test("test_shift_left_in_event_speed_returns_the_header_to_the_newest_time_after_shift_right", async (t) => {
    // Scenario: the two newest events share one instant. The next events are ten days older.
    const harness = makeAppProps({ isTimeSpannedForFile: () => false });
    harness.props.events = makeEventsWithSharedNewestInstant(harness.files);
    const newestIso = makeInstant(NEWEST_EVENT_DAY * SECONDS_PER_DAY).toISOString();
    const olderIso = makeInstant((NEWEST_EVENT_DAY - SHARED_INSTANT_GAP_DAYS) * SECONDS_PER_DAY).toISOString();
    const screen = startScreen(t, harness.props);
    await settle();
    // One Shift-Right press: the walk requests carry the older instant.
    screen.stdin.write(SHIFT_RIGHT_ARROW);
    await settle();
    assert.equal(readMarkerInstantFromWalkCalls(harness).toISOString(), olderIso);
    // One Shift-Left press: the walk requests carry the newest instant again.
    screen.stdin.write(SHIFT_LEFT_ARROW);
    await settle();
    assert.equal(readMarkerInstantFromWalkCalls(harness).toISOString(), newestIso);
});

type PlayScriptCall = { file: Path; startAt: Date };

function makePlayScriptRecorder(playScriptCalls: PlayScriptCall[]): AppProps["onPlayScript"] {
    return async (file, startAt) => {
        playScriptCalls.push({ file, startAt });
    };
}

test("test_the_play_key_on_a_stopped_row_calls_onPlayScript_with_the_file_and_its_time", async (t) => {
    // Scenario: scripts are allowed and no question is open. The cursor file f00 is Stopped with a reason text.
    const playScriptCalls: PlayScriptCall[] = [];
    const harness = makeAppProps({ consentAnswers: { runScripts: true, runModifyingScriptsAutomatically: false }, onPlayScript: makePlayScriptRecorder(playScriptCalls) });
    setFileRunState(harness.walkState, harness.files[0]!, makeRunState(FileWalkStatus.Stopped, "script may write: press p"));
    const screen = startScreen(t, harness.props);
    await settle();
    // The marker starts at the newest event; f00 has no own time.
    const markerInstant = harness.props.events[0]!.instant;
    // Press p.
    screen.stdin.write("p");
    await settle();
    // Exactly one call: the cursor file, and the project marker time as a Date.
    assert.equal(playScriptCalls.length, 1);
    assert.equal(playScriptCalls[0]!.file.value, harness.files[0]!.value);
    assert.ok(playScriptCalls[0]!.startAt instanceof Date);
    assert.equal(playScriptCalls[0]!.startAt.getTime(), markerInstant.getTime());
});

test("test_the_play_key_on_a_row_that_is_not_stopped_calls_nothing", async (t) => {
    // Scenario: scripts are allowed and no question is open. The cursor file f00 is Idle.
    const playScriptCalls: PlayScriptCall[] = [];
    const harness = makeAppProps({ consentAnswers: { runScripts: true, runModifyingScriptsAutomatically: false }, onPlayScript: makePlayScriptRecorder(playScriptCalls) });
    const screen = startScreen(t, harness.props);
    await settle();
    // Press p.
    screen.stdin.write("p");
    await settle();
    // Nothing was called.
    assert.equal(playScriptCalls.length, 0);
});

test("test_a_long_info_row_text_keeps_the_file_name_at_its_start", async (t) => {
    // Scenario: the reason text of the cursor file f00 is far longer than the terminal width.
    const harness = makeAppProps({});
    const endOfLongText = "END-OF-THE-LONG-REASON";
    setFileRunState(harness.walkState, harness.files[0]!, makeRunState(FileWalkStatus.Crashed, `${"x".repeat(300)}${endOfLongText}`));
    const screen = startScreen(t, harness.props);
    await settle();
    // The info row starts with the file name.
    const infoRow = getInfoRow(screen.readFrameLines());
    assert.ok(infoRow.startsWith(`file: ${makeFileName(0)}`), `info row: ${infoRow}`);
    // The end of the long text is cut off.
    assert.ok(!infoRow.includes(endOfLongText), `info row: ${infoRow}`);
});

const SCRIPT_STOP_SOURCE = "/made-up/toolu_script";
const SCRIPT_STOP_SHORT_SOURCE = "toolu_script";
const SCRIPTS_NOT_ALLOWED_TEXT = "scripts are not allowed in this session";

type WalkerPlayHarness = { harness: AppHarness; playRequests: PlayRequest[]; walker: HistoryWalker; stoppedRequest: StepRequest; stoppedOutcome: StepProcessOutcome };

function makeScriptStopResultLine(startAt: Date): StepResultLine {
    return { startAt: startAt.toISOString(), outcome: InverseStepOutcome.UnknownOrRoadblock, commitsWritten: 0, position: 0, commit: "abc", eventType: FileEventType.ScriptMayWrite, source: SCRIPT_STOP_SOURCE };
}

// The real walker and the real consent decision behind the App play key; the pool is replaced by recording functions.
function makeWalkerPlayHarness(consentAnswers: ConsentAnswers): WalkerPlayHarness {
    const harness = makeAppProps({ consentAnswers });
    const playRequests: PlayRequest[] = [];
    const walker = createHistoryWalker({
        storeFolder: harness.props.storeFolder,
        projectFolder: harness.props.projectFolder,
        walkState: harness.walkState,
        requestWalk: () => {},
        requestPlay: (request) => {
            playRequests.push(request);
            return Promise.resolve({ kind: PlayOutcomeKind.ReplayRefused, reasonText: "test" });
        },
        decideScriptAction: (file, eventType, source) => decideScriptAction(consentAnswers, { file, eventType, source }),
        onStatusChange: () => harness.notifyStatusChange(),
        playKeyName: formatKeyBinding(harness.props.keymap.get(TuiCommand.PlayScript)!),
    });
    harness.props.walker = walker;
    harness.props.onPlayScript = (file, startAt) => walker.playScript(file, startAt);
    const startAt = harness.props.events[0]!.instant;
    const stoppedRequest: StepRequest = { file: harness.files[0]!, startAt, isPassingStops: false };
    const stoppedOutcome: StepProcessOutcome = { kind: StepProcessOutcomeKind.Stopped, eventType: FileEventType.ScriptMayWrite, source: SCRIPT_STOP_SOURCE, lastLine: makeScriptStopResultLine(startAt) };
    return { harness, playRequests, walker, stoppedRequest, stoppedOutcome };
}

test("test_the_play_key_with_the_first_answer_no_starts_no_play_and_shows_the_refusal", async (t) => {
    // Scenario: both consent answers are no. The cursor file f00 stopped at a script that may write.
    const { harness, playRequests, walker, stoppedRequest, stoppedOutcome } = makeWalkerPlayHarness({ runScripts: false, runModifyingScriptsAutomatically: false });
    await walker.handleOutcome(stoppedRequest, stoppedOutcome);
    const screen = startScreen(t, harness.props);
    await settle();
    // Press p on the Stopped row.
    screen.stdin.write("p");
    await settle();
    // No play was requested.
    assert.equal(playRequests.length, 0);
    // The row of f00 says that scripts are not allowed in this session.
    const reasonText = getFileRunState(harness.walkState, harness.files[0]!).reasonText;
    assert.ok(reasonText?.includes(SCRIPTS_NOT_ALLOWED_TEXT), `reason text: ${reasonText}`);
});

test("test_the_play_key_with_the_first_answer_yes_and_the_second_no_starts_the_play", async (t) => {
    // Scenario: scripts are allowed but not automatically. The cursor file f00 stopped at a script that may write.
    const { harness, playRequests, walker, stoppedRequest, stoppedOutcome } = makeWalkerPlayHarness({ runScripts: true, runModifyingScriptsAutomatically: false });
    await walker.handleOutcome(stoppedRequest, stoppedOutcome);
    // The row is Stopped and its text names the play key and the script.
    const stoppedRunState = getFileRunState(harness.walkState, harness.files[0]!);
    assert.equal(stoppedRunState.status, FileWalkStatus.Stopped);
    const playKeyName = formatKeyBinding(harness.props.keymap.get(TuiCommand.PlayScript)!);
    assert.ok(stoppedRunState.reasonText?.includes(`press ${playKeyName}`), `reason text: ${stoppedRunState.reasonText}`);
    assert.ok(stoppedRunState.reasonText?.includes(SCRIPT_STOP_SHORT_SOURCE), `reason text: ${stoppedRunState.reasonText}`);
    const screen = startScreen(t, harness.props);
    await settle();
    // Press p on the Stopped row.
    screen.stdin.write("p");
    await settle();
    // Exactly one play was requested, for the cursor file.
    assert.equal(playRequests.length, 1);
    assert.equal(playRequests[0]!.file.value, harness.files[0]!.value);
});

test("test_shift_down_shows_the_next_page_of_rows_and_shift_up_shows_the_first_page_again", async (t) => {
    // Scenario: 50 files, more than one page of rows; the first page starts at f00.
    const harness = makeAppProps({});
    const screen = startScreen(t, harness.props);
    await settle();
    const firstPageNames = screen.readFrameLines().filter((line) => /f\d\d\.txt/.test(line)).map((line) => /f\d\d\.txt/.exec(line)![0]);
    assert.equal(firstPageNames[0], makeFileName(0));
    // Shift-Down shows the next page: its rows are the next VISIBLE_FILE_ROW_COUNT files, and no row of the first page stays.
    screen.stdin.write(SHIFT_DOWN_ARROW);
    await settle();
    const secondPageNames = screen.readFrameLines().filter((line) => /f\d\d\.txt/.test(line)).map((line) => /f\d\d\.txt/.exec(line)![0]);
    assert.equal(secondPageNames[0], makeFileName(VISIBLE_FILE_ROW_COUNT));
    assert.ok(secondPageNames.every((name) => !firstPageNames.slice(0, VISIBLE_FILE_ROW_COUNT).includes(name)), `second page: ${secondPageNames}`);
    // Shift-Up shows the first page again.
    screen.stdin.write(SHIFT_UP_ARROW);
    await settle();
    const backNames = screen.readFrameLines().filter((line) => /f\d\d\.txt/.test(line)).map((line) => /f\d\d\.txt/.exec(line)![0]);
    assert.deepEqual(backNames, firstPageNames);
});
