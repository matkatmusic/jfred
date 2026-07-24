// Conversation view (#/project/<name>/jsonl/<file>): chat-like — genuine turns as bubbles,
// every other record as a collapsed one-line stub, a branch selector strip, and edit-event
// markers linking into the file-history view. Clicking any record opens the JSON inspector.
// The view-model half is DOM-free and tested against scenario ground truth (viewer-project-views.test.ts).
import { el as elUntyped } from "../app-dom.js";
import { logProgress } from "../app-console.js";
import { fetchDocument, fetchRawRecords } from "../app-fetch.js";
import { renderConsentDialog } from "../app-consent.js";
import { renderBaselineQuestionDialog } from "../app-baseline-question.js";
import { routeToConversation, routeToFileHistory } from "../app-routes.js";
import { openTranscriptInspector } from "../inspector.js";
import { findLineForChangeId } from "./file-history-model.js";
const el = elUntyped;
// Pure view model for the conversation view (no DOM): the document's lineVerdicts walked in
// line order, each line becoming either a full message entry (its uuid matches a conversation
// message) or a collapsed one-line stub (every other record), so nothing in the transcript is
// hidden — only folded.
export function buildConversationViewModel(document) {
    const messageByUuid = new Map();
    for (const message of document.messages) {
        messageByUuid.set(message.uuid, message);
    }
    const entries = [];
    for (const verdict of document.lineVerdicts) {
        const message = messageByUuid.get(verdict.uuid);
        if (message !== undefined) {
            entries.push({ kind: "message", message });
        }
        else {
            entries.push({ kind: "stub", line: verdict.line, uuid: verdict.uuid, type: verdict.type, verdict: verdict.verdict });
        }
    }
    return { entries };
}
// The branch selector strip: surviving highlighted, rewound ghosted.
function renderBranchStrip(branches) {
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
function appendEditMarkerLink(conversation, project, path) {
    conversation.append(el("a", {
        class: "edit-marker",
        href: routeToFileHistory(project, path),
        text: `✎ ${path.slice(path.lastIndexOf("/") + 1)}`,
    }));
}
// The chat bubble node for a genuine conversation message.
function buildMessageBubbleNode(message, entryLine, inspectLine) {
    return el("div", {
        class: `bubble ${message.role}`,
        onclick: () => inspectLine(entryLine),
    }, [
        el("div", { class: "bubble-meta", text: `${message.role} · ${message.timestamp === undefined ? "" : new Date(message.timestamp).toLocaleString()}` }),
        el("div", { text: message.text }),
    ]);
}
// The collapsed one-line stub node for a non-message record.
function buildStubRowNode(entry, inspectLine) {
    return el("div", {
        class: "stub-row",
        text: `line ${entry.line} · ${entry.type} · ${entry.verdict}`,
        onclick: () => inspectLine(entry.line),
    });
}
export async function renderConversationView(container, project, jsonl, anchorLine) {
    const result = await fetchDocument(project, jsonl);
    if (result.baselineQuestion !== undefined) {
        renderBaselineQuestionDialog(container, project, result.baselineQuestion);
        return;
    }
    if (result.consentRequired !== undefined) {
        renderConsentDialog(container, project, result.consentRequired);
        return;
    }
    const documentJson = result.document;
    const rawLines = await fetchRawRecords(project, jsonl);
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
    const targetsByLine = new Map();
    for (const history of documentJson.filesTouched) {
        for (const revision of history.revisions) {
            const line = findLineForChangeId(rawLines, revision.changeId);
            if (line < 0)
                continue;
            if (!targetsByLine.has(line))
                targetsByLine.set(line, []);
            targetsByLine.get(line).push(history.target);
        }
    }
    // Inspector navigation (Prev/Next, jump-links) scrolls the conversation in step.
    const nodeByLine = new Map();
    const highlightLine = (line) => {
        const node = nodeByLine.get(line);
        if (node === undefined)
            return;
        container.querySelectorAll(".anchored").forEach((old) => old.classList.remove("anchored"));
        node.classList.add("anchored");
        node.scrollIntoView({ block: "center" });
    };
    const inspectLine = (line) => openTranscriptInspector({ jsonlName: jsonl, rawLines, line, onJumpToLine: highlightLine });
    const lineByUuid = new Map(documentJson.lineVerdicts.map((verdict) => [verdict.uuid, verdict.line]));
    logProgress("rendering");
    await new Promise((resolve) => setTimeout(resolve, 0));
    const conversation = el("div", { class: "conversation" });
    let anchorNode;
    const appendEditMarker = (line) => {
        for (const path of targetsByLine.get(line) ?? []) {
            appendEditMarkerLink(conversation, project, path);
        }
    };
    for (const entry of buildConversationViewModel(documentJson).entries) {
        const entryLine = entry.kind === "message" ? lineByUuid.get(entry.message.uuid) : entry.line;
        let node;
        if (entry.kind === "message") {
            const message = entry.message;
            node = buildMessageBubbleNode(message, entryLine, inspectLine);
        }
        else {
            node = buildStubRowNode(entry, inspectLine);
        }
        conversation.append(node);
        nodeByLine.set(entryLine, node);
        appendEditMarker(entryLine);
        if (anchorLine !== undefined && entryLine === Number(anchorLine))
            anchorNode = node;
    }
    container.append(conversation);
    if (anchorNode !== undefined) {
        anchorNode.classList.add("anchored");
        anchorNode.scrollIntoView({ block: "center" });
    }
}
