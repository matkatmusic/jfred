// S2a: the Docker readiness reply and its route.

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { StateConfidence } from "../engineV3/engineV3_file_known_states.ts";
import { buildInverseReposForFiles, type ProjectFile } from "../engineV3/engineV3_inverse_repos_for_project.ts";
import { DockerReadiness, ScriptReplayChangeKind } from "../engineV3/engineV3_script_replay_container.ts";
import { ScriptTaskOutcomeKind, type ScriptTaskOutcome } from "../engineV3/engineV3_script_replay_run.ts";
import type { ProgressEvent } from "../src/parse/loadTranscript.ts";
import { Path } from "../src/structures/domain.ts";
import { DocumentResponseKind } from "../src/structures/vocabulary_views.ts";
import { getInverseReposStoreFolder } from "../src/viewer_api_layer1_inverse_repos.ts";
import {
    SCRIPT_REPLAY_ALREADY_RUNNING_TEXT, buildDockerReadinessReply, buildScriptReplayNeedsReply, mapScriptTaskOutcomeToWire, sendScriptReplayRunReply,
    type ScriptReplayRun,
} from "../src/viewer_api_layer1_script_replay.ts";
import { dispatchLayer1Route } from "../src/viewer_server_layer1_routes.ts";
import { WireRunOutcome } from "../webapp/layer1-wire-script-results.ts";
import { WireScriptReplayProblem, WireScriptReplayReason, type WireScriptReplayRunReply } from "../webapp/layer1-wire-script-replay.ts";

test("test_docker_readiness_reply_is_empty_when_docker_is_ready", () => {
    // Docker is ready.
    const readiness = DockerReadiness.Ready;
    // The reply has no problem and no problem text.
    assert.deepEqual(buildDockerReadinessReply(readiness), {});
});

test("test_docker_readiness_reply_holds_the_problem_text_when_docker_is_missing", () => {
    // Docker is not installed: the reply names the problem and gives the exact text.
    assert.deepEqual(buildDockerReadinessReply(DockerReadiness.NotInstalled), {
        problem: WireScriptReplayProblem.dockerNotInstalled,
        problemText: "Docker is not installed. Install Docker, start it, then try again.",
    });
    // Docker is not running.
    assert.deepEqual(buildDockerReadinessReply(DockerReadiness.NotRunning), {
        problem: WireScriptReplayProblem.dockerNotRunning,
        problemText: "Docker is not running. Start Docker, then try again.",
    });
    // The script image is missing.
    assert.deepEqual(buildDockerReadinessReply(DockerReadiness.ImageMissing), {
        problem: WireScriptReplayProblem.imageMissing,
        problemText: 'The script image is missing. Run "npm run sandbox:build" in the jfred folder once, then try again.',
    });
});

test("test_docker_readiness_route_is_registered", () => {
    // A GET to the route is dispatched, and the dispatch says it owns the request.
    let body = "";
    const response = {
        writeHead: () => response,
        end: (chunk?: string) => {
            body += chunk ?? "";
        },
    } as unknown as ServerResponse;
    const request = { method: "GET", headers: {} } as unknown as IncomingMessage;
    const handled = dispatchLayer1Route(request, response, new URL("http://localhost/api/layer1-docker-readiness"));
    assert.equal(handled, true);
    // The reply is JSON that holds no field other than the two reply fields.
    const reply = JSON.parse(body) as Record<string, unknown>;
    for (const key of Object.keys(reply)) {
        assert.ok(key === "problem" || key === "problemText");
    }
});

// S2b: the needs route and the run route.

const DISK_NOW_INSTANT = new Date(Date.UTC(2026, 5, 1, 12, 0, 0));
const TO_INSTANT = new Date(Date.UTC(2026, 11, 1, 0, 0, 0));

function makeInstant(second: number): Date {
    return new Date(Date.UTC(2026, 0, 1, 0, 0, 0) + second * 1000);
}

// A call record is stamped one millisecond before its result record.
function makeCallInstant(second: number): Date {
    return new Date(makeInstant(second).getTime() - 1);
}

function makeCallRecord(toolName: string, toolUseId: string, input: object, second: number, cwd: string): object {
    const content = [{ type: "tool_use", id: toolUseId, name: toolName, input, caller: { type: "direct" } }];
    return { type: "assistant", uuid: `call-${toolUseId}`, timestamp: makeCallInstant(second).toISOString(), cwd, message: { role: "assistant", content } };
}

