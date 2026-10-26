// Task 329/336: the multi-file drawer: the wash file sweep and the one fold button.

import { test } from "node:test";
import assert from "node:assert/strict";
import { el, getRequiredElementById } from "../webapp/app-dom.ts";
import { displayDetailView } from "../webapp/layer1-diff-view.ts";
import { listWashFiles, wireMultiFileDrawer } from "../webapp/layer1-drawer-multi.ts";
import type { WireLayer1View } from "../webapp/layer1-wire.ts";
import { initLayer1Dom } from "./webapp-dom-test-helpers.ts";

const T0 = "2026-07-01T10:00:00.000Z";
const T1 = "2026-07-01T11:00:00.000Z";
const T2 = "2026-07-01T12:00:00.000Z";
const T3 = "2026-07-01T13:00:00.000Z";

// Task 336: three pairs plus a disk orphan and a git orphan, to prove the sweep's inclusion rule.
const SWEEP_VIEW: WireLayer1View = {
  pairs: [
    { path: "src/clicked-a.ts", commits: [], onDisk: { instant: T0, axisPx: 0 } },
    { path: "src/clicked-b.ts", commits: [], onDisk: { instant: T2, axisPx: 20 } },
    { path: "src/swept.ts", commits: [], onDisk: { instant: T1, axisPx: 10 } },
    { path: "src/excluded.ts", commits: [], onDisk: { instant: T3, axisPx: 30 } },
  ],
  gitOrphans: [{ path: "src/gone.ts", instant: T1, axisPx: 10 }],
  diskOrphans: [{ path: "notes-swept.txt", instant: T0, axisPx: 0 }],
  ruler: [],
};

test("listWashFiles sweeps in a pair whose step lands inside the range", () => {
  const files = listWashFiles(SWEEP_VIEW, { baseInstant: T0, targetInstant: T2 }, ["src/clicked-a.ts", "src/clicked-b.ts"]);
  assert.ok(files.includes("src/swept.ts"));
});

test("listWashFiles excludes a pair whose step falls outside the range", () => {
  const files = listWashFiles(SWEEP_VIEW, { baseInstant: T0, targetInstant: T2 }, ["src/clicked-a.ts", "src/clicked-b.ts"]);
  assert.equal(files.includes("src/excluded.ts"), false);
});

test("listWashFiles sweeps in a disk orphan whose step lands inside the range", () => {
  const files = listWashFiles(SWEEP_VIEW, { baseInstant: T0, targetInstant: T2 }, []);
  assert.ok(files.includes("notes-swept.txt"));
});

test("listWashFiles never sweeps in a git orphan (no diffable steps)", () => {
  // src/gone.ts's own instant (T1) sits inside T0..T2, but it has no ladder to test: it must stay excluded.
  const files = listWashFiles(SWEEP_VIEW, { baseInstant: T0, targetInstant: T2 }, []);
  assert.equal(files.includes("src/gone.ts"), false);
});

test("listWashFiles always includes the caller's alwaysInclude paths, deduped and sorted", () => {
  // A day past every fixture instant: nothing touches it, isolating alwaysInclude's dedupe and sort.
  const noTouchRange = { baseInstant: "2026-07-02T00:00:00.000Z", targetInstant: "2026-07-02T00:00:00.000Z" };
  const files = listWashFiles(SWEEP_VIEW, noTouchRange, ["src/clicked-b.ts", "src/clicked-a.ts", "src/clicked-a.ts"]);
  assert.deepEqual(files, ["src/clicked-a.ts", "src/clicked-b.ts"]);
});

test("the one fold button flips with the sections and follows hand toggles", () => {
  initLayer1Dom();
  const sections = [el("details", { class: "dfile", open: "" }), el("details", { class: "dfile", open: "" })] as HTMLDetailsElement[];
  displayDetailView(sections);
  wireMultiFileDrawer();
  const foldButton = getRequiredElementById("dfold-all");
  const toggleByHand = (section: HTMLDetailsElement, open: boolean): void => {
    section.open = open;
    section.dispatchEvent(new window.Event("toggle"));
  };
  assert.equal(foldButton.textContent, "Collapse all");
  foldButton.click();
  assert.ok(sections.every((section) => !section.open));
  assert.equal(foldButton.textContent, "Show all");
  foldButton.click();
  assert.ok(sections.every((section) => section.open));
  assert.equal(foldButton.textContent, "Collapse all");
  toggleByHand(sections[0]!, false);
  assert.equal(foldButton.textContent, "Collapse all");
  toggleByHand(sections[1]!, false);
  assert.equal(foldButton.textContent, "Show all");
  toggleByHand(sections[1]!, true);
  assert.equal(foldButton.textContent, "Collapse all");
});
