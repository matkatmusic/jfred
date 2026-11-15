const rulerRedrawListeners: (() => void)[] = [];

// Adds a listener; listeners run in registration order after every redraw of the real ruler.
export function registerRulerRedrawListener(listener: () => void): void {
    rulerRedrawListeners.push(listener);
}

export function notifyRulerRedrawn(): void {
    for (const listener of rulerRedrawListeners) {
        listener();
    }
}
