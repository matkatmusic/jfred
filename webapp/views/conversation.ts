// Conversation view (#/project/<name>/jsonl/<file>): chat-like — genuine turns as bubbles,
// every other record as a collapsed one-line stub, a branch selector strip, and edit-event
// markers linking into the file-history view. Clicking any record opens the JSON inspector.
// The view-model half is DOM-free and tested against scenario ground truth (viewer-project-views.test.ts).

import { el as elUntyped } from "../app-dom.ts";
import { logProgress } from "../app-console.ts";
import { fetchDocument, fetchRawRecords } from "../app-fetch.ts";
import { renderConsentDialog } from "../app-consent.ts";
import { renderBaselineQuestionDialog } from "../app-baseline-question.ts";
import { routeToConversation, routeToFileHistory } from "../app-routes.ts";
import { openTranscriptInspector } from "../inspector.ts";
import { findLineForChangeId } from "./file-history-model.ts";

// Local typed view of app.ts's el() while app.ts is typed in parallel — attrs limited to the
// keys this view actually passes. ponytail: shim only; drop once app.ts exports its own types.
type WireElAttrs = {
    class?: string;
    text?: string;
    href?: string;
    onclick?: () => void;
};
const el = elUntyped as (tag: string, attrs?: WireElAttrs, children?: HTMLElement[]) => HTMLElement;

// Wire shapes of the /api/document JSON this view reads — ids, paths, and dates arrive as
// plain strings on the wire, so these are declared locally rather than imported from ../../src.
type WireConversationMessage = {
    uuid: string;
    role: string;
    timestamp?: string;
    text: string;
};
type WireLineVerdict = {
    uuid: string;
    line: number;
    type: string;
    verdict: string;
};
type WireBranch = {
    isSurviving: boolean;
    tip: string;
};
type WireFileHistory = {
    target: string;
    revisions: { changeId: string }[];
};
type WireConversationDocument = {
    messages: WireConversationMessage[];
    lineVerdicts: WireLineVerdict[];
    branches: WireBranch[];
    filesTouched: WireFileHistory[];
};
// Fields exclusive to one member are declared `?: undefined` on the other so union-wide reads
// (entry.uuid, entry.message) typecheck without narrowing at every site.
type ConversationEntry =
    | { kind: "message"; message: WireConversationMessage; line?: undefined; uuid?: undefined; type?: undefined; verdict?: undefined }
    | { kind: "stub"; line: number; uuid: string; type: string; verdict: string; message?: undefined };

// Pure view model for the conversation view (no DOM): the document's lineVerdicts walked in
// line order, each line becoming either a full message entry (its uuid matches a conversation
// message) or a collapsed one-line stub (every other record), so nothing in the transcript is
// hidden — only folded.
export function buildConversationViewModel(document: WireConversationDocument): { entries: ConversationEntry[] } {
    const messageByUuid = new Map<string, WireConversationMessage>();
    for (const message of document.messages) {
        messageByUuid.set(message.uuid, message);
    }
    const entries: ConversationEntry[] = [];
    for (const verdict of document.lineVerdicts) {
        const message = messageByUuid.get(verdict.uuid);
        if (message !== undefined) {
            entries.push({ kind: "message", message });
        } else {
            entries.push({ kind: "stub", line: verdict.line, uuid: verdict.uuid, type: verdict.type, verdict: verdict.verdict });
        }
    }
    return { entries };
}

// The branch selector strip: surviving highlighted, rewound ghosted.
function renderBranchStrip(branches: WireBranch[]): HTMLElement {
    const strip = el("div", { class: "branch-strip" });
    for (const branch of branches) {
        strip.append(el("span", {
            class: `branch-chip ${branch.isSurviving ? "surviving" : "rewound"}`,
            text: `${branch.isSurviving ? "surviving" : "rewound"} · tip ${String(branch.tip).slice(0, 8)}`,
        }));
    }
    return strip;
}

// One ✎ edit-marker link for a single revised path, appended to the conversation column.
function appendEditMarkerLink(conversation: HTMLElement, project: string, path: string): void {
    conversation.append(el("a", {
        class: "edit-marker",
        href: routeToFileHistory(project, path),
        text: `✎ ${path.slice(path.lastIndexOf("/") + 1)}`,
    }));
}

