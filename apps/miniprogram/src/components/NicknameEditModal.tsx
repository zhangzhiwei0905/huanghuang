import { useState } from "react";
import { Button, Form, Input, Text, View } from "@tarojs/components";
import type { Identity } from "../api/session";
import { updateNickname } from "../api/session";
import "./NicknameEditModal.scss";

export type NicknameEditModalProps = {
  currentNickname: string;
  onDone: (identity: Identity) => void;
  onClose: () => void;
};

/**
 * Small modal for editing the logged-in player's own nickname. Reuses the
 * WeChat `type="nickname"` input so the keyboard offers the "使用微信昵称"
 * shortcut (same pattern as LoginGate). On save it calls updateNickname and
 * hands the refreshed identity back so the caller can update its store
 * without a follow-up resolveIdentity() round-trip.
 */
export function NicknameEditModal({ currentNickname, onDone, onClose }: NicknameEditModalProps) {
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: "status" | "error"; message: string } | null>(
    null,
  );

  async function submit(event: { detail: { value?: Record<string, unknown> } }) {
    const rawNickname = event.detail.value?.nickname;
    const nickname = typeof rawNickname === "string" ? rawNickname.trim() : "";
    if (nickname.length === 0) {
      setFeedback({ kind: "error", message: "请输入昵称（1-12 个字）" });
      return;
    }
    if (nickname === currentNickname.trim()) {
      setFeedback({ kind: "error", message: "新昵称与当前昵称相同" });
      return;
    }
    setBusy(true);
    setFeedback({ kind: "status", message: "正在保存…" });
    try {
      const identity = await updateNickname(nickname);
      onDone(identity);
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : "";
      setFeedback({
        kind: "error",
        message: `保存失败${detail.length > 0 ? `：${detail}` : ""}，请重试`,
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <View className="nickname-backdrop" onClick={onClose}>
      <View className="nickname-modal" catchMove onClick={(event) => event.stopPropagation()}>
        <View className="nickname-modal__head">
          <Text className="nickname-modal__title">修改昵称</Text>
          <View className="nickname-modal__close" hoverClass="is-pressed" onClick={onClose}>
            <Text className="nickname-modal__close-icon">×</Text>
          </View>
        </View>
        <Form className="nickname-modal__form" onSubmit={(event) => void submit(event)}>
          <Input
            className="nickname-modal__input"
            type="nickname"
            name="nickname"
            maxlength={12}
            value={currentNickname}
            placeholder="点击选择微信昵称"
            disabled={busy}
            adjustPosition
          />
          <Text className="nickname-modal__hint">
            点击输入框，在微信键盘中选择"使用微信昵称"，选中后仍可修改
          </Text>
          {feedback !== null ? (
            <Text
              className={`nickname-modal__feedback${feedback.kind === "error" ? " is-error" : ""}`}
            >
              {feedback.message}
            </Text>
          ) : null}
          <View className="nickname-modal__actions">
            <Button
              className="nickname-modal__action nickname-modal__action--ghost"
              hoverClass="is-pressed"
              disabled={busy}
              onClick={onClose}
            >
              取消
            </Button>
            <Button
              formType="submit"
              className="nickname-modal__action nickname-modal__action--primary"
              hoverClass="is-pressed"
              disabled={busy}
            >
              {busy ? "保存中…" : "保存"}
            </Button>
          </View>
        </Form>
      </View>
    </View>
  );
}
