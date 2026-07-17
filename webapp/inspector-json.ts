// Highlighted-JSON rendering for the inspector: the legacy JFReD viewer's token pattern
// (web-shared/json-inspector.js), rebuilt without innerHTML — the text is tokenized and
// appended as text nodes + spans, so page content can never inject markup. Linkable string
// values become jump-links; snapshot backupFileName tokens get the snapshot treatment.

import { el as elUntyped } from "./app-dom.ts";
import { findRevisionForChangeId } from "./views/file-history-model.ts";
import {
    computeRevisionLinkRoute,
    computeSnapshotHistoryAnchor,
    findBackupTimeForBlob,
    findJumpTarget,
    findTrackedBackupEntry,
    type LinkMaps,
    type WireFileHistory,
    type WireRevisionLink,
    type WireTrackedBackup,
    type WireValue,
} from "./inspector-links.ts";

// The state appendSnapshotToken renders from (assembled per openTranscriptInspector call).
export type SnapshotContext = {
    sessionId: string;
    presenceByKey: Map<string, boolean | undefined>;
    project: string | undefined;
    openSnapshotDrawer: (blobName: string, entry: WireTrackedBackup) => void;
};

// Typed view of app.ts's el helper, scoped to the attribute keys and children this file passes.
export const el = elUntyped as (
    tag: string,
    attrs?: { class?: string; text?: string; title?: string; onclick?: () => void },
    children?: HTMLElement[],
) => HTMLElement;

// The legacy viewer's token pattern: strings (key vs value by trailing colon), booleans,
// null, and numbers. Everything between tokens (braces, brackets, commas, whitespace) is
// plain text.
const JSON_TOKEN_PATTERN = /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g;

function classifyToken(token: string): string {
    if (token.startsWith('"')) {
        return token.trimEnd().endsWith(":") ? "json-key" : "json-string";
    }
    if (token === "true" || token === "false") {
        return "json-bool";
    }
    if (token === "null") {
        return "json-null";
    }
    return "json-number";
}

// A string value longer than this is collapsed to its first 7 wrapped lines behind a […]
// toggle. 560 ≈ 7 lines × ~80 chars; the CSS line-clamp does the exact visual 7-line cut,
// this threshold only decides which values get the toggle at all.
const LONG_VALUE_CHAR_LIMIT = 560;

function checkValueIsLong(tokenClass: string, token: string): boolean {
    if (tokenClass !== "json-string") {
        return false;
    }
    return token.length > LONG_VALUE_CHAR_LIMIT;
}

// The [View in File Revisions] button for a resolved snapshot anchor (task 93: the route
// now opens THE Revision View).
function appendViewInRevisionsButton(pre: HTMLElement, snapshotContext: SnapshotContext, anchor: WireRevisionLink) {
    pre.append(el("button", {
        class: "row-btn snapshot-history-btn",
        text: "View in File Revisions",
        onclick: () => {
            location.hash = computeRevisionLinkRoute(snapshotContext.project!, anchor);
        },
    }));
}

// A backupFileName token of the CURRENT record, rendered by on-disk presence: a "view
// snapshot" link + [View in File Revisions] button when the blob exists, a dimmed
// "(missing from disk)" suffix when it does not, a plain token while the probe is in flight.
// This treatment replaces the generic revision-link behavior for these tokens.
function appendSnapshotToken(
    pre: HTMLElement, tokenClass: string, token: string, value: string,
    entry: WireTrackedBackup, filesTouched: WireFileHistory[], snapshotContext: SnapshotContext,
) {
    const presence = snapshotContext.presenceByKey.get(`${snapshotContext.sessionId}|${value}`);
    if (presence !== true) {
        pre.append(el("span", { class: tokenClass, text: token }));
        if (presence === false) {
            pre.append(el("span", { class: "muted", text: " (missing from disk)" }));
        }
        return;
    }
    pre.append(el("span", {
        class: `${tokenClass} jump-link`,
        title: "view snapshot",
        onclick: () => snapshotContext.openSnapshotDrawer(value, entry),
        text: token,
    }));
    // The button is decided at render time: no resolvable anchor, no button.
    const anchor = computeSnapshotHistoryAnchor(filesTouched, entry.relativePath, entry.backupTime);
    if (anchor !== undefined) {
        appendViewInRevisionsButton(pre, snapshotContext, anchor);
    }
}

