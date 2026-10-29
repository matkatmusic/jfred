// The copy-link button: a URL that reopens this page and node by instant, session and line.

import { getRequiredElementById } from "./app-dom.ts";

export type NodeLinkIdentity = { instant: string; sessionFile: string; line: number | undefined };

const INSTANT_PARAM = "nodeInstant";
const SESSION_PARAM = "nodeSession";
const LINE_PARAM = "nodeLine";
const COPY_LABEL = "Copy link";
const COPIED_LABEL = "Copied";
const COPIED_LABEL_MS = 1500;

// The node the drawer shows now; undefined when the drawer shows no single node.
let openedNode: NodeLinkIdentity | undefined;

export function buildNodeLinkUrl(pageUrl: string, identity: NodeLinkIdentity): string {
  const url = new URL(pageUrl);
  url.searchParams.set(INSTANT_PARAM, identity.instant);
  url.searchParams.set(SESSION_PARAM, identity.sessionFile);
  url.searchParams.delete(LINE_PARAM);
  if (identity.line !== undefined) {
    url.searchParams.set(LINE_PARAM, String(identity.line));
  }
  return url.toString();
}

export function readNodeLinkIdentity(search: string): NodeLinkIdentity | undefined {
  const params = new URLSearchParams(search);
  const instant = params.get(INSTANT_PARAM);
  const sessionFile = params.get(SESSION_PARAM);
  const isInstantMissing = instant === null;
  const isSessionMissing = sessionFile === null;
  const isNodeMissing = isInstantMissing || isSessionMissing;
  if (isNodeMissing) {
    return undefined;
  }
  const lineText = params.get(LINE_PARAM);
  return { instant, sessionFile, line: lineText === null ? undefined : Number(lineText) };
}

// A node without a session file (a commit or on-disk node) has no transcript line to point at.
export function readNodeIdentity(node: HTMLElement): NodeLinkIdentity | undefined {
  const instant = node.dataset["instant"];
  const sessionFile = node.dataset["sessionFile"];
  const isInstantMissing = instant === undefined;
  const isSessionMissing = sessionFile === undefined;
  const isIdentityMissing = isInstantMissing || isSessionMissing;
  if (isIdentityMissing) {
    return undefined;
  }
  const lineText = node.dataset["line"];
  return { instant, sessionFile, line: lineText === undefined ? undefined : Number(lineText) };
}

export function findNodeByIdentity(root: ParentNode, identity: NodeLinkIdentity): HTMLElement | undefined {
  const wantedLine = identity.line === undefined ? undefined : String(identity.line);
  for (const node of root.querySelectorAll<HTMLElement>(".node[data-instant]")) {
    const isSameInstant = node.dataset["instant"] === identity.instant;
    const isSameSession = node.dataset["sessionFile"] === identity.sessionFile;
    const isSameLine = node.dataset["line"] === wantedLine;
    const isSameNode = isSameInstant && isSameSession && isSameLine;
    if (isSameNode) {
      return node;
    }
  }
  return undefined;
}

export function storeOpenedNode(identity: NodeLinkIdentity | undefined): void {
  openedNode = identity;
  getRequiredElementById("dcopylink").hidden = identity === undefined;
}

function resetCopyLabel(): void {
  getRequiredElementById("dcopylink").textContent = COPY_LABEL;
}

export async function copyOpenedNodeLink(): Promise<void> {
  if (openedNode === undefined) {
    return;
  }
  await navigator.clipboard.writeText(buildNodeLinkUrl(location.href, openedNode));
  getRequiredElementById("dcopylink").textContent = COPIED_LABEL;
  setTimeout(resetCopyLabel, COPIED_LABEL_MS);
}

// Clicking IS how a node opens, so the linked node opens by the same path as a user's click.
export async function openLinkedNode(identity: NodeLinkIdentity): Promise<void> {
  const node = findNodeByIdentity(document, identity);
  if (node === undefined) {
    throw new Error(`linked node ${identity.instant} line ${identity.line} of ${identity.sessionFile} is not on this page`);
  }
  node.click();
}

export function installCopyLinkButton(): void {
  getRequiredElementById("dcopylink").addEventListener("click", copyOpenedNodeLink);
}
