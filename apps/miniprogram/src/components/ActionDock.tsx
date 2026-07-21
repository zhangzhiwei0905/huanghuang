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
  if (buttons.length === 0) {
    return (
      <View className="action-dock action-dock--empty">
        <Text className="action-dock__hint">等待可执行操作</Text>
      </View>
    );
  }

  return (
    <View className="action-dock">
      {buttons.map((button) => {
        const kind = actionButtonKind(button);
        return (
          <View
            key={button.action}
            className={`action-dock__btn${disabled ? " is-disabled" : ""}`}
            onClick={() => {
              if (!disabled) onAction(button);
            }}
          >
            <Image className="action-dock__img" src={ACTION_BUTTON_IMAGES[kind]} mode="aspectFit" />
            <Text className="action-dock__label">{button.label}</Text>
          </View>
        );
      })}
    </View>
  );
}
