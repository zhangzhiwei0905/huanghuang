import discardImage from "../assets/buttons/discard.png";
import wildcardImage from "../assets/buttons/wildcard.png";
import pongImage from "../assets/buttons/pong.png";
import kongImage from "../assets/buttons/kong.png";
import addedKongImage from "../assets/buttons/added-kong.png";
import winImage from "../assets/buttons/win.png";
import passImage from "../assets/buttons/pass.png";
import type { ActionButtonModel } from "../lib/actionButtons";

export type ActionButtonKind =
  "discard" | "wildcard" | "pong" | "kong" | "added-kong" | "win" | "pass";

export const ACTION_BUTTON_IMAGES: Record<ActionButtonKind, string> = {
  discard: discardImage,
  wildcard: wildcardImage,
  pong: pongImage,
  kong: kongImage,
  "added-kong": addedKongImage,
  win: winImage,
  pass: passImage,
};

export function actionButtonKind(model: ActionButtonModel): ActionButtonKind {
  switch (model.action) {
    case "DISCARD_TILE":
      return "discard";
    case "RELEASE_WILDCARD":
      return "wildcard";
    case "CLAIM_PONG":
    case "CLAIM_INDICATOR_PONG_KONG":
      return "pong";
    case "CLAIM_EXPOSED_KONG":
    case "DECLARE_CONCEALED_KONG":
      return "kong";
    case "DECLARE_ADDED_KONG":
      return "added-kong";
    case "DECLARE_WIN":
      return "win";
    case "PASS_RESPONSE":
      return "pass";
  }
}
