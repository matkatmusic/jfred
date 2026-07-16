// Resolve a path against a transcript `cwd` to one canonical absolute string. A leaf module —
// imports only node `path` — so both extraction (rename targets) and the sidecar (snapshot
// paths) share one resolver with no engine import cycle.
import { resolve } from "node:path";
import { Path } from "./domain.ts";

// Resolve a path to an absolute string against the transcript cwd. Snapshots key their backups
// by the path relative to cwd (e.g. "s5_redirect.txt") and `git mv` names its args relative,
// while a file event's target is absolute; resolving both the same way lets them match.
// resolve() leaves an already-absolute path unchanged, so an absolute target passes through.
export function resolveAgainstCwd(cwd: Path | undefined, path: Path): string {
    if (!cwd) {
        return path.toString();
    }
    return resolve(cwd.toString(), path.toString());
}

