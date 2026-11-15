// Bars view S8: a dot or a file opens the DetailsPane with two inverse-state texts.

import { test } from "node:test";
import assert from "node:assert/strict";
import { getRequiredElementById } from "../webapp/app-dom.ts";
import { fetchInverseStateText, openBarDotDetails, openBarFileDetails } from "../webapp/layer1-components/bars-view/layer1-bars-details.ts";
import type { BarDotModel, BarFileModel } from "../webapp/layer1-components/bars-view/layer1-bars-model.ts";
import { BarDotKind } from "../webapp/layer1-components/bars-view/layer1-bars-wire.ts";
import { ShowRowKind } from "../webapp/layer1-components/show-row/layer1-show-row.ts";
import { initLayer1Dom } from "./webapp-dom-test-helpers.ts";
import { TEST_INSTANT_MIDDLE, TEST_INSTANT_NEWEST, TEST_INSTANT_OLDEST, buildDiskNowCommit, buildInverseCommit, ensureBarsMarkup } from "./layer1-bars-test-helpers.ts";
import { installAnimationFrameStub, installRecordingFetch, waitForPendingFetches } from "./layer1-drawer-test-helpers.ts";

const FILE_PATH = "src/demo.ts";
const PROJECT_DIR = "/proj/demo";

type Ask = { url: string; body?: string };

function buildDot(commitIndex: number, rowIndex: number, kind: BarDotKind, instant: string | null): BarDotModel {
    return { commitIndex, commitHash: `c${commitIndex}`, rowIndex, kind, group: ShowRowKind.commit, stageIndex: 0, alpha: 1, instant };
}

// Four commits, newest first: disk now, a commit, a commit, then either a created commit or a plain commit.
function buildFileModel(oldestKind: BarDotKind): BarFileModel {
    const commits = [
        buildDiskNowCommit(),
        buildInverseCommit({ commitHash: "c1", instant: TEST_INSTANT_NEWEST }),
        buildInverseCommit({ commitHash: "c2", instant: TEST_INSTANT_MIDDLE }),
        buildInverseCommit({ commitHash: "c3", instant: TEST_INSTANT_OLDEST }),
    ];
    const dots = [
        buildDot(0, 0, BarDotKind.disk, null),
        buildDot(1, 1, BarDotKind.commit, TEST_INSTANT_NEWEST),
        buildDot(2, 3, BarDotKind.commit, TEST_INSTANT_MIDDLE),
        buildDot(3, 5, oldestKind, TEST_INSTANT_OLDEST),
    ];
    return { path: FILE_PATH, startRowIndex: 0, goneMarkKind: undefined, bornRowIndex: 5, isPlusShown: false, commits, dots, changes: [], marks: [] };
}

function setUpDetailsPage(contentFor: (params: URLSearchParams) => object = (params) => ({ text: `text at ${params.get("at")}` })): Ask[] {
    initLayer1Dom();
    ensureBarsMarkup();
    installAnimationFrameStub();
    return installRecordingFetch(contentFor);
}

function readStateAsks(asks: Ask[]): URLSearchParams[] {
    const stateAsks = asks.filter((ask) => ask.url.includes("layer1-inverse-state"));
    return stateAsks.map((ask) => new URLSearchParams(ask.url.slice(ask.url.indexOf("?") + 1)));
}

function readDiffAsk(asks: Ask[]): { base: string; target: string } {
    const ask = asks.find((entry) => entry.url.includes("layer1-diff-content"))!;
    return JSON.parse(ask.body!) as { base: string; target: string };
}

test("test_a_dot_click_asks_for_the_state_at_the_dot_instant_and_at_the_next_older_instant", async () => {
    // Steps: open dot 1 (instant NEWEST); the next older commit holds MIDDLE; both states are asked for the file in the project.
    const asks = setUpDetailsPage();
    openBarDotDetails(buildFileModel(BarDotKind.commit), 1, PROJECT_DIR);
    await waitForPendingFetches();
    const stateAsks = readStateAsks(asks);
    assert.deepEqual(stateAsks.map((params) => params.get("at")).sort(), [TEST_INSTANT_MIDDLE, TEST_INSTANT_NEWEST]);
    for (const params of stateAsks) {
        assert.equal(params.get("dir"), PROJECT_DIR);
        assert.equal(params.get("file"), FILE_PATH);
    }
});

