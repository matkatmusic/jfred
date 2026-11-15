// W5: showDockerNoticeWhenDockerIsMissing shows the Docker problem at page load.

import { test } from "node:test";
import assert from "node:assert/strict";
import { showDockerNoticeWhenDockerIsMissing } from "../webapp/layer1-components/popups/layer1-docker-notice.ts";
import { initLayer1Dom } from "./webapp-dom-test-helpers.ts";
import { installFetchRoutes } from "./webapp-fetch-test-helpers.ts";

const PROBLEM_TEXT = "Docker is not installed. Install Docker to replay recorded scripts.";

test("test_notice_is_shown_with_the_problem_text_when_docker_is_missing", async () => {
    // The server says Docker is not installed.
    initLayer1Dom();
    installFetchRoutes({ "/api/layer1-docker-readiness": { problem: "docker-not-installed", problemText: PROBLEM_TEXT } });
    // The page asks once at load.
    await showDockerNoticeWhenDockerIsMissing();
    // One alert notice exists, is the first child of the body, and shows the problem text.
    const notices = document.querySelectorAll("#dockerNotice");
    assert.equal(notices.length, 1);
    const notice = notices[0]!;
    assert.equal(document.body.firstElementChild, notice);
    assert.equal(notice.getAttribute("role"), "alert");
    assert.ok(notice.classList.contains("dockerNotice"));
    assert.equal(notice.textContent, PROBLEM_TEXT);
});

test("test_no_notice_when_docker_is_ready", async () => {
    // The server says Docker is ready: the reply has no problem.
    initLayer1Dom();
    installFetchRoutes({ "/api/layer1-docker-readiness": {} });
    // The page asks once at load.
    await showDockerNoticeWhenDockerIsMissing();
    // No notice is on the page.
    assert.equal(document.querySelectorAll("#dockerNotice").length, 0);
});
