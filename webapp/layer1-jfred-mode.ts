// Task 383: shows the Commit mode button in fixture mode and loads the jfred branch once per page.

import { getRequiredElementById } from "./app-dom.ts";
import { repaintCutMarks } from "./layer1-cut-paint.ts";
import { installCutMarkClick } from "./layer1-cut-marks.ts";
import { refreshJfredStrip } from "./layer1-jfred-strip.ts";
import { loadJfredBranch, readJfredBranch, setArmed } from "./layer1-jfred-state.ts";
import type { WireLayer1View } from "./layer1-wire.ts";

// Module state: a later render must not reload the wire data over fake commits and Delete.
let isBranchLoaded = false;

function toggleCommitMode(): void {
  setArmed(!readJfredBranch().isArmed);
  getRequiredElementById("commit-mode").classList.toggle("current", readJfredBranch().isArmed);
  repaintCutMarks();
  refreshJfredStrip();
}

export function rememberJfredCommits(view: WireLayer1View): void {
  const button = getRequiredElementById("commit-mode");
  button.hidden = view.jfredCommits === undefined;
  if (view.jfredCommits === undefined)
    return;
  if (!isBranchLoaded)
    loadJfredBranch(view);
  isBranchLoaded = true;
  // Assigned, so a re-render never stacks handlers.
  button.onclick = toggleCommitMode;
  installCutMarkClick();
}
