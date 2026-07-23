export const MAX_AVATAR_BYTES = 2 * 1024 * 1024;
export const MAX_AVATAR_BASE64_LENGTH = Math.ceil(MAX_AVATAR_BYTES / 3) * 4;

export type AvatarUploadErrorCode = "INVALID_AVATAR" | "AVATAR_TOO_LARGE";

export class AvatarUploadError extends Error {
  constructor(readonly code: AvatarUploadErrorCode) {
    super(code);
  }
}

export type DecodedAvatar = {
  bytes: Buffer;
  extension: "jpg" | "png";
};

function hasPngSignature(bytes: Buffer): boolean {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;
  return signature.every((value, index) => bytes[index] === value);
}

function hasJpegSignature(bytes: Buffer): boolean {
  return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

export function decodeAvatarData(input: unknown): DecodedAvatar {
  if (typeof input !== "string" || input.length === 0) {
    throw new AvatarUploadError("INVALID_AVATAR");
  }
  if (input.length > MAX_AVATAR_BASE64_LENGTH) {
    throw new AvatarUploadError("AVATAR_TOO_LARGE");
  }
  if (!/^[A-Za-z0-9+/]+={0,2}$/u.test(input) || input.length % 4 !== 0) {
    throw new AvatarUploadError("INVALID_AVATAR");
  }

  const bytes = Buffer.from(input, "base64");
  if (bytes.length === 0) throw new AvatarUploadError("INVALID_AVATAR");
  if (bytes.length > MAX_AVATAR_BYTES) {
    throw new AvatarUploadError("AVATAR_TOO_LARGE");
  }

  const canonicalInput = input.replace(/=+$/u, "");
  const canonicalDecoded = bytes.toString("base64").replace(/=+$/u, "");
  if (canonicalInput !== canonicalDecoded) {
    throw new AvatarUploadError("INVALID_AVATAR");
  }
  if (hasPngSignature(bytes)) return { bytes, extension: "png" };
  if (hasJpegSignature(bytes)) return { bytes, extension: "jpg" };
  throw new AvatarUploadError("INVALID_AVATAR");
}
