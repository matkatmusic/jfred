// The engine log names a file by its path relative to the project folder.

import assert from "node:assert/strict";
import { test } from "node:test";
import { Path } from "../src/structures/domain.ts";
import { getRelativeLogPath } from "../engineV3/tui/engineV3_tui_engine_log.ts";

const PROJECT_FOLDER = new Path("/private/tmp/work/project");

test("test_a_file_in_the_project_folder_is_named_by_its_base_name", () => {
    assert.equal(getRelativeLogPath(PROJECT_FOLDER, new Path("/private/tmp/work/project/geo_report.py")).toString(), "geo_report.py");
});

test("test_a_file_in_a_sub_folder_is_named_with_the_sub_folder", () => {
    assert.equal(getRelativeLogPath(PROJECT_FOLDER, new Path("/private/tmp/work/project/tests/test_geo_core.py")).toString(), "tests/test_geo_core.py");
});
