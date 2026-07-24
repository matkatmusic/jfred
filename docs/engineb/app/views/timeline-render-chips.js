// Timeline file chips (task 92 split from timeline.ts): the letter+color chip, the active-chip
// highlight, and the per-file button row on an expanded agent turn.
import { el } from "../app-dom.js";
import { RevisionViewMode } from "./details-model.js";
import { renderDetailsFileMode } from "./details-revision-view.js";
import { computeSnapshotJumpRoute } from "./timeline-changes.js";
import { openTurnInspector } from "./timeline-render-inspectors.js";
// (item 84) old: splitDiffBlocks (./file-history.ts), renderDiffText (./diff-vs-base.ts) and
// renderCodeInto (../highlight.ts) were imported for showFilePreview / showRevisionDiff. Both
// renderers are retired — the Revision View (details.ts) does this rendering now, and still
// imports all three itself.
// import { renderDiffText } from "./diff-vs-base.ts";
// import { renderCodeInto } from "../highlight.ts";
// The letter half of a chip's letter+color badge (color alone never carries the meaning).
function computeOpLetter(change) {
    if (change.eventKind === "rename") {
        return "R";
    }
    if (change.eventKind === "delete") {
        return "D";
    }
    if (change.eventKind === "copy") {
        return "A";
    }
    if (change.eventKind === "user-edit") {
        return "U";
    }
    if (change.eventKind === "script-execution") {
        return "S";
    }
    if (change.eventKind === "write" && change.isFirstRevision) {
        return "A";
    }
    return "M";
}
function computeBaseName(path) {
    return path.slice(path.lastIndexOf("/") + 1);
}
// One file chip: letter badge + name ("old → new" for renames).
function renderFileChip(change, onclick) {
    const letter = computeOpLetter(change);
    // displayPath, not path (task 127): a pre-rename chip shows the name the file had then.
    const label = change.renamedFrom !== undefined
        ? `${computeBaseName(change.renamedFrom)} → ${computeBaseName(change.displayPath)}`
        : computeBaseName(change.displayPath);
    return el("span", { class: "timeline-chip", title: "Show revision in Inspector", onclick }, [
        el("span", { class: `op-badge op-${letter.toLowerCase()}`, text: letter }),
        el("span", { text: label }),
    ]);
}
export function clearActiveChip(context) {
    if (context.activeChip === null) {
        return;
    }
    context.activeChip.classList.remove("active");
    context.activeChip = null;
}
// The chip whose file the Details pane is showing stays highlighted (item 84).
export function markChipActive(context, chipElement) {
    clearActiveChip(context);
    context.activeChip = chipElement;
    chipElement.classList.add("active");
}
// (item 84) old: toggleDrawerButton — click-again-to-close, shared by the two drawer-opening
// file buttons. Retired with showFilePreview/showRevisionDiff: every chip button now opens the
// Revision View, and the Files-treeview entry — which the chip now IS — never closed on a
// second click. markChipActive above keeps the highlight half.
// const toggleDrawerButton = (chipElement: HTMLElement): boolean => {
//     const pane = document.getElementById("inspector")!;
//     if (chipElement === activeChip) {
//         if (!pane.classList.contains("hidden")) {
//             pane.classList.add("hidden");
//             clearActiveChip();
//             return true;
//         }
//     }
//     clearActiveChip();
//     activeChip = chipElement;
//     chipElement.classList.add("active");
//     return false;
// };
// (item 84) old: showRevisionDiff — the +/- button's own revision-diff renderer, and a second
// implementation of details.ts's showRevisionDiffInDetails: same /api/diff?mode=revisions call,
// same splitDiffBlocks, same computeRevisionDiffFallbackText, two hand-rolled changeId lookups,
// two fetch caches. +/- now calls renderDetailsFileMode focused on its revision, whose card
// default render IS this diff — the details.ts copy survives as the single implementation.
// const showRevisionDiff = async (change: FileChange, chipElement: HTMLElement): Promise<void> => {
//     if (toggleDrawerButton(chipElement)) {
//         return;
//     }
//     const drawer = openInspectorPane();
//     document.getElementById("inspector")!.classList.add("file-preview-drawer");
//     const history = reconstructionDocument.filesTouched.find((entry) =>
//         entry.revisions.some((revision) => revision.changeId === change.changeId));
//     if (history === undefined) {
//         drawer.append(el("div", { class: "muted", text: "no surviving revision for this change (rewound branch)" }));
//         return;
//     }
//     const revisionNumber = history.revisions.findIndex((revision) => revision.changeId === change.changeId);
//     const params = buildConsentParams();
//     params.set("file", history.target);
//     params.set("mode", "revisions");
//     const blocks = splitDiffBlocks(await fetchText(`/api/diff?${params}`));
//     const diffPane = el("div", { class: "timeline-preview" });
//     // (item 47) old: renderDiffText(diffPane, blocks[revisionNumber] ?? "(no diff block for this revision)");
//     const fallbackText = computeRevisionDiffFallbackText(blocks[revisionNumber], change);
//     if (fallbackText === undefined) {
//         renderDiffText(diffPane, blocks[revisionNumber]!);
//     } else {
//         diffPane.append(el("div", { class: "muted", text: fallbackText }));
//     }
//     drawer.append(
//         el("div", { class: "timeline-preview-head", text: `${change.path} · diff for revision ${revisionNumber + 1} (vs previous)` }),
//         diffPane,
//     );
// };
// The { } button's click body (extracted from renderFileButtonRow).
function showCausingRecordForChip(event, context, node, previewPane, causingLocation, change, changeId) {
    event.stopPropagation();
    // (item 55, closing item 53) old: openTurnInspector(node, previewPane); —
    // reverted item 47b: the chip opens its file's OWN causing line (e.g. the
    // Write tool_use), user-decided; synthetic changeIds keep the turn fallback.
    // (item 84) old: openTranscriptInspectorSynced(causingLocation); — the record
    // now paints inside the Revision View, rev cards standing. The fallback stays
    // HERE: it needs `node`, which the Revision View has no notion of.
    if (causingLocation === undefined) {
        openTurnInspector(context, node, previewPane);
        return;
    }
    markChipActive(context, event.currentTarget);
    renderDetailsFileMode(change.path, context.detailsContext, { changeId, mode: RevisionViewMode.record });
}
// The { } chip (task 135 extraction): rendered only when the file's causing line resolved —
// renderFileButtonRow guards, this just builds the button.
function appendCausingRecordChipButton(buttons, context, node, previewPane, causingLocation, change, changeId) {
    buttons.push(el("span", {
        class: "timeline-chip timeline-chip-action",
        title: "Show this file's causing record in inspector",
        text: "{ }",
        onclick: (event) => showCausingRecordForChip(event, context, node, previewPane, causingLocation, change, changeId),
    }));
}
// The +/- button's click body (extracted from renderFileButtonRow).
function showRevisionDiffForChip(event, context, change, changeId) {
    event.stopPropagation();
    markChipActive(context, event.currentTarget);
    // (item 84) old: showRevisionDiff(change, event.currentTarget as HTMLElement);
    // Clicking a card IS how you view its diff — diff is the card's own default.
    renderDetailsFileMode(change.path, context.detailsContext, { changeId, mode: RevisionViewMode.diff });
}
// The 📷 button (extracted from renderFileButtonRow's jumpRoute arm).
function appendSnapshotJumpButton(buttons, context, change, changeId) {
    buttons.push(el("span", {
        class: "timeline-chip timeline-chip-action",
        title: "Show this specific File History Snapshot in File Revisions view",
        text: "📷",
        onclick: (event) => {
            event.stopPropagation();
            markChipActive(context, event.currentTarget);
            // (item 84 follow-up) old: location.hash = jumpRoute; — navigating to the
            // File History route reloaded the whole page (progress bar and all) just to
            // show a revision the bottom pane can already show. Same destination as the
            // chip name, in the pane, no page load.
            renderDetailsFileMode(change.path, context.detailsContext, { changeId, mode: RevisionViewMode.content });
        },
    }));
}
// One file's button row: [ name ] [{ }] [+/-] [📷] <TS> L:n — revision state, the file's OWN
// causing line, the revision's computed diff, the snapshot jump, and the causing line's
// timestamp + label (item 55). The action buttons need a resolvable changeId.
// item 84: every button here is a deep-link into THE Revision View (details.ts's
// renderDetailsFileMode) — button X ≡ `click the treeview entry → click this revision's card →
// click the card's X`. They differ only in the right-column mode they ask for. 📷 renders only
// for snapshot-backed revisions (task 94: backup-blob changeIds, gated inside
// computeSnapshotJumpRoute) — its presence IS the "this revision HAS a File History Snapshot"
// indicator, no longer an any-resolvable-changeId over-fire.
export function renderFileButtonRow(context, node, nodeIndex, change, previewPane) {
    const causingLocation = context.chipLineLocations.get(`${nodeIndex}:${change.path}`);
    const buttons = [renderFileChip(change, (event) => {
            event.stopPropagation();
            markChipActive(context, event.currentTarget);
            // (item 84) old: showFilePreview(node, change, event.currentTarget as HTMLElement);
            // A chip with no changeId names no revision — open on #1, the treeview's own default.
            if (change.changeId === undefined) {
                renderDetailsFileMode(change.path, context.detailsContext);
                return;
            }
            renderDetailsFileMode(change.path, context.detailsContext, { changeId: change.changeId, mode: RevisionViewMode.content });
        })];
    if (change.changeId !== undefined) {
        // Narrowed once: TypeScript does not carry a property narrowing into the callbacks
        // below, and the project's style bans the non-null assertion that would paper over it.
        const changeId = change.changeId;
        // task 135: no causing line resolved (synthetic gitbase: changeId) — the { } chip
        // would only show "no transcript line for this step"; skip it.
        if (causingLocation !== undefined) {
            appendCausingRecordChipButton(buttons, context, node, previewPane, causingLocation, change, changeId);
        }
        buttons.push(el("span", {
            class: "timeline-chip timeline-chip-action",
            title: "Show Diff in Inspector",
            text: "+/-",
            onclick: (event) => showRevisionDiffForChip(event, context, change, changeId),
        }));
        // The route is computed as a PRESENCE TEST, not to navigate: it resolves to undefined
        // when this revision has no File History Snapshot (task 94: non-blob changeIds are
        // rejected inside computeSnapshotJumpRoute), and the button's absence is how the row
        // says so (user-decided). Not every revision has one.
        const jumpRoute = computeSnapshotJumpRoute(context.project, context.reconstructionDocument.filesTouched, change);
        if (jumpRoute !== undefined) {
            appendSnapshotJumpButton(buttons, context, change, changeId);
        }
    }
    // The chip row's meta (item 55): the snapshot's timestamp, plus the causing line's
    // L:n label when it resolved (same numbering as the details pane).
    buttons.push(el("span", { class: "timeline-time", text: new Date(change.when).toLocaleTimeString() }));
    if (causingLocation !== undefined) {
        buttons.push(el("span", {
            class: "timeline-time",
            text: `L:${causingLocation.line} (of ${causingLocation.rawLines.length - 1})`,
        }));
    }
    return el("div", { class: "timeline-chip-row" }, buttons);
}
