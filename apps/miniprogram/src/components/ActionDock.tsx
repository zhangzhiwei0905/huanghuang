import { Image, Text, View } from "@tarojs/components";
import type { ActionButtonModel } from "../lib/actionButtons";
import { ACTION_BUTTON_IMAGES, actionButtonKind } from "../lib/actionButtonImages";
import "./ActionDock.scss";

type ActionDockProps = {
  buttons: ActionButtonModel[];
  disabled?: boolean;
  onAction: (button: ActionButtonModel) => void;
};

export function ActionDock({ buttons, disabled = false, onAction }: ActionDockProps) {
  if (buttons.length === 0) return null;

  return (
    <View className="action-dock">
      {buttons.map((button) => {
        const kind = actionButtonKind(button);
        return (
          <View
            key={button.action}
            className={`action-dock__btn${disabled ? " is-disabled" : ""}`}
            hoverClass={disabled ? "" : "is-pressed"}
            onClick={() => {
              if (!disabled) onAction(button);
            }}
          >
            <Image
              className="action-dock__img"
              src={ACTION_BUTTON_IMAGES[kind]}
              mode="aspectFill"
            />
            <Text className="action-dock__label">{button.label}</Text>
          </View>
        );
      })}
    </View>
  );
}