function makeResultRecord(toolUseId: string, toolUseResult: object, second: number): object {
    const content = [{ type: "tool_result", tool_use_id: toolUseId, content: "ok" }];
    return { type: "user", uuid: `result-${toolUseId}`, timestamp: makeInstant(second).toISOString(), message: { role: "user", content }, toolUseResult };
}

function makeWriteCreateRows(toolUseId: string, filePath: string, content: string, second: number, cwd: string): object[] {
    const toolUseResult = { type: "create", filePath, content, originalFile: null, structuredPatch: [], userModified: false };
    return [makeCallRecord("Write", toolUseId, { file_path: filePath, content }, second, cwd), makeResultRecord(toolUseId, toolUseResult, second)];
}

function makeBashRecord(toolUseId: string, command: string, second: number, cwd: string): object {
    return makeCallRecord("Bash", toolUseId, { command }, second, cwd);
}

type Scene = { projectFolder: Path; jsonlsFolder: Path; historyFolder: Path; storeFolder: Path; projectFiles: ProjectFile[] };

// A temp project that holds the named files on disk, with one transcript (none when there are no records).
// The store folder is the one the route uses, so it is removed with the temp folder.
function makeScene(t: TestContext, diskTextByFileName: Record<string, string>, makeRecords: (projectFolder: string) => object[]): Scene {
    const rootFolder = mkdtempSync(join(tmpdir(), "viewer-script-replay-"));
    const projectFolder = new Path(join(rootFolder, "project"));
    const jsonlsFolder = new Path(join(rootFolder, "jsonls"));
    const historyFolder = new Path(join(rootFolder, "file-history"));
    const storeFolder = getInverseReposStoreFolder(projectFolder);
    t.after(() => {
        rmSync(rootFolder, { recursive: true, force: true });
        rmSync(storeFolder.toString(), { recursive: true, force: true });
    });
    mkdirSync(projectFolder.toString());
    mkdirSync(jsonlsFolder.toString());
    mkdirSync(historyFolder.toString());
    const projectFiles: ProjectFile[] = [];
    for (const [fileName, diskText] of Object.entries(diskTextByFileName)) {
        const file = new Path(join(projectFolder.toString(), fileName));
        writeFileSync(file.toString(), diskText);
        projectFiles.push({ file, transcriptFile: file });
    }
    const records = makeRecords(projectFolder.toString());
    if (records.length > 0) {
        writeFileSync(join(jsonlsFolder.toString(), "s1.jsonl"), records.map((record) => JSON.stringify(record)).join("\n") + "\n");
    }
    return { projectFolder, jsonlsFolder, historyFolder, storeFolder, projectFiles };
}

function buildStore(scene: Scene): void {
    buildInverseReposForFiles(scene.projectFolder, scene.projectFiles, [scene.jsonlsFolder], [scene.historyFolder], scene.storeFolder, DISK_NOW_INSTANT, () => {});
}

type FakeResponse = { response: ServerResponse; getStatus: () => number; getBody: () => string };

// Records the status and the written text; nothing here touches a socket.
function makeFakeResponse(): FakeResponse {
    let status = 0;
    let body = "";
    const response = {
        writableCorked: 0,
        writableFinished: false,
        writeHead: (statusCode: number) => {
            status = statusCode;
        },
        write: (chunk: string) => {
            body += chunk;
            return true;
        },
        end: (chunk?: string) => {
            body += chunk ?? "";
        },
        on: () => {},
    } as unknown as ServerResponse;
    return { response, getStatus: () => status, getBody: () => body };
}

function parseNdjsonLines(body: string): unknown[] {
    return body.split("\n").filter((line) => line !== "").map((line) => JSON.parse(line) as unknown);
}

function makeOutcome(overrides: Partial<ScriptTaskOutcome>): ScriptTaskOutcome {
    return { taskId: "task-1", outcome: ScriptTaskOutcomeKind.Replayed, reason: null, missingExecutable: null, exitCode: 0, timedOut: false, stdout: "out", stderr: "err", files: [], ...overrides };
}

const RUN_REQUEST = { toInstant: TO_INSTANT.toISOString(), allowScripts: true };

