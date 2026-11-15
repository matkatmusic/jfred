// Pure judges for Layer 6 script-run nodes: they read NodeFacts and return booleans or lists.

import {
  DERIVED_ID, INJECTED_ID, MISMATCH_ID, NEVER_PROVABLE_ID, ORIGINAL_FAILED_ID, PENDING_ID, VERIFIED_ID, type NodeFacts,
} from "./layer6-probes.ts";

const RUN_STATE_PREFIX = "run-state-";
const NEVER_PROVABLE_CLASS = "never-provable";
const STATE_FILTER_WORDS = /mismatch|verified|derived|original|injected|confidence|result|state/;

export interface ExpectedNode { id: string; stateClass: string | undefined; isNeverProvable: boolean }

// Each README node: its id and the one run-state class it carries (none for pending and never-provable).
export const EXPECTED_NODES: ExpectedNode[] = [
  { id: PENDING_ID, stateClass: undefined, isNeverProvable: false },
  { id: VERIFIED_ID, stateClass: "run-state-verified", isNeverProvable: false },
  { id: DERIVED_ID, stateClass: "run-state-derived", isNeverProvable: false },
  { id: MISMATCH_ID, stateClass: "run-state-mismatch", isNeverProvable: false },
  { id: ORIGINAL_FAILED_ID, stateClass: "run-state-original-failed", isNeverProvable: false },
  { id: INJECTED_ID, stateClass: "run-state-injected-unverified", isNeverProvable: false },
  { id: NEVER_PROVABLE_ID, stateClass: undefined, isNeverProvable: true },
];

export function listRunStateClasses(classes: string): string[] {
  const states: string[] = [];
  for (const name of classes.split(" ")) {
    const isState = name.startsWith(RUN_STATE_PREFIX);
    if (isState)
      states.push(name);
  }
  return states;
}

export function findNodeFacts(nodes: NodeFacts[], id: string): NodeFacts | undefined {
  for (const node of nodes) {
    const isWanted = node.id === id;
    if (isWanted)
      return node;
  }
  return undefined;
}

export function isNodeExpected(node: NodeFacts | undefined, expected: ExpectedNode): boolean {
  if (node === undefined)
    return false;
  const wantedStates = expected.stateClass === undefined ? [] : [expected.stateClass];
  const hasWantedStates = JSON.stringify(listRunStateClasses(node.classes)) === JSON.stringify(wantedStates);
  const hasNeverProvable = node.classes.split(" ").includes(NEVER_PROVABLE_CLASS);
  return hasWantedStates && hasNeverProvable === expected.isNeverProvable;
}

export function isExpectedNodeSet(nodes: NodeFacts[]): boolean {
  let isMatch = nodes.length === EXPECTED_NODES.length;
  for (const expected of EXPECTED_NODES) {
    const isThisRight = isNodeExpected(findNodeFacts(nodes, expected.id), expected);
    if (!isThisRight)
      isMatch = false;
  }
  return isMatch;
}

// Replaced by the mark checks: the per-state outlines are gone, the marks stay.
// export function isMismatchAlone(nodes: NodeFacts[]): boolean {
//   let isAlone = findNodeFacts(nodes, MISMATCH_ID) !== undefined;
//   for (const node of nodes) {
//     const isMismatch = node.id === MISMATCH_ID;
//     const hasDouble = node.outlineStyle === "double";
//     const hasFill = node.backgroundImage !== "none";
//     const isRight = isMismatch ? hasDouble && hasFill : !hasDouble && !hasFill;
//     if (!isRight)
//       isAlone = false;
//   }
//   return isAlone;
// }

export function listMarkSignatures(nodes: NodeFacts[]): string[] {
  const signatures: string[] = [];
  for (const node of nodes)
    signatures.push(`${node.markKey}|${node.markColour}`);
  return signatures;
}

// Pending and derived share the not-run mark and never-provable has none: only these four have their own mark.
const RATED_MARKS: Record<string, string> = {
  [VERIFIED_ID]: "mark-verified", [MISMATCH_ID]: "mark-mismatch", [ORIGINAL_FAILED_ID]: "mark-original-failed", [INJECTED_ID]: "mark-injected-unverified",
};

export function isRatedMarksDistinct(nodes: NodeFacts[]): boolean {
  const rated = nodes.filter(node => node.id in RATED_MARKS);
  const isEachRight = rated.every(node => node.markKey === RATED_MARKS[node.id]);
  return rated.length === 4 && isEachRight && listUniqueValues(listMarkSignatures(rated)).length === 4;
}

export function isMismatchMarkRed(nodes: NodeFacts[], redColour: string): boolean {
  const mismatch = findNodeFacts(nodes, MISMATCH_ID);
  if (mismatch === undefined)
    return false;
  const others = nodes.filter(node => node.id !== MISMATCH_ID);
  const isUnique = others.every(node => node.markKey !== mismatch.markKey);
  const isRed = mismatch.markColour === redColour;
  return mismatch.markKey === "mark-mismatch" && isUnique && isRed;
}

export function isStateFilterAbsent(kinds: string[]): boolean {
  let isClean = kinds.length > 0;
  for (const kind of kinds) {
    const isStateWord = STATE_FILTER_WORDS.test(kind);
    if (isStateWord)
      isClean = false;
  }
  return isClean;
}

export function listNodeClasses(nodes: NodeFacts[]): string[] {
  const lists: string[] = [];
  for (const node of nodes)
    lists.push(node.classes);
  return lists;
}

export function listNodeSizes(nodes: NodeFacts[]): string[] {
  const sizes: string[] = [];
  for (const node of nodes)
    sizes.push(`${node.width}x${node.height}`);
  return sizes;
}

// Replaced by listMarkSignatures: comparing outline looks proves nothing about the marks.
// export function listNodeSignatures(nodes: NodeFacts[]): string[] {
//   const signatures: string[] = [];
//   for (const node of nodes)
//     signatures.push([node.borderStyle, node.borderColor, node.borderWidth, node.outlineStyle, node.outlineColor, node.outlineWidth, node.backgroundImage].join("|"));
//   return signatures;
// }

export function listUniqueValues(values: string[]): string[] {
  return [...new Set(values)];
}
