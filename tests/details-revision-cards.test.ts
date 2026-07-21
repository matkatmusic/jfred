// DOM tests for buildMissingRevisionCard (tasks 129 + 130): the unrecoverable placeholder
// card says which revision (of how many) failed to apply which operation, keeps the raw
// engine error reachable as the hover title, and carries ONLY the jump + { } actions
// (content/export/patch would lie for a carried-forward placeholder).

import { test } from "node:test";
import assert from "node:assert/strict";
import { setupWebappDom } from "./webapp-dom-test-helpers.ts";
import type { DetailsContext, RevisionCard } from "../webapp/views/details-model.ts";

const RAW_ENGINE_ERROR = "TypeError: hunk.lines is not iterable";
const REVISION_COUNT = 12;

function buildUnrecoverableCard(): RevisionCard {
    return {
        revisionNumber: 8,
        opLabel: "edit",
        timestamp: "2026-07-20T00:00:00Z",
        changeId: "chg-8",
        unrecoverableReason: RAW_ENGINE_ERROR,
    };
}

// The details context the two action buttons resolve through; every call is recorded so a
// test can assert exactly which route a click took.
function buildStubContext(openedChangeIds: string[], selectedRows: number[]): DetailsContext {
    return {
        nodes: [],
        selectTimelineRow: (nodeIndex: number) => selectedRows.push(nodeIndex),
        openRecordForChangeId: (changeId: string) => openedChangeIds.push(changeId),
    } as unknown as DetailsContext;
}

// Boot a fresh DOM and build one unrecoverable card through the real builder. The dynamic
// import keeps the webapp module load AFTER the happy-dom globals exist (task-122 pattern).
async function buildMissingCardInFreshDom(openedChangeIds: string[], selectedRows: number[]): Promise<HTMLElement> {
    setupWebappDom();
    const { buildMissingRevisionCard } = await import("../webapp/views/details-revision-cards.ts");
    const buildActionButton = (text: string, onActivate: () => unknown): HTMLElement => {
        const button = document.createElement("button");
        button.textContent = text;
        button.onclick = () => void onActivate();
        return button;
    };
    return buildMissingRevisionCard(
        buildActionButton,
        buildStubContext(openedChangeIds, selectedRows),
        buildUnrecoverableCard(),
        REVISION_COUNT,
    );
}

test("test_missing_card_shows_failure_summary_not_raw_error", async () => {
    // Scenario: the .why line is the user-useful summary (task 129), not the raw replay error.
    // Steps:
    // build the card for rev 8 of a 12-revision file whose edit failed to replay.
    const card = await buildMissingCardInFreshDom([], []);
    const why = card.querySelector(".why");
    assert.ok(why !== null, ".why line exists");
    // the visible text names the revision, the total, and the failed operation.
    assert.equal(why.textContent, "rev 8 (of 12) failed to apply edit");
    // the raw engine error is NOT the visible text.
    assert.ok(!why.textContent!.includes("TypeError"), "raw error is not visible text");
});

test("test_missing_card_keeps_raw_error_as_hover_title", async () => {
    // Scenario: the raw engine error stays reachable for debugging via the hover title.
    // Steps:
    // build the card, find the .why line.
    const card = await buildMissingCardInFreshDom([], []);
    // assert the title attribute carries the raw reason verbatim.
    assert.equal(card.querySelector(".why")!.getAttribute("title"), RAW_ENGINE_ERROR);
});

test("test_missing_card_has_only_jump_and_json_buttons", async () => {
    // Scenario: the card carries exactly the two task-130 actions and { } routes through
    // context.openRecordForChangeId with the card's changeId.
    // Steps:
    // build the card recording every action-route call.
    const openedChangeIds: string[] = [];
    const card = await buildMissingCardInFreshDom(openedChangeIds, []);
    // exactly two buttons, in reading order: jump then { }.
    const buttons = [...card.querySelectorAll("button")];
    assert.deepEqual(buttons.map((button) => button.textContent), ["Jump to timeline step", "{ }"]);
    // clicking { } opens the record for the card's changeId.
    buttons[1]!.click();
    assert.deepEqual(openedChangeIds, ["chg-8"]);
});
