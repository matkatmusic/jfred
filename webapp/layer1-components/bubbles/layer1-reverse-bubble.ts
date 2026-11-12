// Layer 1's reverse-walk bubble: one file's states from now back to the oldest known state, newest at the top.

import { createElement } from "../../app-dom.ts";
import { WireReverseKind, type WireReverseState } from "../../layer1-wire-reverse.ts";
import { RULER_NODE_ROW_PIXELS } from "../ruler/layer1-ruler-axis.ts";
import { formatInstantLabel } from "../ruler/layer1-ruler-rows.ts";
import { setAxisPx } from "./layer1-lane-nodes.ts";

const REVERSE_KIND_WORDS = {
  [WireReverseKind.DiskNow]: "on disk",
  [WireReverseKind.EditUndone]: "before edit",
  [WireReverseKind.WriteUndone]: "before write",
  [WireReverseKind.FileCreated]: "file did not exist",
  [WireReverseKind.UnknownChange]: "unknown change",
  [WireReverseKind.ScriptChange]: "script change",
  [WireReverseKind.GitCommit]: "commit",
  [WireReverseKind.BackupSnapshot]: "snapshot",
  [WireReverseKind.ReadOnly]: "read, no change",
  [WireReverseKind.PossibleChange]: "possible change, bytes not known",
} as const satisfies Record<WireReverseKind, string>;

const SHORT_COMMIT_HASH_LENGTH = 7;

export function getShortCommitHash(state: WireReverseState): string {
  if (state.commitHash === undefined) {
    throw new Error(`reverse state ${state.index} (${state.kind}) has no commit hash`);
  }
  return state.commitHash.slice(0, SHORT_COMMIT_HASH_LENGTH);
}

function formatReverseLabel(state: WireReverseState): string {
  const words = REVERSE_KIND_WORDS[state.kind];
  if (state.kind === WireReverseKind.DiskNow) {
    return `now · ${words}`;
  }
  if (state.instant === undefined) {
    throw new Error(`reverse state ${state.index} (${state.kind}) has no instant`);
  }
  if (state.kind === WireReverseKind.GitCommit) {
    return `${getShortCommitHash(state)} · ${formatInstantLabel(state.instant)}`;
  }
  if (state.kind === WireReverseKind.BackupSnapshot) {
    return `📸 ${formatInstantLabel(state.instant)} · ${words}`;
  }
  return `${formatInstantLabel(state.instant)} · ${words}`;
}

function buildReverseIdentity(state: WireReverseState): Record<string, string> {
  const isModifying = state.isModifying !== false;
  const identity: Record<string, string> = { "data-index": String(state.index), "data-kind": state.kind, "data-modifying": String(isModifying) };
  if (state.instant !== undefined) {
    identity["data-instant"] = state.instant;
  }
  if (state.commitHash !== undefined) {
    identity["data-hash"] = state.commitHash;
  }
  if (state.jsonlPath !== undefined) {
    if (state.lineNumber !== undefined) {
      identity["data-session-file"] = state.jsonlPath;
      identity["data-line"] = String(state.lineNumber);
    }
  }
  return identity;
}

function appendReverseNode(lane: HTMLElement, state: WireReverseState): void {
  const axisPx = state.index * RULER_NODE_ROW_PIXELS;
  lane.append(
    setAxisPx(createElement("i", { class: "node n-rev", ...buildReverseIdentity(state) }), axisPx),
    setAxisPx(createElement("span", { class: "nlabel", text: formatReverseLabel(state) }), axisPx),
  );
}

function buildReverseLane(states: WireReverseState[]): HTMLElement {
  const lane = setAxisPx(createElement("div", { class: "lane", "data-component": "Lanes" }), 0);
  const indexes: number[] = [];
  for (const state of states) {
    indexes.push(state.index);
  }
  lane.style.setProperty("--span-px", String(Math.max(...indexes) * RULER_NODE_ROW_PIXELS));
  lane.append(createElement("div", { class: "lrail" }));
  for (const state of states) {
    appendReverseNode(lane, state);
  }
  return lane;
}

export function buildReverseBubble(path: string, states: WireReverseState[]): HTMLElement {
  const lane = buildReverseLane(states);
  const filebox = setAxisPx(createElement("div", { class: "filebox reverse-bubble", "data-component": "Bubbles" }, [
    createElement("div", { class: "fname", text: path.split("/").pop() ?? path, "data-path": path }),
    createElement("div", { class: "sub", text: `${states.length} states, newest first` }),
    lane,
  ]), 0);
  filebox.style.setProperty("--lane-count", "0");
  return filebox;
}
