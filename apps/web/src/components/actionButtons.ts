import type { CommandEnvelope, Tile, TileKind } from "@huanghuang/protocol";

export type PrimaryGameAction = Extract<
  CommandEnvelope["type"],
  | "DISCARD_TILE"
  | "RELEASE_WILDCARD"
  | "CLAIM_PONG"
  | "CLAIM_INDICATOR_PONG_KONG"
  | "CLAIM_EXPOSED_KONG"
  | "DECLARE_CONCEALED_KONG"
  | "DECLARE_ADDED_KONG"
  | "DECLARE_WIN"
>;

export type ActionButtonKind = "discard" | "wildcard" | "pong" | "kong" | "added-kong" | "win";

export type ActionButtonModel = {
  kind: ActionButtonKind;
  action: PrimaryGameAction;
  label: "出牌" | "放赖" | "碰" | "杠" | "补杠" | "自摸";
  detail: string;
};

const PRIMARY_ACTIONS = new Set<CommandEnvelope["type"]>([
  "DISCARD_TILE",
  "RELEASE_WILDCARD",
  "CLAIM_PONG",
  "CLAIM_INDICATOR_PONG_KONG",
  "CLAIM_EXPOSED_KONG",
  "DECLARE_CONCEALED_KONG",
  "DECLARE_ADDED_KONG",
  "DECLARE_WIN",
]);

export function isPrimaryGameAction(action: CommandEnvelope["type"]): boolean {
  return PRIMARY_ACTIONS.has(action);
}

export function isWildcardTile(tile: Tile | null, wildcardKind: TileKind | null): boolean {
  return (
    tile !== null &&
    wildcardKind !== null &&
    tile.suit === wildcardKind.suit &&
    tile.rank === wildcardKind.rank
  );
}

export function hasValidTileSelection(
  action: PrimaryGameAction,
  selectedTile: Tile | null,
  wildcardKind: TileKind | null,
): boolean {
  if (action === "DISCARD_TILE") {
    return selectedTile !== null && !isWildcardTile(selectedTile, wildcardKind);
  }
  if (action === "RELEASE_WILDCARD") {
    return isWildcardTile(selectedTile, wildcardKind);
  }
  return true;
}

export function primaryActionButtons(legalActions: readonly string[]): ActionButtonModel[] {
  const legal = new Set(legalActions);
  const buttons: ActionButtonModel[] = [];

  if (legal.has("DISCARD_TILE")) {
    buttons.push({ kind: "discard", action: "DISCARD_TILE", label: "出牌", detail: "选择手牌" });
  }
  if (legal.has("RELEASE_WILDCARD")) {
    buttons.push({
      kind: "wildcard",
      action: "RELEASE_WILDCARD",
      label: "放赖",
      detail: "倍率翻倍",
    });
  }

  if (legal.has("CLAIM_PONG")) {
    buttons.push({ kind: "pong", action: "CLAIM_PONG", label: "碰", detail: "碰牌" });
  } else if (legal.has("CLAIM_INDICATOR_PONG_KONG")) {
    buttons.push({
      kind: "pong",
      action: "CLAIM_INDICATOR_PONG_KONG",
      label: "碰",
      detail: "亮牌碰杠",
    });
  }

  if (legal.has("CLAIM_EXPOSED_KONG")) {
    buttons.push({ kind: "kong", action: "CLAIM_EXPOSED_KONG", label: "杠", detail: "明杠" });
  } else if (legal.has("DECLARE_CONCEALED_KONG")) {
    buttons.push({
      kind: "kong",
      action: "DECLARE_CONCEALED_KONG",
      label: "杠",
      detail: "暗杠",
    });
  }

  if (legal.has("DECLARE_ADDED_KONG")) {
    buttons.push({
      kind: "added-kong",
      action: "DECLARE_ADDED_KONG",
      label: "补杠",
      detail: "碰后补杠",
    });
  }
  if (legal.has("DECLARE_WIN")) {
    buttons.push({ kind: "win", action: "DECLARE_WIN", label: "自摸", detail: "本局获胜" });
  }

  return buttons;
}
