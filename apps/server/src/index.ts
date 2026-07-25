import cookie from "@fastify/cookie";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import {
  chatMessageInputSchema,
  commandEnvelopeSchema,
  createRoomSchema,
  joinRoomSchema,
  readyRoomSchema,
  updateRoomSettingsSchema,
} from "@huanghuang/protocol";
import Fastify from "fastify";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createWriteStream, existsSync, mkdirSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { Server } from "socket.io";
import { AvatarUploadError, decodeAvatarData, MAX_AVATAR_BASE64_LENGTH } from "./avatar-upload.js";
import { GameDatabase } from "./database.js";
import { RoomService } from "./room-service.js";
import { SessionService, SESSION_TOKEN_HEADER } from "./session-service.js";

const app = Fastify({ logger: true });
await app.register(cookie);

// wx.request (WeChat mini-program) always sends `Content-Type: application/
// json` on every request, including bodyless DELETE calls (e.g. leave room)
// — client-side header overrides cannot suppress this, it's baked into the
// mp runtime. Fastify's built-in JSON parser rejects that combination
// (FST_ERR_CTP_EMPTY_JSON_BODY, HTTP 400) as a matter of policy. Override it
// to treat an empty body as `undefined` instead of an error; a body that IS
// present still goes through normal JSON.parse (and a genuinely malformed
// non-empty body still 400s, as before).
app.addContentTypeParser("application/json", { parseAs: "string" }, (_request, body, done) => {
  if (body === "") {
    done(null, undefined);
    return;
  }
  try {
    done(null, JSON.parse(body as string));
  } catch (cause) {
    done(cause as Error, undefined);
  }
});

const database = new GameDatabase(process.env.DATABASE_PATH ?? ":memory:");
const sessions = new SessionService(database);
const rooms = new RoomService(database);

// Avatars uploaded via chooseAvatar land next to the sqlite file so the
// existing `game_data` deploy volume already persists them — no new deploy
// topology needed. AVATAR_DIR overrides for tests/local setups that don't
// want files next to a real DATABASE_PATH.
const avatarDir =
  process.env.AVATAR_DIR ??
  resolve(dirname(process.env.DATABASE_PATH ?? "./data/huanghuang.sqlite"), "avatars");
mkdirSync(avatarDir, { recursive: true });
await app.register(multipart, { limits: { fileSize: 2 * 1024 * 1024 } });
// decorateReply:false — this app registers fastifyStatic a second time below
// for the web build's webRoot, and only one registration may decorate
// `reply.sendFile` or Fastify throws on the duplicate decoration. Neither
// handler here needs reply.sendFile (avatars are served by prefix routing
// alone), so it's safe for this one to skip the decoration.
await app.register(fastifyStatic, { root: avatarDir, prefix: "/avatars/", decorateReply: false });
const sockets = new Server(app.server, {
  cors: { origin: true, credentials: true },
  connectionStateRecovery: {
    maxDisconnectionDuration: 2 * 60 * 1000,
    skipMiddlewares: false,
  },
});

// Mini-program clients read X-Session-Token; browsers expose it only if allowed.
app.addHook("onRequest", async (_request, reply) => {
  reply.header(
    "Access-Control-Expose-Headers",
    `${SESSION_TOKEN_HEADER}, ${SESSION_TOKEN_HEADER.toUpperCase()}`,
  );
});

const webRoot = resolve(import.meta.dirname, "../../web/dist");
if (existsSync(webRoot)) {
  await app.register(fastifyStatic, { root: webRoot, wildcard: false });
  app.setNotFoundHandler((request, reply) => {
    if (request.raw.url?.startsWith("/api") === true) {
      return reply.code(404).send({ error: "NOT_FOUND" });
    }
    return reply.sendFile("index.html");
  });
}

app.get("/health/live", () => ({ status: "ok" }));
app.get("/health/ready", () => ({ status: "ready" }));

/** Issue or refresh an anonymous session without joining a room (mini-program entry). */
app.post("/api/session", (request, reply) => {
  const body = (request.body ?? {}) as { nickname?: unknown };
  const nickname =
    typeof body.nickname === "string" && body.nickname.trim().length > 0
      ? body.nickname.trim().slice(0, 12)
      : "玩家";
  if (sessions.resolve(request) !== null) {
    const ensured = sessions.ensure(request, reply, nickname);
    return {
      sessionId: ensured.session.id,
      nickname: ensured.session.nickname,
      sessionToken: ensured.rawToken,
    };
  }
  const issued = sessions.issue(nickname, reply);
  return {
    sessionId: issued.session.id,
    nickname: issued.session.nickname,
    sessionToken: issued.rawToken,
  };
});

