export type ReconnectWatchdog = {
  schedule: () => void;
  cancel: () => void;
  dispose: () => void;
};

/**
 * A one-timer watchdog for cases Socket.IO cannot recover by itself.
 *
 * Ordinary transport errors stay with Socket.IO's own backoff. The room hook
 * schedules this watchdog only for a server-forced disconnect or after the
 * built-in attempts are exhausted, and cancels it on a successful reconnect.
 */
export function createReconnectWatchdog(onTimeout: () => void, delayMs: number): ReconnectWatchdog {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;

  const cancel = () => {
    if (timer === null) return;
    clearTimeout(timer);
    timer = null;
  };

  return {
    schedule() {
      if (disposed || timer !== null) return;
      timer = setTimeout(() => {
        timer = null;
        if (!disposed) onTimeout();
      }, delayMs);
    },
    cancel,
    dispose() {
      disposed = true;
      cancel();
    },
  };
}
