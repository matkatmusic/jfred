// Test for webapp/layer1-jfred-strip.ts: the commit column beside the session column, its delete button and entry clicks.

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { initLayer1Dom, waitForAsyncWork } from "./webapp-dom-test-helpers.ts";
import { buildNdjsonResponse } from "./webapp-fetch-test-helpers.ts";
import type { WireRulerTick } from "../webapp/layer1-wire.ts";

// layer1-page.ts boots at MODULE SCOPE, so absorb that first boot here against a throwaway DOM.
initLayer1Dom();
const { openPendingMessage, renderJfredEntries, renderJfredStrip } = await import("../webapp/layer1-components/commits-column/layer1-jfred-strip.ts");
const { loadJfredBranch, readJfredBranch, setArmed, setPending } = await import("../webapp/layer1-components/commits-column/layer1-jfred-state.ts");

const TICKS: WireRulerTick[] = [
  { instant: "2026-06-01T09:00:00.000Z", axisPx: 100, eventCount: 1 },
  { instant: "2026-06-01T09:05:00.000Z", axisPx: 160, eventCount: 1 },
  { instant: "2026-06-03T10:30:00.000Z", axisPx: 400, eventCount: 1 },
  { instant: "2026-06-03T18:20:00.000Z", axisPx: 480, eventCount: 1 },
];
const EMPTY_VIEW = { pairs: [], gitOrphans: [], diskOrphans: [], ruler: [] };
const CANNED_VIEW = {
  ...EMPTY_VIEW,
  jfredCommits: {
    isCanned: true as const,
    base: { instant: TICKS[0]!.instant, shortHash: "a1b2c3d4" },
    commits: [
      { instant: TICKS[1]!.instant, shortHash: "c0ffee01", parentShortHash: "a1b2c3d4", message: "message one" },
      { instant: TICKS[2]!.instant, shortHash: "c0ffee02", parentShortHash: "c0ffee01", message: "message two" },
    ],
  },
};

beforeEach(() => {
  initLayer1Dom();
  loadJfredBranch(CANNED_VIEW);
  setArmed(true);
});

const NEEDS_PATHNAME = "/api/layer1-script-replay-needs";
const RUN_PATHNAME = "/api/layer1-script-replay-run";
const COMMIT_PATHNAME = "/api/layer1-jfred-commit";
const COMMITTED_LINE = { outcome: "committed", commit: { instant: TICKS[3]!.instant, shortHash: "c0ffee03", parentShortHash: "c0ffee02", message: "draft message" } };
const NO_TASKS_LINE = { tasks: [] };
const ONE_TASK_LINE = { tasks: [{ taskId: "t1", instant: TICKS[1]!.instant, isInSpan: true, code: "print(1)", cwd: "/w", language: "python", waitingFiles: [{ path: "a.txt", reason: "named-by-file" }] }] };
const RUN_REPLY_LINE = { results: [] };
const MISSING_EXECUTABLE_REPLY_LINE = { results: [{ taskId: "t1", outcome: "replay-failed", missingExecutable: "ffmpeg", timedOut: false, stdout: "", stderr: "", files: [] }] };
let sentCalls: { pathname: string; body: any }[] = [];

function installReplayRoutes(needsLine: unknown, runLine: unknown): void {
  sentCalls = [];
  const linesByPathname: Record<string, unknown> = { [NEEDS_PATHNAME]: needsLine, [RUN_PATHNAME]: runLine, [COMMIT_PATHNAME]: COMMITTED_LINE };
  Object.assign(globalThis, {
    fetch: async (url: unknown, init: RequestInit): Promise<Response> => {
      const { pathname } = new URL(String(url), "http://localhost:7343");
      sentCalls.push({ pathname, body: JSON.parse(String(init.body)) });
      return buildNdjsonResponse([linesByPathname[pathname]]);
    },
  });
}

function readSentPathnames(): string[] {
  return sentCalls.map((call) => call.pathname);
}

async function settleCommitFlow(): Promise<void> {
  for (let round = 0; round < 4; round++)
    await waitForAsyncWork();
}

async function clickCommitOnPendingMark(): Promise<void> {
  setPending({ instant: TICKS[3]!.instant, message: "draft message" });
  renderJfredStrip(TICKS);
  openPendingMessage();
  document.getElementById("jfred-commit-button")!.click();
  await settleCommitFlow();
}

async function clickPopupButton(dataComponent: string): Promise<void> {
  document.querySelector<HTMLElement>(`[data-component="${dataComponent}"]`)!.click();
  await settleCommitFlow();
}

function addAnnotationTrack(): HTMLElement {
  const track = document.createElement("div");
  track.id = "sessionDotLinesComponent";
  document.getElementById("timelineRulerComponent")!.after(track);
  return track;
}

function findEntry(shortHashOrKind: string): HTMLElement {
  return document.querySelector<HTMLElement>(`#jfredCommitsDrawerComponent [data-short-hash="${shortHashOrKind}"], #jfredCommitsDrawerComponent [data-entry-kind="${shortHashOrKind}"]`)!;
}

