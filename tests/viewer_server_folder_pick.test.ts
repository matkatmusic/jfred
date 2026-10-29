// parsePickedPaths: osascript output becomes trimmed folder paths with no trailing slash and no blanks.

import assert from "node:assert/strict";
import { test } from "node:test";
import { parsePickedPaths } from "../src/viewer_server_folder_pick.ts";

test("test_parse_picked_paths_trims_slashes_and_drops_blank_lines", () => {
    assert.deepEqual(parsePickedPaths("/Users/a/one/\n  /Users/a/two \n\n"), ["/Users/a/one", "/Users/a/two"]);
});

test("test_parse_picked_paths_returns_empty_for_empty_output", () => {
    assert.deepEqual(parsePickedPaths(""), []);
});
