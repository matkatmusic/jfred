// Task 360: shared fixtures and helpers for the kind-filter tests.

import { buildNdjsonResponse } from "./webapp-fetch-test-helpers.ts";

const INSTANT = { instant: "2026-06-02T09:00:00.000Z", axisPx: 30 };
const COMMIT = { ...INSTANT, hash: "b7c8d9e0f1a23445566778899aabbccddeeff001" };
const SNAPSHOT = { ...INSTANT, version: 1, sessionId: "s-1", sessionFile: "alpha.jsonl" };
const PAIR = { path: "src/run.ts", commits: [COMMIT], onDisk: INSTANT, snapshots: [SNAPSHOT] };
// One ruler tick, because the Bars load that follows every render needs a ruler row.
export const VIEW = { pairs: [PAIR], gitOrphans: [], diskOrphans: [], ruler: [{ ...INSTANT, eventCount: 1 }] } as never;

// A view object nobody has loaded edits into yet; edits are remembered per view object.
export function buildFreshView(): never {
  return { pairs: [], gitOrphans: [], diskOrphans: [], ruler: [] } as never;
}

export function installSettingsRoute(savedFile: unknown): { posted: () => unknown[] } {
  const posted: unknown[] = [];
  const sendReply = async (url: unknown, init?: { method?: string; body?: string }): Promise<Response> => {
    if (String(url).includes("/api/layer1-inverse-repos")) {
      return buildNdjsonResponse([{ files: [] }]);
    }
    if (init?.method === "POST") {
      posted.push(JSON.parse(init.body ?? "{}"));
    }
    return { ok: true, status: 200, json: async () => savedFile, text: async () => "" } as unknown as Response;
  };
  Object.assign(globalThis, { fetch: sendReply });
  return { posted: () => posted };
}

export function toggleBox(kind: string, checked: boolean): void {
  const box = document.querySelector<HTMLInputElement>(`#timelineViewControls [data-kind=${kind}]`)!;
  box.checked = checked;
  box.dispatchEvent(new window.Event("change", { bubbles: true }));
}

export function readHiddenKinds(): string {
  return document.querySelector(".appWindow")!.getAttribute("data-hidden-kinds")!;
}
