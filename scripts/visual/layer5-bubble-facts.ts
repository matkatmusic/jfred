// Page facts, the page probe, and small helpers for the Layer 5 fixture-mode checks.

import { buildBubbleSelector } from "./mockup-checks.ts";

export const TOLERANCE_PX = 1;

export interface Rect { left: number; right: number; top: number; bottom: number; cx: number; cy: number }
export interface LaneFacts {
  laneX: number; elbow: Rect; elbowTopStyle: string; rail: Rect; railStyle: string; railOpacity: number;
  mergeCount: number; mergeBottom: number | undefined; mergeInFirstLane: boolean;
  bnodes: { cy: number; opacity: number; instant: string }[]; labelRects: Rect[];
  forkCentreY: number | undefined; rejoinCentreY: number | undefined;
}
export interface BubbleFacts {
  rect: Rect; laneW: number; trunkRailLeft: number; trunkRailStyle: string; lanes: LaneFacts[];
  trunkOpacities: number[]; mergeCount: number;
}

export const buildBubbleProbe = (path: string, forks: string[], rejoin: string) => `(b => {
    const rect = (e) => { const r = e.getBoundingClientRect();
        return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, cx: r.left + r.width / 2, cy: r.top + r.height / 2 }; };
    const commitCentreY = (instant) => {
        const dot = [...b.querySelectorAll('.node.n-commit')].find(n => Date.parse(n.dataset.instant) === Date.parse(instant));
        return dot ? rect(dot).cy : undefined; };
    const tickCentreY = (instant) => {
        const iso = new Date(instant).toISOString();
        const stamp = iso.slice(5, 10) + ' ' + iso.slice(11, 23);
        const tick = [...document.querySelectorAll('.ruler .tick')].find(t => t.textContent.startsWith(stamp));
        return tick ? rect(tick).cy : undefined; };
    const lanes = [...b.querySelectorAll('.blane')];
    const rejoinInstant = ${JSON.stringify(rejoin)};
    return {
        rect: rect(b),
        laneW: parseFloat(getComputedStyle(b).getPropertyValue('--lane-w')),
        trunkRailLeft: rect(b.querySelector('.lrail')).left - b.getBoundingClientRect().left,
        trunkRailStyle: getComputedStyle(b.querySelector('.lrail')).borderLeftStyle,
        trunkOpacities: [...b.querySelectorAll('.lane > .node')].filter(n => getComputedStyle(n).visibility !== 'hidden')
            .map(n => parseFloat(getComputedStyle(n).opacity)),
        mergeCount: b.querySelectorAll('.merge-elbow').length,
        lanes: lanes.map((lane, i) => {
            const merge = lane.querySelector('.merge-elbow');
            return {
                laneX: rect(lane).left,
                elbow: rect(lane.querySelector('.split-elbow')),
                elbowTopStyle: getComputedStyle(lane.querySelector('.split-elbow')).borderTopStyle,
                rail: rect(lane.querySelector('.brail')),
                railStyle: getComputedStyle(lane.querySelector('.brail')).borderLeftStyle,
                railOpacity: parseFloat(getComputedStyle(lane.querySelector('.brail')).opacity),
                mergeCount: lane.querySelectorAll('.merge-elbow').length,
                mergeBottom: merge ? rect(merge).bottom : undefined,
                mergeInFirstLane: merge ? merge.closest('.blane') === lanes[0] : false,
                bnodes: [...lane.querySelectorAll('.bnode')].map(n => ({ cy: rect(n).cy, opacity: parseFloat(getComputedStyle(n).opacity), instant: n.dataset.instant })),
                labelRects: [...lane.querySelectorAll('.blabel')].map(rect),
                forkCentreY: tickCentreY(${JSON.stringify(forks)}[i]),
                rejoinCentreY: merge ? commitCentreY(rejoinInstant) : undefined };
        }) };
})(document.querySelector(${JSON.stringify(buildBubbleSelector(path))}))`;

export const PLAIN_BUBBLE_TRUNK_RAIL_LEFT = `(b => b.querySelector('.lrail').getBoundingClientRect().left - b.getBoundingClientRect().left)
    ([...document.querySelectorAll('.filebox')].find(b => b.querySelector('.fname[data-path]') && !b.querySelector('.blane')))`;
export const TICK_ROWS = `[...document.querySelectorAll('.ruler .tick')].map(t => { const r = t.getBoundingClientRect(); return { text: t.textContent, cy: r.top + r.height / 2 }; })`;

// A tick reads "MM-DD HH:MM:SS.mmm (n)" in UTC; this is that stamp for an ISO instant.
export const formatTickStamp = (instant: string) => `${instant.slice(5, 10)} ${instant.slice(11, 23)}`;

export const isNear = (a: number | undefined, b: number | undefined) =>
  a !== undefined && b !== undefined && Math.abs(a - b) <= TOLERANCE_PX;
