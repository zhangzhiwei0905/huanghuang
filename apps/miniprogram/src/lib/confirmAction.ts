import Taro from "@tarojs/taro";

export type DangerActionKind = "leave" | "dissolve";

type DangerActionCopy = {
  title: string;
  content: string;
  confirmText: string;
};

/* Leaving mid-round hands the seat to a bot (the game continues without the
   player), while leaving from the lobby just frees the seat — the copy keeps
   those two consequences distinct so nobody confirms the wrong mental model. */
function dangerActionCopy(kind: DangerActionKind, inProgress: boolean): DangerActionCopy {
  if (kind === "dissolve") {
    return {
      title: "解散房间",
      content: inProgress
        ? "对局进行中解散将立即结束本局，所有玩家被移出房间。确定解散？"
        : "解散后所有玩家将被移出房间。确定解散？",
      confirmText: "解散",
    };
  }
  return {
    title: "离开房间",
    content: inProgress ? "对局进行中离开将由机器人代打本局。确定离开？" : "确定离开房间？",
    confirmText: "离开",
  };
}

/**
 * Confirm a destructive room action before running it. The cancel branch is a
 * no-op (Android back button also lands there), so callers only supply the
 * confirm path.
 */
export async function confirmDangerAction(
  kind: DangerActionKind,
  options: { inProgress: boolean },
  onConfirm: () => void | Promise<void>,
): Promise<void> {
  const copy = dangerActionCopy(kind, options.inProgress);
  try {
    const result = await Taro.showModal({
      title: copy.title,
      content: copy.content,
      confirmText: copy.confirmText,
      confirmColor: "#d64541",
      cancelText: "再想想",
    });
    if (result.confirm) await onConfirm();
  } catch {
    // showModal itself failed (very old base library) — fail closed: no action.
  }
}
