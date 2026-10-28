// Project navigation: a persistent left drawer on every #/project/* route, and the project landing view.

import { createElement as createElementUntyped } from "../app-dom.ts";
import {
  fetchDocument,
  fetchJson,
  getCachedDocument,
} from "../app-fetch.ts";
import { renderConsentDialog } from "../app-consent.ts";
import { renderBaselineQuestionDialog } from "../app-baseline-question.ts";
import { getFileHistoryRoute, getProjectRoute, getTimelineRoute } from "../app-routes.ts";

// app.ts is being typed in parallel; typed view of its untyped `createElement` for this file's call sites.
const createElement = createElementUntyped as (
  tag: string,
  attrs?: Record<string, unknown>,
  children?: readonly (Node | string)[],
) => HTMLElement;

// Wire shapes (JSON off the server: ids/paths/dates are plain strings), minimal to this file's use.
type WireFileHistory = { target: string };
type WireDocument = { filesTouched: WireFileHistory[]; messages: unknown[] };
type WireJsonlFile = { fileName: string; sizeBytes: number; modifiedAt: string };
type WireProjectListing = { name: string; jsonlFiles: WireJsonlFile[] };

// Pure view model (no DOM): every reconstructed file target across the project's JSONLs, sorted.
export function buildProjectViewModel(document: WireDocument): { fileTargets: string[] } {
  const fileTargets: string[] = [];
  for (const history of document.filesTouched) {
    fileTargets.push(history.target);
  }
  return { fileTargets: fileTargets.sort() };
}

// Group targets by their directory for the tree pane.
// ponytail: dirname grouping, not a nested collapsing tree — upgrade if deep hierarchies get unreadable.
function collectTargetsByDirectory(fileTargets: readonly string[]): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  for (const target of fileTargets) {
    const slash = target.lastIndexOf("/");
    const directory = slash < 0 ? "" : target.slice(0, slash);
    const hasGroup = groups.has(directory);
    if (!hasGroup)
      groups.set(directory, []);
    groups.get(directory)!.push(target);
  }
  return groups;
}

// Append one touched-file link to the drawer's tree pane.
function appendTouchedFileLink(
  drawer: HTMLElement,
  project: string,
  target: string,
  activeTarget: string | undefined,
): void {
  drawer.append(createElement("a", {
    class: `drawer-item drawer-file${target === activeTarget ? " active" : ""}`,
    href: getFileHistoryRoute(project, target),
    text: target.slice(target.lastIndexOf("/") + 1),
  }));
}

// The left drawer: JSONL files always; touched files only once the document is cached.
export async function renderProjectDrawer(
  drawer: HTMLElement,
  project: string,
  { activeJsonl, activeTarget }: { activeJsonl?: string; activeTarget?: string },
): Promise<void> {
  drawer.replaceChildren();
  // Collapse state is the `collapsed` class on #drawer: it survives re-render and resets on reload.
  const toggleButton = createElement("button", {
    class: "row-btn drawer-toggle",
    text: drawer.classList.contains("collapsed") ? "»" : "«",
    title: "Collapse/expand files drawer",
    onclick: () => {
      const collapsed = drawer.classList.toggle("collapsed");
      toggleButton.textContent = collapsed ? "»" : "«";
    },
  });
  drawer.append(toggleButton);
  const listings = (await fetchJson("/api/projects")) as WireProjectListing[];
  let listing: WireProjectListing | undefined;
  for (const entry of listings) {
    if (entry.name === project) {
      listing = entry;
      break;
    }
  }
  if (listing === undefined)
    return;
  drawer.append(createElement("div", { class: "pane-title" }, [createElement("a", { href: getProjectRoute(project), text: project })]));

  drawer.append(createElement("div", { class: "drawer-section-title", text: `JSONL files (${listing.jsonlFiles.length})` }));
  // The default view: a JSONL opens the project timeline at its session; direct jsonl URLs still render the conversation.
  const jsonlList = createElement("div", { class: "drawer-jsonl-list" });
  for (const entry of listing.jsonlFiles) {
    jsonlList.append(createElement("a", {
      class: `drawer-item${entry.fileName === activeJsonl ? " active" : ""}`,
      href: getTimelineRoute(project, entry.fileName, undefined),
      text: entry.fileName,
      title: `${entry.sizeBytes} B · ${new Date(entry.modifiedAt).toLocaleString()}`,
    }));
  }
  drawer.append(jsonlList);

  const cachedDocument = getCachedDocument<WireDocument>(project);
  if (cachedDocument === undefined)
    return;
  const viewModel = buildProjectViewModel(cachedDocument);
  drawer.append(createElement("div", { class: "drawer-section-title", text: `Files touched (${viewModel.fileTargets.length})` }));
  for (const [directory, targets] of collectTargetsByDirectory(viewModel.fileTargets)) {
    drawer.append(createElement("div", { class: "tree-dir", text: directory === "" ? "/" : directory }));
    for (const target of targets) {
      appendTouchedFileLink(drawer, project, target, activeTarget);
    }
  }
}

// The project landing view (#/project/<name>): builds the unified document, hosting the consent dialog.
export async function renderProjectView(container: HTMLElement, project: string): Promise<void> {
  const result = await fetchDocument<WireDocument>(project, undefined);
  if (result.baselineQuestion !== undefined) {
    renderBaselineQuestionDialog(container, project, result.baselineQuestion);
    return;
  }
  if (result.consentRequired !== undefined) {
    renderConsentDialog(container, project, result.consentRequired);
    return;
  }
  const viewModel = buildProjectViewModel(result.document!);
  container.append(createElement("div", { class: "pane-title", text: project }));
  container.append(createElement("div", { class: "muted", text: `${result.document!.messages.length} conversation turns · ${viewModel.fileTargets.length} files touched · pick a JSONL or file on the left` }));
}

