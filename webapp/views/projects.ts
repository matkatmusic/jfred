// Projects tree (#/): every project in the active folder, most recently active first
// (the server's scan order), narrowable by a live name filter.

import { el as elUntyped } from "../app-dom.ts";
import { fetchJson } from "../app-fetch.ts";
import { routeToProject } from "../app-routes.ts";

// Wire shapes for /api/projects (dates arrive as plain ISO strings).
type WireJsonlFile = { modifiedAt: string };
type WireProject = { name: string; jsonlFiles: WireJsonlFile[] };

// app.ts is being typed in parallel; give its helper a local signature at this usage site.
type ElAttributes = Record<string, string | (() => void)>;
const el = elUntyped as (tag: string, attrs?: ElAttributes, children?: HTMLElement[]) => HTMLElement;

// Pure view model for the projects view (no DOM): the listing rows whose project name
// contains the filter text, case-insensitive. An empty filter keeps every row
// (includes("") is always true — no branch needed).
export function filterProjectsByName<ProjectType extends { name: string }>(projects: ProjectType[], filterText: string): ProjectType[] {
    const loweredFilterText = filterText.toLowerCase();
    return projects.filter((project) => project.name.toLowerCase().includes(loweredFilterText));
}

export async function renderProjectsView(container: HTMLElement): Promise<void> {
    const projects: WireProject[] = await fetchJson("/api/projects");
    const filterInput = el("input", { type: "text", placeholder: "filter projects…", spellcheck: "false" }) as HTMLInputElement;
    const countLabel = el("span", { class: "muted" });
    const listPane = el("div");
    const renderList = () => {
        const visibleProjects = filterProjectsByName(projects, filterInput.value);
        countLabel.textContent = `${visibleProjects.length} / ${projects.length} project(s)`;
        listPane.replaceChildren();
        for (const project of visibleProjects) {
            const latest = project.jsonlFiles[0];
            listPane.append(el("div", {
                class: "project-row",
                onclick: () => { location.hash = routeToProject(project.name); },
            }, [
                el("a", { href: routeToProject(project.name), text: project.name }),
                el("span", { class: "project-count", text: `${project.jsonlFiles.length} jsonl` }),
                el("span", { class: "muted", text: latest === undefined ? "" : new Date(latest.modifiedAt).toLocaleString() }),
            ]));
        }
    };
    filterInput.addEventListener("input", renderList);
    container.append(el("div", { class: "filter-bar" }, [
        el("span", { class: "pane-title", text: "Projects" }),
        filterInput,
        countLabel,
    ]));
    container.append(listPane);
    renderList();
}

