// task 194: the reconstruction-mode selection view — a project's own pre-build view, shown after the paths are set and BEFORE any reconstruction work begins (no console overlay, no empty timeline, no empty file-nav). Two modes: full (today's behavior — every file, slow on large projects) and bounded to one file's nth revision (task-193 semantics: the cut is the end of the containing agent turn). The file list is the cheap parse-only /api/prescan: each touched file with its FIRST modifying event; a script-attributed instant is a static basename-mention candidate, marked as such — never replay-proven.

import { el } from "./app-dom.ts";
import { fetchJson } from "./app-fetch.ts";
import { storeModeChoice } from "./app-choices.ts";
import { renderRoute } from "./app-router.ts";

// Wire shape of one /api/prescan row (server: viewer_api_prescan.ts PrescanFileEntry).
export type WirePrescanFile = {
    path: string;
    firstEventInstant: string;
    firstEventIsScriptRunCandidate: boolean;
};

// The human-readable form of a prescan row's ISO instant plus its attribution mark.
export function formatPrescanRowNote(file: WirePrescanFile): string {
    const stamp = file.firstEventInstant.replace("T", " ").replace("Z", " UTC");
    const candidateMark = file.firstEventIsScriptRunCandidate ? " · script-run candidate" : "";
    return `first event ${stamp}${candidateMark}`;
}

function buildFileRow(file: WirePrescanFile, selectAsBoundFile: (path: string, row: HTMLElement) => void): HTMLElement {
    const row = el("div", {
        class: "mode-file-row",
        style: "cursor:pointer; padding:2px 8px; display:flex; gap:12px; justify-content:space-between;",
        onclick: () => selectAsBoundFile(file.path, row),
    }, [
        el("code", { text: file.path }),
        el("span", { class: "muted", text: formatPrescanRowNote(file) }),
    ]);
    return row;
}

export async function renderModeSelectionView(container: HTMLElement, project: string): Promise<void> {
    container.replaceChildren(el("div", { class: "muted", text: "scanning touched files…" }));
    const { files } = await fetchJson<{ files: WirePrescanFile[] }>(`/api/prescan?project=${encodeURIComponent(project)}`);
    let boundFilePath: string | undefined;
    let selectedRow: HTMLElement | undefined;
    const fullRadio = el("input", { type: "radio", name: "recon-mode", checked: "" }) as HTMLInputElement;
    const boundedRadio = el("input", { type: "radio", name: "recon-mode" }) as HTMLInputElement;
    const nthInput = el("input", { type: "number", min: "1", value: "1", style: "width:64px" }) as HTMLInputElement;
    const selectAsBoundFile = (path: string, row: HTMLElement): void => {
        boundFilePath = path;
        boundedRadio.checked = true;
        selectedRow?.style.removeProperty("outline");
        row.style.outline = "2px solid currentColor";
        selectedRow = row;
    };
    // Mirrors the consent/baseline dialogs' decide: store the answer, re-render the route — the re-issued /api/document request carries the choice as boundFile/boundNth.
    const startReconstruction = (): void => {
        if (fullRadio.checked) {
            storeModeChoice(project, { mode: "full" });
        } else if (boundFilePath === undefined) {
            return;
        } else {
            storeModeChoice(project, { mode: "bounded", file: boundFilePath, nth: Math.max(1, Number(nthInput.value) || 1) });
        }
        renderRoute();
    };
    const box = el("div", { class: "consent-box" }, [
        el("div", { class: "consent-header" }, [
            el("h2", { text: "How should this project be reconstructed?" }),
            el("label", { style: "display:block" }, [fullRadio, " Full reconstruction — every file, every revision (can take a long time)"]),
            el("label", { style: "display:block" }, [boundedRadio, " Bounded — reconstruct all touched files only until the chosen file's revision ", nthInput, " end of agent turn"]),
            el("div", { class: "muted", text: "pick the bound file below — each row shows the file's first modifying event; script-run instants are static candidates, not replay-proven" }),
            el("button", { class: "toolbar-btn consent-run", text: "Start reconstruction", onclick: startReconstruction }),
        ]),
        el("div", { class: "mode-file-list" }, files.map((file) => buildFileRow(file, selectAsBoundFile))),
    ]);
    container.replaceChildren(box);
}
