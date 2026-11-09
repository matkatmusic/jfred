// Pure logic of the component inspector: which tagged part is hovered, and what Copy writes.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";
import { buildCopyText, buildHierarchyText, findHoverCandidate } from "../webapp/component-inspector/component-inspector-pick.ts";

const TAGGED_TREE = `
    <div id="page" data-component="Page">
        <div id="nav" data-component="Nav">
            <div id="pane" data-component="Pane"><span id="deep"></span></div>
        </div>
        <div id="other" data-component="Other"></div>
    </div>
    <p id="untagged"></p>`;

function buildTaggedDocument(): Document {
    const browserWindow = new Window();
    browserWindow.document.body.innerHTML = TAGGED_TREE;
    return browserWindow.document as unknown as Document;
}

test("test_finding_the_hover_candidate_at_root_returns_the_outermost_tagged_part", () => {
    // Scenario: with nothing entered, hovering deep inside the page picks the outermost tagged part.
    const page = buildTaggedDocument();
    // the target is the deepest span, and the stack top is the page root (null).
    const candidate = findHoverCandidate(page.getElementById("deep"), null);
    // the candidate is "Page", not "Pane".
    assert.equal(candidate?.id, "page");
});

test("test_a_grandchild_target_resolves_to_the_direct_child_part_of_the_stack_top", () => {
    // Scenario: with Page entered, hovering a grandchild picks Page's direct tagged child.
    const page = buildTaggedDocument();
    // the target is the deepest span, and the stack top is Page.
    const candidate = findHoverCandidate(page.getElementById("deep"), page.getElementById("page"));
    // the candidate is "Nav", the direct tagged child of Page.
    assert.equal(candidate?.id, "nav");
});

test("test_a_target_outside_the_stack_top_returns_no_candidate", () => {
    // Scenario: with Nav entered, hovering Page's other child is outside Nav.
    const page = buildTaggedDocument();
    // the target is "Other", and the stack top is Nav.
    const candidate = findHoverCandidate(page.getElementById("other"), page.getElementById("nav"));
    // no candidate exists.
    assert.equal(candidate, null);
});

test("test_hierarchy_text_for_a_nested_part_is_outermost_first_dot_joined", () => {
    // Scenario: the hierarchy of Pane lists every tagged ancestor-or-self, outermost first.
    const page = buildTaggedDocument();
    // build the text for Pane.
    const hierarchyText = buildHierarchyText(page.getElementById("pane")!);
    // the names run Page, Nav, Pane.
    assert.equal(hierarchyText, "Page.Nav.Pane");
});

test("test_copy_text_has_the_exact_name_file_line_hierarchy_shape", () => {
    // Scenario: Copy writes `{ Name, file, line, Hierarchy }`.
    const copyText = buildCopyText("FileNavPane", { file: "/abs/file-nav.html", line: 3 }, "Layer1Page.FileNav.FileNavPane");
    // the shape is exact.
    assert.equal(copyText, "{ FileNavPane, /abs/file-nav.html, 3, Layer1Page.FileNav.FileNavPane }");
});
