// The task-56 pre-baseline question dialog: when a project's reveng-paths.json supplies a
// base commit (item 46), the server asks — before any build — whether file states that
// precede that commit should be reconstructed at all. "No" makes the baseline commit the
// timeline's first shown step (the engine drops the work the beacon supersedes); "Yes"
// reconstructs exactly as before. The choice is remembered per project for this browser
// session only, mirroring the script-consent dialog (app-consent.ts).
import { el } from "./app-dom.js";
import { storeBaselineChoice } from "./app-choices.js";
import { renderRoute } from "./app-router.js";
// The short display form of a full commit hash (git's customary 12 abbreviated digits).
export function formatShortCommitHash(commitHash) {
    return commitHash.slice(0, 12);
}
export function renderBaselineQuestionDialog(container, project, question) {
    // Mirrors the consent dialog's decide: store the answer, re-render the route — the
    // re-issued /api/document request carries the choice as the preBaseline param.
    const decide = (choice) => {
        storeBaselineChoice(project, choice);
        renderRoute();
    };
    const reconstructButton = el("button", {
        class: "toolbar-btn consent-run",
        text: "Reconstruct pre-baseline states",
        onclick: () => decide("1"),
    });
    const startAtBaselineButton = el("button", {
        class: "toolbar-btn",
        text: "Start at the baseline commit",
        onclick: () => decide("0"),
    });
    const box = el("div", { class: "consent-box" }, [
        el("div", { class: "consent-header" }, [
            el("h2", { text: "Do you want to reconstruct file states that precede the supplied baseline git commit?" }),
            el("div", { class: "muted", text: `repo ${question.repo} · commit ${formatShortCommitHash(question.baseCommit)}` }),
            reconstructButton,
            startAtBaselineButton,
        ]),
    ]);
    container.replaceChildren(box);
}
