import { describe, expect, it } from "vitest";
import {
  AvatarUploadError,
  decodeAvatarData,
  MAX_AVATAR_BASE64_LENGTH,
  MAX_AVATAR_BYTES,
} from "./avatar-upload.js";

function expectAvatarError(input: unknown, code: AvatarUploadError["code"]): void {
  try {
    decodeAvatarData(input);
    throw new Error("Expected avatar decoding to fail");
  } catch (cause) {
    expect(cause).toBeInstanceOf(AvatarUploadError);
    expect((cause as AvatarUploadError).code).toBe(code);
  }
}

describe("decodeAvatarData", () => {
  it("accepts PNG data by file signature", () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
    const decoded = decodeAvatarData(png.toString("base64"));
    expect(decoded.extension).toBe("png");
    expect(decoded.bytes).toEqual(png);
  });

  it("accepts JPEG data by file signature", () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00]);
    const decoded = decodeAvatarData(jpeg.toString("base64"));
    expect(decoded.extension).toBe("jpg");
    expect(decoded.bytes).toEqual(jpeg);
  });

  it.each([undefined, null, "", "not base64!", "YWJjZA==extra"])(
    "rejects malformed input: %s",
    (input) => {
      expectAvatarError(input, "INVALID_AVATAR");
    },
  );

  it("rejects valid base64 whose decoded bytes are not an image", () => {
    expectAvatarError(Buffer.from("plain text").toString("base64"), "INVALID_AVATAR");
  });

  it("rejects encoded payloads beyond the hard limit before decoding", () => {
    expect(MAX_AVATAR_BASE64_LENGTH).toBeGreaterThan(MAX_AVATAR_BYTES);
    expectAvatarError("A".repeat(MAX_AVATAR_BASE64_LENGTH + 4), "AVATAR_TOO_LARGE");
  });
});
