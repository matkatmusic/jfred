import { test } from "node:test";
import assert from "node:assert/strict";
import { initWebappDom } from "./webapp-dom-test-helpers.ts";

test("test_renderGitBaselineInDetails_prepends_a_banner_naming_the_base_commit", async () => {
    initWebappDom();
    const { renderGitBaselineInDetails } = await import("../webapp/views/details-baseline.ts");
    const changeId = "gitBase:abc1234:orders.py";
    const historyDocument = {
        filesTouched: [{ target: "orders.py", revisions: [{ kind: "git-base", changeId, timestamp: "2026-07-01T10:00:00Z" }] }],
    };
    renderGitBaselineInDetails(historyDocument as never, "orders.py", changeId);
    const body = document.getElementById("details-right-body")!;
    assert.match(body.querySelector(".recon-banner")!.textContent!, /base commit abc1234/);
    assert.equal(body.firstElementChild!.className, "recon-banner");
});
