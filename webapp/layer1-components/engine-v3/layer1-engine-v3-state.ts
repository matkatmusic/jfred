// engineV3 mockup state: the step list and the marker. The marker lives in the browser only.

import { EngineV3StepKind, type WireEngineV3Step } from "./layer1-wire-engine-v3.ts";

// The first step is the first commit in the repo: the docker container starts there.
const FIRST_STEP_INDEX = 0;

// Put on the node that the marker is at: a Session column node or a commit node.
export const CURRENT_NODE_CLASS = "current-node";

let steps: WireEngineV3Step[] = [];
let markerIndex = FIRST_STEP_INDEX;

export function storeEngineV3Steps(nextSteps: WireEngineV3Step[]): void {
  steps = nextSteps;
  markerIndex = FIRST_STEP_INDEX;
}

export function readMarkerIndex(): number {
  return markerIndex;
}

export function readCurrentStep(): WireEngineV3Step | undefined {
  return steps[markerIndex];
}

export function isCurrentEngineV3Node(nodeId: string): boolean {
  return steps[markerIndex]?.nodeId === nodeId;
}

export function isMarkerOnFirstStep(): boolean {
  return markerIndex === FIRST_STEP_INDEX;
}

export function isMarkerOnLastStep(): boolean {
  return markerIndex === steps.length - 1;
}

export function moveMarkerForward(): void {
  markerIndex = Math.min(markerIndex + 1, steps.length - 1);
}

export function moveMarkerBackward(): void {
  markerIndex = Math.max(markerIndex - 1, FIRST_STEP_INDEX);
}

export function resetMarkerToStart(): void {
  markerIndex = FIRST_STEP_INDEX;
}

export function moveMarkerToNode(nodeId: string): void {
  for (const [index, step] of steps.entries()) {
    const isNode = step.nodeId === nodeId;
    if (isNode) {
      markerIndex = index;
      return;
    }
  }
}

function findNextCommitIndex(): number | undefined {
  for (let index = markerIndex + 1; index < steps.length; index += 1) {
    const isCommit = steps[index]!.kind === EngineV3StepKind.commit;
    if (isCommit) {
      return index;
    }
  }
  return undefined;
}

function findPreviousCommitIndex(): number | undefined {
  for (let index = markerIndex - 1; index >= FIRST_STEP_INDEX; index -= 1) {
    const isCommit = steps[index]!.kind === EngineV3StepKind.commit;
    if (isCommit) {
      return index;
    }
  }
  return undefined;
}

export function containsCommitAfterMarker(): boolean {
  return findNextCommitIndex() !== undefined;
}

export function moveMarkerToNextCommit(): void {
  markerIndex = findNextCommitIndex() ?? markerIndex;
}

export function moveMarkerToPreviousCommit(): void {
  markerIndex = findPreviousCommitIndex() ?? markerIndex;
}
