// The serialized DOM geometry dump the visual loop captures at every state, and the in-page
// expression that produces it. The shape and the probe live in ONE file so the assertions can never
// read a field the probe stopped emitting.
//
// Every box is a getBoundingClientRect in VIEWPORT coordinates, which is what makes the dump
// comparable across zoom levels: native CSS `zoom` participates in layout, so a rect already carries
// the scaling that offsetTop/offsetLeft would not.
//
// TRAP: the probe is a template literal, so it must contain no backtick and no dollar-brace.

export interface Box {
    x: number;
    y: number;
    w: number;
    h: number;
}

// One measured element. `ownerPath` is the `data-path` of the bubble it belongs to, so a label or a
// dot can be reported against the file it describes rather than as an anonymous rectangle.
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

// The two orphan bucket headings. A bubble that prints one of these as its file name is the
// bucket-title-instead-of-a-path failure the assertions hunt for; they are also the strings
// layer1-page.ts's buildOrphanBucket is called with.
export const BUCKET_TITLES = ["No on-disk match", "No repository match"] as const;

// Collect every rectangle the assertions read, in one page turn. Elements are grouped by role
// rather than dumped as one flat list, because every assertion is scoped to one role.
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
        [...document.querySelectorAll(selector)].map((element) => describe(element, group));
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
