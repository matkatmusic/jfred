// Task 286: the Layer 1 header's branch and commit dropdowns. They exist only once the repo box is confirmed to name a real git repo — GET /api/layer1-refs answering ok IS that confirmation, so no separate "is this a repo" endpoint exists. Both selects WRITE into the pre-existing #ref text box rather than replacing it: a raw hash must still be typeable, and #ref is the endpoint's param.

import { el, getInputById, getRequiredElementById } from "./app-dom.ts";

// The /api/layer1-refs wire shape, re-declared because webapp/ cannot import from src/ — the same constraint that re-spells CommitTimeSource in layer1-sources.ts.
interface WireRefCommit {
    hash: string;
    date: string;
    subject: string;
}

interface WireLayer1Refs {
    branches: string[];
    head: string;
    commits: WireRefCommit[];
}

// 75 characters of subject, the number the user specified; #commit is sized in `ch` to match.
const SUBJECT_WIDTH = 75;

// The row the `.repo-ok` class gates the pickers on. Thrown on absence for the same reason getRequiredElementById throws: markup drift should fail loudly, not silently do nothing.
function getRepoRow(): HTMLElement {
    const row = document.querySelector(".sources.repo");
    if (row === null) {
        throw new Error("page markup is missing .sources.repo");
    }
    return row as HTMLElement;
}

function getSelectById(id: string): HTMLSelectElement {
    return getRequiredElementById(id) as HTMLSelectElement;
}

// Mockup line 1207's expression: short hash, padded subject, date — monospace, so the columns line up down the list.
function describeCommit(commit: WireRefCommit): string {
    const subject = commit.subject.padEnd(SUBJECT_WIDTH).slice(0, SUBJECT_WIDTH);
    return `${commit.hash.slice(0, 8)}  ${subject}  ${commit.date}`;
}

function fillBranchOptions(refs: WireLayer1Refs, ref: string): void {
    const select = getSelectById("branch");
    select.replaceChildren(...refs.branches.map((name) => el("option", { value: name, text: name })));
    // The ref box wins when it names a branch — that is what the view on screen was built against; otherwise the branch the repo is actually checked out on.
    select.value = refs.branches.includes(ref) ? ref : refs.head;
}

function fillCommitOptions(commits: WireRefCommit[], ref: string): void {
    const select = getSelectById("commit");
    // The empty first option means "whatever the ref box already says" — a branch name, or nothing.
    select.replaceChildren(
        el("option", { value: "", text: "(branch head)" }),
        ...commits.map((commit) => el("option", { value: commit.hash, text: describeCommit(commit) })),
    );
    // Only select a hash the list actually holds: assigning an unmatched value blanks the select, which reads worse than "(branch head)".
    select.value = commits.some((commit) => commit.hash === ref) ? ref : "";
}

// Read #repo, ask the endpoint for its branches and head-window of commits, and reveal the pickers.  Any refusal — empty box, a path that is not a repo, a bad ref — just removes `.repo-ok`, so the dropdowns silently do not appear (the mockup's behaviour). The crumb already carries the view route's own errors; a second error surface here would double-report the same bad path.
export async function confirmRepoAndFillRefs(): Promise<void> {
    const row = getRepoRow();
    const repo = getInputById("repo").value.trim();
    if (repo === "") {
        row.classList.remove("repo-ok");
        return;
    }
    const ref = getInputById("ref").value.trim();
    const response = await fetch(`/api/layer1-refs?${new URLSearchParams({ repo, ref })}`);
    if (!response.ok) {
        row.classList.remove("repo-ok");
        return;
    }
    const refs = await response.json() as WireLayer1Refs;
    fillBranchOptions(refs, ref);
    fillCommitOptions(refs.commits, ref);
    row.classList.add("repo-ok");
}

// `afterBranchPick` is passed in rather than imported, matching wireFolderPickers: its only caller is layer1-page.ts's boot, and reaching back for loadLayer1View would make the modules circular.
export function wireRefPickers(afterBranchPick: () => void): void {
    getSelectById("branch").addEventListener("change", (event) => {
        getInputById("ref").value = (event.currentTarget as HTMLSelectElement).value;
        // The user's decision: picking a branch reloads the whole view. The reload re-runs confirmRepoAndFillRefs, so the commit list becomes that branch's with "(branch head)" on.
        afterBranchPick();
    });
    getSelectById("commit").addEventListener("change", (event) => {
        // Writes the hash and stops. No reload: a commit pick is a ~10 s rebuild, and a select fires `change` on every keyboard arrow-through — the user presses Load when they have landed.
        getInputById("ref").value = (event.currentTarget as HTMLSelectElement).value;
    });
    // `change`, not `input`: one fetch per finished edit rather than one per keystroke.
    getInputById("repo").addEventListener("change", () => {
        void confirmRepoAndFillRefs();
    });
}