// The chat bubble node for a genuine conversation message.
function buildMessageBubbleNode(message: WireConversationMessage, entryLine: number, inspectLine: (line: number) => void): HTMLElement {
    return el("div", {
        class: `bubble ${message.role}`,
        onclick: () => inspectLine(entryLine),
    }, [
        el("div", { class: "bubble-meta", text: `${message.role} · ${message.timestamp === undefined ? "" : new Date(message.timestamp).toLocaleString()}` }),
        el("div", { text: message.text }),
    ]);
}

// The collapsed one-line stub node for a non-message record.
function buildStubRowNode(entry: Extract<ConversationEntry, { kind: "stub" }>, inspectLine: (line: number) => void): HTMLElement {
    return el("div", {
        class: "stub-row",
        text: `line ${entry.line} · ${entry.type} · ${entry.verdict}`,
        onclick: () => inspectLine(entry.line),
    });
}

export async function renderConversationView(container: HTMLElement, project: string, jsonl: string, anchorLine: string | undefined): Promise<void> {
    const result = await fetchDocument<WireConversationDocument>(project, jsonl);
    if (result.baselineQuestion !== undefined) {
        renderBaselineQuestionDialog(container, project, result.baselineQuestion);
        return;
    }
    if (result.consentRequired !== undefined) {
        renderConsentDialog(container, project, result.consentRequired);
        return;
    }
    const documentJson: WireConversationDocument = result.document!;
    const rawLines: string[] = await fetchRawRecords(project, jsonl);

    // A log line written right before a long synchronous stretch never paints without a yield.
    logProgress("building view");
    await new Promise((resolve) => setTimeout(resolve, 0));

    container.append(el("div", { class: "filter-bar" }, [
        el("div", { class: "pane-title", text: jsonl }),
        el("button", {
            class: "row-btn",
            text: "Raw lines",
            onclick: () => { location.hash = `${routeToConversation(project, jsonl, undefined)}/lines`; },
        }),
    ]));
    container.append(renderBranchStrip(documentJson.branches));

    // line index -> the file paths that line's change revised (the edit-event markers), keyed
    // by scanning each revision's changeId back to its raw line (see findLineForChangeId).
    const targetsByLine = new Map<number, string[]>();
    for (const history of documentJson.filesTouched) {
        for (const revision of history.revisions) {
            const line: number = findLineForChangeId(rawLines, revision.changeId);
            if (line < 0) continue;
            if (!targetsByLine.has(line)) targetsByLine.set(line, []);
            targetsByLine.get(line)!.push(history.target);
        }
    }

    // Inspector navigation (Prev/Next, jump-links) scrolls the conversation in step.
    const nodeByLine = new Map<number, HTMLElement>();
    const highlightLine = (line: number): void => {
        const node = nodeByLine.get(line);
        if (node === undefined) return;
        container.querySelectorAll(".anchored").forEach((old) => old.classList.remove("anchored"));
        node.classList.add("anchored");
        node.scrollIntoView({ block: "center" });
    };
    const inspectLine = (line: number): void => openTranscriptInspector({ jsonlName: jsonl, rawLines, line, onJumpToLine: highlightLine });
    const lineByUuid = new Map(documentJson.lineVerdicts.map((verdict): [string, number] => [verdict.uuid, verdict.line]));

    logProgress("rendering");
    await new Promise((resolve) => setTimeout(resolve, 0));

    const conversation = el("div", { class: "conversation" });
    let anchorNode: HTMLElement | undefined;
    const appendEditMarker = (line: number): void => {
        for (const path of targetsByLine.get(line) ?? []) {
            appendEditMarkerLink(conversation, project, path);
        }
    };
    for (const entry of buildConversationViewModel(documentJson).entries) {
        const entryLine = entry.kind === "message" ? lineByUuid.get(entry.message.uuid)! : entry.line;
        let node: HTMLElement;
        if (entry.kind === "message") {
            const message = entry.message;
            node = buildMessageBubbleNode(message, entryLine, inspectLine);
        } else {
            node = buildStubRowNode(entry, inspectLine);
        }
        conversation.append(node);
        nodeByLine.set(entryLine, node);
        appendEditMarker(entryLine);
        if (anchorLine !== undefined && entryLine === Number(anchorLine)) anchorNode = node;
    }
    container.append(conversation);
    if (anchorNode !== undefined) {
        anchorNode.classList.add("anchored");
        anchorNode.scrollIntoView({ block: "center" });
    }
}

