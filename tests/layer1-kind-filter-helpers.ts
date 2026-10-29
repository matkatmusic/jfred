// Task 360: shared fixtures and helpers for the kind-filter tests.

const INSTANT = { instant: "2026-06-02T09:00:00.000Z", axisPx: 30 };
const COMMIT = { ...INSTANT, hash: "b7c8d9e0f1a23445566778899aabbccddeeff001" };
const SNAPSHOT = { ...INSTANT, version: 1, sessionId: "s-1", sessionFile: "alpha.jsonl" };
const PAIR = { path: "src/run.ts", commits: [COMMIT], onDisk: INSTANT, snapshots: [SNAPSHOT] };
export const VIEW = { pairs: [PAIR], gitOrphans: [], diskOrphans: [], ruler: [] } as never;

// A view object nobody has loaded edits into yet; edits are remembered per view object.
export function buildFreshView(): never {
  return { pairs: [], gitOrphans: [], diskOrphans: [], ruler: [] } as never;
}

export function installSettingsRoute(savedFile: unknown): { posted: () => unknown[] } {
  const posted: unknown[] = [];
  const sendReply = async (_url: unknown, init?: { method?: string; body?: string }): Promise<Response> => {
    if (init?.method === "POST") {
      posted.push(JSON.parse(init.body ?? "{}"));
    }
    return { ok: true, status: 200, json: async () => savedFile, text: async () => "" } as unknown as Response;
  };
  Object.assign(globalThis, { fetch: sendReply });
  return { posted: () => posted };
}

export function toggleBox(kind: string, checked: boolean): void {
  const box = document.querySelector<HTMLInputElement>(`#show-row [data-kind=${kind}]`)!;
  box.checked = checked;
  box.dispatchEvent(new window.Event("change", { bubbles: true }));
}

export function readHiddenKinds(): string {
  return document.querySelector(".viz-root")!.getAttribute("data-hidden-kinds")!;
}
