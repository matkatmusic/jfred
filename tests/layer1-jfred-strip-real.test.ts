// Test for webapp/layer1-jfred-strip.ts: the real Commit click, its streamed progress, cancel and failures.

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { initLayer1Dom, waitForAsyncWork } from "./webapp-dom-test-helpers.ts";

// layer1-page.ts boots at MODULE SCOPE, so absorb that first boot here against a throwaway DOM.
initLayer1Dom();
const { openPendingMessage, renderJfredStrip } = await import("../webapp/layer1-components/commits-column/layer1-jfred-strip.ts");
const { loadJfredBranch, readJfredBranch, setArmed, setPending } = await import("../webapp/layer1-components/commits-column/layer1-jfred-state.ts");
const { attachLayer1CancelButton } = await import("../webapp/layer1-components/loading-bar/layer1-progress.ts");

const SEARCH = "?dir=%2Fw%2Fproj&repo=%2Fw%2Fproj";
const TICKS = ["2026-06-01T09:00:00.000Z", "2026-06-03T10:30:00.000Z", "2026-06-03T18:20:00.000Z"].map((instant, index) => ({ instant, axisPx: 100 + index * 190, eventCount: 1 }));
const REAL_VIEW = { pairs: [], gitOrphans: [], diskOrphans: [], ruler: [], jfredCommits: { base: { instant: TICKS[0]!.instant, shortHash: "a1b2c3d4" }, commits: [] } };
const CANNED_VIEW = { ...REAL_VIEW, jfredCommits: { ...REAL_VIEW.jfredCommits, isCanned: true as const } };
const COMMITTED_REPLY = { outcome: "committed", commit: { instant: TICKS[2]!.instant, shortHash: "deadbeef", parentShortHash: "a1b2c3d4", message: "server message" } };
let sent: { pathname: string; search: string; init: RequestInit }[] = [];
beforeEach(() => {
  initLayer1Dom(SEARCH);
  attachLayer1CancelButton();
  setArmed(true);
});

function installCommitRoute(reply: (init: RequestInit) => Response): void {
  sent = [];
  Object.assign(globalThis, {
    fetch: async (url: unknown, init: RequestInit): Promise<Response> => {
      const { pathname, search } = new URL(String(url), "http://localhost:7343");
      sent.push({ pathname, search, init });
      return reply(init);
    },
  });
}

function buildStreamResponse(lines: unknown[]): Response {
  return new Response(lines.map((line) => `${JSON.stringify(line)}\n`).join(""));
}

function buildOpenStream() {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({ start: (started) => { controller = started; } });
  const push = (line: unknown): void => controller.enqueue(new TextEncoder().encode(`${JSON.stringify(line)}\n`));
  return { response: new Response(body), push, close: () => controller.close(), fail: () => controller.error(new DOMException("aborted", "AbortError")) };
}

function openPendingDraft(view: typeof REAL_VIEW | typeof CANNED_VIEW): void {
  loadJfredBranch(view);
  setPending({ instant: TICKS[2]!.instant, message: "draft message" });
  renderJfredStrip(TICKS);
  openPendingMessage();
}

async function settle(): Promise<void> {
  await waitForAsyncWork();
  await waitForAsyncWork();
}
async function clickCommit(): Promise<void> {
  document.getElementById("jfred-commit-button")!.click();
  await settle();
}
function readBarsHidden(): boolean[] {
  return ["loadbar", "busy-shield"].map((id) => document.getElementById(id)!.hasAttribute("hidden"));
}

async function checkFailedCommit(expectedText: string): Promise<void> {
  const savedListeners = process.listeners("unhandledRejection");
  process.removeAllListeners("unhandledRejection");
  const captured: unknown[] = [];
  process.on("unhandledRejection", (reason) => captured.push(reason));
  await clickCommit();
  process.removeAllListeners("unhandledRejection");
  for (const listener of savedListeners)
    process.on("unhandledRejection", listener);
  assert.equal((captured[0] as Error).message, expectedText);
  assert.equal(document.getElementById("dtoast")!.textContent, `Error: ${expectedText}`);
  assert.equal(readJfredBranch().pending!.message, "draft message");
  assert.deepEqual(readBarsHidden(), [true, true]);
}

