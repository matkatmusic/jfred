// Snapshot drawer and blob-presence probes, split from inspector.ts (task 115); presence is cached per session.

import { fetchJson } from "./app-fetch.ts";
import {
  computeBlobRequestUrl,
  type WireBlobResponse,
  type WireRecord,
  type WireTrackedBackup,
} from "./inspector-links.ts";
import { createElement } from "./inspector-json.ts";

// Whether each probed blob is on disk, keyed "<session>|<blobName>"; fetched once per session.
export const blobPresenceByKey = new Map<string, boolean | undefined>();

// Bumped at every showLine render; a settled probe re-renders only if its count is still current.
let showLineRenderCount = 0;

// Advance the render counter for a new showLine render and return the new count.
export function updateShowLineRenderCount(): number {
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
  const drawer = createElement("div", { class: "snapshot-pane" }, [
    createElement("div", { class: "snapshot-pane-header" }, [
      createElement("span", { class: "muted", text: `${entry.relativePath} — ${blobName}` }),
      createElement("button", { class: "row-btn", text: "Close", onclick: () => closeSnapshotDrawer(pane, drawer) }),
    ]),
    // createElement("pre", { class: "inspector-text", text: result.content ?? "" }), // (item 49)
    snapshotText,
  ]);
  return drawer;
}

// Fetch one blob's presence and record it in the cache.
async function fetchBlobPresence(sessionId: string, name: string): Promise<void> {
  const probed = await fetchJson(computeBlobRequestUrl(sessionId, name)) as WireBlobResponse;
  blobPresenceByKey.set(`${sessionId}|${name}`, probed.exists);
}

// Fetch each blob's presence, then re-show the SAME line if the pane still shows it.
function fetchBlobPresenceAndRerenderLine(unprobedNames: string[], sessionId: string, renderCountAtStart: number, showLine: (line: number) => void, clamped: number): void {
  const probes: Promise<void>[] = [];
  for (const name of unprobedNames) {
    probes.push(fetchBlobPresence(sessionId, name));
  }
  const renderIfCurrent = (): void => {
    if (showLineRenderCount === renderCountAtStart) {
      showLine(clamped);
    }
  };
  const markProbeUnknown = (): void => { /* a failed probe leaves presence unknown — tokens stay plain */ };
  const allProbed = Promise.all(probes);
  const rendered = allProbed.then(renderIfCurrent);
  rendered.catch(markProbeUnknown);
}

// Scan the on-disk presence of a record's tracked backups (unknowns only).
export function scanTrackedBackupPresence(trackedBackups: NonNullable<NonNullable<WireRecord["snapshot"]>["trackedFileBackups"]>, sessionId: string, renderCountAtStart: number, showLine: (line: number) => void, clamped: number): void {
  const unprobedNames: string[] = [];
  for (const entry of Object.values(trackedBackups)) {
    const name = entry.backupFileName as string | undefined;
    if (name === undefined) {
      continue;
    }
    const isProbed = blobPresenceByKey.has(`${sessionId}|${name}`);
    if (!isProbed) {
      unprobedNames.push(name);
    }
  }
  if (unprobedNames.length > 0) {
    fetchBlobPresenceAndRerenderLine(unprobedNames, sessionId, renderCountAtStart, showLine, clamped);
  }
}
