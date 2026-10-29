// app-baseline-question.ts: the dialog shows the repo and the short commit hash.

import { test } from "node:test";
import assert from "node:assert/strict";
import { initWebappDom } from "./webapp-dom-test-helpers.ts";

test("test_formatShortCommitHash_keeps_first_12_digits", async () => {
    initWebappDom();
    const { formatShortCommitHash } = await import("../webapp/app-baseline-question.ts");
    assert.equal(formatShortCommitHash("0123456789abcdef0123"), "0123456789ab");
});

test("test_renderBaselineQuestionDialog_shows_repo_commit_and_two_buttons", async () => {
    initWebappDom();
    const { renderBaselineQuestionDialog } = await import("../webapp/app-baseline-question.ts");
    const container = document.createElement("div");
    renderBaselineQuestionDialog(container, "proj", { repo: "/tmp/repo", baseCommit: "0123456789abcdef0123" } as never);
    assert.ok(container.textContent!.includes("repo /tmp/repo · commit 0123456789ab"));
    assert.equal(container.querySelectorAll("button").length, 2);
});
