// Projects tree (#/): every project in the active folder, most recently active first
// (the server's scan order), narrowable by a live name filter.
import { el as elUntyped } from "../app-dom.js";
import { fetchJson } from "../app-fetch.js";
import { routeToProject } from "../app-routes.js";
const el = elUntyped;
// Pure view model for the projects view (no DOM): the listing rows whose project name
// contains the filter text, case-insensitive. An empty filter keeps every row
// (includes("") is always true — no branch needed).
export function filterProjectsByName(projects, filterText) {
    const loweredFilterText = filterText.toLowerCase();
    return projects.filter((project) => project.name.toLowerCase().includes(loweredFilterText));
}
function appendProjectRow(listPane, project) {
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
export async function renderProjectsView(container) {
    const projects = await fetchJson("/api/projects");
    const filterInput = el("input", { type: "text", placeholder: "filter projects…", spellcheck: "false" });
    const countLabel = el("span", { class: "muted" });
    const listPane = el("div");
    const renderList = () => {
        const visibleProjects = filterProjectsByName(projects, filterInput.value);
        countLabel.textContent = `${visibleProjects.length} / ${projects.length} project(s)`;
        listPane.replaceChildren();
        for (const project of visibleProjects) {
            appendProjectRow(listPane, project);
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
