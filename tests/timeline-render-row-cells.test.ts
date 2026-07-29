// Role-class tests for webapp/views/timeline-render-row-cells.ts (task 160): raw-line rows get their own text color class instead of falling through to the session-end styling.

import { test } from "node:test";
import assert from "node:assert/strict";
import { setupWebappDom } from "./webapp-dom-test-helpers.ts";

test("test_line_node_rows_get_their_own_role_class", async () => {
    // Scenario (task 160): computeRoleClass returns a line-node-specific class for LINE_NODE_KIND instead of falling through to the session-end "role-end".  Steps: boot the DOM globals the webapp module graph expects, then import the module.
    setupWebappDom();
    const { computeRoleClass } = await import("../webapp/views/timeline-render-row-cells.ts");
    const { LINE_NODE_KIND } = await import("../webapp/views/timeline-line-nodes.ts");
    const { SESSION_END_NODE_KIND } = await import("../webapp/views/timeline-types.ts");
    // a raw-line row classifies as "role-line" — its own color in styles.css.
    assert.equal(computeRoleClass(LINE_NODE_KIND), "role-line");
    // the session-end fall-through stays "role-end".
    assert.equal(computeRoleClass(SESSION_END_NODE_KIND), "role-end");
});
