// Shared helpers for the webapp view-model tests (tests/viewer-*.test.ts).  User directive 2026-07-02: scenarios are the client-test fixtures — every executed scenario carries ground truth (.step_states/ file states + the JSONL's conversational turns), so the view models are asserted against reality, not against hand-written expectations.  The view models consume the JSON-serialized document exactly as the client receives it over HTTP, so every test feeds JSON.parse(JSON.stringify(document)).

import { buildProjectDocument } from "../src/viewer_api.ts";
import { Path } from "../src/structures/domain.ts";
import { S19_JSONL } from "./fixtures.ts";

// The s19 document as the CLIENT sees it: built once, JSON round-tripped (Path/Uuid/Date -> strings).
export function buildS19ClientDocument(): any {
    return JSON.parse(JSON.stringify(buildProjectDocument([new Path(S19_JSONL)], undefined)));
}
