// Geometry shape and probe co-located so assertions stay in sync with the dump.
//
// Boxes use viewport coords (getBoundingClientRect), comparable across zoom levels.
//
// TRAP: the probe is a template literal, so no backtick or dollar-brace.

export interface Box {
    x: number;
    y: number;
    w: number;
    h: number;
}

// `ownerPath` traces a label/dot back to its parent bubble's file path.
export interface Measured {
    group: string;
    cls: string;
    text: string;
    path: string | null;
    ownerPath: string | null;
    laneIndex: number;
    isBucket: boolean;
    box: Box;
    scrollWidth: number;
    clientWidth: number;
    clientHeight: number;
    lineHeight: number;
}

export interface StateGeometry {
    state: string;
    zoom: string;
    crumb: string;
    findStatus: string;
    viewport: { w: number; h: number };
    // The scroll container the timeline is drawn inside — the "viewport" a jump has to land within.
    scroller: Box & { scrollLeft: number; scrollTop: number };
    fileboxes: Measured[];
    fnames: Measured[];
    nodes: Measured[];
    labels: Measured[];
    ticks: Measured[];
    tickFiles: Measured[];
    found: Measured[];
}

// Bucket headings assertions check for the title-instead-of-path bug.
export const BUCKET_TITLES = ["No on-disk match", "No repository match"] as const;

// Collects all assertion-relevant rects in one page turn, grouped by role.
export const GEOMETRY_PROBE = `(() => {
    const round = (value) => Math.round(value * 100) / 100;
    const rect = (element) => {
        const r = element.getBoundingClientRect();
        return { x: round(r.x), y: round(r.y), w: round(r.width), h: round(r.height) };
    };
    const lanes = [...document.querySelectorAll('#stage .lane')];
    const describe = (element, group) => {
        const box = element.closest('.filebox');
        const lane = element.closest('.lane');
        const style = getComputedStyle(element);
        return {
            group,
            cls: element.className,
            text: (element.textContent || '').slice(0, 60),
            path: element.dataset ? (element.dataset.path || null) : null,
            ownerPath: box ? (box.querySelector('.fname')?.dataset.path || null) : null,
            laneIndex: lane ? lanes.indexOf(lane) : -1,
            isBucket: box ? box.classList.contains('bucket') : false,
            box: rect(element),
            scrollWidth: element.scrollWidth,
            clientWidth: element.clientWidth,
            clientHeight: element.clientHeight,
            lineHeight: round(parseFloat(style.lineHeight) || parseFloat(style.fontSize) || 0),
        };
    };
    const collect = (selector, group) =>
        [...document.querySelectorAll(selector)]
            .filter((element) => element.getClientRects().length > 0)
            .map((element) => describe(element, group));
    const scroller = document.getElementById('timelines');
    const root = document.querySelector('.viz-root');
    return {
        zoom: (getComputedStyle(root).getPropertyValue('--zoom') || '1').trim(),
        crumb: document.getElementById('crumb').textContent || '',
        findStatus: document.getElementById('find-status').textContent || '',
        viewport: { w: window.innerWidth, h: window.innerHeight },
        scroller: Object.assign(rect(scroller), {
            scrollLeft: round(scroller.scrollLeft),
            scrollTop: round(scroller.scrollTop),
        }),
        fileboxes: collect('#stage .filebox', 'filebox'),
        fnames: collect('#stage .filebox > .fname', 'fname'),
        nodes: collect('#stage .node', 'node'),
        labels: collect('#stage .nlabel', 'nlabel'),
        ticks: collect('#ruler .tick', 'tick'),
        tickFiles: collect('#ruler .tickfiles button', 'tickfile'),
        found: collect('.found', 'found'),
    };
})()`;

