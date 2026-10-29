import { test } from "node:test";
import assert from "node:assert/strict";
import { executeCli } from "../src/reconstruction_cli.ts";
import { S8_JSONL, S9_JSONL } from "./fixtures.ts";
import { branchRewoundHeader, rewoundMention } from "../src/regex_expressions.ts";

// Default view: S8 shows two rewound branch wrappers above the surviving branch; the file-less head is no branch.
test("test_default_view_shows_surviving_vc_plus_two_rewound", () => {
    const out = executeCli([S8_JSONL]);
    assert.ok(out.includes("branch surviving"));
    assert.ok(!out.includes("no files touched"));
    assert.equal((out.match(branchRewoundHeader) ?? []).length, 2); // exactly two rewound wrappers
    assert.ok(!out.includes("overwrite"));
});

// --surviving: only the surviving branch — no rewound branch headers.
test("test_surviving_flag_shows_only_vc", () => {
    const out = executeCli([S8_JSONL, "--surviving"]);
    assert.ok(!out.includes("## rewound"));
    assert.ok(!out.includes("branch rewound"));
});

// --list-branches: one surviving line and exactly two rewound summary lines.
test("test_list_branches_lists_surviving_vc_and_two_rewound", () => {
    const out = executeCli([S8_JSONL, "--list-branches"]);
    assert.ok(out.includes("surviving"));
    assert.equal((out.match(rewoundMention) ?? []).length, 2);
});

// Default view: S9 has one surviving branch and no rewound branch, so its conversationDAG is linear.
test("test_s9_default_view_is_a_plain_list_of_the_restored_files", () => {
    const out = executeCli([S9_JSONL]);
    assert.ok(out.includes("scenario9.py"));
    assert.ok(out.includes("test_scenario9.py"));
    assert.ok(!out.includes("branch "));             // linear, no wrappers
    assert.ok(!out.includes("no files touched"));
});

// --list-branches: a single surviving line; no rewound line.
test("test_s9_list_branches_shows_only_the_surviving_restored_branch", () => {
    const out = executeCli([S9_JSONL, "--list-branches"]);
    assert.ok(out.includes("surviving"));
    assert.ok(!out.includes("rewound"));
});

// --surviving: the two restored files, no headers.
test("test_s9_surviving_flag_shows_the_restored_files", () => {
    const out = executeCli([S9_JSONL, "--surviving"]);
    assert.ok(out.includes("scenario9.py"));
    assert.ok(out.includes("tests/test_scenario9.py"));
    assert.ok(!out.includes("## "));
});
