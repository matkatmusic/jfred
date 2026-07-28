// Script-execution consent dialog: running recorded scripts is opt-in, declining still
// yields a degraded document.

import { el } from "./app-dom.ts";
import { storeConsentChoice } from "./app-choices.ts";
import { type WireConsentScript } from "./app-fetch.ts";
import {
    checkConsentScriptOverflowsPreview,
    clampConsentSelectionStep,
    ConsentBlockKind,
    CONSENT_SCRIPT_LANGUAGE_PATH,
    findDefaultConsentSelectionIndex,
    formatConsentSourceToken,
    groupConsentScriptsIntoBlocks,
    splitInlineInterpreterCode,
} from "./app-consent-model.ts";
import { renderRoute } from "./app-router.ts";
import { renderCodeInto } from "./highlight.ts";

// Shell lines carrying inline code (`python3 -c "…"`) highlight only the quoted body, in the
// interpreter's language.
function buildConsentScriptRow(script: WireConsentScript): HTMLElement {
    const pre = el("pre");
    const inline = splitInlineInterpreterCode(script.code);
    if (inline === undefined) {
        renderCodeInto(pre, script.code, CONSENT_SCRIPT_LANGUAGE_PATH);
    } else {
        const bodySpan = el("span");
        renderCodeInto(bodySpan, inline.body, inline.languagePath);
        pre.append(document.createTextNode(inline.prefix), bodySpan, document.createTextNode(inline.suffix));
    }
    const row = el("div", { class: "consent-script" }, [
        el("div", { class: "muted", text: new Date(script.timestamp).toLocaleString() + (script.cwd ? `  ·  cwd ${script.cwd}` : "") + formatConsentSourceToken(script.source) }),
        pre,
    ]);
    if (checkConsentScriptOverflowsPreview(script.code)) {
        const expandButton = el("button", { class: "toolbar-btn", text: "Expand" });
        expandButton.onclick = () => {
            const nowExpanded = pre.classList.toggle("expanded");
            expandButton.textContent = nowExpanded ? "Collapse" : "Expand";
        };
        row.append(expandButton);
    }
    return row;
}

// Shares the per-block <details> state the triangles use: any block closed means open all.
function toggleReadOnlyBlocksVisibility(box: HTMLElement): void {
    const detailsBlocks = [...box.querySelectorAll<HTMLDetailsElement>("details.consent-readonly-block")];
    const shouldOpen = detailsBlocks.some((block) => !block.open);
    for (const block of detailsBlocks) block.open = shouldOpen;
}

function appendReadOnlyScriptsBlock(box: HTMLElement, scripts: WireConsentScript[]): void {
    const firstTimestamp = new Date(scripts[0]!.timestamp).toLocaleString();
    box.append(el("details", { class: "consent-readonly-block" }, [
        el("summary", { class: "muted", text: `----- ${firstTimestamp} ${scripts.length} readonly script(s) -----` }),
        ...scripts.map(buildConsentScriptRow),
    ]));
}

function updateRowExpandButtonLabel(pre: HTMLPreElement, shouldExpand: boolean): void {
    const row = pre.parentElement;
    if (row !== null) {
        const rowButton = row.querySelector("button");
        if (rowButton !== null) {
            rowButton.textContent = shouldExpand ? "Collapse" : "Expand";
        }
    }
}

