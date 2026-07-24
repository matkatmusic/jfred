// Per-row cell builders for the revision timeline (task 121 split from timeline-render-rows.ts,
// 250-line cap): the fork gutter cell, the role classes, and the small append-one-cell helpers
// buildTimelineRows composes into each .tl-row.
import { el } from "../app-dom.js";
import { GIT_BASELINE_ROLE_PILL_LABEL, computeRolePillClass, computeSessionStartLabel, } from "./timeline-labels.js";
import { LINE_NODE_KIND } from "./timeline-line-nodes.js";
import { renderFileButtonRow } from "./timeline-render-chips.js";
import { AGENT_TURN_NODE_KIND, COMMIT_NODE_KIND, SESSION_END_NODE_KIND, TOOL_CALL_NODE_KIND, USER_TURN_NODE_KIND, } from "./timeline-types.js";
// The mockup's role-* text/bubble class per node kind (agent turns are the assistant role).
export function computeRoleClass(kind) {
    if (kind === USER_TURN_NODE_KIND) {
        return "role-user";
    }
    if (kind === AGENT_TURN_NODE_KIND) {
        return "role-assistant";
    }
    if (kind === TOOL_CALL_NODE_KIND) {
        return "role-tool";
    }
    if (kind === COMMIT_NODE_KIND) {
        return "role-commit";
    }
    // task 160: a raw-line row's text is its classification ("type · verdict") — its own
    // color, not the session-end styling.
    if (kind === LINE_NODE_KIND) {
        return "role-line";
    }
    return "role-end";
}
// Commit and session-end dots render hollow (border ring) — both read as terminators (the old
// SVG rail's convention, now the .g-hollow class).
function checkDotIsHollow(kind) {
    if (kind === COMMIT_NODE_KIND) {
        return true;
    }
    return kind === SESSION_END_NODE_KIND;
}
// The fork gutter cell (mockup buildGraphCell): the lane-1 rail tinted with the row's session
// color; rows inside a computeGraphLaneRuns run add the lane-2 rail (fork curve on the run's
// first row, cut-off on its last) and put their dot on lane 2 (CSS colors it).
export function buildGraphCell(kind, index, laneRuns, sessionColor) {
    const cell = el("div", { class: "tl-graph" });
    cell.append(el("span", { class: "g-rail g-l1", style: `background:${sessionColor}` }));
    const run = laneRuns.find((candidate) => index >= candidate.startIndex && index <= candidate.endIndex);
    if (run !== undefined) {
        const lane2 = el("span", { class: "g-rail g-l2" });
        if (index === run.startIndex) {
            lane2.classList.add("g-start");
            cell.append(el("span", { class: "g-fork" }));
        }
        if (index === run.endIndex) {
            lane2.classList.add("g-end");
        }
        cell.append(lane2);
    }
    const dot = el("span", { class: `g-dot ${run === undefined ? "g-l1" : "g-l2"}` });
    if (checkDotIsHollow(kind)) {
        dot.classList.add("g-hollow");
        dot.style.color = sessionColor; // .g-hollow's ring is currentColor
    }
    else if (run === undefined) {
        dot.style.background = sessionColor; // lane-2 dots keep the CSS lane color
    }
    cell.append(dot);
    return cell;
}
// The tinted session-start marker row (extracted from buildTimelineRows).
export function appendSessionStartMarker(context, rowFragment, sessionColor, startedSessionId) {
    const marker = el("div", { class: "tl-session-start" });
    marker.style.color = sessionColor;
    marker.append(el("span", {
        class: "tl-session-start-label",
        text: computeSessionStartLabel(context.reconstructionDocument.sessionTitles, startedSessionId),
    }));
    rowFragment.append(marker);
}
// The commit row's cells (extracted from buildTimelineRows). A plain commit: spacer, "git
// commit" label, hash pill. The merged git-derived baseline row (task 121): expansion triangle
// (its bubble carries the baseline file chips), green baseline pill instead of the label, hash
// pill kept.
export function appendCommitCells(context, line, row, node) {
    if (node.isGitBaseline === true) {
        appendExpansionTriangle(context, line, row);
        line.append(el("span", { class: `role-pill ${computeRolePillClass(GIT_BASELINE_ROLE_PILL_LABEL)}`, text: GIT_BASELINE_ROLE_PILL_LABEL }));
    }
    else {
        line.append(el("span", { class: "tl-tri", text: "" })); // spacer keeps columns aligned
        line.append(el("span", { class: "commit-label", text: "git commit" }));
    }
    if (node.resultHash !== undefined) { // no hash → no pill (a blank "—" reads broken)
        line.append(el("span", { class: "commit-pill", text: node.resultHash }));
    }
}
// The ▸ triangle that toggles a row's expanded state (extracted from buildTimelineRows).
export function appendExpansionTriangle(context, line, row) {
    const tri = el("span", { class: "tl-tri", text: "▸" });
    tri.addEventListener("click", (event) => {
        event.stopPropagation(); // expansion must not change selection
        row.classList.toggle("expanded");
        context.updateToggleLabel();
    });
    line.append(tri);
}
// The { } button that opens the row's JSONL record in the details pane (extracted from buildTimelineRows).
export function appendJsonRecordButton(context, line, index) {
    line.append(el("button", {
        class: "tl-json",
        text: "{ }",
        title: "Show this row's JSONL record in the details pane",
        onclick: async (event) => {
            event.stopPropagation();
            await context.selectTimelineRow(index);
            context.openNodeInspector(index);
        },
    }));
}
// A bubble carries file chips when its node owns them: every agent turn, plus the merged
// git-derived baseline commit row (task 121). Typed as a predicate so the chip renderer
// receives the narrowed chip-owning union.
function checkBubbleShowsFileChips(node) {
    if (node.kind === AGENT_TURN_NODE_KIND) {
        return true;
    }
    return node.isGitBaseline === true;
}
// The expanded row's bubble: full text plus agent-turn file chips (extracted from buildTimelineRows).
export function appendExpandedBubble(context, node, index, previewPane, main, row) {
    const bubble = el("div", { class: `tl-bubble ${computeRoleClass(node.kind)}` });
    bubble.append(node.kind === TOOL_CALL_NODE_KIND ? `${node.toolName}(${node.summary})` : node.text ?? "");
    if (checkBubbleShowsFileChips(node)) {
        bubble.append(el("div", { class: "timeline-chips" }, node.fileChanges.map((change) => renderFileButtonRow(context, node, index, change, previewPane))));
    }
    main.append(bubble);
    context.expandableRows.push(row);
}