app.get("/api/session", (request, reply) => {
  const session = sessions.resolve(request);
  if (session === null) return reply.code(401).send({ error: "UNAUTHENTICATED" });
  return {
    sessionId: session.id,
    nickname: session.nickname,
    avatarUrl: session.avatarUrl ?? null,
    // Distinguishes a real WeChat-linked account from a pre-existing plain
    // anonymous session (issued by the old nickname-only /api/session POST
    // flow, still valid and resolvable here) — the mini-program's login
    // gate must not treat the latter as "already logged in" or a device
    // that tested before this feature shipped skips the login screen
    // forever with its old nickname/no avatar.
    wechatLinked: session.wechatOpenId !== null && session.wechatOpenId !== undefined,
  };
});

/**
 * WeChat code exchange, enabled only when WECHAT_APP_ID + WECHAT_APP_SECRET are set.
 * The openid returned by jscode2session persistently identifies the player: a returning
 * openid updates its existing anonymous_sessions row (nickname/avatar/token refreshed)
 * instead of spawning a new session every login, so the client can recognize the same
 * player across app launches without re-prompting for identity each time.
 */
app.post("/api/auth/wechat", async (request, reply) => {
  const appId = process.env.WECHAT_APP_ID;
  const appSecret = process.env.WECHAT_APP_SECRET;
  if (
    appId === undefined ||
    appId.length === 0 ||
    appSecret === undefined ||
    appSecret.length === 0
  ) {
    return reply.code(501).send({ error: "WECHAT_AUTH_DISABLED" });
  }
  const body = (request.body ?? {}) as {
    code?: unknown;
    nickname?: unknown;
    avatarUrl?: unknown;
    resumeOnly?: unknown;
  };
  if (typeof body.code !== "string" || body.code.length === 0) {
    return reply.code(400).send({ error: "INVALID_INPUT" });
  }
  const nickname =
    typeof body.nickname === "string" && body.nickname.trim().length > 0
      ? body.nickname.trim().slice(0, 12)
      : "微信玩家";
  const avatarUrl =
    typeof body.avatarUrl === "string" && body.avatarUrl.length > 0 ? body.avatarUrl : null;
  const url = new URL("https://api.weixin.qq.com/sns/jscode2session");
  url.searchParams.set("appid", appId);
  url.searchParams.set("secret", appSecret);
  url.searchParams.set("js_code", body.code);
  url.searchParams.set("grant_type", "authorization_code");
  let openId: string;
  try {
    const response = await fetch(url);
    const payload = (await response.json()) as { openid?: string; errcode?: number };
    if (typeof payload.openid !== "string" || payload.openid.length === 0) {
      request.log.warn({ errcode: payload.errcode }, "wechat jscode2session failed");
      return await reply.code(401).send({ error: "WECHAT_AUTH_FAILED" });
    }
    openId = payload.openid;
  } catch (error) {
    request.log.error({ err: error }, "wechat jscode2session network error");
    return await reply.code(502).send({ error: "WECHAT_AUTH_UNAVAILABLE" });
  }
  const token = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const session =
    body.resumeOnly === true
      ? database.resumeWechatSession(openId, tokenHash)
      : database.upsertWechatSession({ openId, nickname, avatarUrl }, tokenHash);
  if (session === null) {
    return reply.code(404).send({ error: "WECHAT_PROFILE_REQUIRED" });
  }
  sessions.attachSessionTokenHeader(reply, token);
  return {
    sessionId: session.id,
    nickname: session.nickname,
    avatarUrl: session.avatarUrl ?? null,
    sessionToken: token,
  };
});

/**
 * chooseAvatar's callback only gives a local temp file path — this uploads
 * it to a durable, publicly-fetchable URL so other seats in a room can
 * actually load the image (a temp path on one player's device means
 * nothing to anyone else's client).
 */
app.post("/api/upload/avatar", async (request, reply) => {
  const file = await request.file();
  if (file === undefined) return reply.code(400).send({ error: "NO_FILE" });
  const ext = file.mimetype === "image/png" ? "png" : "jpg";
  const filename = `${randomUUID()}.${ext}`;
  await pipeline(file.file, createWriteStream(join(avatarDir, filename)));
  return { avatarUrl: `/avatars/${filename}` };
});

/**
 * Experience builds enforce uploadFile and request domain allowlists
 * separately. This JSON transport lets the mini-program send a small,
 * compressed avatar through its already-required request domain while the
 * multipart route above remains available for older clients.
 */
