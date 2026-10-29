// In-page probes and the measured view for the Layer 2 centring checks; split out of layer2-checks-centre.ts.

// Boxes are [left, top, right, bottom]. TRAP: probes are template literals, so no backtick or dollar-brace.

// Rounding slack for "centred", and the distance from a scroll end that counts as sitting at it.
export const CENTRE_TOLERANCE_PX = 4;
export const EDGE_TOLERANCE_PX = 1;
// A node counts as freely centrable only when its target scroll is this far inside [0, scrollMax].
const INTERIOR_MARGIN_PX = 10;

const DEFINE_MEASURE = `
    const pane = document.getElementById('timelines');
    const read = (element) => { const r = element.getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom]; };
    const paneBox = read(pane);
    const drawerBox = read(document.getElementById('drawer'));
    const area = [...paneBox];
    if (drawerBox[2] > drawerBox[0] && drawerBox[0] > paneBox[0] && drawerBox[0] < paneBox[2]) area[2] = drawerBox[0];
    const maxScroll = [pane.scrollWidth - pane.clientWidth, pane.scrollHeight - pane.clientHeight];
    const scroll = [pane.scrollLeft, pane.scrollTop];
    const centreOf = (box, axis) => (box[axis] + box[axis + 2]) / 2;
    const targetOf = (node, axis) => scroll[axis] + centreOf(read(node), axis) - centreOf(area, axis);
    const visibleNodes = () => [...document.querySelectorAll('#stage .node.n-snap')].filter((node) => node.offsetParent !== null);
`;

export interface CentredView {
  node: number[];
  area: number[];
  pane: number[];
  drawer: number[];
  scroll: number[];
  maxScroll: number[];
  offset: number[];
  isInside: boolean;
  touchesDrawer: boolean;
}

export const readView = (nodeSelector: string) => `(() => { ${DEFINE_MEASURE}
    const node = ${nodeSelector};
    const box = read(node);
    return { node: box, area, pane: paneBox, drawer: drawerBox, scroll, maxScroll,
        offset: [0, 1].map((axis) => centreOf(box, axis) - centreOf(area, axis)),
        isInside: box[0] >= paneBox[0] && box[1] >= paneBox[1] && box[2] <= paneBox[2] && box[3] <= paneBox[3],
        touchesDrawer: box[0] < drawerBox[2] && box[2] > drawerBox[0] && box[1] < drawerBox[3] && box[3] > drawerBox[1] };
})()`;

// Marks the first visible snapshot node with its centred target in or out of range; else -1 or -2.
export const markProbe = (wantInterior: boolean) => `(() => { ${DEFINE_MEASURE}
    document.querySelectorAll('[data-centre-probe]').forEach((node) => node.removeAttribute('data-centre-probe'));
    const isInterior = (node) => [0, 1].every((axis) => targetOf(node, axis) >= ${INTERIOR_MARGIN_PX} && targetOf(node, axis) <= maxScroll[axis] - ${INTERIOR_MARGIN_PX});
    const isClamped = (node) => [0, 1].some((axis) => targetOf(node, axis) < -${INTERIOR_MARGIN_PX} || targetOf(node, axis) > maxScroll[axis] + ${INTERIOR_MARGIN_PX});
    const found = visibleNodes().find(${wantInterior ? "isInterior" : "isClamped"});
    if (!found) return false;
    found.setAttribute('data-centre-probe', '1');
    window.__centreTargets = [0, 1].map((axis) => targetOf(found, axis));
    return true;
})()`;

export const PROBE = `document.querySelector('[data-centre-probe]')`;

export const formatCentreLine = (label: string, view: CentredView): string =>
  `CENTRE ${label}: node centre (${(view.node[0]! + view.node[2]!) / 2}, ${(view.node[1]! + view.node[3]!) / 2}) area centre (${(view.area[0]! + view.area[2]!) / 2}, ${(view.area[1]! + view.area[3]!) / 2}) offset ${JSON.stringify(view.offset)} scroll ${JSON.stringify(view.scroll)} of ${JSON.stringify(view.maxScroll)} drawer ${JSON.stringify(view.drawer)} pane ${JSON.stringify(view.pane)}`;
