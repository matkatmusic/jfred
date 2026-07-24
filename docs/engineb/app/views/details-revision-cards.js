// Rev-card DOM builders for the Revision View (split from details-revision-view.ts at the
// 250-line cap, task 126). Pure element construction — selection, focus, and diff routing stay
// in details-revision-view.ts.
import { el } from "../app-dom.js";
import { fullContentsIsOn, } from "./details-model.js";
import { showContentInDetails } from "./details-diff.js";
import { downloadText } from "./download.js";
function jumpToOwningTimelineStep(context, card) {
    const ownerIndex = context.nodes.findIndex((candidate) => (candidate.fileChanges ?? []).some((change) => change.changeId === card.changeId));
    // No owning row (rewound / synthetic revisions): the button is a no-op.
    if (ownerIndex >= 0) {
        context.selectTimelineRow(ownerIndex);
    }
}
export function buildRevisionHeadElement(rangeToggle, card) {
    return el("div", { class: "rev-head" }, [
        rangeToggle,
        el("span", { text: `#${card.revisionNumber}` }),
        el("span", { class: `op-badge op-${card.opLabel}`, text: card.opLabel }),
        el("span", { class: "rev-ts", text: new Date(card.timestamp).toLocaleString() }),
    ]);
}
export function buildRevisionActionsElement(buildActionButton, context, target, baseName, card, index, revisionContents, getDiffBlocks) {
    return el("div", { class: "rev-actions" }, [
        buildActionButton("Show content", () => showContentInDetails(target, card.revisionNumber, revisionContents[index]?.content)),
        buildActionButton("Export this version", () => downloadText(`${baseName}.rev${card.revisionNumber}`, revisionContents[index]?.content ?? "")),
        buildActionButton("Copy patch", async () => navigator.clipboard.writeText((await getDiffBlocks(fullContentsIsOn()))[index] ?? "")),
        buildActionButton("Export .patch", async () => downloadText(`${baseName}.rev${card.revisionNumber}.patch`, (await getDiffBlocks(fullContentsIsOn()))[index] ?? "")),
        buildActionButton("Jump to timeline step", () => jumpToOwningTimelineStep(context, card)),
        // item 84: the ONLY route to a file-modifying event's JSON. The timeline chip's
        // { } delegates here, so this is load-bearing for the unification rule, not a
        // nicety — without it the Revision View has no JSON route at all.
        buildActionButton("{ }", () => context.openRecordForChangeId(card.changeId)),
    ]);
}
// task 119: an unrecoverable placeholder's card — dashed "rev N ✗" head. task 129: the .why
// line says which revision (of how many) failed to apply which operation; the raw engine
// error survives as the hover title. task 130: ONLY the jump + { } actions — the placeholder's
// lines are the prior revision carried forward, so content/export/patch actions would lie.
export function buildMissingRevisionCard(buildActionButton, context, card, revisionCount) {
    return el("div", { class: "rev-card missing" }, [
        el("div", { class: "rev-head" }, [
            el("span", { text: `rev ${card.revisionNumber} ✗` }),
            el("span", { class: "rev-ts", text: new Date(card.timestamp).toLocaleString() }),
        ]),
        el("div", {
            class: "why",
            title: card.unrecoverableReason,
            text: `rev ${card.revisionNumber} (of ${revisionCount}) failed to apply ${card.opLabel}`,
        }),
        el("div", { class: "rev-actions" }, [
            buildActionButton("Jump to timeline step", () => jumpToOwningTimelineStep(context, card)),
            buildActionButton("{ }", () => context.openRecordForChangeId(card.changeId)),
        ]),
    ]);
}
