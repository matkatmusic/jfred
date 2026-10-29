// Projects tree (#/): every project, most recently active first, narrowable by a live name filter.

import { createElement as createElementUntyped } from "../app-dom.ts";
import { fetchJson } from "../app-fetch.ts";
import { getProjectRoute } from "../app-routes.ts";

// Wire shapes for /api/projects (dates arrive as plain ISO strings).
type WireJsonlFile = { modifiedAt: string };
type WireProject = { name: string; jsonlFiles: WireJsonlFile[] };

// app.ts is being typed in parallel; give its helper a local signature at this usage site.
type ElAttributes = Record<string, string | (() => void)>;
const createElement = createElementUntyped as (tag: string, attrs?: ElAttributes, children?: HTMLElement[]) => HTMLElement;

// Rows whose project name contains the filter text, case-insensitive; an empty filter keeps every row.
export function filterProjectsByName<ProjectType extends { name: string }>(projects: ProjectType[], filterText: string): ProjectType[] {
  const loweredFilterText = filterText.toLowerCase();
  const matchingProjects: ProjectType[] = [];
  for (const project of projects) {
    const isNameMatch = project.name.toLowerCase().includes(loweredFilterText);
    if (isNameMatch) {
      matchingProjects.push(project);
    }
  }
  return matchingProjects;
}

function appendProjectRow(listPane: HTMLElement, project: WireProject): void {
  const latest = project.jsonlFiles[0];
  listPane.append(createElement("div", {
    class: "project-row",
    onclick: () => {
      location.hash = getProjectRoute(project.name);
    },
  }, [
    createElement("a", { href: getProjectRoute(project.name), text: project.name }),
    createElement("span", { class: "project-count", text: `${project.jsonlFiles.length} jsonl` }),
    createElement("span", { class: "muted", text: latest === undefined ? "" : new Date(latest.modifiedAt).toLocaleString() }),
  ]));
}

export async function renderProjectsView(container: HTMLElement): Promise<void> {
  const projects: WireProject[] = await fetchJson("/api/projects");
  const filterInput = createElement("input", { type: "text", placeholder: "filter projects…", spellcheck: "false" }) as HTMLInputElement;
  const countLabel = createElement("span", { class: "muted" });
  const listPane = createElement("div");
  const renderList = () => {
    const visibleProjects = filterProjectsByName(projects, filterInput.value);
    countLabel.textContent = `${visibleProjects.length} / ${projects.length} project(s)`;
    listPane.replaceChildren();
    for (const project of visibleProjects) {
      appendProjectRow(listPane, project);
    }
  };
  filterInput.addEventListener("input", renderList);
  container.append(createElement("div", { class: "filter-bar" }, [
    createElement("span", { class: "pane-title", text: "Projects" }),
    filterInput,
    countLabel,
  ]));
  container.append(listPane);
  renderList();
}

