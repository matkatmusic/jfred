// Task 361 step 6c: pure judges and page expressions of the Layer 9 real-page checks.

import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import type { EntryFacts } from "./layer9-probes.ts";
import type { JfredCommitFacts, RealRepo, RepoState } from "./layer9-real-repo.ts";

export interface YesNoFacts { rows: number; text: string }
export interface ArmFacts { boxes: number; unchecked: number; editDots: number }

export const WRITE_FLAG = "--allow-jfred-writes";
export const SCREENSHOT_NAMES = { armed: "21-layer9-real-armed", committed: "22-layer9-real-committed" } as const;
export const MIN_SCREENSHOT_BYTES = 10 * 1024;
export const FAKE_HASH_PREFIX = "c0ffee";
export const BASE_NEEDS_COMMIT_TEXT = "the base must be a commit";

export const STAGE_READY = `document.querySelectorAll('#stage .filebox').length > 0`;
// Armed: mode on, strip drawn, busy shield closed, edit dots loaded.
export const ARMED_STATE = `document.getElementById('commit-mode').classList.contains('current') && document.getElementById('jfred-strip') !== null
    && document.getElementById('busy-shield').hidden && document.querySelectorAll('#stage .n-edit').length > 0`;
export const ARM_FACTS = `(boxes => ({ boxes: boxes.length, unchecked: boxes.filter(b => !b.checked).length, editDots: document.querySelectorAll('#stage .n-edit').length }))
    ([...document.querySelectorAll('#show-row input[data-kind]')])`;
export const COMMIT_BUTTON_CLICK = `document.getElementById('jfred-commit-button').click()`;
export const COMMIT_SETTLED = `document.getElementById('jfred-commit-button') === null || document.getElementById('yesno-row') !== null`;
export const TOAST_SHOWN = `!document.getElementById('dtoast').hidden && document.getElementById('dtoast').textContent.trim() !== ''`;
export const READ_TOAST_TEXT = `document.getElementById('dtoast').textContent`;
export const YESNO_FACTS = `({ rows: document.querySelectorAll('#yesno-row').length, text: document.getElementById('yesno-row')?.textContent ?? '' })`;
// export const PENDING_TICK_TIME = `(document.querySelector('#ruler .tick.cut-pending')?.dataset.fullTime ?? '')`;
export const PENDING_TICK_TIME = `(document.querySelector('#ruler .tick.cut-pending')?.textContent ?? '')`;
export const STRIP_ENTRY_COUNT = `document.querySelectorAll('#jfred-strip .jnode[data-entry-kind]').length`;
export const BRANCH_OPTIONS = `[...document.querySelectorAll('#branch option')].map(o => o.value)`;
export const LOADING_IDLE = `document.getElementById('loadbar').hasAttribute('hidden') && document.getElementById('busy-shield').hidden`;
// Every label the loading bar shows is kept; an observer sees labels that a 50 ms poll would miss.
export const WATCH_LABELS = `(() => {
    window.__labels = new Set();
    const label = document.getElementById('loadbar-label');
    new MutationObserver(() => { if (label.textContent !== '') window.__labels.add(label.textContent); })
        .observe(label, { childList: true, characterData: true, subtree: true });
})()`;
export const READ_LABELS = `[...window.__labels]`;

export function buildPageQuery(repo: RealRepo): string {
  const params = new URLSearchParams({ dir: repo.repoDir, repo: repo.repoDir });
  params.append("jsonl", repo.transcriptDir);
  return params.toString();
}

// A file older than this run is a leftover, not a screenshot of this run.
export function isScreenshotLargeEnough(name: string, runStartedMs: number): boolean {
  const file = join(import.meta.dirname, "out", `mockup-${name}.png`);
  const isPresent = existsSync(file);
  return isPresent && statSync(file).size > MIN_SCREENSHOT_BYTES && statSync(file).mtimeMs >= runStartedMs;
}

export function isAuthorDateAtMark(authorDate: Date, markInstant: Date): boolean {
  const markSecond = Math.floor(markInstant.getTime() / 1000);
  return Math.floor(authorDate.getTime() / 1000) === markSecond;
}

// Git dates have second precision, so both ends are cut to whole seconds.
export function isCommitterDateBetween(committerDate: Date, startedAt: Date, endedAt: Date): boolean {
  const second = Math.floor(committerDate.getTime() / 1000);
  const isAfterStart = second >= Math.floor(startedAt.getTime() / 1000);
  const isBeforeEnd = second <= Math.floor(endedAt.getTime() / 1000);
  return isAfterStart && isBeforeEnd;
}

export function isSameRepoState(before: RepoState, after: RepoState): boolean {
  return before.head === after.head && before.branch === after.branch && before.status === after.status && before.fileText === after.fileText;
}

export function isSameItems(first: string[], second: string[]): boolean {
  return JSON.stringify([...first].sort()) === JSON.stringify([...second].sort());
}

export function isTwoDistinctLabels(labels: string[]): boolean {
  return new Set(labels).size >= 2;
}

export function listEntryShortHashes(entries: EntryFacts[]): string[] {
  const shortHashes: string[] = [];
  for (const entry of entries) {
    if (entry.shortHash !== null) {
      shortHashes.push(entry.shortHash);
    }
  }
  return shortHashes;
}

export function isRealEntryHash(entries: EntryFacts[], realShortHash: string): boolean {
  const shortHashes = listEntryShortHashes(entries);
  let hasFakeHash = false;
  for (const shortHash of shortHashes) {
    hasFakeHash = hasFakeHash || shortHash.startsWith(FAKE_HASH_PREFIX);
  }
  return shortHashes.includes(realShortHash) && !hasFakeHash;
}

export function isYesNoNaming(facts: YesNoFacts, instantPrefix: string): boolean {
  return facts.rows === 1 && facts.text.includes(instantPrefix);
}

export function listShortHashes(hashes: string[], length: number): string[] {
  const shortHashes: string[] = [];
  for (const hash of hashes) {
    shortHashes.push(hash.slice(0, length));
  }
  return shortHashes;
}

export function isChainedCommit(facts: JfredCommitFacts, parentHash: string | undefined, writeText: string): boolean {
  return facts.parentHash === parentHash && facts.fileText === writeText;
}

export function isEveryKindArmed(facts: ArmFacts): boolean {
  return facts.boxes > 0 && facts.unchecked === 0 && facts.editDots > 0;
}
