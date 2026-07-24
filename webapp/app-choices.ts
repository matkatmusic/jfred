// ─── script-execution consent + pre-baseline choice (per-browser-SESSION memory only, by design) ──
// Split from app-fetch.ts (task 152, 250-line cap): the per-project sessionStorage answers and
// the server-boot-id sweep that forgets them. Document caching stays in app-fetch.ts.

const CONSENT_KEY_PREFIX = "consent:";
// task 56: the pre-baseline answer, stored per project exactly like the consent choice.
const BASELINE_KEY_PREFIX = "baseline:";
// task 194: the reconstruction-mode answer (full vs bounded-to-file), same pattern again.
const MODE_KEY_PREFIX = "mode:";
// Prefixes of per-project choices a server relaunch must forget (boot-id sweep below).
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

// task 152: forget the stored answer so the next document fetch sends no preBaseline param —
// which is what lets the server re-ask.
export function clearBaselineChoice(project: string): void {
    sessionStorage.removeItem(computeBaselineKey(project));
}

// task 194: the reconstruction-mode decision, made on its own view BEFORE any build starts:
// full = every file (today's behavior), bounded = reconstruct until `file`'s `nth`-revision
// end of agent turn (task-193 semantics, sent as boundFile/boundNth on the document request).
export type ModeChoice = { mode: "full" } | { mode: "bounded"; file: string; nth: number };

function computeModeKey(project: string): string {
    return `${MODE_KEY_PREFIX}${project}`;
}

export function storeModeChoice(project: string, choice: ModeChoice): void {
    sessionStorage.setItem(computeModeKey(project), JSON.stringify(choice));
}

// The stored choice, or null when not asked yet this session (which is what shows the view).
export function getModeChoice(project: string): ModeChoice | null {
    const stored = sessionStorage.getItem(computeModeKey(project));
    return stored === null ? null : JSON.parse(stored) as ModeChoice;
}

export function clearModeChoice(project: string): void {
    sessionStorage.removeItem(computeModeKey(project));
}

// The server stamps each process launch with a boot id (GET /api/config). Consent choices live in
// sessionStorage, which survives both a page reload AND a server restart — so after relaunching the
// server (e.g. to drop the sandbox memo) a reloaded page would silently reuse the old "Run"/"declined"
// choice and never re-prompt. When the boot id changes we know the server was relaunched and clear
// every remembered consent choice so the next load re-prompts. The boot id shares sessionStorage's
// per-tab lifetime, so a brand-new tab (empty storage) simply stores the current id with nothing to clear.
const SERVER_BOOT_ID_KEY = "serverBootId";

export function reconcileServerBootId(bootId: string): void {
    if (sessionStorage.getItem(SERVER_BOOT_ID_KEY) === bootId) {
        return;
    }
    for (let index = sessionStorage.length - 1; index >= 0; index--) {
        const key = sessionStorage.key(index);
        if (key !== null && CHOICE_KEY_PREFIXES.some((prefix) => key.startsWith(prefix))) {
            sessionStorage.removeItem(key);
        }
    }
    sessionStorage.setItem(SERVER_BOOT_ID_KEY, bootId);
}