app.post(
  "/api/upload/avatar-data",
  { bodyLimit: MAX_AVATAR_BASE64_LENGTH + 64 },
  async (request, reply) => {
    try {
      const body = (request.body ?? {}) as { data?: unknown };
      const avatar = decodeAvatarData(body.data);
      const filename = `${randomUUID()}.${avatar.extension}`;
      await writeFile(join(avatarDir, filename), avatar.bytes);
      return { avatarUrl: `/avatars/${filename}` };
    } catch (cause) {
      if (cause instanceof AvatarUploadError) {
        const statusCode = cause.code === "AVATAR_TOO_LARGE" ? 413 : 400;
        return reply.code(statusCode).send({ error: cause.code });
      }
      request.log.error({ err: cause }, "avatar data upload failed");
      return reply.code(500).send({ error: "AVATAR_UPLOAD_FAILED" });
    }
  },
);

app.post("/api/rooms", (request, reply) => {
  const parsed = createRoomSchema.safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ error: "INVALID_INPUT" });
  const { session } = sessions.ensure(request, reply, parsed.data.nickname);
  const room = rooms.createRoom(
    session,
    parsed.data.baseScore,
    parsed.data.mode,
    parsed.data.turnTimeoutSeconds,
  );
  return reply.code(201).send(rooms.project(room, session.id));
});

app.post("/api/rooms/join", (request, reply) => {
  const parsed = joinRoomSchema.safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ error: "INVALID_INPUT" });
  const { session } = sessions.ensure(request, reply, parsed.data.nickname);
  const room = rooms.joinRoom(session, parsed.data.roomCode);
  if (room === null) return reply.code(404).send({ error: "ROOM_NOT_FOUND" });
  if (room === "ROOM_FULL") return reply.code(409).send({ error: "ROOM_FULL" });
  if (room === "ROOM_NOT_JOINABLE") {
    return reply.code(409).send({ error: "ROOM_NOT_JOINABLE" });
  }
  sockets.to(room.id).emit("room:update", { version: room.version });
  return rooms.project(room, session.id);
});

app.get<{ Params: { code: string } }>("/api/rooms/:code", (request, reply) => {
  const session = sessions.resolve(request);
  if (session === null) return reply.code(401).send({ error: "UNAUTHENTICATED" });
  const room = rooms.getRoom(request.params.code);
  if (room === null) return reply.code(404).send({ error: "ROOM_NOT_FOUND" });
  if (!rooms.hasMember(session.id, room.code)) {
    return reply.code(403).send({ error: "NOT_A_MEMBER" });
  }
  return rooms.project(room, session.id);
});

app.post<{ Params: { code: string } }>("/api/rooms/:code/ready", (request, reply) => {
  const session = sessions.resolve(request);
  if (session === null) return reply.code(401).send({ error: "UNAUTHENTICATED" });
  const parsed = readyRoomSchema.safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ error: "INVALID_INPUT" });
  const room = rooms.setReady(session.id, request.params.code, parsed.data.ready);
  if (room === null) return reply.code(404).send({ error: "ROOM_NOT_FOUND" });
  if (room === "ACTION_NOT_AVAILABLE") {
    return reply.code(409).send({ error: "ACTION_NOT_AVAILABLE" });
  }
  sockets.to(room.id).emit("room:update", { version: room.version });
  return rooms.project(room, session.id);
});

app.patch<{ Params: { code: string } }>("/api/rooms/:code/settings", (request, reply) => {
  const session = sessions.resolve(request);
  if (session === null) return reply.code(401).send({ error: "UNAUTHENTICATED" });
  const parsed = updateRoomSettingsSchema.safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ error: "INVALID_INPUT" });
  const room = rooms.updateBaseScore(session.id, request.params.code, parsed.data.baseScore);
  if (room === null) return reply.code(404).send({ error: "ROOM_NOT_FOUND" });
  if (room === "FORBIDDEN") return reply.code(403).send({ error: "OWNER_ONLY" });
  if (room === "ACTION_NOT_AVAILABLE") {
    return reply.code(409).send({ error: "ACTION_NOT_AVAILABLE" });
  }
  sockets.to(room.id).emit("room:update", { version: room.version });
  return rooms.project(room, session.id);
});

app.post<{ Params: { code: string } }>("/api/rooms/:code/continue", (request, reply) => {
  const session = sessions.resolve(request);
  if (session === null) return reply.code(401).send({ error: "UNAUTHENTICATED" });
  const room = rooms.continueBotRound(session.id, request.params.code);
  if (room === null) return reply.code(404).send({ error: "ROOM_NOT_FOUND" });
  if (room === "ACTION_NOT_AVAILABLE") {
    return reply.code(409).send({ error: "ACTION_NOT_AVAILABLE" });
  }
  sockets.to(room.id).emit("room:update", { version: room.version });
  return rooms.project(room, session.id);
});