test("test_commit_click_on_a_real_branch_posts_the_view_query_and_shows_the_server_hash", async () => {
  // Verify: one POST with the page query and JSON header, no files; the entry takes the server hash.
  installCommitRoute(() => buildStreamResponse([COMMITTED_REPLY]));
  openPendingDraft(REAL_VIEW);
  await clickCommit();
  assert.equal(sent.length, 1);
  assert.equal(sent[0]!.pathname + sent[0]!.search, `/api/layer1-jfred-commit${SEARCH}`);
  assert.deepEqual(sent[0]!.init.headers, { "content-type": "application/json" });
  assert.deepEqual(JSON.parse(String(sent[0]!.init.body)), { baseShortHash: "a1b2c3d4", markInstant: TICKS[2]!.instant, message: "draft message", allowScripts: false });
  assert.equal(readJfredBranch().commits.at(-1)!.shortHash, "deadbeef");
  assert.equal(document.getElementById("jfred-strip")!.innerHTML.includes("c0ffee"), false);
  assert.equal(document.querySelector("#dbody pre")!.textContent, "server message");
});

test("test_commit_click_on_a_canned_branch_posts_like_a_real_one", async () => {
  // Verify: a canned view sends one request and appends the reply as its entry.
  installCommitRoute(() => buildStreamResponse([COMMITTED_REPLY]));
  openPendingDraft(CANNED_VIEW);
  await clickCommit();
  assert.equal(sent.length, 1);
  assert.deepEqual(readJfredBranch().commits.map((commit) => commit.shortHash), ["deadbeef"]);
});

test("test_commit_click_paints_the_streamed_progress_on_the_loading_bar_and_closes_it_after_the_reply", async () => {
  // Verify: bar and shield show the progress label while the stream is open, then both hide.
  const stream = buildOpenStream();
  installCommitRoute(() => stream.response);
  openPendingDraft(REAL_VIEW);
  stream.push({ kind: "progress", label: "building the commit", current: 1, total: 3 });
  await clickCommit();
  assert.equal(document.getElementById("loadbar-label")!.textContent, "building the commit — 1 / 3");
  assert.deepEqual(readBarsHidden(), [false, false]);
  stream.push({ kind: "progress", label: "building the commit", current: 3, total: 3 });
  stream.push(COMMITTED_REPLY);
  stream.close();
  await settle();
  assert.deepEqual(readBarsHidden(), [true, true]);
});

test("test_cancelling_the_commit_keeps_the_pending_mark_and_shows_no_toast", async () => {
  // Verify: Cancel then Yes on the loading bar aborts the stream; the draft stays and no toast shows.
  const stream = buildOpenStream();
  installCommitRoute((init) => {
    init.signal!.addEventListener("abort", stream.fail);
    return stream.response;
  });
  openPendingDraft(REAL_VIEW);
  await clickCommit();
  document.getElementById("loadbar-cancel")!.click();
  document.getElementById("loadbar-confirm-yes")!.click();
  await settle();
  assert.equal(readJfredBranch().pending!.message, "draft message");
  assert.equal(document.getElementById("dtoast")!.hidden, true);
  assert.deepEqual(readBarsHidden(), [true, true]);
});

test("test_failed_commit_keeps_the_pending_mark_shows_the_error_toast_and_rethrows", async () => {
  // Verify: a 400 text keeps the draft, toasts the text and hides bar and shield.
  installCommitRoute(() => new Response("range is bad", { status: 400 }));
  openPendingDraft(REAL_VIEW);
  await checkFailedCommit("range is bad");
});

test("test_failed_commit_from_a_stream_error_line_keeps_the_pending_mark_and_hides_the_bar", async () => {
  // Verify: an error line after a progress line toasts its label and keeps the draft.
  installCommitRoute(() => buildStreamResponse([{ kind: "progress", label: "building", current: 1, total: 2 }, { kind: "error", label: "engine failed" }]));
  openPendingDraft(REAL_VIEW);
  await checkFailedCommit("engine failed");
});
