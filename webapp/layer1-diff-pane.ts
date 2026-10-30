// Task 329: THE diff pane — the single-pair drawer and every multi-file section share this one controller.

import { createElement } from "./app-dom.ts";
import { appendColumnsDiff, appendInlineDiff } from "./diff-render.ts";
import { buildPairText, buildPatchText, computeArrowDisabledFlags, openToast, fetchDiffContent, savePatchFile, type DiffPane, type DiffPaneMounts, type DiffPaneOptions } from "./layer1-diff-pane-support.ts";

export const DiffPaneMode = Object.freeze({ side: "side", inline: "inline" } as const);
export type DiffPaneModeValue = (typeof DiffPaneMode)[keyof typeof DiffPaneMode];

// One diffable revision: a marker plus its fully-computed file state AS A STRING; any source works.
export type DiffStep = {
  marker: string;
  // The /api/layer1-file query behind loadContent, exposed so an image section can fetch bytes.
  buildParams: () => URLSearchParams;
  loadContent: () => Promise<string>;
};

export function createDiffPane(mounts: DiffPaneMounts, options: DiffPaneOptions): DiffPane {
  let mode = options.mode;
  let fullContents = options.fullContents;
  let shown: { path: string; steps: DiffStep[]; baseIndex: number; targetIndex: number } | undefined;
  let diffText = "";
  // Same STRING on both sides — same revision picked twice, or no change between revisions.
  let identicalSides = false;

  function updateControls(): void {
    for (const button of mounts.modeButtons) {
      button.classList.toggle("current", button.dataset.mode === mode);
    }
    mounts.fullToggle.checked = fullContents;
    if (shown === undefined) {
      return;
    }
    // Identical sides ARE the whole file: full content is forced on and the toggle locked.
    mounts.fullToggle.checked = fullContents || identicalSides;
    mounts.fullToggle.disabled = identicalSides;
    // Identical sides are not a diff: the tools row vanishes until the contents differ.
    if (mounts.toolsRow !== undefined) {
      mounts.toolsRow.style.display = identicalSides ? "none" : "";
    }
    const disabledFlags = computeArrowDisabledFlags(shown.baseIndex, shown.targetIndex, shown.steps.length);
    for (let at = 0; at < mounts.arrows.length; at++) {
      mounts.arrows[at]!.disabled = disabledFlags[at]!;
    }
  }

  function renderBody(): void {
    if (shown === undefined) {
      return;
    }
    updateControls();
    if (diffText === "") {
      mounts.body.replaceChildren(createElement("div", { class: "dbinary", text: "No text differences between these revisions." }));
      return;
    }
    mounts.body.replaceChildren();
    (mode === DiffPaneMode.inline ? appendInlineDiff : appendColumnsDiff)(mounts.body, diffText, shown.path);
  }

  async function loadDiffText(): Promise<boolean> {
    const { steps, baseIndex, targetIndex } = shown!;
    mounts.body.textContent = "loading…";
    try {
      const [base, target] = await Promise.all([steps[baseIndex]!.loadContent(), steps[targetIndex]!.loadContent()]);
      identicalSides = base === target;
      const response = await fetchDiffContent(base, target, fullContents || identicalSides);
      if (!response.ok) {
        mounts.body.textContent = await response.text();
        return false;
      }
      diffText = (await response.json() as { diff: string }).diff;
      return true;
    }
    catch (error) {
      mounts.body.textContent = String(error);
      return false;
    }
  }

  async function loadAndRenderDiff(): Promise<void> {
    const loaded = await loadDiffText();
    if (loaded) {
      renderBody();
    }
  }

  async function selectPair(path: string, steps: DiffStep[], baseIndex: number, targetIndex: number): Promise<void> {
    shown = { path, steps, baseIndex, targetIndex };
    const pairText = buildPairText(steps[baseIndex]!.marker, steps[targetIndex]!.marker, baseIndex === targetIndex);
    mounts.pairLabel.textContent = pairText.label;
    mounts.meta.textContent = pairText.meta;
    updateControls();
    await loadAndRenderDiff();
  }

  function selectMode(event: Event): void {
    event.preventDefault();
    mode = (event.currentTarget as HTMLElement).dataset.mode as DiffPaneModeValue;
    renderBody();
  }

  // Task 320: full content is a context-width toggle — the diff stays shown, refetched wider/narrower.
  function toggleFullContents(): void {
    fullContents = mounts.fullToggle.checked;
    if (shown === undefined) {
      return;
    }
    void loadAndRenderDiff();
  }

  function moveSide(event: Event): void {
    event.preventDefault();
    const arrow = event.currentTarget as HTMLButtonElement;
    const isBlocked = shown === undefined || arrow.disabled;
    if (isBlocked) {
      return;
    }
    const at = mounts.arrows.indexOf(arrow);
    const side = at < 2 ? "baseIndex" : "targetIndex";
    shown![side] += at % 2 === 0 ? -1 : 1;
    void selectPair(shown!.path, shown!.steps, shown!.baseIndex, shown!.targetIndex);
    options.onSidesChanged?.(shown!.baseIndex, shown!.targetIndex);
  }

  function savePatch(event: Event): void {
    event.preventDefault();
    const hasNoDiff = shown === undefined || diffText === "";
    if (hasNoDiff) {
      openToast("no differences to export");
      return;
    }
    savePatchFile(shown!.path, buildPatchText(shown!.path, diffText));
  }

  function clearShown(): void {
    shown = undefined;
  }

  for (const button of mounts.modeButtons) {
    button.addEventListener("click", selectMode);
  }
  mounts.fullToggle.addEventListener("change", toggleFullContents);
  for (const arrow of mounts.arrows) {
    arrow.addEventListener("click", moveSide);
  }
  mounts.exportButton.addEventListener("click", savePatch);

  return { showPair: selectPair, clear: clearShown };
}
