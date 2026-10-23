// The show row's < and > arrows jump the timeline to the nearest node of one kind, measured along the time axis, which runs down the page.

import { getRequiredElementById } from "./app-dom.ts";
import { highlightLandedElement, scrollToUncoveredCentre } from "./layer1-find-file.ts";
import { classifyNodeKind, isKindHidden, onKindBoxToggle } from "./layer1-kind-filter.ts";
import { KindJumpDirection, ShowRowKind } from "./layer1-show-row.ts";

// Within this a node counts as the one already landed on, so a second click never sticks on it.
const SAME_POSITION_EPSILON_PX = 1;

const DIRECTION_SIGN: Record<KindJumpDirection, number> = {
    [KindJumpDirection.previous]: -1,
    [KindJumpDirection.next]: 1,
};

// A landed node sits at the uncovered area's centre, which is not the pane's centre while the drawer is open, so until the pane scrolls the next click steps from this node.
let landed: { node: HTMLElement; scrollTop: number } | undefined;

interface MeasuredNode {
    node: HTMLElement;
    centerY: number;
}

function readCenterY(element: HTMLElement): number {
    const box = element.getBoundingClientRect();
    return box.top + box.height / 2;
}

function readAnchorY(): number {
    const pane = getRequiredElementById("timelines");
    if (landed !== undefined && getRequiredElementById("stage").contains(landed.node) && landed.scrollTop === pane.scrollTop) {
        return readCenterY(landed.node);
    }
    return readCenterY(pane);
}

function listKindNodes(kind: ShowRowKind): MeasuredNode[] {
    return [...getRequiredElementById("stage").querySelectorAll<HTMLElement>(".node")]
        .filter((node) => classifyNodeKind(node) === kind)
        .map((node) => ({ node, centerY: readCenterY(node) }));
}

function findNearestInDirection(nodes: MeasuredNode[], anchorY: number, direction: KindJumpDirection): HTMLElement | undefined {
    const sign = DIRECTION_SIGN[direction];
    return nodes
        .filter(({ centerY }) => (centerY - anchorY) * sign > SAME_POSITION_EPSILON_PX)
        .reduce<MeasuredNode | undefined>((nearest, candidate) =>
            nearest === undefined || (candidate.centerY - nearest.centerY) * sign < 0 ? candidate : nearest, undefined)?.node;
}

function readArrowKind(arrow: HTMLElement): ShowRowKind {
    return Object.values(ShowRowKind).find((kind) => kind === arrow.dataset["jumpKind"])!;
}

function readArrowDirection(arrow: HTMLElement): KindJumpDirection {
    return Object.values(KindJumpDirection).find((direction) => direction === arrow.dataset["jump"])!;
}

function jumpFromArrowClick(event: MouseEvent): void {
    const arrow = (event.target as HTMLElement).closest<HTMLElement>("button[data-jump-kind]");
    if (arrow === null) {
        return;
    }
    const target = findNearestInDirection(listKindNodes(readArrowKind(arrow)), readAnchorY(), readArrowDirection(arrow));
    if (target === undefined) {
        return;
    }
    // Same landing as a ruler tick click.
    scrollToUncoveredCentre(target);
    highlightLandedElement(target);
    landed = { node: target, scrollTop: getRequiredElementById("timelines").scrollTop };
    refreshKindJumpArrows();
}

// Run after every stage render, box toggle and scroll; assigned, not added, so a re-render never stacks listeners.
export function refreshKindJumpArrows(): void {
    const showRow = getRequiredElementById("show-row");
    showRow.onclick = jumpFromArrowClick;
    getRequiredElementById("timelines").onscroll = refreshKindJumpArrows;
    const anchorY = readAnchorY();
    const nodesByKind = new Map<ShowRowKind, MeasuredNode[]>();
    for (const arrow of showRow.querySelectorAll<HTMLButtonElement>("button[data-jump-kind]")) {
        const kind = readArrowKind(arrow);
        if (!nodesByKind.has(kind)) {
            nodesByKind.set(kind, isKindHidden(kind) ? [] : listKindNodes(kind));
        }
        arrow.disabled = findNearestInDirection(nodesByKind.get(kind)!, anchorY, readArrowDirection(arrow)) === undefined;
    }
}

onKindBoxToggle(refreshKindJumpArrows);