test("test_the_diff_pane_opens_with_the_file_path_and_the_state_line", () => {
    // Steps: open dot 1; the pane is open, the header names the path, the meta line reads state 2 of 4 with the kind label and the instant.
    setUpDetailsPage();
    openBarDotDetails(buildFileModel(BarDotKind.commit), 1, PROJECT_DIR);
    assert.ok(getRequiredElementById("detailsPaneContainer").classList.contains("open"));
    assert.equal(getRequiredElementById("dpath").textContent, FILE_PATH);
    assert.equal(getRequiredElementById("dpath").title, FILE_PATH);
    assert.equal(getRequiredElementById("dmeta").textContent, `state 2 of 4 · commit · ${TEST_INSTANT_NEWEST}`);
    assert.equal(getRequiredElementById("dprev").hidden, true);
    assert.equal(getRequiredElementById("dnext").hidden, true);
});

test("test_the_disk_dot_asks_for_the_state_at_now", async () => {
    // Steps: open dot 0 (null instant); the target ask carries a time of now, the base ask carries the newest commit instant; the meta line says now.
    const asks = setUpDetailsPage();
    const before = Date.now();
    openBarDotDetails(buildFileModel(BarDotKind.commit), 0, PROJECT_DIR);
    await waitForPendingFetches();
    const askedInstants = readStateAsks(asks).map((params) => params.get("at")!);
    assert.ok(askedInstants.includes(TEST_INSTANT_NEWEST));
    const nowInstant = askedInstants.find((instant) => instant !== TEST_INSTANT_NEWEST)!;
    assert.ok(Date.parse(nowInstant) >= before);
    assert.ok(Date.parse(nowInstant) <= Date.now());
    assert.equal(getRequiredElementById("dmeta").textContent, "state 1 of 4 · disk now · now");
});

test("test_a_dot_with_no_older_commit_diffs_against_an_empty_text", async () => {
    // Steps: open the oldest dot (a plain commit, no older commit); only one state is asked for; the diff base is an empty text.
    const asks = setUpDetailsPage();
    openBarDotDetails(buildFileModel(BarDotKind.commit), 3, PROJECT_DIR);
    await waitForPendingFetches();
    assert.deepEqual(readStateAsks(asks).map((params) => params.get("at")), [TEST_INSTANT_OLDEST]);
    assert.deepEqual(readDiffAsk(asks), { base: "", target: `text at ${TEST_INSTANT_OLDEST}` });
});

test("test_a_created_dot_shows_the_did_not_exist_text", async () => {
    // Steps: open the created dot; the body says the file did not exist; no state is asked for.
    const asks = setUpDetailsPage();
    openBarDotDetails(buildFileModel(BarDotKind.created), 3, PROJECT_DIR);
    await waitForPendingFetches();
    assert.ok(getRequiredElementById("dbody").textContent!.includes("File did not exist before this point."));
    assert.equal(readStateAsks(asks).length, 0);
});

test("test_a_null_state_text_reads_as_an_empty_text", async () => {
    // Steps: the server answers text null; the fetch returns an empty text.
    setUpDetailsPage(() => ({ file: FILE_PATH, commit: null, text: null }));
    assert.equal(await fetchInverseStateText(PROJECT_DIR, FILE_PATH, TEST_INSTANT_NEWEST), "");
});

test("test_file_details_open_the_first_dot_at_or_older_than_the_selected_row", () => {
    // Steps: dots sit on rows 0, 1, 3 and 5; select row 2; the first dot with row 2 or more is dot 2 on row 3.
    setUpDetailsPage();
    openBarFileDetails(buildFileModel(BarDotKind.commit), 2, PROJECT_DIR);
    assert.equal(getRequiredElementById("dmeta").textContent, `state 3 of 4 · commit · ${TEST_INSTANT_MIDDLE}`);
});

test("test_file_details_for_a_row_older_than_every_dot_show_did_not_exist_at_this_row", () => {
    // Steps: select row 9, past every dot; the body says the file did not exist at this row.
    setUpDetailsPage();
    openBarFileDetails(buildFileModel(BarDotKind.commit), 9, PROJECT_DIR);
    assert.ok(getRequiredElementById("dbody").textContent!.includes("File did not exist at this row."));
});
