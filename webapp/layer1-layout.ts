// Builds the Layer 1 box tree once, by moving the flat HTML parts into FlexBox containers.

import { getRequiredElementById } from "./app-dom.ts";
import { FlexBox, type FlexLayoutMode } from "./flex-box.ts";

function getRequiredElementBySelector(selector: string): HTMLElement {
    const element = document.querySelector<HTMLElement>(selector);
    if (element === null) {
        throw new Error(`page markup is missing ${selector}`);
    }
    return element;
}

function createNamedBox(layoutMode: FlexLayoutMode, names: { id: string; class: string; "data-component": string }): FlexBox {
    const box = new FlexBox(layoutMode);
    box.element.id = names.id;
    box.element.className = names.class;
    box.element.setAttribute("data-component", names["data-component"]);
    return box;
}

export function buildLayer1Layout(): void {
    const isBuilt = document.getElementById("headerContainer") !== null;
    if (isBuilt) {
        return;
    }
    const appWindowBox = new FlexBox(FlexBox.layoutModes.rows, getRequiredElementById("appWindow"));

    // Header side (step 18).
    const headerContainerBox = createNamedBox(FlexBox.layoutModes.rows, { id: "headerContainer", class: "headerContainer", "data-component": "headerContainer" });
    const headerRowComponentBox = createNamedBox(FlexBox.layoutModes.columns, { id: "headerRowComponent", class: "headerRowComponent", "data-component": "headerRowComponent" });
    headerRowComponentBox.add(getRequiredElementBySelector("h1"));
    headerRowComponentBox.add(getRequiredElementById("crumb"));
    headerRowComponentBox.add(getRequiredElementBySelector(".timebar"));
    headerRowComponentBox.add(getRequiredElementById("project-settings"));
    headerRowComponentBox.add(getRequiredElementById("commit-mode"));
    headerRowComponentBox.add(getRequiredElementById("clear-results"));
    headerRowComponentBox.add(getRequiredElementBySelector("[data-component-inspector-toggle]"));
    headerRowComponentBox.add(getRequiredElementById("clear-results-confirm"));
    headerRowComponentBox.add(getRequiredElementBySelector(".zoombar"));
    headerRowComponentBox.add(getRequiredElementBySelector(".layerbar"));
    headerContainerBox.add(headerRowComponentBox);
    headerContainerBox.add(getRequiredElementBySelector(".sources:not(.repo)"));
    headerContainerBox.add(getRequiredElementBySelector(".sources.repo"));
    headerContainerBox.add(getRequiredElementById("jumpToRowComponent"));
    headerContainerBox.add(getRequiredElementById("engine-v3-bar"));
    appWindowBox.add(headerContainerBox);

    // Session data side (step 19).
    const sessionDataContainerBox = createNamedBox(FlexBox.layoutModes.columns, { id: "sessionDataContainer", class: "sessionDataContainer", "data-component": "sessionDataContainer" });
    const sourcesContainerBox = createNamedBox(FlexBox.layoutModes.rows, { id: "sourcesContainer", class: "sourcesContainer", "data-component": "sourcesContainer" });
    const timelineComponentsContainerBox = createNamedBox(FlexBox.layoutModes.rows, { id: "timelineComponentsContainer", class: "timelineComponentsContainer", "data-component": "timelineComponentsContainer" });
    sourcesContainerBox.add(getRequiredElementById("fileNavComponent"), { grow: 3, minSize: 80 });
    sourcesContainerBox.add(getRequiredElementById("navpane-grip"));
    sourcesContainerBox.add(getRequiredElementById("jsonlsComponent"), { grow: 2, minSize: 80 });
    sessionDataContainerBox.add(sourcesContainerBox);
    sessionDataContainerBox.add(getRequiredElementById("filenav-grip"));
    sessionDataContainerBox.add(timelineComponentsContainerBox, { grow: 1 });
    sessionDataContainerBox.add(getRequiredElementBySelector(".minimapComponent"));
    sessionDataContainerBox.add(getRequiredElementById("detailsPaneContainer"));
    appWindowBox.add(sessionDataContainerBox, { grow: 1 });

    // Timeline side (step 20).
    const timelineContainerBox = createNamedBox(FlexBox.layoutModes.rows, { id: "timelineContainer", class: "timelineContainer", "data-component": "timelineContainer" });
    const canvasBox = new FlexBox(FlexBox.layoutModes.columns);
    canvasBox.element.classList.add("canvas");
    const timelineRulerContainerBox = createNamedBox(FlexBox.layoutModes.columns, { id: "timelineRulerContainer", class: "timelineRulerContainer", "data-component": "timelineRulerContainer" });
    const fileBubbleContainerBox = createNamedBox(FlexBox.layoutModes.columns, { id: "fileBubbleContainer", class: "fileBubbleContainer", "data-component": "fileBubbleContainer" });
    timelineRulerContainerBox.add(getRequiredElementById("timelineRulerComponent"));
    canvasBox.add(getRequiredElementById("leaders"));
    canvasBox.add(getRequiredElementById("washes"));
    canvasBox.add(getRequiredElementById("ranges"));
    canvasBox.add(timelineRulerContainerBox);
    canvasBox.add(fileBubbleContainerBox);
    timelineContainerBox.add(canvasBox);
    timelineComponentsContainerBox.add(getRequiredElementById("loadbar"));
    timelineComponentsContainerBox.add(getRequiredElementById("timelineViewControls"));
    timelineComponentsContainerBox.add(timelineContainerBox, { grow: 1 });

    // Boxes were appended after the parts that stay put (popups, toast, inspector rows); put them first.
    appWindowBox.element.prepend(headerContainerBox.element, sessionDataContainerBox.element);
}
