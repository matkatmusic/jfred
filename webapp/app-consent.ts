// The script-execution consent dialog (plan 3.2): every recorded script shown verbatim,
// running is opt-in, declining still yields a (degraded) document. Pure view-model helpers
// live in app-consent-model.ts.

import { el } from "./app-dom.ts";
import { storeConsentChoice, type WireConsentScript } from "./app-fetch.ts";
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

// One script's row in the consent dialog: local timestamp (+ cwd when recorded) over its
// python-highlighted code; scripts taller than the preview clip get an Expand toggle (item 70).
// Shell lines carrying inline code (`python3 -c "…"`) highlight just the quoted body, in the
// interpreter's language, with the wrapper left as plain text.
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

// The consent dialog (plan 3.2): every script's code shown verbatim; running is opt-in;
// declining still yields a (degraded) document. The choice is remembered per project for
// this browser session only. Read-only scripts (item 69) collapse into per-run <details>
// blocks; the Show/hide button opens/closes all of them at once.
export function renderConsentDialog(container: HTMLElement, project: string, scripts: WireConsentScript[]): void {
    const readOnlyCount = scripts.filter((script) => script.readOnly === true).length;
    const modifyingCount = scripts.length - readOnlyCount;
    const countSplit = readOnlyCount > 0 ? ` — ${modifyingCount} modifying, ${readOnlyCount} read-only` : "";
    // item 73: decide moved above the header build — the decision buttons now live in the
    // sticky header instead of a bottom .consent-actions row.
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
    // item 73: sticky header — the message, decision buttons, and script navigation stay
    // visible while the previews scroll (styles.css .consent-header).
    const header = el("div", { class: "consent-header" }, [
        el("h2", { text: `This reconstruction contains ${scripts.length} recorded script execution(s)${countSplit}` }),
        el("div", { class: "consent-header-row" }, [
            runButton, continueButton, jumpToTopButton, prevButton, nextButton, navCounter, expandAllButton,
        ]),
    ]);
    const box = el("div", { class: "consent-box" }, [
        header,
        // item 73: was — the message rendered as a plain first child and scrolled away with
        // the previews; it now lives in the sticky header above:
        // el("h2", { text: `This reconstruction contains ${scripts.length} recorded script execution(s)${countSplit}` }),
        el("div", { class: "muted", text: "Re-running them reproduces script-made file states. Nothing runs without your say-so." }),
    ]);
    if (readOnlyCount > 0) {
        // Expand-all/collapse-all over the SAME per-block <details> state the triangles use:
        // if any block is closed the click opens all, otherwise it closes all.
        box.append(el("button", {
            class: "toolbar-btn",
            text: "Show/hide Read-only scripts",
            onclick: () => {
                const detailsBlocks = [...box.querySelectorAll<HTMLDetailsElement>("details.consent-readonly-block")];
                const shouldOpen = detailsBlocks.some((block) => !block.open);
                for (const block of detailsBlocks) block.open = shouldOpen;
            },
        }));
    }
    for (const block of groupConsentScriptsIntoBlocks(scripts)) {
        if (block.kind === ConsentBlockKind.modifying) {
            box.append(buildConsentScriptRow(block.script));
        } else {
            const firstTimestamp = new Date(block.scripts[0]!.timestamp).toLocaleString();
            box.append(el("details", { class: "consent-readonly-block" }, [
                el("summary", { class: "muted", text: `----- ${firstTimestamp} ${block.scripts.length} readonly script(s) -----` }),
                ...block.scripts.map(buildConsentScriptRow),
            ]));
        }
    }
    // item 73: was — decide + the decision buttons rendered at the BOTTOM of the script list
    // and scrolled out of reach; both buttons now live in the sticky header above:
    // const decide = (choice: string) => {
    //     storeConsentChoice(project, choice);
    //     renderRoute();
    // };
    // box.append(el("div", { class: "consent-actions" }, [
    //     el("button", { class: "toolbar-btn consent-run", text: "Run scripts for this reconstruction", onclick: () => decide("1") }),
    //     el("button", { class: "toolbar-btn", text: "Continue without running", onclick: () => decide("0") }),
    // ]));
    // item 73: Prev/Next walk the VISIBLE script rows — modifying rows always, read-only rows
    // only while their <details> block is open. Rows sit in scripts[] order (grouping is
    // contiguous and order-preserving), so allConsentRows()[i] corresponds to scripts[i].
    const allConsentRows = () => [...box.querySelectorAll<HTMLElement>(".consent-script")];
    const collectVisibleConsentRows = () => allConsentRows()
        .filter((row) => row.closest("details:not([open])") === null);
    const defaultIndex = findDefaultConsentSelectionIndex(scripts);
    let selectedRow: HTMLElement | undefined = defaultIndex === undefined ? undefined : allConsentRows()[defaultIndex];
    const updateScriptNavState = () => {
        const visibleRows = collectVisibleConsentRows();
        if (selectedRow === undefined || !visibleRows.includes(selectedRow)) {
            // The selected row's block closed (or nothing was selectable yet): fall back to
            // the first visible row so the rectangle never sits on a hidden script.
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
    // <details> toggle events don't bubble but ARE observable in the capture phase, and they
    // fire for programmatic open changes too — one listener covers the per-block triangles,
    // the Show/hide button, and Expand All.
    box.addEventListener("toggle", () => updateScriptNavState(), true);
    updateScriptNavState();
    // item 72/73: Expand All expands or collapses every script preview and read-only <details>
    // block at once. item 73 moved the button into the sticky consent header (the static
    // #toggle-all skeleton is hidden while consent shows — see below). onclick property
    // assignment (not addEventListener) so re-renders never stack handlers. Re-query the DOM
    // on every click — the per-row Expand buttons and the read-only Show/hide button mutate
    // the same expanded state between clicks.
    // const toggleAllButton = document.getElementById("toggle-all") as HTMLButtonElement;
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
        // With nothing expandable the button is inert; "Expand All" is the least-misleading label.
        toggleAllButton.textContent = anyCollapsed || nothingExpandable ? "Expand All" : "Collapse All";
    };
    toggleAllButton.onclick = () => {
        const { previews, readOnlyBlocks } = collectExpandables();
        const shouldExpand = previews.some((pre) => !pre.classList.contains("expanded"))
            || readOnlyBlocks.some((block) => !block.open);
        for (const pre of previews) pre.classList.toggle("expanded", shouldExpand);
        for (const block of readOnlyBlocks) block.open = shouldExpand;
        for (const pre of previews) {
            // Keep each row's own Expand/Collapse button label in step with the global toggle.
            const row = pre.parentElement;
            if (row !== null) {
                const rowButton = row.querySelector("button");
                if (rowButton !== null) {
                    rowButton.textContent = shouldExpand ? "Collapse" : "Expand";
                }
            }
        }
        updateToggleAllLabel();
    };
    updateToggleAllLabel();
    // item 73: the header row owns Expand All during consent; hide the skeleton button so two
    // Expand All buttons never show at once. renderRoute un-hides it on every navigation.
    (document.getElementById("toggle-all") as HTMLButtonElement).hidden = true;
    container.append(box);
}
