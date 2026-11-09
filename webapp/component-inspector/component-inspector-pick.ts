// Pure logic of the component inspector: which tagged part is hovered, and what Copy writes.

export interface ComponentSource {
  file: string;
  line: number;
}

const TAGGED_SELECTOR = "[data-component]";

function findNearestTaggedAncestor(element: Element): Element | null {
  return element.parentElement?.closest(TAGGED_SELECTOR) ?? null;
}

export function readComponentName(element: Element): string {
  return element.getAttribute("data-component")!;
}

// The tagged part under `target` whose nearest tagged ancestor is `stackTop` (null = page root).
export function findHoverCandidate(target: Element | null, stackTop: Element | null): Element | null {
  let candidate: Element | null = target?.closest(TAGGED_SELECTOR) ?? null;
  while (candidate !== null) {
    const parentPart = findNearestTaggedAncestor(candidate);
    if (parentPart === stackTop) {
      return candidate;
    }
    candidate = parentPart;
  }
  return null;
}

// Names of all tagged ancestors-or-self, outermost first, joined by ".".
export function buildHierarchyText(part: Element): string {
  const names: string[] = [];
  let current: Element | null = part;
  while (current !== null) {
    names.unshift(readComponentName(current));
    current = findNearestTaggedAncestor(current);
  }
  return names.join(".");
}

export function buildCopyText(name: string, source: ComponentSource, hierarchyText: string): string {
  return `{ ${name}, ${source.file}, ${source.line}, ${hierarchyText} }`;
}