app.post<{ Params: { code: string } }>("/api/rooms/:code/dissolve", (request, reply) => {
  const session = sessions.resolve(request);
  if (session === null) return reply.code(401).send({ error: "UNAUTHENTICATED" });
  const room = rooms.requestDissolve(session.id, request.params.code);
  if (room === null) return reply.code(404).send({ error: "ROOM_NOT_FOUND" });
  if (room === "FORBIDDEN") return reply.code(403).send({ error: "OWNER_ONLY" });
  sockets.to(room.id).emit("room:update", { version: room.version });
  return rooms.project(room, session.id);
});

app.delete<{ Params: { code: string } }>("/api/rooms/:code", (request, reply) => {
  const session = sessions.resolve(request);
  if (session === null) return reply.code(401).send({ error: "UNAUTHENTICATED" });
  const room = rooms.leaveRoom(session.id, request.params.code);
  if (room === null) return reply.code(404).send({ error: "ROOM_NOT_FOUND" });
  sockets.to(room.id).emit("room:update", { version: room.version });
  return { closed: room.status === "CLOSED" };
});

sockets.use((socket, next) => {
  const headers: {
    authorization?: string | string[];
    cookie?: string;
    [key: string]: unknown;
  } = {};
  if (socket.handshake.headers.authorization !== undefined) {
    headers.authorization = socket.handshake.headers.authorization;
  }
  if (socket.handshake.headers.cookie !== undefined) {
    headers.cookie = socket.handshake.headers.cookie;
  }
  const tokenHeader = socket.handshake.headers[SESSION_TOKEN_HEADER];
  if (tokenHeader !== undefined) {
    headers[SESSION_TOKEN_HEADER] = tokenHeader;
  }
  const session = sessions.resolveSocketHandshake({
    auth: socket.handshake.auth,
    headers,
  });
  if (session === null) return next(new Error("UNAUTHENTICATED"));
  const socketData = socket.data as { sessionId?: string };
  socketData.sessionId = session.id;
  next();
});

sockets.on("connection", (socket) => {
  const socketData = socket.data as { sessionId?: string };
  const sessionId = socketData.sessionId;
  if (sessionId === undefined) {
    socket.disconnect(true);
    return;
  }
  for (const update of rooms.setConnected(sessionId, true)) {
    sockets.to(update.roomId).emit("room:update", { version: update.version });
  }
  socket.on("room:subscribe", (roomCode: string, acknowledge: (value: unknown) => void) => {
    const room = rooms.getRoom(roomCode);
    if (room?.status !== "ACTIVE") return acknowledge({ error: "ROOM_NOT_FOUND" });
    if (!rooms.hasMember(sessionId, roomCode)) return acknowledge({ error: "NOT_A_MEMBER" });
    void socket.join(room.id);
    acknowledge(rooms.project(room, sessionId));
  });

  socket.on("room:chat", (unknownInput: unknown, acknowledge: (value: unknown) => void) => {
    const parsed = chatMessageInputSchema.safeParse(unknownInput);
    if (!parsed.success) return acknowledge({ accepted: false, errorCode: "INVALID_INPUT" });
    const result = rooms.createChatMessage(sessionId, parsed.data.roomCode, parsed.data.message);
    if (result === null) return acknowledge({ accepted: false, errorCode: "ROOM_NOT_FOUND" });
    if (result === "NOT_A_MEMBER" || result === "ACTION_NOT_AVAILABLE") {
      return acknowledge({ accepted: false, errorCode: result });
    }
    void socket.join(result.roomId);
    sockets.to(result.roomId).emit("room:chat", result);
    acknowledge({ accepted: true });
  });

  socket.on("game:command", (unknownCommand: unknown, acknowledge: (value: unknown) => void) => {
    const parsed = commandEnvelopeSchema.safeParse(unknownCommand);
    if (!parsed.success) return acknowledge({ accepted: false, errorCode: "INVALID_COMMAND" });
    const result = rooms.execute(sessionId, parsed.data);
    acknowledge(result);
    if (result.accepted) {
      sockets.to(parsed.data.roomId).emit("room:update", { version: result.serverVersion });
    }
  });
  socket.on("disconnect", () => {
    for (const update of rooms.setConnected(sessionId, false)) {
      sockets.to(update.roomId).emit("room:update", { version: update.version });
    }
  });
});

const roomTimer = setInterval(() => {
  for (const update of rooms.tick()) {
    sockets.to(update.roomId).emit("room:update", { version: update.version });
  }
}, 250);
roomTimer.unref();

app.addHook("onClose", async () => {
  clearInterval(roomTimer);
  await sockets.close();
  database.close();
});

const port = Number(process.env.PORT ?? 3000);
await app.listen({ host: "0.0.0.0", port });
