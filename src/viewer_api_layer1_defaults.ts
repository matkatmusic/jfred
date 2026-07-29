// The Layer 1 page's cold-start defaults: which project it opens on and which source folders it reads, for a fresh browser with nothing saved.
//
// They live in `.config/debugConfig.json`, a GITIGNORED folder at the repo root (user, 2026-07-27), rather than in source: they are one developer's local paths — absolute, machine-specific, and useless to anyone else who clones this. A missing or unreadable file is the normal case for everybody else and means "no defaults", which is exactly the behaviour that shipped before this existed. debugConfig.example.json is the committed copy documenting the shape, and README.md says where it has to be copied to.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// What the page fills its boxes and its two source lists from when nothing else says otherwise.  Every field is optional: a config naming only `dir` is a legitimate config.
export interface Layer1Defaults {
    dir?: string;
    repo?: string;
    jsonl?: string[];
    fileHistory?: string[];
}

export const DEBUG_CONFIG_PATH = resolve(import.meta.dirname, "..", ".config", "debugConfig.json");

// Only the four known keys survive, and only in the shape the page can use — this file is hand-edited, so a typo must degrade to "no default for that field" rather than reaching the client as something it will try to render.
function readStringArray(value: unknown): string[] | undefined {
    return Array.isArray(value) && value.every((entry) => typeof entry === "string") ? value : undefined;
}

function readString(value: unknown): string | undefined {
    return typeof value === "string" && value !== "" ? value : undefined;
}

export function computeLayer1Defaults(): Layer1Defaults {
    let parsed: Record<string, unknown>;
    try {
        parsed = JSON.parse(readFileSync(DEBUG_CONFIG_PATH, "utf8")) as Record<string, unknown>;
    } catch {
        // No file, or not JSON: the normal case. Defaults are a convenience, never a requirement.
        return {};
    }
    return {
        dir: readString(parsed.dir),
        repo: readString(parsed.repo),
        jsonl: readStringArray(parsed.jsonl),
        fileHistory: readStringArray(parsed.fileHistory),
    };
}
