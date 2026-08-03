/**
 * 排位保护卡生效倒计时文案 'HH:MM:SS'；目标时间已过或无效时返回 null。
 * Target-timestamp driven (like remainingSecondsUntilTarget) instead of a
 * decrementing counter, so the countdown recovers correctly after the app
 * is backgrounded and resumed mid-count.
 */
export function rankProtectionCountdownText(
  activeUntil: string,
  now: number,
): string | null {
  const remainingMs = Date.parse(activeUntil) - now;
  if (!Number.isFinite(remainingMs) || remainingMs <= 0) return null;
  const totalSeconds = Math.ceil(remainingMs / 1_000);
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}
