// An image node fills the drawer from the binary route; the stage is built by hand, matching layer1-page.ts's DOM.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement,getInputById, getRequiredElementById } from "../webapp/app-dom.ts";
import { installNodeDrawer } from "../webapp/layer1-drawer.ts";
import { initLayer1Dom } from "./webapp-dom-test-helpers.ts";
import { stubFetchRoutes } from "./webapp-fetch-test-helpers.ts";
import { installAnimationFrameStub, waitForPendingFetches } from "./layer1-drawer-test-helpers.ts";

test("an image node renders an img off the binary route instead of fetching text", async () => {
    // Task 299: no JSON fetch happens — the img's src IS the request.
    initLayer1Dom();
    installAnimationFrameStub();
    stubFetchRoutes({});
    const node = createElement("i", { class: "node n-disk" });
    getRequiredElementById("stage").replaceChildren(createElement("div", { class: "filebox" }, [
        createElement("div", { class: "fname", text: "logo.png", "data-path": "assets/logo.png" }),
        createElement("div", { class: "lane" }, [node, createElement("span", { class: "nlabel", text: "on disk" })]),
    ]));
    getInputById("dir").value = "/project";
    installNodeDrawer();

    node.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    await waitForPendingFetches();

    const image = getRequiredElementById("dbody").querySelector("img");
    assert.ok(image?.getAttribute("src")?.includes("binary=1"), image?.outerHTML);
    assert.equal(getRequiredElementById("imgtools").hidden, false);
});
