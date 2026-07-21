// ─── script-execution consent + pre-baseline choice (per-browser-SESSION memory only, by design) ──
// Split from app-fetch.ts (task 152, 250-line cap): the per-project sessionStorage answers and
// the server-boot-id sweep that forgets them. Document caching stays in app-fetch.ts.

const CONSENT_KEY_PREFIX = "consent:";
// task 56: the pre-baseline answer, stored per project exactly like the consent choice.
const BASELINE_KEY_PREFIX = "baseline:";
// Prefixes of per-project choices a server relaunch must forget (boot-id sweep below).
const CHOICE_KEY_PREFIXES = [CONSENT_KEY_PREFIX, BASELINE_KEY_PREFIX];

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
