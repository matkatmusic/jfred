// engineV3 mockup bar: five buttons and a Session column node click move the marker; fake data only.

import { getRequiredElementById } from "../../app-dom.ts";
import {
  CURRENT_NODE_CLASS, containsCommitAfterMarker, isMarkerOnFirstStep, isMarkerOnLastStep, moveMarkerBackward, moveMarkerForward, moveMarkerToNextCommit,
  moveMarkerToNode, moveMarkerToPreviousCommit, readCurrentStep, readMarkerIndex, resetMarkerToStart, storeEngineV3Steps,
} from "./layer1-engine-v3-state.ts";
import { renderEngineV3Line, moveEngineV3LineIntoView } from "./layer1-engine-v3-line.ts";
import type { WireEngineV3Steps } from "./layer1-wire-engine-v3.ts";
import type { WireLayer1View } from "../../layer1-wire.ts";

const NO_STEPS_SENTENCE = "No steps are loaded.";
const NO_FILES_TEXT = "No files changed.";

// Marks a Session dot by record id, or a commit's nodes by hash.
function markCurrentNode(): void {
  for (const node of document.querySelectorAll("i.current-node")) {
    node.classList.remove(CURRENT_NODE_CLASS);
  }
  const step = readCurrentStep();
  if (step === undefined) {
    return;
  }
  for (const node of document.querySelectorAll(`i.anode[data-record-id="${step.nodeId}"], i.node.n-commit[title="${step.nodeId}"]`)) {
    node.classList.add(CURRENT_NODE_CLASS);
  }
}

function formatFilesChanged(filesChanged: readonly string[]): string {
  if (filesChanged.length === 0) {
    return NO_FILES_TEXT;
  }
  return `Files changed: ${filesChanged.join(", ")}`;
}

function renderReadout(): void {
  const step = readCurrentStep();
  getRequiredElementById("engine-v3-bar").dataset["markerIndex"] = String(readMarkerIndex());
  if (step === undefined) {
    getRequiredElementById("engine-v3-sentence").textContent = NO_STEPS_SENTENCE;
    getRequiredElementById("engine-v3-files").textContent = "";
    return;
  }
  getRequiredElementById("engine-v3-sentence").textContent = step.sentence;
  getRequiredElementById("engine-v3-files").textContent = formatFilesChanged(step.filesChanged);
}

function setButtonOff(id: string, isOff: boolean): void {
  (getRequiredElementById(id) as HTMLButtonElement).disabled = isOff;
}

function renderButtonRules(): void {
  const isOnFirstStep = isMarkerOnFirstStep();
  setButtonOff("engine-v3-start-over", isOnFirstStep);
  setButtonOff("engine-v3-previous-commit", isOnFirstStep);
  setButtonOff("engine-v3-step-backwards", isOnFirstStep);
  setButtonOff("engine-v3-step-forward", isMarkerOnLastStep());
  setButtonOff("engine-v3-next-commit", !containsCommitAfterMarker());
}

export function renderMarker(): void {
  markCurrentNode();
  renderReadout();
  renderButtonRules();
  renderEngineV3Line();
}

function moveMarkerOnNodeClick(event: MouseEvent): void {
  const node = (event.target as HTMLElement).closest<HTMLElement>("i.anode");
  if (node === null) {
    return;
  }
  moveMarkerToNode(node.dataset["recordId"]!);
  renderMarker();
  moveEngineV3LineIntoView();
}

// Assigned, so a re-render never stacks handlers.
function attachMarkerButton(id: string, moveMarker: () => void): void {
  getRequiredElementById(id).onclick = () => {
    moveMarker();
    renderMarker();
    moveEngineV3LineIntoView();
  };
}

function attachMarkerButtons(): void {
  attachMarkerButton("engine-v3-start-over", resetMarkerToStart);
  attachMarkerButton("engine-v3-previous-commit", moveMarkerToPreviousCommit);
  attachMarkerButton("engine-v3-step-backwards", moveMarkerBackward);
  attachMarkerButton("engine-v3-step-forward", moveMarkerForward);
  attachMarkerButton("engine-v3-next-commit", moveMarkerToNextCommit);
}

async function fetchEngineV3Steps(): Promise<WireEngineV3Steps> {
  const response = await fetch("/api/layer1-engine-v3-steps");
  if (!response.ok) {
    throw new Error(`/api/layer1-engine-v3-steps answered ${response.status}`);
  }
  return await response.json() as WireEngineV3Steps;
}

// Fixture mode only: real views carry no annotations, so the bar stays hidden and nothing is fetched.
export async function loadEngineV3Steps(view: Pick<WireLayer1View, "annotations">): Promise<void> {
  const bar = getRequiredElementById("engine-v3-bar");
  bar.hidden = view.annotations === undefined;
  if (view.annotations === undefined) {
    return;
  }
  const reply = await fetchEngineV3Steps();
  storeEngineV3Steps(reply.steps);
  attachMarkerButtons();
  // Delegated: the Session column redraws its nodes on scroll. A named function, so adding it again is a no-op.
  document.addEventListener("click", moveMarkerOnNodeClick);
  renderMarker();
}
