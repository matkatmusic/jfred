// A shared link's node opens after the page loads.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement, getRequiredElementById } from "../webapp/app-dom.ts";
import { installNodeDrawer } from "../webapp/layer1-drawer.ts";
import { openLinkedNodeAfterLoad } from "../webapp/layer1-linked-node.ts";
import { DISK_FILE_CONTENT, installAnimationFrameStub, installRecordingFetch } from "./layer1-drawer-test-helpers.ts";
import { initLayer1Dom } from "./webapp-dom-test-helpers.ts";

const IDENTITY = { instant: "2026-04-25T21:01:39.913Z", sessionFile: "/jot/684c147c.jsonl", line: 2235 };

test("a node already on the page opens without ticking any box", async () => {
  initLayer1Dom();
  installAnimationFrameStub();
  installRecordingFetch(() => ({ content: DISK_FILE_CONTENT }));
  const node = createElement("i", {
    class: "node n-snap", "data-instant": IDENTITY.instant, "data-session-file": IDENTITY.sessionFile, "data-line": "2235", "data-version": "1",
  });
  getRequiredElementById("stage").replaceChildren(createElement("div", { class: "filebox" }, [
    createElement("div", { class: "fname", text: "a.ts", "data-path": "src/a.ts" }),
    createElement("div", { class: "lane" }, [node]),
  ]));
  installNodeDrawer();

  await openLinkedNodeAfterLoad(IDENTITY);

  assert.ok(getRequiredElementById("drawer").classList.contains("open"));
});
