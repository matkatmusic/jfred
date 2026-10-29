// DOM node builders for the conversation view: filter bar, branch strip, bubbles, stubs, edit markers.

import { createElement as createElementUntyped } from "../app-dom.ts";
import { getConversationRoute, getFileHistoryRoute } from "../app-routes.ts";
import type { ConversationStubEntry, WireBranch, WireConversationMessage } from "./conversation-model.ts";

// Typed view of createElement for this view's keys. ponytail: shim only; drop once app-dom types it.
type WireElAttrs = {
  class?: string;
  text?: string;
  href?: string;
  onclick?: () => void;
};
const createElement = createElementUntyped as (tag: string, attrs?: WireElAttrs, children?: HTMLElement[]) => HTMLElement;

export function buildFilterBar(project: string, jsonl: string): HTMLElement {
  const openRawLines = (): void => {
    location.hash = `${getConversationRoute(project, jsonl, undefined)}/lines`;
  };
  return createElement("div", { class: "filter-bar" }, [
    createElement("div", { class: "pane-title", text: jsonl }),
    createElement("button", { class: "row-btn", text: "Raw lines", onclick: openRawLines }),
  ]);
}

export function createConversationColumn(): HTMLElement {
  return createElement("div", { class: "conversation" });
}

// The branch selector strip: surviving highlighted, rewound ghosted.
export function renderBranchStrip(branches: WireBranch[]): HTMLElement {
  const strip = createElement("div", { class: "branch-strip" });
  for (const branch of branches) {
    strip.append(createElement("span", {
      class: `branch-chip ${branch.isSurviving ? "surviving" : "rewound"}`,
      text: `${branch.isSurviving ? "surviving" : "rewound"} · tip ${String(branch.tip).slice(0, 8)}`,
    }));
  }
  return strip;
}

// One ✎ edit-marker link for a single revised path, appended to the conversation column.
export function appendEditMarkerLink(conversation: HTMLElement, project: string, path: string): void {
  conversation.append(createElement("a", {
    class: "edit-marker",
    href: getFileHistoryRoute(project, path),
    text: `✎ ${path.slice(path.lastIndexOf("/") + 1)}`,
  }));
}

// The chat bubble node for a genuine conversation message.
export function buildMessageBubbleNode(message: WireConversationMessage, entryLine: number, inspectLine: (line: number) => void): HTMLElement {
  return createElement("div", {
    class: `bubble ${message.role}`,
    onclick: () => inspectLine(entryLine),
  }, [
    createElement("div", { class: "bubble-meta", text: `${message.role} · ${message.timestamp === undefined ? "" : new Date(message.timestamp).toLocaleString()}` }),
    createElement("div", { text: message.text }),
  ]);
}

// The collapsed one-line stub node for a non-message record.
export function buildStubRowNode(entry: ConversationStubEntry, inspectLine: (line: number) => void): HTMLElement {
  return createElement("div", {
    class: "stub-row",
    text: `line ${entry.line} · ${entry.type} · ${entry.verdict}`,
    onclick: () => inspectLine(entry.line),
  });
}
