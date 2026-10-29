// Task 286: branch and commit dropdowns that write into #ref; shown only once /api/layer1-refs confirms a repo.

import { createElement, getInputById, getRequiredElementById } from "./app-dom.ts";
import type { Layer1RefsView, RepoCommitRow } from "./layer1-wire.ts";

// 75 characters of subject, the number the user specified; #commit is sized in `ch` to match.
const SUBJECT_WIDTH = 75;

// The row the `.repo-ok` class gates the pickers on; absence throws so markup drift fails loudly.
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

// Mockup line 1207's expression: short hash, padded subject, date, so monospace columns line up.
function formatCommit(commit: RepoCommitRow): string {
  const subject = commit.subject.padEnd(SUBJECT_WIDTH).slice(0, SUBJECT_WIDTH);
  return `${commit.hash.slice(0, 8)}  ${subject}  ${commit.date}`;
}

function createBranchOption(name: string): HTMLElement {
  return createElement("option", { value: name, text: name });
}

function createCommitOption(commit: RepoCommitRow): HTMLElement {
  return createElement("option", { value: commit.hash, text: formatCommit(commit) });
}

function fillBranchOptions(refs: Layer1RefsView, ref: string): void {
  const select = getSelectById("branch");
  const options: HTMLElement[] = [];
  for (const name of refs.branches) {
    options.push(createBranchOption(name));
  }
  select.replaceChildren(...options);
  // The ref box wins when it names a branch; otherwise use the checked-out branch.
  select.value = refs.branches.includes(ref) ? ref : refs.head;
}

function fillCommitOptions(commits: RepoCommitRow[], ref: string): void {
  const select = getSelectById("commit");
  const options: HTMLElement[] = [];
  for (const commit of commits) {
    options.push(createCommitOption(commit));
  }
  // The empty first option means "whatever the ref box already says": a branch name, or nothing.
  select.replaceChildren(createElement("option", { value: "", text: "(branch head)" }), ...options);
  // Select only a listed hash: an unmatched value blanks the select, worse than "(branch head)".
  let selectedHash = "";
  for (const commit of commits) {
    if (commit.hash === ref) {
      selectedHash = ref;
    }
  }
  select.value = selectedHash;
}

function getNoResponse(): undefined {
  return undefined;
}

function copyPickedValueToRef(event: Event): void {
  getInputById("ref").value = (event.currentTarget as HTMLSelectElement).value;
}

// Fill the pickers from /api/layer1-refs; ANY refusal just removes `.repo-ok` so the dropdowns stay hidden.
export async function fillRefsFromRepo(): Promise<void> {
  const row = getRepoRow();
  const repo = getInputById("repo").value.trim();
  if (repo === "") {
    row.classList.remove("repo-ok");
    return;
  }
  const ref = getInputById("ref").value.trim();
  // A dead server must read as "repo not confirmed", never an unhandled rejection (boot voids this call).
  const response = await fetch(`/api/layer1-refs?${new URLSearchParams({ repo, ref })}`).catch(getNoResponse);
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

// `afterBranchPick` is passed in, not imported: importing loadLayer1View would make the modules circular.
export function registerRefPickers(afterBranchPick: () => void): void {
  function copyBranchToRefAndReload(event: Event): void {
    copyPickedValueToRef(event);
    // Picking a branch reloads the view; the reload re-runs fillRefsFromRepo for that branch.
    afterBranchPick();
  }
  function fillRefsAfterRepoEdit(): void {
    void fillRefsFromRepo();
  }
  getSelectById("branch").addEventListener("change", copyBranchToRefAndReload);
  // No reload on a commit pick: it is a slow rebuild and `change` fires on every arrow key.
  getSelectById("commit").addEventListener("change", copyPickedValueToRef);
  // `change`, not `input`: one fetch per finished edit rather than one per keystroke.
  getInputById("repo").addEventListener("change", fillRefsAfterRepoEdit);
}
