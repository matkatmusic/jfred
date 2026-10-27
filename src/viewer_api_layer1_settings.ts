// GET/POST /api/layer1-settings: task 297 project record; file lives in HOME, not repo.

import { readFileSync, writeFileSync } from "node:fs";
import { type IncomingMessage, type ServerResponse } from "node:http";
import { homedir } from "node:os";
import { join } from "node:path";
import { Path } from "./structures/domain.ts";
import { computeLayer1Defaults } from "./viewer_api_layer1_defaults.ts";
import { sendJson } from "./viewer_server_routes.ts";

// One project's saved header state; plain strings because it is the on-disk JSON record.
export interface Layer1ProjectSettings {
  dir: string;
  repo: string;
  branch: string;
  ref: string;
  jsonl: string[];
  fileHistory: string[];
  collapsedFolders?: string[];
  hiddenKinds?: string[];
}

export interface Layer1Settings {
  lastDir: string | null;
  projects: Record<string, Layer1ProjectSettings>;
}

// Overridable so a test can redirect it away from the real home.
let settingsFilePath = new Path(join(homedir(), ".jfred-layer1-settings.json"));

export function setLayer1SettingsPath(path: Path): void {
  settingsFilePath = path;
}

// A missing or corrupt settings file reads as "nothing saved" so the page still loads.
export function readLayer1Settings(): Layer1Settings {
  try {
    const parsed = JSON.parse(readFileSync(settingsFilePath.toString(), "utf8")) as Partial<Layer1Settings>;
    return { lastDir: parsed.lastDir ?? null, projects: parsed.projects ?? {} };
  }
  catch {
    return { lastDir: null, projects: {} };
  }
}

// Read-modify-write keyed by `dir`, merged so partial saves keep other fields.
export function saveLayer1Project(project: Partial<Layer1ProjectSettings> & { dir: string }): void {
  const isDirString = typeof project.dir === "string";
  const isDirEmpty = project.dir === "";
  const isDirInvalid = !isDirString || isDirEmpty;
  if (isDirInvalid) {
    throw new Error("body must carry a non-empty dir");
  }
  const settings = readLayer1Settings();
  settings.projects[project.dir] = { ...settings.projects[project.dir], ...project } as Layer1ProjectSettings;
  settings.lastDir = project.dir;
  writeFileSync(settingsFilePath.toString(), JSON.stringify(settings, null, 2));
}

// Saved file plus cold-start defaults in one round trip, so the page never renders against half the answer.
export function sendLayer1Settings(response: ServerResponse): void {
  sendJson(response, 200, { ...readLayer1Settings(), defaults: computeLayer1Defaults() });
}

// POST body = one project entry; accumulation follows receiveConfigUpdate in viewer_server_config.ts.
export function receiveLayer1SettingsUpdate(request: IncomingMessage, response: ServerResponse): void {
  let body = "";
  function appendChunk(chunk: Buffer): void {
    body += chunk.toString();
  }
  function saveBodyAndRespond(): void {
    try {
      saveLayer1Project(JSON.parse(body) as Partial<Layer1ProjectSettings> & { dir: string });
      sendJson(response, 200, { saved: true });
    }
    catch (error) {
      sendJson(response, 400, { error: String(error) });
    }
  }
  request.on("data", appendChunk);
  request.on("end", saveBodyAndRespond);
}
