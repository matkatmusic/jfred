// Script-run Details view-model half (task 67; DOM-free, tested in
// tests/script-run-details-view.test.ts): resolve a run's sandbox-proven changed paths to the
// revisions whose per-revision diffs show the run's before/after. The DOM renderer lives in
// details-script-run.ts (the details-model.ts / details.ts split precedent).
import { SCRIPT_RUN_CHANGE_ID_PREFIX } from "./timeline-changes.js";
export function buildScriptRunDetailsViewModel(scriptRun, document) {
    return {
        code: scriptRun.code,
        files: scriptRun.changedPaths.map((path) => resolveChangedFileEntry(path, scriptRun, document.filesTouched)),
    };
}
// The engine's refForTarget join, mirrored: exact target match, else the changed path names the
// same file by a trailing path segment (the sandbox's state keys may be cwd-relative).
function resolveChangedFileEntry(path, scriptRun, histories) {
    const history = histories.find((candidate) => candidate.target === path || candidate.target.endsWith(`/${path}`) || path.endsWith(`/${candidate.target}`));
    if (history === undefined) {
        return { path, target: undefined, revisionNumber: undefined };
    }
    return { path, target: history.target, revisionNumber: pickRunRevisionNumber(history, scriptRun) };
}
// The 1-based revision showing this run's effect: (1) the revision the run's own deterministic
// scriptRun:<toolUseId>: changeId stamped; (2) the first revision at/after the run instant (the
// beacon-evidenced case — ISO-8601 wire timestamps compare lexicographically); (3) the last
// revision, when every revision precedes the run.
function pickRunRevisionNumber(history, scriptRun) {
    const runPrefix = `${SCRIPT_RUN_CHANGE_ID_PREFIX}${scriptRun.toolUseId}:`;
    const stamped = history.revisions.findIndex((revision) => revision.changeId.startsWith(runPrefix));
    if (stamped !== -1) {
        return stamped + 1;
    }
    const atOrAfter = history.revisions.findIndex((revision) => revision.timestamp >= scriptRun.timestamp);
    if (atOrAfter !== -1) {
        return atOrAfter + 1;
    }
    return history.revisions.length;
}
