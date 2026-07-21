const ERROR_LABELS: Record<string, string> = {
  ACTION_NOT_AVAILABLE: "当前不能执行这个操作",
  CANNOT_WIN: "当前牌型不能胡",
  INVALID_COMMAND: "操作格式无效",
  INVALID_INPUT: "输入内容无效",
  NOT_A_MEMBER: "你不在这个牌局中",
  NOT_CURRENT_PLAYER: "还没轮到你",
  OWNER_ONLY: "只有房主可以执行这个操作",
  ROOM_NOT_FOUND: "房间不存在或已经解散",
  ROOM_FULL: "房间已经坐满了",
  ROOM_NOT_JOINABLE: "当前房间不能加入，请等待本局结束",
  UNAUTHENTICATED: "匿名会话已失效，请重新进入",
  VERSION_CONFLICT: "牌局刚刚发生变化，已为你同步",
  WALL_EMPTY: "牌墙已空",
  WILDCARD_CANNOT_BE_DISCARDED: "赖子只能放赖，不能直接打出",
  WRONG_PHASE: "当前阶段不能执行这个操作",
};

export function errorLabel(code: string): string {
  return ERROR_LABELS[code] ?? "操作没有成功，请再试一次";
}
