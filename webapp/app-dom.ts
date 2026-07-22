// ─── tiny DOM builder (textContent everywhere — no innerHTML, no injection) ──

type ElAttrs = Record<string, string | EventListener>;

// The input element with `id` (task 159: shared by app-paths-project.ts and app-paths-wizard.ts).
export function getInputById(id: string): HTMLInputElement {
    return document.getElementById(id) as HTMLInputElement;
}

export function el(tag: string, attrs: ElAttrs = {}, children: (Node | string)[] = []): HTMLElement {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) {
        if (key === "class") node.className = value as string;
        else if (key === "text") node.textContent = value as string;
        else if (key.startsWith("on")) node.addEventListener(key.slice(2), value as EventListener);
        else node.setAttribute(key, value as string);
    }
    for (const child of children) node.append(child);
    return node;
}
