// POST /api/config handling for viewer_server.ts: switch the projects folder and file-history folder.

import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { getProjectsDir, setProjectsDir, setFileHistoryDir, getEffectiveFileHistoryDir } from "./viewer_api_projects.ts";
import { sendJson } from "./viewer_server_routes.ts";

// A change tells the client the server relaunched, so it drops its stored script-consent choices.
export const SERVER_BOOT_ID = randomUUID();

// Order matters: the projects switch clears the override, so an explicit fileHistoryDir applies after it.
export function applyConfigUpdate(response: ServerResponse, body: string): void {
  const requested = JSON.parse(body) as { projectsDir?: string; fileHistoryDir?: string };
  const isProjectsDirMissing = requested.projectsDir === undefined;
  const isFileHistoryDirMissing = requested.fileHistoryDir === undefined;
  const isBodyEmpty = isProjectsDirMissing && isFileHistoryDirMissing;
  if (isBodyEmpty) {
    sendJson(response, 400, { error: "body must carry projectsDir and/or fileHistoryDir" });
    return;
  }
  if (requested.projectsDir !== undefined) {
    setProjectsDir(requested.projectsDir);
  }
  if (requested.fileHistoryDir !== undefined) {
    setFileHistoryDir(requested.fileHistoryDir);
  }
  sendJson(response, 200, { projectsDir: getProjectsDir(), fileHistoryDir: getEffectiveFileHistoryDir(), bootId: SERVER_BOOT_ID });
}

export function receiveConfigUpdate(request: IncomingMessage, response: ServerResponse): void {
  let body = "";
  function appendChunk(chunk: Buffer): void {
    body += chunk.toString();
  }
  function applyBody(): void {
    try {
      applyConfigUpdate(response, body);
    }
    catch (error) {
      sendJson(response, 400, { error: String(error) });
    }
  }
  request.on("data", appendChunk);
  request.on("end", applyBody);
}
