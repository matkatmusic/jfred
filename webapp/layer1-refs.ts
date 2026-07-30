// Task 286: the Layer 1 header's branch and commit dropdowns. They exist only once the repo box is confirmed to name a real git repo — GET /api/layer1-refs answering ok IS that confirmation, so no separate "is this a repo" endpoint exists. Both selects WRITE into the pre-existing #ref text box rather than replacing it: a raw hash must still be typeable, and #ref is the endpoint's param.

import { el, getInputById, getRequiredElementById } from "./app-dom.ts";
import type { Layer1RefsView, RepoCommitRow } from "./layer1-wire.ts";

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
function describeCommit(commit: RepoCommitRow): string {
    const subject = commit.subject.padEnd(SUBJECT_WIDTH).slice(0, SUBJECT_WIDTH);
    return `${commit.hash.slice(0, 8)}  ${subject}  ${commit.date}`;
}

function fillBranchOptions(refs: Layer1RefsView, ref: string): void {
    const select = getSelectById("branch");
    select.replaceChildren(...refs.branches.map((name) => el("option", { value: name, text: name })));
    // The ref box wins when it names a branch — that is what the view on screen was built against; otherwise the branch the repo is actually checked out on.
    select.value = refs.branches.includes(ref) ? ref : refs.head;
}

function fillCommitOptions(commits: RepoCommitRow[], ref: string): void {
    const select = getSelectById("commit");
    // The empty first option means "whatever the ref box already says" — a branch name, or nothing.
    select.replaceChildren(
        el("option", { value: "", text: "(branch head)" }),
        ...commits.map((commit) => el("option", { value: commit.hash, text: describeCommit(commit) })),
    );
    // Only select a hash the list actually holds: assigning an unmatched value blanks the select, which reads worse than "(branch head)".
    select.value = commits.some((commit) => commit.hash === ref) ? ref : "";
}

// Fill the pickers from /api/layer1-refs; ANY refusal just removes `.repo-ok` so the dropdowns stay hidden.
export async function confirmRepoAndFillRefs(): Promise<void> {
    const row = getRepoRow();
    const repo = getInputById("repo").value.trim();
    if (repo === "") {
        row.classList.remove("repo-ok");
        return;
    }
    const ref = getInputById("ref").value.trim();
    // A dead server must read as "repo not confirmed", never an unhandled rejection (boot voids this call).
    const response = await fetch(`/api/layer1-refs?${new URLSearchParams({ repo, ref })}`).catch(() => undefined);
    if (response === undefined) {
        row.classList.remove("repo-ok");
        return;
    }
    if (!response.ok) {
        row.classList.remove("repo-ok");
        return;
    }
    const refs = await response.json() as Layer1RefsView;
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