test("test_the_strip_is_the_sibling_right_after_the_session_column", () => {
  // Verify: with a track present, the strip sits right after it.
  const track = addAnnotationTrack();
  renderJfredStrip(TICKS);
  assert.equal(track.nextElementSibling!.id, "jfredCommitsDrawerComponent");
});

test("test_without_a_session_column_the_strip_follows_the_ruler", () => {
  // Verify: the timelineRulerComponent is the anchor when no track exists.
  renderJfredStrip(TICKS);
  assert.equal(document.getElementById("timelineRulerComponent")!.nextElementSibling!.id, "jfredCommitsDrawerComponent");
});

test("test_a_second_render_keeps_one_strip_with_one_head", () => {
  // Verify: the strip is built once; the second render only redraws it.
  renderJfredStrip(TICKS);
  renderJfredStrip(TICKS);
  assert.equal(document.querySelectorAll("#jfredCommitsDrawerComponent").length, 1);
  assert.equal(document.querySelectorAll("#jfredCommitsDrawerComponent .jhead").length, 1);
  assert.equal(document.querySelectorAll("#jfredCommitsDrawerComponent .jnode").length, 3);
});

test("test_the_head_holds_the_title_and_the_delete_button", () => {
  // Verify: the head reads `commits` and carries `Delete jfred branch`.
  renderJfredStrip(TICKS);
  assert.equal(document.querySelector("#jfredCommitsDrawerComponent .jhead span")!.textContent, "commits");
  assert.equal(document.querySelector("#jfredCommitsDrawerComponent .jhead button.jdelete")!.textContent, "Delete jfred branch");
});

test("test_commit_mode_off_removes_the_strip", () => {
  // Verify: with Commit mode off the next render removes the strip.
  renderJfredStrip(TICKS);
  setArmed(false);
  renderJfredStrip(TICKS);
  assert.equal(document.getElementById("jfredCommitsDrawerComponent"), null);
});

test("test_the_delete_button_clears_the_state_and_keeps_the_head", async () => {
  // Verify: after the Yes answer, base, commits and pending are gone, no entry is drawn, the head stays.
  renderJfredStrip(TICKS);
  document.querySelector<HTMLElement>("#jfredCommitsDrawerComponent .jdelete")!.click();
  document.querySelector<HTMLElement>("#yesno-row .yesno-yes")!.click();
  await waitForAsyncWork();
  const branch = readJfredBranch();
  assert.equal(branch.base, undefined);
  assert.equal(branch.commits.length, 0);
  assert.equal(document.querySelectorAll("#jfredCommitsDrawerComponent .jhead").length, 1);
  assert.equal(document.querySelectorAll("#jfredCommitsDrawerComponent .jnode").length, 0);
});

test("test_a_click_on_a_commit_entry_opens_its_message_without_a_button", () => {
  // Verify: the detailsPaneContainer shows the stored message, header and parent.
  renderJfredStrip(TICKS);
  findEntry("c0ffee02").click();
  assert.equal(document.getElementById("dpath")!.textContent, "jfred commit c0ffee02");
  assert.equal(document.getElementById("dmeta")!.textContent, "parent c0ffee01 | author date 2026-06-03T10:30:00.000Z");
  assert.equal(document.querySelector("#dbody pre")!.textContent, "message two");
  assert.equal(document.getElementById("jfred-commit-button"), null);
});

test("test_a_click_on_a_label_opens_the_same_message", () => {
  // Verify: the delegated click works from the label too.
  renderJfredStrip(TICKS);
  document.querySelector<HTMLElement>('#jfredCommitsDrawerComponent .jlabel[data-short-hash="c0ffee01"]')!.click();
  assert.equal(document.querySelector("#dbody pre")!.textContent, "message one");
});

test("test_a_click_on_the_pending_entry_opens_its_message_with_a_commit_button", () => {
  // Verify: the pending draft shows with the Commit button and the tip as parent.
  setPending({ instant: TICKS[3]!.instant, message: "draft message" });
  renderJfredStrip(TICKS);
  findEntry("pending").click();
  assert.equal(document.getElementById("dpath")!.textContent, "jfred commit (pending)");
  assert.equal(document.getElementById("dmeta")!.textContent, "parent c0ffee02 | author date 2026-06-03T18:20:00.000Z");
  assert.equal(document.querySelector("#dbody pre")!.textContent, "draft message");
  assert.notEqual(document.getElementById("jfred-commit-button"), null);
});

test("test_the_commit_button_adds_the_entry_and_the_drawer_shows_it_without_a_button", async () => {
  // Verify: Commit posts, the streamed reply adds c0ffee03 with parent c0ffee02, redraws the column and drops the button.
  installReplayRoutes(NO_TASKS_LINE, RUN_REPLY_LINE);
  await clickCommitOnPendingMark();
  assert.equal(readJfredBranch().commits.at(-1)!.shortHash, "c0ffee03");
  assert.equal(findEntry("c0ffee03").dataset["parentHash"], "c0ffee02");
  assert.equal(document.querySelectorAll("#jfredCommitsDrawerComponent .jnode").length, 4);
  assert.equal(document.getElementById("dpath")!.textContent, "jfred commit c0ffee03");
  assert.equal(document.getElementById("jfred-commit-button"), null);
});

