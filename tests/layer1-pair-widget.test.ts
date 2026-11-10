// The pair bubble marks the commit nodes of the engineV3 marker's commit, and no other node.

import { test } from "node:test";
import assert from "node:assert/strict";
import { initLayer1Dom } from "./webapp-dom-test-helpers.ts";
import { storeEngineV3Steps } from "../webapp/layer1-components/engine-v3/layer1-engine-v3-state.ts";
import { EngineV3StepKind } from "../webapp/layer1-components/engine-v3/layer1-wire-engine-v3.ts";
import type { WirePair } from "../webapp/layer1-wire.ts";

initLayer1Dom();
const { buildPairWidget } = await import("../webapp/layer1-pair-widget.ts");

const PAIR: WirePair = {
    path: "src/run.ts",
    commits: [
        { hash: "aaaa1111", instant: "2026-06-01T09:00:00.000Z", axisPx: 10 },
        { hash: "bbbb2222", instant: "2026-06-01T10:00:00.000Z", axisPx: 20 },
    ],
    onDisk: { instant: "2026-06-02T09:00:00.000Z", axisPx: 30 },
};

function storeCommitStep(hash: string): void {
    storeEngineV3Steps([{ nodeId: hash, nodeTime: "2026-06-01T09:00:00.000Z", kind: EngineV3StepKind.commit, filesChanged: [], sentence: "x" }]);
}

function listCurrentNodeTitles(): string[] {
    const titles: string[] = [];
    for (const node of buildPairWidget(PAIR).querySelectorAll("i.node.current-node")) {
        titles.push(node.getAttribute("title") ?? "no title");
    }
    return titles;
}

test("test_the_commit_node_with_the_marked_hash_gets_the_current_node_class", () => {
    // Steps: mark aaaa1111, build the bubble, expect only that commit node marked.
    storeCommitStep("aaaa1111");
    assert.deepEqual(listCurrentNodeTitles(), ["aaaa1111"]);
});

test("test_no_node_is_marked_when_the_marked_hash_is_not_in_the_pair", () => {
    storeCommitStep("cccc3333");
    assert.deepEqual(listCurrentNodeTitles(), []);
});

test("test_the_on_disk_node_is_never_marked", () => {
    storeCommitStep("aaaa1111");
    assert.equal(buildPairWidget(PAIR).querySelector("i.node.n-disk")!.classList.contains("current-node"), false);
});
