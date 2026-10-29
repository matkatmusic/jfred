// Task 357: the Layer 5 real-check page probe, its fact shapes and pure helpers.

import { type WireBranchesView } from "../../webapp/layer1-wire-branches.ts";

export const JOT_MERGE_PATH = "common/scripts/plate/spawn_summary_agent.py";
export const REVENG_MERGE_PATH = "jfred/tests/reconstruction_bound.test.ts";
const TOLERANCE_PX = 1;

export interface LaneFacts {
  splitTop: number; splitStyle: string; railStyle: string; railOpacity: number;
  mergeBottom: number | null; bnodeOpacities: number[]; bnodeMaxCy: number;
}
export interface BubbleFacts {
  path: string; trunkRailLeft: number; trunkRailStyle: string;
  trunk: { instant: string; opacity: number; cy: number }[]; lanes: LaneFacts[];
}
export interface PageFacts { ticks: { text: string; cy: number }[]; plainRailLeft: number | null; bubbles: BubbleFacts[] }

export const PAGE_PROBE = `(() => {
    const rect = (e) => { const r = e.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, cy: r.top + r.height / 2 }; };
    const style = (e) => getComputedStyle(e);
    const isShown = (e) => style(e).display !== 'none' && style(e).visibility !== 'hidden';
    const boxes = [...document.querySelectorAll('.filebox')].filter(b => b.querySelector('.fname[data-path]'));
    const railLeft = (b) => rect(b.querySelector('.lrail')).left - rect(b).left;
    const plain = boxes.find(b => !b.querySelector('.blane'));
    return {
        ticks: [...document.querySelectorAll('.ruler .tick')].map(t => ({ text: t.textContent, cy: rect(t).cy })),
        plainRailLeft: plain ? railLeft(plain) : null,
        bubbles: boxes.filter(b => b.querySelector('.blane')).map(b => ({
            path: b.querySelector('.fname[data-path]').dataset.path,
            trunkRailLeft: railLeft(b),
            trunkRailStyle: style(b.querySelector('.lrail')).borderLeftStyle,
            trunk: [...b.querySelectorAll('.lane > .node')].filter(isShown)
                .map(n => ({ instant: n.dataset.instant, opacity: parseFloat(style(n).opacity), cy: rect(n).cy })),
            lanes: [...b.querySelectorAll('.blane')].map(lane => {
                const merge = lane.querySelector('.merge-elbow');
                const bnodes = [...lane.querySelectorAll('.bnode')];
                return {
                    splitTop: rect(lane.querySelector('.split-elbow')).top,
                    splitStyle: style(lane.querySelector('.split-elbow')).borderTopStyle,
                    railStyle: style(lane.querySelector('.brail')).borderLeftStyle,
                    railOpacity: parseFloat(style(lane.querySelector('.brail')).opacity),
                    mergeBottom: merge ? rect(merge).bottom : null,
                    bnodeOpacities: bnodes.map(n => parseFloat(style(n).opacity)),
                    bnodeMaxCy: Math.max(...bnodes.map(n => rect(n).cy)) };
            }) })) };
})()`;

export type PayloadLane = WireBranchesView["pairs"][number]["branches"][number];
export interface DrawnLane { path: string; payload: PayloadLane; facts: LaneFacts; bubble: BubbleFacts }

export function formatTickStamp(instant: string): string {
  const isoText = new Date(instant).toISOString();
  const stamp = isoText.slice(5, 23);
  return stamp.replace("T", " ");
}

export const isNear = (a: number | undefined, b: number | undefined) => a !== undefined && b !== undefined && Math.abs(a - b) <= TOLERANCE_PX;

export function findTickCy(facts: PageFacts, instant: string): number | undefined {
  const stamp = formatTickStamp(instant);
  for (const tick of facts.ticks) {
    const isMatch = tick.text.startsWith(stamp);
    if (isMatch) {
      return tick.cy;
    }
  }
  return undefined;
}

export function listDrawnLanes(payload: WireBranchesView, page: PageFacts): DrawnLane[] {
  const lanes: DrawnLane[] = [];
  for (const bubble of page.bubbles) {
    let branches: PayloadLane[] = [];
    for (const pair of payload.pairs) {
      if (pair.path === bubble.path) {
        branches = pair.branches;
        break;
      }
    }
    for (let index = 0; index < bubble.lanes.length; index++) {
      lanes.push({ path: bubble.path, payload: branches[index]!, facts: bubble.lanes[index]!, bubble });
    }
  }
  return lanes;
}

export function containsMergeTarget(payload: PayloadLane): boolean {
  return payload.rejoinAt !== undefined || payload.keptToEnd === true;
}

export function findRejoinCy(lane: DrawnLane, page: PageFacts): number | undefined {
  const instantMs = Date.parse(lane.payload.rejoinAt!);
  const trunkCys: number[] = [];
  for (const node of lane.bubble.trunk) {
    const isRejoinNode = Date.parse(node.instant) === instantMs;
    if (isRejoinNode) {
      trunkCys.push(node.cy);
    }
  }
  for (const cy of trunkCys) {
    const isAtMerge = isNear(cy, lane.facts.mergeBottom!);
    if (isAtMerge) {
      return cy;
    }
  }
  return trunkCys[0] ?? findTickCy(page, lane.payload.rejoinAt!);
}
