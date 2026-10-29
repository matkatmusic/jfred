// The Details drawer's copy-link button: a URL that reopens the same page and the same node.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement, getRequiredElementById } from "../webapp/app-dom.ts";
import { installNodeDrawer } from "../webapp/layer1-drawer.ts";
import {
  buildNodeLinkUrl, findNodeByIdentity, installCopyLinkButton, openLinkedNode, readNodeLinkIdentity,
} from "../webapp/layer1-node-link.ts";
import { SCRIPT_RUN, openSingleRunDrawer } from "./layer1-drawer-script-helpers.ts";
import { DISK_FILE_CONTENT, installAnimationFrameStub, installRecordingFetch } from "./layer1-drawer-test-helpers.ts";
import { initLayer1Dom } from "./webapp-dom-test-helpers.ts";

const IDENTITY = { instant: "2026-04-25T21:01:39.913Z", sessionFile: "/jot/684c147c.jsonl", line: 2235 };
const PAGE = "http://localhost:7420/app/layer1.html?dir=/jot&repo=/jot&jsonl=/jot/projects&snapshots=/jot/fh";

function stubClipboard(): string[] {
  const copied: string[] = [];
  Object.defineProperty(globalThis.navigator, "clipboard", {
    configurable: true,
    value: { writeText: async (text: string) => void copied.push(text) },
  });
  return copied;
}

function buildIdentityNode(identity: typeof IDENTITY, className: string): HTMLElement {
  return createElement("i", {
    class: className, "data-instant": identity.instant, "data-session-file": identity.sessionFile, "data-line": String(identity.line),
  });
}

test("the link keeps every page param and adds the node's instant, session file and line", () => {
  const url = new URL(buildNodeLinkUrl(PAGE, IDENTITY));

  assert.equal(url.origin + url.pathname, "http://localhost:7420/app/layer1.html");
  assert.equal(url.searchParams.get("dir"), "/jot");
  assert.equal(url.searchParams.get("repo"), "/jot");
  assert.deepEqual(url.searchParams.getAll("jsonl"), ["/jot/projects"]);
  assert.deepEqual(url.searchParams.getAll("snapshots"), ["/jot/fh"]);
  assert.deepEqual(readNodeLinkIdentity(url.search), IDENTITY);
});

test("a link built from a link carries one node, not two", () => {
  const first = buildNodeLinkUrl(PAGE, IDENTITY);
  const second = buildNodeLinkUrl(first, { ...IDENTITY, line: 7 });

  assert.equal(new URL(second).searchParams.getAll("nodeLine").length, 1);
  assert.equal(readNodeLinkIdentity(new URL(second).search)?.line, 7);
});

test("a page URL with no node params reads no identity", () => {
  assert.equal(readNodeLinkIdentity("?dir=/jot&repo=/jot"), undefined);
});

test("a node is found by instant, session file and line together", () => {
  initLayer1Dom();
  const wrongLine = buildIdentityNode({ ...IDENTITY, line: 1 }, "node n-edit");
  const match = buildIdentityNode(IDENTITY, "node n-edit");
  getRequiredElementById("stage").replaceChildren(wrongLine, match);

  assert.equal(findNodeByIdentity(document, IDENTITY), match);
  assert.equal(findNodeByIdentity(document, { ...IDENTITY, sessionFile: "/other.jsonl" }), undefined);
});

test("the copy-link button copies a link to the open script run", async () => {
  const run = { ...SCRIPT_RUN, instant: IDENTITY.instant, sessionFile: IDENTITY.sessionFile, line: IDENTITY.line };
  await openSingleRunDrawer(run);
  const copied = stubClipboard();
  installCopyLinkButton();

  const button = getRequiredElementById("dcopylink");
  assert.equal(button.hidden, false);
  button.click();
  await Promise.resolve();

  assert.equal(copied.length, 1);
  assert.deepEqual(readNodeLinkIdentity(new URL(copied[0]!).search), IDENTITY);
});

test("closing the drawer hides the copy-link button", async () => {
  await openSingleRunDrawer(SCRIPT_RUN);
  installCopyLinkButton();

  getRequiredElementById("dclose").click();

  assert.equal(getRequiredElementById("dcopylink").hidden, true);
});

test("opening a linked node clicks it, which opens the drawer", async () => {
  initLayer1Dom();
  installAnimationFrameStub();
  installRecordingFetch(() => ({ content: DISK_FILE_CONTENT }));
  const node = buildIdentityNode(IDENTITY, "node n-snap");
  node.dataset["version"] = "1";
  getRequiredElementById("stage").replaceChildren(createElement("div", { class: "filebox" }, [
    createElement("div", { class: "fname", text: "a.ts", "data-path": "src/a.ts" }),
    createElement("div", { class: "lane" }, [node]),
  ]));
  installNodeDrawer();

  await openLinkedNode(IDENTITY);

  assert.ok(getRequiredElementById("drawer").classList.contains("open"));
});

test("opening a node that is not on the page throws", async () => {
  initLayer1Dom();
  getRequiredElementById("stage").replaceChildren();

  await assert.rejects(openLinkedNode(IDENTITY), /not on this page/);
});
