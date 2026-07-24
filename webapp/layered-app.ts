// Layered page skeleton behavior (task 205, spec S7): collapsing drawer, drawer lists with
// per-file placeholder widgets, file-nav click scrolling to its widget, and the Changes pane
// hidden until a segment is selected. DOM-only — task 206 wires the data endpoint.

// The element with `id`, thrown on absence so a markup drift fails loudly.
function getRequiredElementById(id: string): HTMLElement {
    const element = document.getElementById(id);
    if (element === null) {
        throw new Error(`layered page markup is missing #${id}`);
    }
    return element;
}

// Collapse or restore the left drawer.
export function toggleLayeredDrawer(): void {
    getRequiredElementById("layered-drawer").classList.toggle("collapsed");
}

// Show the Changes pane only while a segment is selected (S7: hidden until then).
export function revealChangesPane(hasSelection: boolean): void {
    getRequiredElementById("layered-changes").hidden = !hasSelection;
}

// One drawer list entry.
function buildDrawerItem(label: string, onClick: (() => void) | undefined): HTMLElement {
    const item = document.createElement("div");
    item.className = "layered-drawer-item";
    item.textContent = label;
    if (onClick !== undefined) {
        item.addEventListener("click", onClick);
    }
    return item;
}

// One placeholder canvas widget for a file (replaced by the real per-file widget in task 207).
function buildFileWidget(fileName: string, widgetIndex: number): HTMLElement {
    const widget = document.createElement("section");
    widget.className = "layered-file-widget";
    widget.id = `layered-file-widget-${widgetIndex}`;
    widget.textContent = fileName;
    return widget;
}

// Rebuild the session list, the file nav, and the canvas's placeholder widgets. A file-nav
// item's click scrolls its widget into view (S7: clicking a file scrolls to its widget).
export function renderLayeredDrawer(sessionNames: string[], fileNames: string[]): void {
    const sessionList = getRequiredElementById("layered-session-list");
    sessionList.replaceChildren(...sessionNames.map((name) => buildDrawerItem(name, undefined)));
    const canvas = getRequiredElementById("layered-canvas");
    const widgets = fileNames.map((name, widgetIndex) => buildFileWidget(name, widgetIndex));
    canvas.replaceChildren(...widgets);
    const fileNav = getRequiredElementById("layered-file-nav");
    const navItems = fileNames.map((name, widgetIndex) =>
        buildDrawerItem(name, () => widgets[widgetIndex]?.scrollIntoView({ behavior: "smooth", block: "center" })));
    fileNav.replaceChildren(...navItems);
}

// Wire the header toggle button and render the empty drawer.
export function bootLayeredApp(): void {
    getRequiredElementById("layered-drawer-toggle").addEventListener("click", toggleLayeredDrawer);
    renderLayeredDrawer([], []);
}

bootLayeredApp();
