// Pure judges and page-fact types shared by the Layer 7 checks.

import { type Uuid } from "../../src/structures/domain.ts";
import { ANNOTATION_BLOCK_IDS, TOOL_NODE_IDS, listFillerIds } from "../../src/viewer_api_layer7_fixture_data.ts";
import { ANNOTATION_LOOKS } from "../../webapp/layer1-annotation-looks.ts";

export interface ColumnNodeFacts {
  id: string; classes: string; instant: string; pairId: string | undefined; cx: number; cy: number;
  borderStyle: string; label: string; labelBox: PageBox; nodeBox: PageBox; signature: string;
}
export interface PageBox { left: number; right: number; top: number; bottom: number }
export interface BracketFacts { count: number; style: string; top: number; bottom: number }
export interface TrackFacts { count: number; isAfterRuler: boolean; isBeforeStage: boolean; position: string }
export interface WindowFacts { topIds: string[]; bottomIds: string[]; outsideCount: number }
export interface DuplicateFacts { stageParts: number; trackTools: number; ids: string[] }

function listIdTexts(ids: readonly Uuid[]): string[] {
  const texts: string[] = [];
  for (const id of ids)
    texts.push(id.toString());
  return texts;
}

export const BLOCK_IDS = listIdTexts(ANNOTATION_BLOCK_IDS);
export const TOOL_IDS = listIdTexts(TOOL_NODE_IDS);

export function listColumnIds(): string[] {
  return [...BLOCK_IDS, ...listIdTexts(listFillerIds())];
}

export function isNear(first: number, second: number, tolerancePx: number): boolean {
  return Math.abs(first - second) <= tolerancePx;
}

export function findColumnNode(nodes: ColumnNodeFacts[], id: string): ColumnNodeFacts {
  for (const node of nodes) {
    const isWanted = node.id === id;
    if (isWanted)
      return node;
  }
  throw new Error(`the column has no drawn node ${id}`);
}

export function listBlockNodes(nodes: ColumnNodeFacts[]): ColumnNodeFacts[] {
  const block: ColumnNodeFacts[] = [];
  for (const node of nodes) {
    const isBlock = BLOCK_IDS.includes(node.id);
    if (isBlock)
      block.push(node);
  }
  return block;
}

export function countNodesWithClass(nodes: ColumnNodeFacts[], cssClass: string): number {
  let total = 0;
  for (const node of nodes) {
    const hasClass = node.classes.split(" ").includes(cssClass);
    if (hasClass)
      total += 1;
  }
  return total;
}

export function listDistinctSignatures(nodes: ColumnNodeFacts[]): string[] {
  const signatures: string[] = [];
  for (const node of nodes)
    signatures.push(node.signature);
  return [...new Set(signatures)];
}

export function listMissingIds(seen: string[], expected: string[]): string[] {
  const missing: string[] = [];
  for (const id of expected) {
    const isSeen = seen.includes(id);
    if (!isSeen)
      missing.push(id);
  }
  return missing;
}

export function isEveryIdUnique(ids: string[]): boolean {
  return new Set(ids).size === ids.length;
}

export function isTrackBetween(track: TrackFacts): boolean {
  return track.count === 1 && track.isAfterRuler && track.isBeforeStage && track.position === "sticky";
}

function countNodesWithId(nodes: ColumnNodeFacts[], id: string): number {
  let total = 0;
  for (const node of nodes) {
    const isWanted = node.id === id;
    if (isWanted)
      total += 1;
  }
  return total;
}

function isEveryBlockIdDrawnOnce(nodes: ColumnNodeFacts[]): boolean {
  let isOnce = true;
  for (const id of BLOCK_IDS) {
    const isThisOnce = countNodesWithId(nodes, id) === 1;
    if (!isThisOnce)
      isOnce = false;
  }
  return isOnce;
}

function isEveryKindDrawnOnce(nodes: ColumnNodeFacts[]): boolean {
  let isOnce = true;
  for (const look of Object.values(ANNOTATION_LOOKS)) {
    const isThisOnce = countNodesWithClass(listBlockNodes(nodes), look.cssClass) === 1;
    if (!isThisOnce)
      isOnce = false;
  }
  return isOnce;
}

export function isBlockComplete(nodes: ColumnNodeFacts[]): boolean {
  return isEveryBlockIdDrawnOnce(nodes) && isEveryKindDrawnOnce(nodes);
}

export function isWindowed(facts: WindowFacts, totalRecords: number): boolean {
  const isTopPartial = facts.topIds.length > 0 && facts.topIds.length < totalRecords;
  const isBottomPartial = facts.bottomIds.length > 0 && facts.bottomIds.length < totalRecords;
  const isSameSet = JSON.stringify([...facts.topIds].sort()) === JSON.stringify([...facts.bottomIds].sort());
  return isTopPartial && isBottomPartial && !isSameSet;
}

export function isBracketSpanning(bracket: BracketFacts, upperCy: number, lowerCy: number, tolerancePx: number): boolean {
  const isDashedOnce = bracket.count === 1 && bracket.style === "dashed";
  return isDashedOnce && isNear(bracket.top, upperCy, tolerancePx) && isNear(bracket.bottom, lowerCy, tolerancePx);
}

export function isStampedWithPredecessor(stampless: ColumnNodeFacts, predecessor: ColumnNodeFacts): boolean {
  const isSameInstant = stampless.instant === predecessor.instant;
  const isLevel = isNear(stampless.cy, predecessor.cy, 1);
  const isBesideIt = stampless.cx !== predecessor.cx;
  return isSameInstant && isLevel && isBesideIt;
}
