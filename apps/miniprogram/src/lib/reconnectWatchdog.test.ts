import { afterEach, describe, expect, it, vi } from "vitest";
import { createReconnectWatchdog } from "./reconnectWatchdog.js";

afterEach(() => {
  vi.useRealTimers();
});

describe("createReconnectWatchdog", () => {
  it("coalesces repeated schedules into one hard reconnect", () => {
    vi.useFakeTimers();
    const onTimeout = vi.fn();
    const watchdog = createReconnectWatchdog(onTimeout, 2_000);

    watchdog.schedule();
    watchdog.schedule();
    vi.advanceTimersByTime(2_000);

    expect(onTimeout).toHaveBeenCalledTimes(1);
  });

  it("cancels a pending hard reconnect when the socket reconnects", () => {
    vi.useFakeTimers();
    const onTimeout = vi.fn();
    const watchdog = createReconnectWatchdog(onTimeout, 2_000);

    watchdog.schedule();
    watchdog.cancel();
    vi.advanceTimersByTime(2_000);

    expect(onTimeout).not.toHaveBeenCalled();
  });

  it("does not fire or reschedule after disposal", () => {
    vi.useFakeTimers();
    const onTimeout = vi.fn();
    const watchdog = createReconnectWatchdog(onTimeout, 2_000);

    watchdog.schedule();
    watchdog.dispose();
    watchdog.schedule();
    vi.advanceTimersByTime(2_000);

    expect(onTimeout).not.toHaveBeenCalled();
  });
});
