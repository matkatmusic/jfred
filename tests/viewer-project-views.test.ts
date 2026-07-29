// Tests for the conversation, project, and projects-listing view models (webapp/views/conversation.ts, project.ts, projects.ts — plain ES modules, DOM-free).  See tests/viewer-test-helpers.ts for the fixture rationale.

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildProjectDocument } from "../src/viewer_api.ts";
import { buildConversationViewModel } from "../webapp/views/conversation.ts";
import { buildProjectViewModel } from "../webapp/views/project.ts";
import { filterProjectsByName } from "../webapp/views/projects.ts";
import { readNonEmptyLines } from "./utilities.ts";
import { jsonlPathsForScenario } from "./fixtures.ts";
import { S19_JSONL } from "./fixtures.ts";
import { buildS19ClientDocument } from "./viewer-test-helpers.ts";

test("test_conversation_viewmodel_shows_scenario_turns", () => {
    // Scenario: the conversation view model's turns are exactly document.messages (genuine user prompts + text-bearing assistant replies), in order — and the first user prompt's text matches the raw JSONL line, so the view model can't silently drop or reorder turns.
    const document = buildS19ClientDocument();
    const viewModel = buildConversationViewModel(document);
    const turns = viewModel.entries.filter((entry: any) => entry.kind === "message");
    // same count, same uuids, same texts, same order as the document's messages.
    assert.deepEqual(
        turns.map((entry: any) => ({ uuid: entry.message.uuid, text: entry.message.text })),
        document.messages.map((message: any) => ({ uuid: message.uuid, text: message.text })),
    );
    // spot-check the first user prompt's text against the raw JSONL line carrying its uuid.
    const firstUserMessage = document.messages.find((message: any) => message.role === "user");
    assert.ok(firstUserMessage !== undefined);
    const rawLines = readNonEmptyLines(S19_JSONL).map((line) => JSON.parse(line));
    const rawRecord = rawLines.find((record: any) => record.uuid === firstUserMessage.uuid);
    assert.ok(rawRecord !== undefined, "the first user prompt exists as a raw JSONL line");
    const rawText = typeof rawRecord.message.content === "string"
        ? rawRecord.message.content
        : rawRecord.message.content.filter((block: any) => block.type === "text").map((block: any) => block.text).join("\n");
    assert.equal(firstUserMessage.text, rawText);
});

test("test_conversation_viewmodel_interleaves_collapsed_stubs", () => {
    // Scenario: between two adjacent turns, the view model lists stub entries whose uuids are exactly the lineVerdicts uuids between those messages' lines.
    const document = buildS19ClientDocument();
    const viewModel = buildConversationViewModel(document);
    // find the first pair of adjacent message entries with at least one stub between them.
    const entries = viewModel.entries;
    let firstMessageIndex = -1;
    for (let index = 0; index < entries.length - 1; index += 1) {
        if (entries[index]!.kind === "message" && entries[index + 1]!.kind === "stub") {
            firstMessageIndex = index;
            break;
        }
    }
    assert.ok(firstMessageIndex >= 0, "s19 has a message followed by collapsed records");
    // collect the view model's stub run and the next message after it.
    const stubUuids: string[] = [];
    let nextMessageEntry: any;
    for (let index = firstMessageIndex + 1; index < entries.length; index += 1) {
        if (entries[index]!.kind === "message") { nextMessageEntry = entries[index]; break; }
        stubUuids.push(entries[index]!.uuid!);
    }
    assert.ok(nextMessageEntry !== undefined, "a following message bounds the stub run");
    // ground truth: the lineVerdicts strictly between the two messages' lines.
    const lineOf = (uuid: string) => document.lineVerdicts.find((verdict: any) => verdict.uuid === uuid)!.line;
    const startLine = lineOf(entries[firstMessageIndex]!.message!.uuid);
    const endLine = lineOf(nextMessageEntry.message.uuid);
    const expectedUuids = document.lineVerdicts
        .filter((verdict: any) => verdict.line > startLine && verdict.line < endLine)
        .map((verdict: any) => verdict.uuid);
    assert.deepEqual(stubUuids, expectedUuids);
});

test("test_filterProjectsByName_matches_case_insensitive_substring", () => {
    // Scenario: filtering a project listing by a mixed-case fragment keeps exactly the projects whose name contains that fragment, ignoring case.  Steps: a listing holds three projects with distinct names.
    const projectListing = [{ name: "alpha-app" }, { name: "Beta-Tool" }, { name: "gamma-app" }];
    // filter with a fragment that case-insensitively matches only the second project.
    const filteredProjects = filterProjectsByName(projectListing, "beta");
    // only that project survives the filter.
    assert.deepEqual(filteredProjects.map((project: any) => project.name), ["Beta-Tool"]);
});

test("test_filterProjectsByName_returns_all_projects_for_empty_filter", () => {
    // Scenario: an empty filter string keeps the whole listing, in order.  Steps: a listing holds two projects.
    const projectListing = [{ name: "alpha-app" }, { name: "Beta-Tool" }];
    // filter with the empty string (the input's initial state).
    const filteredProjects = filterProjectsByName(projectListing, "");
    // every project survives, order unchanged.
    assert.deepEqual(filteredProjects, projectListing);
});

test("test_file_state_viewmodel_unifies_multi_jsonl", () => {
    // Scenario: s53 (two concurrent-agent transcripts) — the project view model's files-touched list covers files originating from BOTH JSONLs.
    const paths = jsonlPathsForScenario("s53");
    const perTranscriptTargets = paths.map((path) =>
        JSON.parse(JSON.stringify(buildProjectDocument([path], undefined)))
            .filesTouched.map((history: any) => history.target),
    );
    const unifiedDocument = JSON.parse(JSON.stringify(buildProjectDocument(paths, undefined)));
    const viewModel = buildProjectViewModel(unifiedDocument);
    for (const targets of perTranscriptTargets) {
        for (const target of targets) {
            assert.ok(viewModel.fileTargets.includes(target), `project view model covers ${target}`);
        }
    }
});
