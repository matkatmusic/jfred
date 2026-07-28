// File-Revisions mode — THE Revision View (item 84; split from details.ts, task 92). Every route to a file's content lands here: the Files sidebar (no focus → revision #1, diff), and every timeline chip-row button (focused on its own revision, in the mode its button names).  Rev-cards on the left, the selected card's diff / content / causing record on the right (tests/details-revision-view.test.ts covers the focus + range view-model helpers in details-model.ts).

import { el } from "../app-dom.ts";
import { routeToFileHistory } from "../app-routes.ts";
import { revealDetailsPane } from "../inspector.ts";
import { buildFileHistoryViewModel } from "./file-history-model.ts";
import { splitPatchByFile } from "./timeline-changes.ts";
import { computeRevisionDiffFallbackText } from "./timeline-labels.ts";
import { computeRangeSummary } from "./timeline-picks.ts";
import { type FileChange } from "./timeline-types.ts";
import {
    type DetailsContext,
    type RevisionCard,
    type RevisionFocus,
    RevisionViewMode,
    buildRevisionCards,
    checkCardRunIsContiguous,
    checkChangeIdIsGitBaseline,
    computeFocusedCardIndex,
    computeOwningNodeIndexes,
    fullContentsIsOn,
} from "./details-model.ts";
import { showGitBaselineInDetails } from "./details-baseline.ts";
import {
    fetchRevisionDiffBlocks,
    setDetailsHeader,
    showContentInDetails,
    showDiffInDetails,
    showTextInDetails,
    showUnrecoverableInDetails,
} from "./details-diff.ts";
import {
    buildMissingRevisionCard,
    buildRevisionActionsElement,
    buildRevisionHeadElement,
} from "./details-revision-cards.ts";

