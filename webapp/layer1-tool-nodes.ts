// Task 382: tool calls naming a file draw use and result nodes with a dashed bracket on its lane.

import { createElement } from "./app-dom.ts";
import { buildPairBracket } from "./layer1-annotation-bracket.ts";
import { ANNOTATION_LOOKS } from "./layer1-annotation-looks.ts";
import { setAxisPx } from "./layer1-lane-nodes.ts";
import type { WireToolNode } from "./layer1-wire-annotations.ts";

function buildToolIdentity(node: WireToolNode, title: string) {
  return {
    title,
    "data-record-id": node.id,
    "data-record-kind": node.kind,
    "data-pair-id": node.pairId,
    "data-instant": node.instant,
  };
}

function appendToolNode(lane: HTMLElement, node: WireToolNode, axisPx: number): HTMLElement {
  const look = ANNOTATION_LOOKS[node.kind];
  const identity = buildToolIdentity(node, `${node.kind}: ${node.label}`);
  const dot = setAxisPx(createElement("i", { class: `tnode ${look.cssClass}`, ...identity }), axisPx);
  const label = setAxisPx(createElement("span", { class: "tlabel", text: `${look.letter} ${node.label}`, ...identity }), axisPx);
  lane.append(dot, label);
  return dot;
}

// startPx is the lane's first node, so each offset matches the other nodes on the lane.
export function appendToolNodes(lane: HTMLElement, toolNodes: WireToolNode[], startPx: number): void {
  const dotsByPairId = new Map<string, HTMLElement[]>();
  for (const node of toolNodes) {
    const dot = appendToolNode(lane, node, node.axisPx - startPx);
    dotsByPairId.set(node.pairId, [...(dotsByPairId.get(node.pairId) ?? []), dot]);
  }
  for (const [pairId, dots] of dotsByPairId) {
    const [first, second] = dots;
    const isPairComplete = first !== undefined && second !== undefined;
    if (isPairComplete) {
      const bracket = buildPairBracket(first, second, "tbracket");
      bracket.setAttribute("data-pair-id", pairId);
      lane.append(bracket);
    }
  }
}
