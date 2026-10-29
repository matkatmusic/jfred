// Record mode of the Revision View card render opens the causing record and nothing else.

import { test } from "node:test";
import assert from "node:assert/strict";
import { initWebappDom } from "./webapp-dom-test-helpers.ts";
import { RevisionViewMode } from "../webapp/views/details-model.ts";
import type { RevisionPage } from "../webapp/views/details-revision-diff.ts";

test("test_render_card_in_mode_record_opens_record_for_change_id", async () => {
    initWebappDom();
    const { renderCardInMode } = await import("../webapp/views/details-revision-diff.ts");
    const openedChangeIds: string[] = [];
    const context = { openRecordForChangeId: (changeId: string) => openedChangeIds.push(changeId) };
    const page = { context } as unknown as RevisionPage;
    const card = { revisionNumber: 2, opLabel: "edit", timestamp: "2026-07-20T00:00:00Z", changeId: "chg-2" };
    renderCardInMode(page, card, 1, RevisionViewMode.record);
    assert.deepEqual(openedChangeIds, ["chg-2"]);
});