// Resolves what a string token links to: renders the snapshot treatment itself (handled =
// true), or reports the jump target / revision link for the caller's span rendering.
function resolveStringTokenLink(
    pre: HTMLElement, tokenClass: string, token: string, record: WireValue,
    currentLine: number, maps: LinkMaps, filesTouched: WireFileHistory[],
    snapshotContext: SnapshotContext | undefined,
): { handled: boolean; jumpTarget: number | undefined; revisionLink: WireRevisionLink | undefined } {
    let jumpTarget: number | undefined;
    let revisionLink: WireRevisionLink | undefined;
    try {
        const value = JSON.parse(token) as string;
        // A backupFileName the CURRENT record tracks gets the snapshot treatment
        // instead of the generic revision link.
        const trackedEntry = snapshotContext === undefined ? undefined : findTrackedBackupEntry(record, value);
        if (trackedEntry !== undefined) {
            // trackedEntry !== undefined implies snapshotContext was passed (see the ternary above).
            appendSnapshotToken(pre, tokenClass, token, value, trackedEntry, filesTouched, snapshotContext!);
            return { handled: true, jumpTarget, revisionLink };
        }
        jumpTarget = findJumpTarget(value, currentLine, maps);
        if (jumpTarget === undefined) {
            // A value that IS a revision changeId (e.g. a backupFileName blob name)
            // links to that file's revision list, anchored on that revision. A blob
            // version without its own revision anchors via the snapshot's backupTime.
            revisionLink = findRevisionForChangeId(filesTouched, value, findBackupTimeForBlob(record, value));
        }
    } catch { /* not a lone string literal — no link */ }
    return { handled: false, jumpTarget, revisionLink };
}

// The clickable jump-to-line span for a token whose value names a transcript line.
function appendJumpLinkSpan(
    pre: HTMLElement, tokenClass: string, token: string, jumpTarget: number,
    showLine: (line: number) => void,
) {
    pre.append(el("span", {
        class: `${tokenClass} jump-link`,
        title: `Jump to line ${jumpTarget}`,
        onclick: () => showLine(jumpTarget),
        text: token,
    }));
}

// The clickable revision-link span for a token whose value is a revision changeId.
function appendRevisionLinkSpan(
    pre: HTMLElement, tokenClass: string, token: string, revisionLink: WireRevisionLink,
    openRevision: (link: WireRevisionLink) => void,
) {
    pre.append(el("span", {
        class: `${tokenClass} jump-link`,
        title: revisionLink.revisionNumber === undefined
            ? `Open ${revisionLink.target} revisions`
            : `Open ${revisionLink.target} at revision #${revisionLink.revisionNumber}`,
        onclick: () => openRevision(revisionLink),
        text: token,
    }));
}

// Long value: first 7 wrapped lines only (CSS line-clamp), […] toggles the rest.
function appendCollapsibleLongValue(pre: HTMLElement, tokenClass: string, token: string) {
    const valueSpan = el("span", { class: `${tokenClass} json-collapsed`, text: token });
    const expandToggle = el("button", {
        class: "row-btn json-expand",
        text: "[…]",
        title: "Show the full value",
        onclick: () => {
            const collapsed = valueSpan.classList.toggle("json-collapsed");
            expandToggle.textContent = collapsed ? "[…]" : "[hide]";
        },
    });
    pre.append(valueSpan, expandToggle);
}

// Pretty JSON text -> a <pre> of text nodes and highlight spans; linkable string values
// become clickable jump-links.
// (item 23) old signature: function renderHighlightedJson(prettyText, record, currentLine, maps, showLine, filesTouched, openRevision) {
export function renderHighlightedJson(
    prettyText: string, record: WireValue, currentLine: number, maps: LinkMaps,
    showLine: (line: number) => void, filesTouched: WireFileHistory[],
    openRevision: (link: WireRevisionLink) => void, snapshotContext?: SnapshotContext,
) {
    const pre = el("pre", { class: "inspector-json" });
    let lastIndex = 0;
    for (const match of prettyText.matchAll(JSON_TOKEN_PATTERN)) {
        if (match.index > lastIndex) {
            pre.append(prettyText.slice(lastIndex, match.index));
        }
        const token = match[0];
        const tokenClass = classifyToken(token);
        let jumpTarget: number | undefined;
        let revisionLink: WireRevisionLink | undefined;
        let handledAsSnapshot = false;
        if (tokenClass === "json-string") {
            const resolution = resolveStringTokenLink(pre, tokenClass, token, record, currentLine, maps, filesTouched, snapshotContext);
            handledAsSnapshot = resolution.handled;
            jumpTarget = resolution.jumpTarget;
            revisionLink = resolution.revisionLink;
        }
        if (handledAsSnapshot) {
            lastIndex = match.index + token.length;
            continue;
        }
        if (jumpTarget !== undefined) {
            appendJumpLinkSpan(pre, tokenClass, token, jumpTarget, showLine);
        } else if (revisionLink !== undefined) {
            appendRevisionLinkSpan(pre, tokenClass, token, revisionLink, openRevision);
        } else if (checkValueIsLong(tokenClass, token)) {
            appendCollapsibleLongValue(pre, tokenClass, token);
        } else {
            pre.append(el("span", { class: tokenClass, text: token }));
        }
        lastIndex = match.index + token.length;
    }
    pre.append(prettyText.slice(lastIndex));
    return pre;
}
