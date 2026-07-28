// GET + POST /api/layer1-settings — the per-project Layer 1 header record (task 297): the project folder, its repo, the ref, and the two picked source lists, so re-opening the page restores the last project instead of re-typing it.
//
// The file lives in the user's HOME, never in the repo: a settings file is per-user state and must not turn up as a git diff.

import { readFileSync, writeFileSync } from "node:fs";
import { type IncomingMessage, type ServerResponse } from "node:http";
import { homedir } from "node:os";
import { join } from "node:path";
import { Path } from "./structures/domain.ts";
import { computeLayer1Defaults } from "./viewer_api_layer1_defaults.ts";
import { sendJson } from "./viewer_server_routes.ts";

// One project's saved header state. Plain strings rather than Path/Date: this IS the on-disk record and the POST body, and it round-trips through JSON untouched.
export interface Layer1ProjectSettings {
    dir: string;
    repo: string;
    branch: string;
    ref: string;
    jsonl: string[];
    fileHistory: string[];
}

export interface Layer1Settings {
    lastDir: string | null;
    projects: Record<string, Layer1ProjectSettings>;
}

// Module-level and overridable so a test can redirect it — nothing may write to the real home.
let settingsFilePath = new Path(join(homedir(), ".jfred-layer1-settings.json"));

export function setLayer1SettingsPath(path: Path): void {
    settingsFilePath = path;
}

// A settings file is a convenience, so a missing OR corrupt one reads as "nothing saved" rather than stopping the page from loading.
export function readLayer1Settings(): Layer1Settings {
    try {
        const parsed = JSON.parse(readFileSync(settingsFilePath.toString(), "utf8")) as Partial<Layer1Settings>;
        return { lastDir: parsed.lastDir ?? null, projects: parsed.projects ?? {} };
    } catch {
        return { lastDir: null, projects: {} };
    }
}

// Read-modify-write, keyed by the project's own `dir`, so saving project A never drops project B.
export function saveLayer1Project(project: Layer1ProjectSettings): void {
    if (typeof project.dir !== "string" || project.dir === "") {
        throw new Error("body must carry a non-empty dir");
    }
    const settings = readLayer1Settings();
    settings.projects[project.dir] = project;
    settings.lastDir = project.dir;
    writeFileSync(settingsFilePath.toString(), JSON.stringify(settings, null, 2));
}

// The saved file PLUS the cold-start defaults, in one round trip: the page needs both to decide what to fill its boxes with, and asking twice would let it render once against the wrong answer.
export function handleLayer1SettingsRequest(response: ServerResponse): void {
    sendJson(response, 200, { ...readLayer1Settings(), defaults: computeLayer1Defaults() });
}

// POST body = one project entry. Body accumulation follows handleConfigUpdate in viewer_server.ts, the existing precedent for a POST in this server.
export function handleLayer1SettingsUpdate(request: IncomingMessage, response: ServerResponse): void {
    let body = "";
    request.on("data", (chunk: Buffer) => { body += chunk.toString(); });
    request.on("end", () => {
        try {
            saveLayer1Project(JSON.parse(body) as Layer1ProjectSettings);
            sendJson(response, 200, { saved: true });
        } catch (error) {
            sendJson(response, 400, { error: String(error) });
        }
    });
}
