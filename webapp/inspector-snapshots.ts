// Snapshot drawer + blob-presence probes, split from inspector.ts (task 115). Presence is probed once per browser session and cached; the drawer splits the Details pane JSON/blob.

import { fetchJson } from "./app-fetch.ts";
import {
    computeBlobRequestUrl,
    type WireBlobResponse,
    type WireRecord,
    type WireTrackedBackup,
} from "./inspector-links.ts";
import { el } from "./inspector-json.ts";

// Whether each probed blob is on disk, keyed "<session>|<blobName>" — fetched once per browser session (a blob file never changes once written).
export const blobPresenceByKey = new Map<string, boolean | undefined>();

// Bumped at every showLine render; a settled presence probe re-renders ONLY when the pane still shows the line it probed for (its captured count is still the current one).
let showLineRenderCount = 0;

// Advance the render counter for a new showLine render and return the new count.
export function bumpShowLineRenderCount(): number {
    showLineRenderCount += 1;
    return showLineRenderCount;
}

// Tear down the snapshot drawer: remove its element and drop the pane's split modifier.
function closeSnapshotDrawer(pane: HTMLElement, drawer: HTMLElement): void {
    drawer.remove();
    pane.classList.remove("snapshot-drawer");
}

// Assemble the snapshot drawer element (header with close button + the rendered blob text).
export function buildSnapshotDrawer(pane: HTMLElement, entry: WireTrackedBackup, blobName: string, snapshotText: HTMLElement): HTMLElement {
    const drawer = el("div", { class: "snapshot-pane" }, [
        el("div", { class: "snapshot-pane-header" }, [
            el("span", { class: "muted", text: `${entry.relativePath} — ${blobName}` }),
            el("button", { class: "row-btn", text: "Close", onclick: () => closeSnapshotDrawer(pane, drawer) }),
        ]),
        // el("pre", { class: "inspector-text", text: result.content ?? "" }), // (item 49)
        snapshotText,
    ]);
    return drawer;
}

// Fetch each named blob's presence, record it, and re-show the SAME line once every probe settles — but only when the pane still shows the line the probes were started for.
function fetchBlobPresenceAndRerenderLine(unprobedNames: string[], sessionId: string, renderCountAtStart: number, showLine: (line: number) => void, clamped: number): void {
    Promise.all(unprobedNames.map(async (name) => {
        const probed = await fetchJson(computeBlobRequestUrl(sessionId, name)) as WireBlobResponse;
        blobPresenceByKey.set(`${sessionId}|${name}`, probed.exists);
    })).then(() => {
        if (showLineRenderCount === renderCountAtStart) {
            showLine(clamped);
        }
    }).catch(() => { /* a failed probe leaves presence unknown — tokens stay plain */ });
}

// Probe the on-disk presence of a record's tracked backups (unknowns only).
export function probeTrackedBackupPresence(trackedBackups: NonNullable<NonNullable<WireRecord["snapshot"]>["trackedFileBackups"]>, sessionId: string, renderCountAtStart: number, showLine: (line: number) => void, clamped: number): void {
    const unprobedNames = Object.values(trackedBackups)
        .map((entry) => entry.backupFileName)
        .filter((name): name is string => name !== undefined && !blobPresenceByKey.has(`${sessionId}|${name}`));
    if (unprobedNames.length > 0) {
        fetchBlobPresenceAndRerenderLine(unprobedNames, sessionId, renderCountAtStart, showLine, clamped);
    }
}