export function renderDetailsFileMode(target: string, context: DetailsContext, focus?: RevisionFocus): void {
    revealDetailsPane();
    setDetailsHeader(`File Revisions — ${target}`);
    const left = document.getElementById("details-left")!;
    left.replaceChildren(el("div", { class: "pane-title", text: "Revisions" }));
    const history = context.document.filesTouched.find((entry) => entry.target === target);
    if (history === undefined || history.revisions.length === 0) {
        left.append(el("div", { class: "dempty", text: "No revisions" }));
        return;
    }
    // task 93: the Diff-vs-Base entry moved here from the retired File History view.
    left.append(el("button", {
        class: "row-btn",
        text: "Diff vs Base",
        onclick: () => { location.hash = `${routeToFileHistory(context.project, target)}/vsbase`; },
    }));
    const cards = buildRevisionCards(history);
    const focusedIndex = computeFocusedCardIndex(cards, focus);
    const focusedMode = focus?.mode ?? RevisionViewMode.diff;
    // Revision contents come from the file-history view model (step snapshots at each revision's timestamp) — the same mechanism the file-history view's Show content uses.
    const revisionContents = buildFileHistoryViewModel(context.document, target).revisions;
    const baseName = target.slice(target.lastIndexOf("/") + 1);
    // The revision-timeline diff at each context width, fetched at most once each on first need: switching rev-cards never re-fetches, but toggling full contents fetches the wider diff separately (item 75).
    let defaultBlocks: Promise<string[]> | undefined;
    let fullBlocks: Promise<string[]> | undefined;
    const getDiffBlocks = (full: boolean) => {
        if (full) {
            fullBlocks ??= fetchRevisionDiffBlocks(context.project, target, true);
            return fullBlocks;
        }
        defaultBlocks ??= fetchRevisionDiffBlocks(context.project, target, false);
        return defaultBlocks;
    };
    const showCardDiff = async (card: RevisionCard, index: number) => {
        const label = `${target} — revision #${card.revisionNumber}`;
        // t124:Q2 — a placeholder's lines are the prior revision carried forward, so a computed diff reads "(no content change)". Show the failure reason instead.
        if (card.unrecoverableReason !== undefined) {
            const previousBlock = index > 0 ? (await getDiffBlocks(fullContentsIsOn()))[index - 1] : undefined;
            showUnrecoverableInDetails(label, card.unrecoverableReason, previousBlock, () => void showCardDiff(card, index));
            return;
        }
        // task 56 follow-up: a base-commit beacon's diff is empty — show the committed bytes.
        if (checkChangeIdIsGitBaseline(card.changeId)) {
            showGitBaselineInDetails(context.document, target, card.changeId);
            return;
        }
        const block = (await getDiffBlocks(fullContentsIsOn()))[index];
        const change: FileChange = {
            path: target,
            displayPath: target,    // this site renders its own `${target} — revision #n` label
            eventKind: card.opLabel,
            renamedFrom: history.revisions[index]!.rename?.from,
            isFirstRevision: index === 0,
            changeId: card.changeId,
            when: card.timestamp,
        };
        const fallbackText = computeRevisionDiffFallbackText(block, change);
        if (fallbackText !== undefined) {
            showTextInDetails(label, fallbackText);
            return;
        }
        showDiffInDetails(label, block!, () => void showCardDiff(card, index));
    };
    // item 84: one card's right-column render in a chosen mode. A card's OWN click always means diff — only an incoming focus can ask for content or record.
    const showCardInMode = (card: RevisionCard, index: number, mode: RevisionViewMode) => {
        if (mode === RevisionViewMode.content) {
            showContentInDetails(target, card.revisionNumber, revisionContents[index]?.content);
            return;
        }
        if (mode === RevisionViewMode.record) {
            context.openRecordForChangeId(card.changeId);
            return;
        }
        void showCardDiff(card, index);
    };
    // item 84: which cards are toggled for a range diff (0-based). Empty → single-card mode.
    const rangeSelection = new Set<number>();
    // Each card's range toggle, pushed in card order by the forEach below — so rangeToggles[i] is always card i's own toggle.
    const rangeToggles: HTMLElement[] = [];
    // Every glyph re-reads the set: one click changes one card's membership, but the whole run's glyphs must agree with it.
    const refreshRangeToggleGlyphs = () => {
        rangeToggles.forEach((toggle, toggleIndex) => {
            toggle.textContent = rangeSelection.has(toggleIndex) ? "☑" : "☐";
        });
    };
    // item 84: the picked run's diff for THIS file — card run → owning nodes → step range → the server's range patch → this file's block. The same path showFilePreview's range branch took before item 84 moved it here; computeRangeSummary still speaks node indexes.
    const showRangeDiff = async () => {
        const selectedIndexes = [...rangeSelection].sort((left2, right2) => left2 - right2);
        if (!checkCardRunIsContiguous(selectedIndexes)) {
            showTextInDetails(target, "(pick a contiguous run of revisions)");
            return;
        }
        const ownerIndexes = computeOwningNodeIndexes(cards, context.nodes, selectedIndexes);
        if (ownerIndexes.length === 0) {
            showTextInDetails(target, "(no timeline steps own the picked revisions)");
            return;
        }
        const summary = computeRangeSummary(context.nodes, ownerIndexes);
        const patchText = await context.fetchRangePatch(summary.fromStepIndex, summary.toStepIndex);
        const block = splitPatchByFile(patchText).find((entry) =>
            target === entry.path || target.endsWith(`/${entry.path}`));
        const firstNumber = selectedIndexes[0]! + 1;
        const lastNumber = selectedIndexes[selectedIndexes.length - 1]! + 1;
        const label = `${target} — revisions #${firstNumber}→#${lastNumber}`;
        if (block === undefined) {
            showTextInDetails(label, "(file unchanged across the picked revisions)");
            return;
        }
        showDiffInDetails(label, block.block, () => void showRangeDiff());
    };
    // Never re-enter renderDetailsFileMode to repaint: it would rebuild the cards and drop both the selection and the focus. Flip the glyphs in place, then re-decide the right column.
    const toggleRangeCard = (index: number) => {
        if (rangeSelection.has(index)) {
            rangeSelection.delete(index);
        } else {
            rangeSelection.add(index);
        }
        refreshRangeToggleGlyphs();
        // Emptying the run returns the right column to the focused card's own render.
        if (rangeSelection.size === 0) {
            showCardInMode(cards[focusedIndex]!, focusedIndex, focusedMode);
            return;
        }
        void showRangeDiff();
    };
    const selectCard = (cardElement: HTMLElement) => {
        left.querySelectorAll(".rev-card").forEach((other) => other.classList.remove("selected"));
        cardElement.classList.add("selected");
    };
    // An action button's click must not re-trigger the card's own diff swap.
    const buildActionButton = (text: string, onActivate: () => unknown) => el("button", {
        text,
        onclick: ((event: Event) => {
            event.stopPropagation();
            onActivate();
        }) as EventListener,
    });
    cards.forEach((card, index) => {
        // item 84: range toggle — buildActionButton stops propagation so toggling never fires the card's diff swap.
        const rangeToggle = buildActionButton("☐", () => toggleRangeCard(index));
        // Pushed even for missing cards (unrendered there) so rangeToggles[i] stays card i's toggle.
        rangeToggles.push(rangeToggle);
        // Built for missing cards too (like the toggle) but only attached on healthy ones.
        const healthyCardRows = [
            buildRevisionHeadElement(rangeToggle, card),
            buildRevisionActionsElement(buildActionButton, context, target, baseName, card, index, revisionContents, getDiffBlocks),
        ];
        const cardElement = card.unrecoverableReason === undefined
            ? el("div", { class: "rev-card" }, healthyCardRows)
            : buildMissingRevisionCard(buildActionButton, context, card, cards.length);
        cardElement.onclick = () => {
            selectCard(cardElement);
            void showCardDiff(card, index);
        };
        left.append(cardElement);
        // item 84: was `if (index === 0)` — the focused card is now whichever revision the caller asked for, in the mode it asked for. No focus still means #1 in diff mode.
        if (index === focusedIndex) {
            selectCard(cardElement);
            showCardInMode(card, index, focusedMode);
        }
    });
}
