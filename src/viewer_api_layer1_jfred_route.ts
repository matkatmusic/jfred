// POST /api/layer1-jfred-commit and /api/layer1-jfred-delete (task 361, phase 4): refused unless the server starts with --allow-jfred-writes.

import { type IncomingMessage, type ServerResponse } from "node:http";
import type { WireJfredCommitRequest } from "../webapp/layer1-components/commits-column/layer1-wire-jfred.ts";
import { assertLocalJsonPost } from "./viewer_api_clear_results.ts";
import { removeJfredBranch } from "./viewer_api_layer1_jfred_write.ts";
import { buildCommitReply, type CommitInput } from "./viewer_api_layer1_jfred_reply.ts";
import { sendNdjsonBuild, validateExistingFolderParam } from "./viewer_api_layer1_route.ts";
import { sendJson, sendText } from "./viewer_server_routes.ts";

let jfredWritesEnabled = false;

export function enableJfredWrites(): void {
  jfredWritesEnabled = true;
}

function assertJfredWritesEnabled(): void {
  if (!jfredWritesEnabled) {
    throw new Error("jfred git writes are off: start the server with --allow-jfred-writes");
  }
}

export function parseCommitInput(query: URLSearchParams, body: string): CommitInput {
  const dir = validateExistingFolderParam(query, "dir");
  const repoDir = validateExistingFolderParam(query, "repo");
  const request = JSON.parse(body) as WireJfredCommitRequest;
  if (typeof request.allowScripts !== "boolean") {
    throw new Error(`allowScripts must be true or false: ${request.allowScripts}`);
  }
  const markInstant = new Date(request.markInstant);
  const isMarkInstantValid = !Number.isNaN(markInstant.getTime());
  if (!isMarkInstantValid) {
    throw new Error(`markInstant is not a valid date: ${request.markInstant}`);
  }
  return { query, dir, repoDir, request, markInstant };
}

function sendCommitAnswer(response: ServerResponse, query: URLSearchParams, body: string): void {
  try {
    assertJfredWritesEnabled();
    const input = parseCommitInput(query, body);
    function buildReply(writeNdjsonLine: (value: unknown) => void): unknown {
      return buildCommitReply(input, writeNdjsonLine);
    }
    sendNdjsonBuild(response, buildReply);
  }
  catch (error) {
    sendText(response, 400, String(error));
  }
}

function sendDeleteAnswer(response: ServerResponse, query: URLSearchParams): void {
  try {
    assertJfredWritesEnabled();
    const repoDir = validateExistingFolderParam(query, "repo");
    removeJfredBranch(repoDir);
    sendJson(response, 200, { deleted: true });
  }
  catch (error) {
    sendText(response, 400, String(error));
  }
}

export function receiveJfredCommit(request: IncomingMessage, response: ServerResponse, url: URL): void {
  assertLocalJsonPost(request);
  let body = "";
  function appendChunk(chunk: Buffer): void {
    body += chunk.toString();
  }
  function sendAnswerForBody(): void {
    sendCommitAnswer(response, url.searchParams, body);
  }
  request.on("data", appendChunk);
  request.on("end", sendAnswerForBody);
}

export function receiveJfredDelete(request: IncomingMessage, response: ServerResponse, url: URL): void {
  assertLocalJsonPost(request);
  function sendAnswerForRequest(): void {
    sendDeleteAnswer(response, url.searchParams);
  }
  request.resume();
  request.on("end", sendAnswerForRequest);
}