test("test_a_click_on_the_base_opens_nothing", () => {
  // Verify: the base has no message, so the detailsPaneContainer stays closed.
  renderJfredStrip(TICKS);
  findEntry("base").click();
  assert.equal(document.getElementById("detailsPaneContainer")!.classList.contains("open"), false);
});

test("test_redraw_builds_the_strip_from_the_stored_ticks", async () => {
  // Verify: after a delete, a new base plus a redraw brings the entry back without new ticks.
  renderJfredStrip(TICKS);
  document.querySelector<HTMLElement>("#jfredCommitsDrawerComponent .jdelete")!.click();
  document.querySelector<HTMLElement>("#yesno-row .yesno-yes")!.click();
  await waitForAsyncWork();
  loadJfredBranch(CANNED_VIEW);
  renderJfredEntries();
  assert.equal(document.querySelectorAll("#jfredCommitsDrawerComponent .jnode").length, 3);
});

test("test_commit_without_tasks_skips_the_popup_and_the_run", async () => {
  // Verify: no task means no popup, no run request, and a commit with allowScripts false.
  installReplayRoutes(NO_TASKS_LINE, RUN_REPLY_LINE);
  await clickCommitOnPendingMark();
  assert.deepEqual(readSentPathnames(), [NEEDS_PATHNAME, COMMIT_PATHNAME]);
  assert.equal(document.querySelector('[data-component="runConsentPopup"]'), null);
  assert.equal(sentCalls[1]!.body.allowScripts, false);
});

test("test_commit_with_tasks_opens_the_popup_before_the_commit", async () => {
  // Verify: with one task the popup shows both buttons and only the needs request has been sent.
  installReplayRoutes(ONE_TASK_LINE, RUN_REPLY_LINE);
  await clickCommitOnPendingMark();
  assert.notEqual(document.querySelector('[data-component="runConsentPopup"]'), null);
  assert.equal(document.querySelector('[data-component="runConsentRunButton"]')!.textContent, "Run scripts");
  assert.equal(document.querySelector('[data-component="runConsentContinueWithoutRunningButton"]')!.textContent, "Continue without running");
  assert.deepEqual(readSentPathnames(), [NEEDS_PATHNAME]);
});

test("test_run_answer_posts_the_run_then_the_commit_with_allow_scripts_true", async () => {
  // Verify: Run scripts sends needs, run (allowScripts true, toInstant the mark), then the commit with allowScripts true.
  installReplayRoutes(ONE_TASK_LINE, RUN_REPLY_LINE);
  await clickCommitOnPendingMark();
  await clickPopupButton("runConsentRunButton");
  assert.deepEqual(readSentPathnames(), [NEEDS_PATHNAME, RUN_PATHNAME, COMMIT_PATHNAME]);
  assert.deepEqual(sentCalls[1]!.body, { toInstant: TICKS[3]!.instant, allowScripts: true });
  assert.equal(sentCalls[2]!.body.allowScripts, true);
});

test("test_continue_answer_posts_no_run_and_the_commit_with_allow_scripts_false", async () => {
  // Verify: Continue without running sends needs, then the commit with allowScripts false, and no run.
  installReplayRoutes(ONE_TASK_LINE, RUN_REPLY_LINE);
  await clickCommitOnPendingMark();
  await clickPopupButton("runConsentContinueWithoutRunningButton");
  assert.deepEqual(readSentPathnames(), [NEEDS_PATHNAME, COMMIT_PATHNAME]);
  assert.equal(sentCalls[1]!.body.allowScripts, false);
});

test("test_needs_range_starts_at_the_tip_instant", async () => {
  // Verify: the needs request runs from the last jfred commit instant to the mark.
  installReplayRoutes(NO_TASKS_LINE, RUN_REPLY_LINE);
  await clickCommitOnPendingMark();
  assert.deepEqual(sentCalls[0]!.body, { fromInstant: TICKS[2]!.instant, toInstant: TICKS[3]!.instant });
});

test("test_run_reply_with_a_missing_executable_opens_the_notice_before_the_commit", async () => {
  // Verify: after Run scripts the notice names the program; the commit is sent only after Close.
  installReplayRoutes(ONE_TASK_LINE, MISSING_EXECUTABLE_REPLY_LINE);
  await clickCommitOnPendingMark();
  await clickPopupButton("runConsentRunButton");
  assert.match(document.querySelector('[data-component="missingExecutablesPopup"]')!.textContent!, /ffmpeg/);
  assert.deepEqual(readSentPathnames(), [NEEDS_PATHNAME, RUN_PATHNAME]);
  await clickPopupButton("missingExecutablesCloseButton");
  assert.deepEqual(readSentPathnames(), [NEEDS_PATHNAME, RUN_PATHNAME, COMMIT_PATHNAME]);
});
