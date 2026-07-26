// ─── tiny DOM builder (textContent everywhere — no innerHTML, no injection) ──

// `undefined` is permitted so a caller can pass an OPTIONAL attribute inline (e.g. a hover `title`
// that only some nodes have) instead of branching on it; el() omits those keys entirely.
type ElAttrs = Record<string, string | EventListener | undefined>;

// The input element with `id` (task 159: shared by app-paths-project.ts and app-paths-wizard.ts).
export function getInputById(id: string): HTMLInputElement {
    return document.getElementById(id) as HTMLInputElement;
}

// The element with `id`, thrown on absence so a markup drift fails loudly (shared by the
// layered and debug pages — task 183 moved it here from layered-app.ts).
export function getRequiredElementById(id: string): HTMLElement {
    const element = document.getElementById(id);
    if (element === null) {
        throw new Error(`page markup is missing #${id}`);
    }
    return element;
}

export function el(tag: string, attrs: ElAttrs = {}, children: (Node | string)[] = []): HTMLElement {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) {
        // An absent optional attribute is omitted, not stringified: setAttribute would otherwise
        // write the literal text "undefined" (e.g. an optional `title` on a Layer 1 node label).
        if (value === undefined) continue;
        if (key === "class") node.className = value as string;
        else if (key === "text") node.textContent = value as string;
        else if (key.startsWith("on")) node.addEventListener(key.slice(2), value as EventListener);
        else node.setAttribute(key, value as string);
    }
    for (const child of children) node.append(child);
    return node;
}
