import { Text, View } from "@tarojs/components";
import "./RoundStartOverlay.scss";

export function RoundStartOverlay({
  eyebrow,
  title,
  countdown,
}: {
  eyebrow: string;
  title: string;
  countdown: number;
}) {
  return (
    <View className="round-start-overlay">
      <View className="round-start-overlay__halo" />
      <View className="round-start-overlay__content">
        <Text className="round-start-overlay__eyebrow">{eyebrow}</Text>
        <Text className="round-start-overlay__title">{title}</Text>
        <Text key={countdown} className="round-start-overlay__count">
          {countdown}
        </Text>
      </View>
    </View>
  );
}
