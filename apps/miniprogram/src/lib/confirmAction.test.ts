import Taro from "@tarojs/taro";
import { afterEach, describe, expect, it, vi } from "vitest";
import { confirmDangerAction } from "./confirmAction";

vi.mock("@tarojs/taro", () => ({
  default: {
    showModal: vi.fn(),
  },
}));

const showModal = vi.mocked(Taro.showModal);

describe("confirmDangerAction", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("runs the action when the user confirms a dissolve", async () => {
    showModal.mockResolvedValue({ confirm: true, cancel: false, errMsg: "showModal:ok" });
    const onConfirm = vi.fn();

    await confirmDangerAction("dissolve", { inProgress: false }, onConfirm);

    expect(showModal).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "解散房间",
        confirmText: "解散",
        confirmColor: "#d64541",
      }),
    );
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("does nothing on cancel (including Android back button)", async () => {
    showModal.mockResolvedValue({ confirm: false, cancel: true, errMsg: "showModal:ok" });
    const onConfirm = vi.fn();

    await confirmDangerAction("leave", { inProgress: false }, onConfirm);

    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("uses bot-takeover copy when leaving mid-round", async () => {
    showModal.mockResolvedValue({ confirm: false, cancel: true, errMsg: "showModal:ok" });

    await confirmDangerAction("leave", { inProgress: true }, vi.fn());

    expect(showModal).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining("机器人代打") }),
    );
  });

  it("fails closed when showModal itself rejects", async () => {
    showModal.mockRejectedValue(new Error("showModal:fail"));
    const onConfirm = vi.fn();

    await confirmDangerAction("dissolve", { inProgress: true }, onConfirm);

    expect(onConfirm).not.toHaveBeenCalled();
  });
});