// The choice is remembered per project for this browser session only.
export function renderConsentDialog(container: HTMLElement, project: string, scripts: WireConsentScript[]): void {
    const readOnlyCount = scripts.filter((script) => script.readOnly === true).length;
    const modifyingCount = scripts.length - readOnlyCount;
    const countSplit = readOnlyCount > 0 ? ` — ${modifyingCount} modifying, ${readOnlyCount} read-only` : "";
    const decide = (choice: string) => {
        storeConsentChoice(project, choice);
        renderRoute();
    };
    const runButton = el("button", { class: "toolbar-btn consent-run", text: "Run scripts for this reconstruction", onclick: () => decide("1") }) as HTMLButtonElement;
    const continueButton = el("button", { class: "toolbar-btn", text: "Continue without running", onclick: () => decide("0") }) as HTMLButtonElement;
    const jumpToTopButton = el("button", { class: "toolbar-btn consent-jump-top", text: "Jump to top", onclick: () => container.scrollTo({ top: 0, behavior: "smooth" }) }) as HTMLButtonElement;
    const prevButton = el("button", { class: "toolbar-btn", text: "< Prev" }) as HTMLButtonElement;
    const nextButton = el("button", { class: "toolbar-btn", text: "Next >" }) as HTMLButtonElement;
    const navCounter = el("span", { class: "muted consent-nav-counter" });
    const expandAllButton = el("button", { class: "toolbar-btn", text: "Expand All" }) as HTMLButtonElement;
    // Sticky so decisions and navigation stay reachable while previews scroll.
    const header = el("div", { class: "consent-header" }, [
        el("h2", { text: `This reconstruction contains ${scripts.length} recorded script execution(s)${countSplit}` }),
        el("div", { class: "consent-header-row" }, [
            runButton, continueButton, jumpToTopButton, prevButton, nextButton, navCounter, expandAllButton,
        ]),
    ]);
    const box = el("div", { class: "consent-box" }, [
        header,
        el("div", { class: "muted", text: "Re-running them reproduces script-made file states. Nothing runs without your say-so." }),
    ]);
    if (readOnlyCount > 0) {
        box.append(el("button", {
            class: "toolbar-btn",
            text: "Show/hide Read-only scripts",
            onclick: () => toggleReadOnlyBlocksVisibility(box),
        }));
    }
    for (const block of groupConsentScriptsIntoBlocks(scripts)) {
        if (block.kind === ConsentBlockKind.modifying) {
            box.append(buildConsentScriptRow(block.script));
        } else {
            appendReadOnlyScriptsBlock(box, block.scripts);
        }
    }
    // Grouping is contiguous and order-preserving, so allConsentRows()[i] matches scripts[i].
    const allConsentRows = () => [...box.querySelectorAll<HTMLElement>(".consent-script")];
    const collectVisibleConsentRows = () => allConsentRows()
        .filter((row) => row.closest("details:not([open])") === null);
    const defaultIndex = findDefaultConsentSelectionIndex(scripts);
    let selectedRow: HTMLElement | undefined = defaultIndex === undefined ? undefined : allConsentRows()[defaultIndex];
    const updateScriptNavState = () => {
        const visibleRows = collectVisibleConsentRows();
        if (selectedRow === undefined || !visibleRows.includes(selectedRow)) {
            // Fall back to the first visible row so the selection never sits on a hidden script.
            selectedRow = visibleRows[0];
        }
        for (const row of allConsentRows()) {
            row.classList.toggle("consent-selected", row === selectedRow);
        }
        const nothingNavigable = visibleRows.length === 0;
        prevButton.hidden = nothingNavigable;
        nextButton.hidden = nothingNavigable;
        navCounter.hidden = nothingNavigable;
        if (selectedRow !== undefined) {
            const selectedIndex = visibleRows.indexOf(selectedRow);
            prevButton.disabled = selectedIndex <= 0;
            nextButton.disabled = selectedIndex >= visibleRows.length - 1;
            navCounter.textContent = `Script ${selectedIndex + 1} of ${visibleRows.length}`;
        }
    };
    const navigateConsentScript = (delta: number) => {
        const visibleRows = collectVisibleConsentRows();
        if (visibleRows.length === 0) {
            return;
        }
        const currentIndex = selectedRow === undefined ? -1 : visibleRows.indexOf(selectedRow);
        selectedRow = visibleRows[clampConsentSelectionStep(currentIndex, delta, visibleRows.length)];
        updateScriptNavState();
        selectedRow?.scrollIntoView({ block: "center", behavior: "smooth" });
    };
    prevButton.onclick = () => navigateConsentScript(-1);
    nextButton.onclick = () => navigateConsentScript(1);
    // <details> toggle events don't bubble but are observable in the capture phase, and fire
    // for programmatic open changes too, so one listener covers every expand path.
    box.addEventListener("toggle", () => updateScriptNavState(), true);
    updateScriptNavState();
    // Re-query the DOM on every click: per-row Expand and Show/hide mutate the same state
    // between clicks. onclick (not addEventListener) so re-renders never stack handlers.
    const toggleAllButton = expandAllButton;
    const collectExpandables = () => ({
        previews: [...box.querySelectorAll<HTMLPreElement>(".consent-script pre")]
            .filter((pre) => checkConsentScriptOverflowsPreview(pre.textContent ?? "")),
        readOnlyBlocks: [...box.querySelectorAll<HTMLDetailsElement>("details.consent-readonly-block")],
    });
    const updateToggleAllLabel = () => {
        const { previews, readOnlyBlocks } = collectExpandables();
        const anyCollapsed = previews.some((pre) => !pre.classList.contains("expanded"))
            || readOnlyBlocks.some((block) => !block.open);
        const nothingExpandable = previews.length === 0 && readOnlyBlocks.length === 0;
        toggleAllButton.textContent = anyCollapsed || nothingExpandable ? "Expand All" : "Collapse All";
    };
    toggleAllButton.onclick = () => {
        const { previews, readOnlyBlocks } = collectExpandables();
        const shouldExpand = previews.some((pre) => !pre.classList.contains("expanded"))
            || readOnlyBlocks.some((block) => !block.open);
        for (const pre of previews) pre.classList.toggle("expanded", shouldExpand);
        for (const block of readOnlyBlocks) block.open = shouldExpand;
        for (const pre of previews) {
            updateRowExpandButtonLabel(pre, shouldExpand);
        }
        updateToggleAllLabel();
    };
    updateToggleAllLabel();
    // Hide the skeleton button so two Expand All buttons never show at once; renderRoute un-hides it.
    (document.getElementById("toggle-all") as HTMLButtonElement).hidden = true;
    container.append(box);
}
