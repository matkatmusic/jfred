// What JSON.parse yields from /api/layer1-view: `Path` arrives as a plain string and `Instant` as ISO text, so these are NOT src/viewer_api_layer1.ts's Layer1Wire* types (same naming convention as webapp/layered-app.ts's Wire* mirrors).
//
// Their own module rather than webapp/layer1-page.ts's private declarations (task 253): the folder filter (webapp/layer1-filter.ts) takes and returns a whole view, and the page imports the filter, so a type owned by the page could only reach the filter through a cycle.

export interface WireInstant {
    instant: string;
    axisPx: number;
}

export interface WireCommit extends WireInstant {
    hash: string;
}

// One RULER entry. Its own type rather than a widened WireInstant: every commit, orphan and on-disk node is a WireInstant too, and none of them carries a count (task 275).
export interface WireRulerTick extends WireInstant {
    // How many nodes the view draws at this instant, across every bubble.
    eventCount: number;
}

export interface WirePair {
    path: string;
    // Oldest first, as the endpoint emits them.
    commits: WireCommit[];
    onDisk: WireInstant;
}

export interface WireOrphan extends WireInstant {
    path: string;
}

// One session transcript from /api/layer1-sessions (task 292). `started`/`ended` are the session's FIRST and LAST record — deliberately not the instants of the files it touched, because the band has to be able to open before the first write and close after the last one.
export interface WireSession {
    file: string;
    // Absolute path: the wire identity, because two source folders can hold the same basename.
    fullPath: string;
    title: string;
    started: string;
    ended: string;
    // Every file the session touched, which is all the filter needs.
    paths: string[];
}

export interface WireLayer1View {
    pairs: WirePair[];
    gitOrphans: WireOrphan[];
    diskOrphans: WireOrphan[];
    // Every distinct instant the view draws, ascending.
    ruler: WireRulerTick[];
}
