import { test } from "node:test";
import assert from "node:assert/strict";
import { getRequiredElementById } from "../webapp/app-dom.ts";
import { DiffPaneMode, createDiffPane, type DiffStep } from "../webapp/layer1-diff-pane.ts";
import type { DiffPaneMounts } from "../webapp/layer1-diff-pane-support.ts";
import { initLayer1Dom } from "./webapp-dom-test-helpers.ts";
import { installRecordingFetch, waitForPendingFetches } from "./layer1-drawer-test-helpers.ts";

function buildStep(marker: string, content: string): DiffStep {
    return { marker, buildParams: () => new URLSearchParams(), loadContent: async () => content };
}

function buildMounts(): DiffPaneMounts {
    const arrows = [0, 1, 2, 3].map(() => document.createElement("button")) as DiffPaneMounts["arrows"];
    return {
        pairLabel: document.createElement("span"),
        meta: document.createElement("span"),
        body: document.createElement("div"),
        modeButtons: [],
        fullToggle: document.createElement("input"),
        exportButton: document.createElement("button"),
        arrows,
    };
}

test("showPair labels the pair, disables edge arrows, and renders the diff", async () => {
    initLayer1Dom();
    installRecordingFetch(() => ({}));
    const mounts = buildMounts();
    const pane = createDiffPane(mounts, { mode: DiffPaneMode.side, fullContents: false });
    const steps = [buildStep("one", "a\n"), buildStep("two", "b\n"), buildStep("three", "c\n")];

    await pane.showPair("src/demo.ts", steps, 0, 1);
    await waitForPendingFetches();

    assert.equal(mounts.pairLabel.textContent, "one - two");
    assert.equal(mounts.meta.textContent, "base one → target two");
    assert.deepEqual(mounts.arrows.map((arrow) => arrow.disabled), [true, false, false, false]);
    assert.ok(mounts.body.children.length > 0);
});

test("clicking an arrow steps that side and reloads the pair", async () => {
    initLayer1Dom();
    installRecordingFetch(() => ({}));
    const mounts = buildMounts();
    const pane = createDiffPane(mounts, { mode: DiffPaneMode.side, fullContents: false });
    const steps = [buildStep("one", "a\n"), buildStep("two", "b\n"), buildStep("three", "c\n")];
    await pane.showPair("src/demo.ts", steps, 0, 1);
    await waitForPendingFetches();

    mounts.arrows[3].click();
    await waitForPendingFetches();

    assert.equal(mounts.pairLabel.textContent, "one - three");
});

test("export with nothing shown flashes the refusal toast", () => {
    initLayer1Dom();
    const mounts = buildMounts();
    createDiffPane(mounts, { mode: DiffPaneMode.side, fullContents: false });

    mounts.exportButton.click();

    const toast = getRequiredElementById("dtoast");
    assert.equal(toast.textContent, "no differences to export");
    assert.equal(toast.hidden, false);
});
