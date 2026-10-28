// ─── header: toolbar popovers (item 66) ────── Split from app-header.ts.

import { createElement } from "./app-dom.ts";
import { fetchJson } from "./app-fetch.ts";
import { routeToProject } from "./app-routes.ts";

// The /api/projects payload rows, as far as the Projects menu reads them.
type WireProjectListing = { name: string };

// Both toolbar popovers close together: opening one, picking a project, or any document click.
function hideToolbarPopovers(): void {
  document.getElementById("projects-menu")!.hidden = true;
  document.getElementById("paths-popover")!.hidden = true;
}

// Fill the Projects dropdown with one navigating row per project in the active folder.
async function fillProjectsMenu(menu: HTMLElement): Promise<void> {
  const projects = await fetchJson<WireProjectListing[]>("/api/projects");
  const menuItems: HTMLElement[] = [];
  for (const project of projects) {
    const openProject = (): void => {
      hideToolbarPopovers();
      location.hash = routeToProject(project.name);
    };
    menuItems.push(createElement("div", { class: "menu-item", text: project.name, onclick: openProject }));
  }
  menu.replaceChildren(...menuItems);
}

function toggleProjectsMenu(event: Event): void {
  event.stopPropagation();
  const projectsMenu = document.getElementById("projects-menu")!;
  const wasHidden = projectsMenu.hidden;
  hideToolbarPopovers();
  projectsMenu.hidden = !wasHidden;
  if (!projectsMenu.hidden) {
    void fillProjectsMenu(projectsMenu);
  }
}

function togglePathsPopover(event: Event): void {
  event.stopPropagation();
  const pathsPopover = document.getElementById("paths-popover")!;
  const wasHidden = pathsPopover.hidden;
  hideToolbarPopovers();
  pathsPopover.hidden = !wasHidden;
}

// In-popover clicks stay open, except the apply button, whose click closes the popover.
function stopPathsPopoverClick(event: Event): void {
  if ((event.target as HTMLElement).id !== "projects-dir-change") {
    event.stopPropagation();
  }
}

// item 66: toolbar buttons toggle their popovers; a document click closes both.
export function initToolbarPopovers(): void {
  document.getElementById("projects-btn")!.addEventListener("click", toggleProjectsMenu);
  document.getElementById("paths-btn")!.addEventListener("click", togglePathsPopover);
  document.getElementById("paths-popover")!.addEventListener("click", stopPathsPopoverClick);
  document.addEventListener("click", hideToolbarPopovers);
}
