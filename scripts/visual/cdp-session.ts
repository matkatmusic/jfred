// The CDP websocket: matches each reply from Chrome to the call that waits for it.

export interface PendingCall {
  resolve: (result: Record<string, unknown>) => void;
  reject: (error: Error) => void;
}

export interface CdpSession {
  send: (method: string, params?: Record<string, unknown>) => Promise<Record<string, unknown>>;
  socket: WebSocket;
}

export function receiveCdpMessage(pending: Map<number, PendingCall>, rawData: string): void {
  const message = JSON.parse(rawData) as {
    id?: number; result?: Record<string, unknown>; error?: { message: string };
  };
  if (message.id === undefined) {
    return;
  }
  const call = pending.get(message.id);
  if (call === undefined) {
    return;
  }
  pending.delete(message.id);
  if (message.error !== undefined) {
    call.reject(new Error(message.error.message));
    return;
  }
  call.resolve(message.result ?? {});
}

export async function openCdpSession(socketUrl: string): Promise<CdpSession> {
  const socket = new WebSocket(socketUrl);
  const pending = new Map<number, PendingCall>();
  let nextCallId = 0;
  await new Promise<Event>((resolve) => socket.addEventListener("open", resolve, { once: true }));
  function receiveMessage(event: MessageEvent): void {
    receiveCdpMessage(pending, String(event.data));
  }
  socket.addEventListener("message", receiveMessage);

  function send(method: string, params: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    const id = ++nextCallId;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params }));
    });
  }

  return { send, socket };
}
