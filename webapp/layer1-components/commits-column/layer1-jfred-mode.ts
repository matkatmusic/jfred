// Task 383: shows the Commit mode button in fixture mode and loads the jfred branch once per page.

import { getInputById, getRequiredElementById } from "../../app-dom.ts";
import { getJfredBaseHashForProject, saveJfredBaseHash } from "../../layer1-settings.ts";
import { openToast } from "../details-drawer/layer1-diff-pane-support.ts";
import { toggleKindBox } from "../show-row/layer1-kind-filter.ts";
import { repaintCutMarks } from "./layer1-cut-paint.ts";
import { installCutMarkClick } from "./layer1-cut-marks.ts";
import { refreshJfredStrip } from "./layer1-jfred-strip.ts";
import { applyBaseFromHash, loadJfredBranch, readJfredBranch, setArmed } from "./layer1-jfred-state.ts";
import type { WireLayer1View } from "../../layer1-wire.ts";

// Module state: a later render must not reload the wire data over fake commits and Delete.
let isBranchLoaded = false;

const KINDS_NOT_LOADED_TEXT = "Commit mode needs every node type, and one did not load. Commit mode stays off.";

function loadSavedBase(view: WireLayer1View): void {
  const branchBeforeRestore = readJfredBranch();
  if (branchBeforeRestore.base !== undefined)
    return;
  const savedHash = getJfredBaseHashForProject(getInputById("dir").value.trim());
  if (savedHash === "")
    return;
  applyBaseFromHash(view, savedHash);
  const branchAfterRestore = readJfredBranch();
  if (branchAfterRestore.base === undefined)
    saveJfredBaseHash("");
}

async function enableEveryKind(): Promise<boolean> {
  const kindBoxes = document.querySelectorAll<HTMLInputElement>("#show-row input[data-kind]");
  for (const box of kindBoxes) {
    if (!box.checked) {
      box.checked = true;
      await toggleKindBox(box);
    }
  }
  for (const box of kindBoxes) {
    if (!box.checked)
      return false;
  }
  return true;
}

async function toggleCommitMode(): Promise<void> {
  const branchBeforeToggle = readJfredBranch();
  if (!branchBeforeToggle.isArmed) {
    const areAllKindsOn = await enableEveryKind();
    if (!areAllKindsOn) {
      openToast(KINDS_NOT_LOADED_TEXT);
      return;
    }
  }
  setArmed(!readJfredBranch().isArmed);
  getRequiredElementById("commit-mode").classList.toggle("current", readJfredBranch().isArmed);
  repaintCutMarks();
  refreshJfredStrip();
}

function loadBranchForView(view: WireLayer1View, isCanned: boolean): void {
  if (isCanned) {
    if (!isBranchLoaded) {
      loadJfredBranch(view);
      isBranchLoaded = true;
    }
    return;
  }
  loadJfredBranch(view);
  loadSavedBase(view);
}

export function rememberJfredCommits(view: WireLayer1View): void {
  const button = getRequiredElementById("commit-mode");
  button.hidden = view.jfredCommits === undefined;
  if (view.jfredCommits === undefined)
    return;
  loadBranchForView(view, view.jfredCommits.isCanned === true);
  // Assigned, so a re-render never stacks handlers.
  button.onclick = toggleCommitMode;
  installCutMarkClick();
}
