// ─── tiny DOM builder (textContent everywhere — no innerHTML, no injection) ──
// The input element with `id` (task 159: shared by app-paths-project.ts and app-paths-wizard.ts).
export function getInputById(id) {
    return document.getElementById(id);
}
export function el(tag, attrs = {}, children = []) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) {
        if (key === "class")
            node.className = value;
        else if (key === "text")
            node.textContent = value;
        else if (key.startsWith("on"))
            node.addEventListener(key.slice(2), value);
        else
            node.setAttribute(key, value);
    }
    for (const child of children)
        node.append(child);
    return node;
}