test("test_needs_reply_lists_the_unfilled_tasks_with_in_span_flags", (t) => {
    // Scenario: two files each wait for one recorded script; the span starts between the two scripts.
    // Steps:
    // A project holds a.txt and b.txt. Each file has a Write, then one script that rewrites it. Script A runs at second 20 and script B at second 40.
    const scene = makeScene(t, { "a.txt": "a1\n", "b.txt": "b1\n" }, (projectFolder) => [
        ...makeWriteCreateRows("toolu_write_a", join(projectFolder, "a.txt"), "a0\n", 10, projectFolder),
        ...makeWriteCreateRows("toolu_write_b", join(projectFolder, "b.txt"), "b0\n", 11, projectFolder),
        makeBashRecord("toolu_script_a", `printf 'a1\\n' > ${join(projectFolder, "a.txt")}`, 20, projectFolder),
        makeBashRecord("toolu_script_b", `printf 'b1\\n' > ${join(projectFolder, "b.txt")}`, 40, projectFolder),
    ]);
    // The per-file repos and their gap files are built for real.
    buildStore(scene);
    // The needs reply is built for a span that starts at second 30.
    const progressEvents: ProgressEvent[] = [];
    const reply = buildScriptReplayNeedsReply(scene.projectFolder, [scene.jsonlsFolder], { fromInstant: makeInstant(30).toISOString(), toInstant: TO_INSTANT.toISOString() }, (event) => progressEvents.push(event), DockerReadiness.Ready);
    // It lists two tasks, oldest first.
    assert.equal(reply.tasks.length, 2);
    const [taskA, taskB] = reply.tasks;
    // Task A is before the span start: it is not in the span. It names a.txt.
    assert.equal(taskA!.instant, makeCallInstant(20).toISOString());
    assert.match(taskA!.taskId, /s1\.jsonl:\d+:toolu_script_a$/);
    assert.equal(taskA!.isInSpan, false);
    assert.equal(taskA!.language, "bash");
    assert.equal(taskA!.cwd, scene.projectFolder.toString());
    assert.match(taskA!.code, /printf 'a1/);
    assert.ok(taskA!.source!.filePath.endsWith("s1.jsonl"));
    assert.ok(taskA!.source!.lineNumber > 0);
    assert.deepEqual(taskA!.waitingFiles, [{ path: "a.txt", reason: WireScriptReplayReason.namedByFile }]);
    // Task B is after the span start: it is in the span. It names b.txt.
    assert.equal(taskB!.instant, makeCallInstant(40).toISOString());
    assert.equal(taskB!.isInSpan, true);
    assert.deepEqual(taskB!.waitingFiles, [{ path: "b.txt", reason: WireScriptReplayReason.namedByFile }]);
    // With no span start, both tasks are in the span.
    const replyWithoutStart = buildScriptReplayNeedsReply(scene.projectFolder, [scene.jsonlsFolder], { fromInstant: null, toInstant: TO_INSTANT.toISOString() }, () => {}, DockerReadiness.Ready);
    assert.deepEqual(replyWithoutStart.tasks.map((task) => task.isInSpan), [true, true]);
    // A task after the end instant is not listed.
    const replyToSecond30 = buildScriptReplayNeedsReply(scene.projectFolder, [scene.jsonlsFolder], { fromInstant: null, toInstant: makeInstant(30).toISOString() }, () => {}, DockerReadiness.Ready);
    assert.equal(replyToSecond30.tasks.length, 1);
    // One progress line per project file names that file.
    const progressFiles = progressEvents.filter((event) => event.file !== undefined).map((event) => event.file);
    assert.deepEqual(progressFiles.sort(), ["a.txt", "b.txt"]);
});

test("test_needs_reply_holds_no_problem_when_docker_is_ready", (t) => {
    // Scenario: with Docker ready, the reply has the task list and no problem fields.
    // Steps:
    // A project has no files and no transcripts.
    const scene = makeScene(t, {}, () => []);
    // The needs reply is built while Docker is ready.
    const reply = buildScriptReplayNeedsReply(scene.projectFolder, [scene.jsonlsFolder], { fromInstant: null, toInstant: TO_INSTANT.toISOString() }, () => {}, DockerReadiness.Ready);
    // The reply holds an empty task list and no problem field and no problem text field.
    assert.deepEqual(reply, { tasks: [] });
});

test("test_needs_reply_holds_the_problem_text_when_docker_is_missing", (t) => {
    // Scenario: with Docker missing, the reply names the problem and still lists the tasks.
    // Steps:
    // A project has no files and no transcripts.
    const scene = makeScene(t, {}, () => []);
    // The needs reply is built while Docker is not running (the readiness is given to the builder).
    const reply = buildScriptReplayNeedsReply(scene.projectFolder, [scene.jsonlsFolder], { fromInstant: null, toInstant: TO_INSTANT.toISOString() }, () => {}, DockerReadiness.NotRunning);
    // The reply holds the problem, the exact text, and the task list.
    assert.deepEqual(reply, {
        problem: WireScriptReplayProblem.dockerNotRunning,
        problemText: "Docker is not running. Start Docker, then try again.",
        tasks: [],
    });
});

test("test_run_is_refused_without_allow_scripts", async () => {
    // Scenario: a run request that does not hold allowScripts === true gets a 400 and runs nothing.
    // Steps:
    // A fake replay counts its calls.
    let replayCallCount = 0;
    const countingReplay: ScriptReplayRun = async () => {
        replayCallCount += 1;
        return [];
    };
    // A request with allowScripts false is sent.
    const falseResponse = makeFakeResponse();
    await sendScriptReplayRunReply(falseResponse.response, { toInstant: TO_INSTANT.toISOString(), allowScripts: false }, countingReplay);
    // The answer is 400 and the text names allowScripts.
    assert.equal(falseResponse.getStatus(), 400);
    assert.match(falseResponse.getBody(), /allowScripts/);
    // A request whose allowScripts is the text "true" is refused in the same way.
    const textResponse = makeFakeResponse();
    await sendScriptReplayRunReply(textResponse.response, { toInstant: TO_INSTANT.toISOString(), allowScripts: "true" as unknown as boolean }, countingReplay);
    assert.equal(textResponse.getStatus(), 400);
    // The fake replay was never called.
    assert.equal(replayCallCount, 0);
});

test("test_second_run_while_one_runs_is_refused", async () => {
    // Scenario: only one replay runs at a time, and the lock opens again when a run ends or throws.
    // Steps:
    // The first run starts and waits for the test to release it.
    let releaseFirstRun!: () => void;
    const firstRunMayEnd = new Promise<void>((resolve) => {
        releaseFirstRun = resolve;
    });
    const firstResponse = makeFakeResponse();
    const firstRun = sendScriptReplayRunReply(firstResponse.response, RUN_REQUEST, async () => {
        await firstRunMayEnd;
        return [];
    });
    // A second request arrives while the first runs.
    let secondReplayCallCount = 0;
    const secondResponse = makeFakeResponse();
    await sendScriptReplayRunReply(secondResponse.response, RUN_REQUEST, async () => {
        secondReplayCallCount += 1;
        return [];
    });
    // The second request gets a 400 with the exact text and its replay never runs.
    assert.equal(secondResponse.getStatus(), 400);
    assert.equal(secondResponse.getBody(), "a script replay is already running");
    assert.equal(SCRIPT_REPLAY_ALREADY_RUNNING_TEXT, "a script replay is already running");
    assert.equal(secondReplayCallCount, 0);
    // The first run ends and answers 200 with an empty result list.
    releaseFirstRun();
    await firstRun;
    assert.equal(firstResponse.getStatus(), 200);
    assert.deepEqual(parseNdjsonLines(firstResponse.getBody()).at(-1), { results: [] });
    // A third request is accepted now.
    const thirdResponse = makeFakeResponse();
    await sendScriptReplayRunReply(thirdResponse.response, RUN_REQUEST, async () => []);
    assert.equal(thirdResponse.getStatus(), 200);
    // A run that throws ends with an error line.
    const throwingResponse = makeFakeResponse();
    await sendScriptReplayRunReply(throwingResponse.response, RUN_REQUEST, async () => {
        throw new Error("replay broke");
    });
    assert.deepEqual(parseNdjsonLines(throwingResponse.getBody()).at(-1), { kind: DocumentResponseKind.error, label: "replay broke" });
    // The next request after the throwing run is accepted too.
    const afterThrowResponse = makeFakeResponse();
    await sendScriptReplayRunReply(afterThrowResponse.response, RUN_REQUEST, async () => []);
    assert.equal(afterThrowResponse.getStatus(), 200);
});

test("test_task_outcome_maps_to_the_wire_outcome", () => {
    // Scenario: each outcome kind maps to its wire outcome, and each null field leaves its wire field absent.
    // Steps:
    // A replayed outcome maps to "replayed" and keeps its exit code.
    const replayed = mapScriptTaskOutcomeToWire(makeOutcome({ outcome: ScriptTaskOutcomeKind.Replayed, exitCode: 0 }));
    assert.equal(replayed.outcome, WireRunOutcome.replayed);
    assert.equal(replayed.exitCode, 0);
    // A replayed outcome with no reason and no missing executable has neither field.
    assert.equal("reason" in replayed, false);
    assert.equal("missingExecutable" in replayed, false);
    // A refused outcome maps to "not-replayed", keeps its reason, and has no exit code field.
    const refused = mapScriptTaskOutcomeToWire(makeOutcome({ outcome: ScriptTaskOutcomeKind.Refused, reason: "uses the internet", exitCode: null }));
    assert.equal(refused.outcome, WireRunOutcome.notReplayed);
    assert.equal(refused.reason, "uses the internet");
    assert.equal("exitCode" in refused, false);
    // A failed outcome maps to "replay-failed" and keeps its exit code.
    const failed = mapScriptTaskOutcomeToWire(makeOutcome({ outcome: ScriptTaskOutcomeKind.Failed, exitCode: 3, timedOut: true }));
    assert.equal(failed.outcome, WireRunOutcome.replayFailed);
    assert.equal(failed.exitCode, 3);
    assert.equal(failed.timedOut, true);
    assert.equal(failed.stdout, "out");
    assert.equal(failed.stderr, "err");
    // The file outcomes map path, change kind and confidence; only Proven and Derived give a confidence.
    const withFiles = mapScriptTaskOutcomeToWire(makeOutcome({
        files: [
            { relativePath: "a.txt", changeKind: ScriptReplayChangeKind.Changed, confidence: StateConfidence.Proven, isGapFilled: true },
            { relativePath: "b.txt", changeKind: ScriptReplayChangeKind.Created, confidence: StateConfidence.Derived, isGapFilled: false },
            { relativePath: "c.txt", changeKind: ScriptReplayChangeKind.Deleted, confidence: StateConfidence.Confirmed, isGapFilled: false },
            { relativePath: "d.txt", changeKind: null, confidence: StateConfidence.Unknown, isGapFilled: false },
            { relativePath: "e.txt", changeKind: null, confidence: null, isGapFilled: false },
        ],
    }));
    assert.deepEqual(withFiles.files, [
        { path: "a.txt", changeKind: "changed", confidence: "proven", isGapFilled: true },
        { path: "b.txt", changeKind: "created", confidence: "derived", isGapFilled: false },
        { path: "c.txt", changeKind: "deleted", confidence: null, isGapFilled: false },
        { path: "d.txt", changeKind: null, confidence: null, isGapFilled: false },
        { path: "e.txt", changeKind: null, confidence: null, isGapFilled: false },
    ]);
});

test("test_routes_are_registered", () => {
    // Scenario: both new routes are in the Layer 1 route list.
    // Steps:
    // A POST with no content type is sent to each route. The route list owns it, so the route's first guard throws.
    const request = { method: "POST", headers: {} } as unknown as IncomingMessage;
    const response = {} as unknown as ServerResponse;
    // An unregistered path would return false instead of throwing.
    for (const routePath of ["/api/layer1-script-replay-needs", "/api/layer1-script-replay-run"]) {
        assert.throws(() => dispatchLayer1Route(request, response, new URL(`http://localhost${routePath}`)), /content type must be application\/json/);
    }
});

test("test_run_reply_carries_the_missing_executable_name", async () => {
    // Scenario: the run reply names the program a script lacked, and leaves the field out when none was lacking.
    // Steps:
    // A fake replay reports one progress line and two outcomes: one lacked "pandas", one lacked nothing.
    const fakeReplay: ScriptReplayRun = async (_toInstant, reportProgress) => {
        reportProgress({ kind: DocumentResponseKind.progress, label: "replaying script 1 of 2", current: 1, total: 2 });
        return [
            makeOutcome({ taskId: "task-1", outcome: ScriptTaskOutcomeKind.Failed, exitCode: 1, missingExecutable: "pandas" }),
            makeOutcome({ taskId: "task-2", outcome: ScriptTaskOutcomeKind.Replayed, missingExecutable: null }),
        ];
    };
    // The run request is sent.
    const fake = makeFakeResponse();
    await sendScriptReplayRunReply(fake.response, RUN_REQUEST, fakeReplay);
    // The first line is the progress line and the last line is the reply.
    const lines = parseNdjsonLines(fake.getBody());
    assert.equal(lines.length, 2);
    assert.equal((lines[0] as ProgressEvent).label, "replaying script 1 of 2");
    const reply = lines[1] as WireScriptReplayRunReply;
    // The first result carries the name "pandas".
    assert.equal(reply.results[0]!.missingExecutable, "pandas");
    // The second result has no missingExecutable field.
    assert.equal("missingExecutable" in reply.results[1]!, false);
});
