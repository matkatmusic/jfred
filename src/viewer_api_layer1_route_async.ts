// Task 358 part P: async NDJSON sender; a client close aborts the step.

import { type ServerResponse } from "node:http";
import { DocumentResponseKind } from "./structures/vocabulary_views.ts";

export type WriteNdjsonLine = (value: unknown) => void;
// Its return value is the last line; undefined (cancelled) writes none.
export type NdjsonStep = (writeLine: WriteNdjsonLine, signal: AbortSignal) => Promise<unknown>;

function createLineWriter(response: ServerResponse): WriteNdjsonLine {
  return (value: unknown): void => {
    // // A line after the client left is dropped: output events still arrive while the container stops.
    // if (signal.aborted) {
    //   return;
    // }
    response.write(JSON.stringify(value) + "\n");
    if (response.writableCorked > 0) {
      response.uncork();
    }
    response.socket?.uncork();
  };
}

function stopStepOnClose(response: ServerResponse, controller: AbortController): void {
  function stopUnlessFinished(): void {
    if (!response.writableFinished) {
      controller.abort();
    }
  }
  response.on("close", stopUnlessFinished);
}

function formatLastLine(lastValue: unknown): string | undefined {
  return lastValue === undefined ? undefined : JSON.stringify(lastValue) + "\n";
}

export async function sendNdjsonAsync(response: ServerResponse, runStep: NdjsonStep): Promise<void> {
  response.writeHead(200, { "Content-Type": "application/x-ndjson; charset=utf-8" });
  response.socket?.setNoDelay(true);
  const controller = new AbortController();
  stopStepOnClose(response, controller);
  try {
    const lastValue = await runStep(createLineWriter(response), controller.signal);
    response.end(formatLastLine(lastValue));
  }
  catch (error) {
    response.end(JSON.stringify({ kind: DocumentResponseKind.error, label: (error as Error).message }) + "\n");
  }
}
