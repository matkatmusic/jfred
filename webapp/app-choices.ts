// Per-project script-consent, pre-baseline and mode answers (sessionStorage only), plus the boot-id sweep that forgets them.

const CONSENT_KEY_PREFIX = "consent:";
const BASELINE_KEY_PREFIX = "baseline:";
const MODE_KEY_PREFIX = "mode:";
// Prefixes of per-project choices a server relaunch must forget.
const CHOICE_KEY_PREFIXES = [CONSENT_KEY_PREFIX, BASELINE_KEY_PREFIX, MODE_KEY_PREFIX];

export function computeConsentKey(project: string): string {
  return `${CONSENT_KEY_PREFIX}${project}`;
}

export function storeConsentChoice(project: string, choice: string): void {
  sessionStorage.setItem(computeConsentKey(project), choice);
}

// "1" (run), "0" (declined), or null (not asked yet this session).
export function getConsentChoice(project: string): string | null {
  return sessionStorage.getItem(computeConsentKey(project));
}

function computeBaselineKey(project: string): string {
  return `${BASELINE_KEY_PREFIX}${project}`;
}

export function storeBaselineChoice(project: string, choice: string): void {
  sessionStorage.setItem(computeBaselineKey(project), choice);
}

// "1" (reconstruct pre-baseline), "0" (start at the baseline commit), or null (not asked yet).
export function getBaselineChoice(project: string): string | null {
  return sessionStorage.getItem(computeBaselineKey(project));
}

// Forgetting the answer makes the next document fetch send no preBaseline param, so the server re-asks.
export function clearBaselineChoice(project: string): void {
  sessionStorage.removeItem(computeBaselineKey(project));
}

// Reconstruction mode, chosen before any build: full, or bounded to `file`'s `nth` revision.
export type ModeChoice = { mode: "full" } | { mode: "bounded"; file: string; nth: number };

function computeModeKey(project: string): string {
  return `${MODE_KEY_PREFIX}${project}`;
}

export function storeModeChoice(project: string, choice: ModeChoice): void {
  sessionStorage.setItem(computeModeKey(project), JSON.stringify(choice));
}

// The stored choice, or null when not asked yet this session.
export function getModeChoice(project: string): ModeChoice | null {
  const stored = sessionStorage.getItem(computeModeKey(project));
  return stored === null ? null : JSON.parse(stored) as ModeChoice;
}

export function clearModeChoice(project: string): void {
  sessionStorage.removeItem(computeModeKey(project));
}

// sessionStorage survives a server restart, so a new boot id (GET /api/config) clears the remembered choices.
const SERVER_BOOT_ID_KEY = "serverBootId";

function isChoiceKey(key: string): boolean {
  for (const prefix of CHOICE_KEY_PREFIXES) {
    const hasPrefix = key.startsWith(prefix);
    if (hasPrefix) {
      return true;
    }
  }
  return false;
}

export function clearChoicesOnNewBootId(bootId: string): void {
  const storedBootId = sessionStorage.getItem(SERVER_BOOT_ID_KEY);
  const isSameBoot = storedBootId === bootId;
  if (isSameBoot) {
    return;
  }
  for (let index = sessionStorage.length - 1; index >= 0; index--) {
    const key = sessionStorage.key(index);
    const isChoice = key !== null && isChoiceKey(key);
    if (isChoice) {
      sessionStorage.removeItem(key);
    }
  }
  sessionStorage.setItem(SERVER_BOOT_ID_KEY, bootId);
}
