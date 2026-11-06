import { closeBusyShield, openBusyShield, renderBusyShield } from "../popups/layer1-busy-shield.ts";
import { hideLayer1Progress, readLayer1ViewStream, renderLayer1Progress } from "../loading-bar/layer1-progress.ts";
import type { WireJfredCommitReply, WireJfredCommitRequest } from "./layer1-wire-jfred.ts";

function renderBothProgress(label: string, current?: number, total?: number): void {
  renderLayer1Progress(label, current, total);
  renderBusyShield(label, current, total);
}

export async function sendJfredCommit(request: WireJfredCommitRequest): Promise<WireJfredCommitReply | undefined> {
  openBusyShield("starting");
  renderLayer1Progress("starting");
  const reply = await readLayer1ViewStream<WireJfredCommitReply>(
    `/api/layer1-jfred-commit?${new URLSearchParams(location.search)}`,
    renderBothProgress,
    { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(request) },
  );
  hideLayer1Progress();
  closeBusyShield();
  return reply;
}

export async function sendJfredDelete(): Promise<void> {
  const response = await fetch(`/api/layer1-jfred-delete?${new URLSearchParams(location.search)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  if (!response.ok) {
    throw new Error(await response.text());
  }
}
