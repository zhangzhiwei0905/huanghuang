import cookie from "@fastify/cookie";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import {
  chatMessageInputSchema,
  commandEnvelopeSchema,
  createFriendRequestInputSchema,
  createRoomSchema,
  createRoomInviteInputSchema,
  joinRoomSchema,
  matchmakingQueueInputSchema,
  readyRoomSchema,
  removeRoomBotSchema,
  teamMatchmakingInputSchema,
  updateRoomSettingsSchema,
} from "@huanghuang/protocol";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createWriteStream, existsSync, mkdirSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { Server } from "socket.io";
import { AvatarUploadError, decodeAvatarData, MAX_AVATAR_BASE64_LENGTH } from "./avatar-upload.js";
import { RANKED_BOTS, matchmakingBotsEnabled, rankedBotSession } from "./competitive-bots.js";
import { GameDatabase } from "./database.js";
import { MatchmakingService } from "./matchmaking-service.js";
import { RoomPresence } from "./room-presence.js";
import { RoomService } from "./room-service.js";
import { SessionService, SESSION_TOKEN_HEADER } from "./session-service.js";
import { SessionPresence } from "./session-presence.js";
import { SocialService } from "./social-service.js";
import { readBuildTime, readRevision, resolveAppVersion } from "./version.js";

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
const presence = new SessionPresence();
const roomPresence = new RoomPresence();
// Seed the preset ranked bot accounts once the database exists so the
// matchmaking bot path can hand real sessions (with competitive profiles) to
// the room service. Idempotent — safe on every boot, and only writes the
// configured rank on first creation so earned rank survives restarts.
const rankedBotSessions = matchmakingBotsEnabled
  ? RANKED_BOTS.map((bot) => {
      database.ensureRankedBotSession(bot);
      return rankedBotSession(bot);
    })
  : [];
const matchmaking = new MatchmakingService(
  database,
  (sessionId) => presence.isConnected(sessionId),
  (players) => {
    const room = rooms.createCompetitiveMatch(
      players.map((player) => player.session),
      players.map((player) => player.entry),
    );
    const competitiveMatch = room.competitiveMatch;
    if (competitiveMatch === null) throw new Error("Competitive room is missing match metadata");
    return { matchId: competitiveMatch.matchId, roomId: room.id };
  },
  Date.now(),
  {
    enabled: matchmakingBotsEnabled,
    bots: rankedBotSessions,
    createRoom: (humans, bots) => {
      const room = rooms.createCompetitiveMatchWithBots(
        humans.map((human) => human.session),
        humans.map((human) => human.entry),
        bots,
      );
      const competitiveMatch = room.competitiveMatch;
      if (competitiveMatch === null) {
        throw new Error("Competitive bot room is missing match metadata");
      }
      return { matchId: competitiveMatch.matchId, roomId: room.id };
    },
  },
);

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
const social = new SocialService(database, rooms, (sessionId) => presence.isConnected(sessionId));

function socialChannel(sessionId: string): string {
  return `session:${sessionId}`;
}

function notifySocial(sessionIds: readonly string[], reason: string): void {
  for (const sessionId of new Set(sessionIds)) {
    sockets.to(socialChannel(sessionId)).emit("social:update", { reason });
  }
}

function matchmakingResponse(sessionId: string) {
  const state = matchmaking.getState(sessionId);
  if (state.status === "QUEUED" && state.partyRoomId !== undefined) {
    const partyRoom = rooms.getRoomById(state.partyRoomId);
    return {
      state,
      botsEnabled: matchmakingBotsEnabled,
      room:
        partyRoom !== null && rooms.hasMember(sessionId, partyRoom.code)
          ? rooms.project(partyRoom, sessionId)
          : null,
    };
  }
  if (state.status !== "MATCHED") return { state, room: null, botsEnabled: matchmakingBotsEnabled };
  const room = rooms.getRoomById(state.roomId);
  return {
    state,
    botsEnabled: matchmakingBotsEnabled,
    room:
      room !== null && rooms.hasMember(sessionId, room.code)
        ? rooms.project(room, sessionId)
        : null,
  };
}

async function emitRoomProjection(roomId: string, excludedSocketId: string | null = null) {
  const room = rooms.getRoomById(roomId);
  if (room === null) return;
  try {
    const roomSockets = await sockets.in(roomId).fetchSockets();
    for (const memberSocket of roomSockets) {
      if (memberSocket.id === excludedSocketId) continue;
      const memberData = memberSocket.data as { sessionId?: string };
      if (memberData.sessionId === undefined) continue;
      memberSocket.emit("room:update", {
        version: room.version,
        projection: rooms.project(room, memberData.sessionId),
      });
    }
  } catch (cause) {
    // Preserve the older recovery path if adapter socket enumeration ever
    // fails: clients can still turn this version hint into an HTTP snapshot.
    app.log.error({ err: cause, roomId }, "failed to push member room projections");
    const target =
      excludedSocketId === null ? sockets.to(roomId) : sockets.to(roomId).except(excludedSocketId);
    target.emit("room:update", { version: room.version });
  }
}

function tickMatchmaking() {
  const result = matchmaking.tick();
  for (const room of rooms.reconcileTeamMatchQueues()) {
    void emitRoomProjection(room.id);
  }
  return result;
}

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

// Read once at startup and cache — never re-read the file per-request.
const cachedBuiltAt = readBuildTime(join(process.cwd(), "BUILD_TIME"));
const cachedRevision = readRevision();
// Resolve (and, if a new deploy actually happened, persist) the displayed
// semver once at startup rather than per-request — same reasoning as
// cachedBuiltAt above. Set APP_VERSION_OVERRIDE for exactly one deploy to
// force a specific version (e.g. "从 1.2.0 开始"); see resolveAppVersion's
// doc comment in version.ts.
const storedAppVersion = database.getAppVersion();
const resolvedAppVersion = resolveAppVersion({
  stored: storedAppVersion,
  currentRevision: cachedRevision,
  override: process.env.APP_VERSION_OVERRIDE ?? null,
});
const cachedAppVersion = resolvedAppVersion.version;
const cachedAppVersionUpdatedAt = resolvedAppVersion.bumped
  ? new Date().toISOString()
  : (storedAppVersion?.updatedAt ?? new Date().toISOString());
if (resolvedAppVersion.bumped) {
  database.upsertAppVersion({
    version: resolvedAppVersion.version,
    lastRevision: cachedRevision,
    updatedAt: cachedAppVersionUpdatedAt,
  });
}

app.get("/api/version", () => ({
  version: cachedAppVersion,
  builtAt: cachedBuiltAt,
  updatedAt: cachedAppVersionUpdatedAt,
  revision: cachedRevision,
}));

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
      playerId: ensured.session.playerId ?? null,
      nickname: ensured.session.nickname,
      avatarUrl: ensured.session.avatarUrl ?? null,
      sessionToken: ensured.rawToken,
    };
  }
  const issued = sessions.issue(nickname, reply);
  return {
    sessionId: issued.session.id,
    playerId: issued.session.playerId ?? null,
    nickname: issued.session.nickname,
    avatarUrl: issued.session.avatarUrl ?? null,
    sessionToken: issued.rawToken,
  };
});

app.get("/api/session", (request, reply) => {
  const session = sessions.resolve(request);
  if (session === null) return reply.code(401).send({ error: "UNAUTHENTICATED" });
  return {
    sessionId: session.id,
    playerId: session.playerId ?? null,
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
    playerId: session.playerId ?? null,
    nickname: session.nickname,
    avatarUrl: session.avatarUrl ?? null,
    sessionToken: token,
  };
});

function socialErrorStatus(code: string): number {
  if (code === "PLAYER_NOT_FOUND" || code.endsWith("_NOT_FOUND")) return 404;
  if (code === "FORBIDDEN" || code === "NOT_FRIENDS" || code === "NOT_A_MEMBER") return 403;
  if (code === "PLAYER_ID_CAPACITY_EXHAUSTED") return 503;
  return 409;
}

app.get("/api/social", (request, reply) => {
  const session = sessions.resolve(request);
  if (session === null) return reply.code(401).send({ error: "UNAUTHENTICATED" });
  try {
    return social.snapshot(session);
  } catch (cause) {
    const code = cause instanceof Error ? cause.message : "SOCIAL_FAILED";
    return reply.code(socialErrorStatus(code)).send({ error: code });
  }
});

app.get<{ Params: { playerId: string } }>("/api/players/:playerId", (request, reply) => {
  const session = sessions.resolve(request);
  if (session === null) return reply.code(401).send({ error: "UNAUTHENTICATED" });
  const parsed = createFriendRequestInputSchema.safeParse({ playerId: request.params.playerId });
  if (!parsed.success) return reply.code(400).send({ error: "INVALID_INPUT" });
  try {
    return social.search(session, parsed.data.playerId);
  } catch (cause) {
    const code = cause instanceof Error ? cause.message : "SOCIAL_FAILED";
    return reply.code(socialErrorStatus(code)).send({ error: code });
  }
});

app.post("/api/friend-requests", (request, reply) => {
  const session = sessions.resolve(request);
  if (session === null) return reply.code(401).send({ error: "UNAUTHENTICATED" });
  const parsed = createFriendRequestInputSchema.safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ error: "INVALID_INPUT" });
  try {
    const friendRequest = social.sendFriendRequest(session, parsed.data.playerId);
    notifySocial(
      [friendRequest.requesterSessionId, friendRequest.recipientSessionId],
      "FRIEND_REQUEST",
    );
    return reply.code(201).send(social.snapshot(session));
  } catch (cause) {
    const code = cause instanceof Error ? cause.message : "SOCIAL_FAILED";
    return reply.code(socialErrorStatus(code)).send({ error: code });
  }
});

function handleFriendRequestAction(
  request: FastifyRequest,
  reply: FastifyReply,
  requestId: string,
  action: "ACCEPT" | "DECLINE" | "WITHDRAW",
) {
  const session = sessions.resolve(request);
  if (session === null) return reply.code(401).send({ error: "UNAUTHENTICATED" });
  try {
    const updated = social.updateFriendRequest(session, requestId, action);
    notifySocial(
      [updated.requesterSessionId, updated.recipientSessionId],
      action === "ACCEPT" ? "FRIENDSHIP" : "FRIEND_REQUEST",
    );
    return social.snapshot(session);
  } catch (cause) {
    const code = cause instanceof Error ? cause.message : "SOCIAL_FAILED";
    return reply.code(socialErrorStatus(code)).send({ error: code });
  }
}

app.post<{ Params: { id: string } }>("/api/friend-requests/:id/accept", (request, reply) =>
  handleFriendRequestAction(request, reply, request.params.id, "ACCEPT"),
);
app.post<{ Params: { id: string } }>("/api/friend-requests/:id/decline", (request, reply) =>
  handleFriendRequestAction(request, reply, request.params.id, "DECLINE"),
);
app.delete<{ Params: { id: string } }>("/api/friend-requests/:id", (request, reply) =>
  handleFriendRequestAction(request, reply, request.params.id, "WITHDRAW"),
);

app.delete<{ Params: { playerId: string } }>("/api/friends/:playerId", (request, reply) => {
  const session = sessions.resolve(request);
  if (session === null) return reply.code(401).send({ error: "UNAUTHENTICATED" });
  try {
    const targetSessionId = social.removeFriend(session, request.params.playerId);
    notifySocial([session.id, targetSessionId], "FRIENDSHIP");
    return social.snapshot(session);
  } catch (cause) {
    const code = cause instanceof Error ? cause.message : "SOCIAL_FAILED";
    return reply.code(socialErrorStatus(code)).send({ error: code });
  }
});

app.post<{ Params: { code: string } }>("/api/rooms/:code/invites", (request, reply) => {
  const session = sessions.resolve(request);
  if (session === null) return reply.code(401).send({ error: "UNAUTHENTICATED" });
  const parsed = createRoomInviteInputSchema.safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ error: "INVALID_INPUT" });
  try {
    const invite = social.createRoomInvite(session, request.params.code, parsed.data.playerId);
    notifySocial([invite.inviteeSessionId], "ROOM_INVITE");
    return reply.code(201).send({ accepted: true });
  } catch (cause) {
    const code = cause instanceof Error ? cause.message : "SOCIAL_FAILED";
    return reply.code(socialErrorStatus(code)).send({ error: code });
  }
});

app.post<{ Params: { id: string } }>("/api/room-invites/:id/accept", (request, reply) => {
  const session = sessions.resolve(request);
  if (session === null) return reply.code(401).send({ error: "UNAUTHENTICATED" });
  try {
    const invite = social.getAcceptableInvite(session, request.params.id);
    const invitedRoom = rooms.getRoomById(invite.roomId);
    if (invitedRoom === null) throw new Error("ROOM_INVITE_NOT_AVAILABLE");
    const joined = rooms.joinRoom(session, invitedRoom.code);
    if (joined === null) throw new Error("ROOM_NOT_FOUND");
    if (typeof joined === "string") throw new Error(joined);
    social.updateRoomInvite(session, invite.id, "ACCEPTED");
    sockets.to(joined.id).emit("room:update", { version: joined.version });
    notifySocial([invite.inviterSessionId, invite.inviteeSessionId], "ROOM_INVITE");
    if (Object.values(joined.seats).every((seat) => seat.controller !== "EMPTY")) {
      notifySocial(database.expireRoomInvitesForRoom(joined.id), "ROOM_INVITE");
    }
    return rooms.project(joined, session.id);
  } catch (cause) {
    const code = cause instanceof Error ? cause.message : "SOCIAL_FAILED";
    return reply.code(socialErrorStatus(code)).send({ error: code });
  }
});

app.post<{ Params: { id: string } }>("/api/room-invites/:id/decline", (request, reply) => {
  const session = sessions.resolve(request);
  if (session === null) return reply.code(401).send({ error: "UNAUTHENTICATED" });
  try {
    const invite = social.updateRoomInvite(session, request.params.id, "DECLINED");
    notifySocial([invite.inviterSessionId, invite.inviteeSessionId], "ROOM_INVITE");
    return social.snapshot(session);
  } catch (cause) {
    const code = cause instanceof Error ? cause.message : "SOCIAL_FAILED";
    return reply.code(socialErrorStatus(code)).send({ error: code });
  }
});

/**
 * chooseAvatar's callback only gives a local temp file path — this uploads
 * it to a durable, publicly-fetchable URL so other seats in a room can
 * actually load the image (a temp path on one player's device means
 * nothing to anyone else's client).
 */
app.get("/api/competitive/profile", (request, reply) => {
  const session = sessions.resolve(request);
  if (session === null) return reply.code(401).send({ error: "UNAUTHENTICATED" });
  try {
    return matchmaking.getProfile(session);
  } catch (cause) {
    if (cause instanceof Error && cause.message === "WECHAT_LINK_REQUIRED") {
      return reply.code(403).send({ error: "WECHAT_LINK_REQUIRED" });
    }
    throw cause;
  }
});

app.get("/api/matchmaking/status", (request, reply) => {
  const session = sessions.resolve(request);
  if (session === null) return reply.code(401).send({ error: "UNAUTHENTICATED" });
  if (session.wechatOpenId == null) {
    return reply.code(403).send({ error: "WECHAT_LINK_REQUIRED" });
  }
  matchmaking.heartbeat(session.id);
  tickMatchmaking();
  return matchmakingResponse(session.id);
});

app.post("/api/matchmaking/queue", (request, reply) => {
  const session = sessions.resolve(request);
  if (session === null) return reply.code(401).send({ error: "UNAUTHENTICATED" });
  const parsed = matchmakingQueueInputSchema.safeParse(request.body ?? {});
  if (!parsed.success) return reply.code(400).send({ error: "INVALID_INPUT" });
  try {
    if (parsed.data.previousMatchId === undefined) {
      matchmaking.enqueue(session, Date.now(), parsed.data.allowBots === true);
    } else {
      matchmaking.continueMatchmaking(
        session,
        parsed.data.previousMatchId,
        Date.now(),
        parsed.data.allowBots === true,
      );
    }
    tickMatchmaking();
    return matchmakingResponse(session.id);
  } catch (cause) {
    const code = cause instanceof Error ? cause.message : "MATCHMAKING_FAILED";
    if (code === "WECHAT_LINK_REQUIRED") {
      return reply.code(403).send({ error: code });
    }
    if (code.includes("active competitive match") || code.includes("settled match member")) {
      return reply.code(409).send({ error: "MATCHMAKING_STATE_CONFLICT" });
    }
    request.log.error({ err: cause }, "failed to enqueue competitive player");
    return reply.code(500).send({ error: "MATCHMAKING_FAILED" });
  }
});

app.delete("/api/matchmaking/queue", (request, reply) => {
  const session = sessions.resolve(request);
  if (session === null) return reply.code(401).send({ error: "UNAUTHENTICATED" });
  const entry = database.getMatchmakingEntry(session.id);
  matchmaking.cancel(session.id);
  if (entry?.partyId !== null && entry?.partyId !== undefined) {
    const partyRoom = rooms.getRoomById(entry.partyId);
    if (partyRoom !== null) {
      rooms.resetTeamMatch(partyRoom.code);
      sockets.to(partyRoom.id).emit("room:update", { version: partyRoom.version });
    }
  }
  return matchmakingResponse(session.id);
});

app.post<{ Params: { matchId: string } }>(
  "/api/competitive/matches/:matchId/acknowledge",
  (request, reply) => {
    const session = sessions.resolve(request);
    if (session === null) return reply.code(401).send({ error: "UNAUTHENTICATED" });
    try {
      matchmaking.acknowledgeResult(session.id, request.params.matchId);
      return matchmakingResponse(session.id);
    } catch (cause) {
      if (cause instanceof Error && cause.message === "MATCH_RESULT_NOT_AVAILABLE") {
        return reply.code(409).send({ error: "MATCH_RESULT_NOT_AVAILABLE" });
      }
      throw cause;
    }
  },
);

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
  if (parsed.data.mode === "TEAM_MATCH" && session.wechatOpenId == null) {
    return reply.code(403).send({ error: "WECHAT_LINK_REQUIRED" });
  }
  const room = rooms.createRoom(
    session,
    parsed.data.baseScore,
    parsed.data.mode,
    parsed.data.turnTimeoutSeconds,
    parsed.data.botDifficulty,
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
  if (room === "WECHAT_LINK_REQUIRED") {
    return reply.code(403).send({ error: "WECHAT_LINK_REQUIRED" });
  }
  sockets.to(room.id).emit("room:update", { version: room.version });
  if (Object.values(room.seats).every((seat) => seat.controller !== "EMPTY")) {
    notifySocial(database.expireRoomInvitesForRoom(room.id), "ROOM_INVITE");
  }
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

app.post<{ Params: { code: string } }>("/api/rooms/:code/team-matchmaking", (request, reply) => {
  const session = sessions.resolve(request);
  if (session === null) return reply.code(401).send({ error: "UNAUTHENTICATED" });
  const parsed = teamMatchmakingInputSchema.safeParse(request.body ?? {});
  if (!parsed.success) return reply.code(400).send({ error: "INVALID_INPUT" });
  const prepared = rooms.prepareTeamMatch(session.id, request.params.code);
  if (prepared === null) return reply.code(404).send({ error: "ROOM_NOT_FOUND" });
  if (prepared === "FORBIDDEN") return reply.code(403).send({ error: "OWNER_ONLY" });
  if (prepared === "TEAM_SIZE_INVALID") {
    return reply.code(409).send({ error: "TEAM_SIZE_INVALID" });
  }
  if (prepared === "NOT_ALL_READY") {
    return reply.code(409).send({ error: "NOT_ALL_READY" });
  }
  if (prepared === "WECHAT_LINK_REQUIRED") {
    return reply.code(403).send({ error: "WECHAT_LINK_REQUIRED" });
  }
  if (prepared === "ACTION_NOT_AVAILABLE") {
    return reply.code(409).send({ error: "ACTION_NOT_AVAILABLE" });
  }
  try {
    matchmaking.enqueueParty(
      prepared.sessions,
      prepared.room.id,
      Date.now(),
      parsed.data.allowBots === true,
    );
    rooms.touchTeamMatch(prepared.room.code);
    notifySocial(database.expireRoomInvitesForRoom(prepared.room.id), "ROOM_INVITE");
    sockets.to(prepared.room.id).emit("room:update", { version: prepared.room.version });
    tickMatchmaking();
    return rooms.project(prepared.room, session.id);
  } catch (cause) {
    const code = cause instanceof Error ? cause.message : "TEAM_MATCHMAKING_FAILED";
    if (code.includes("already queued") || code.includes("active competitive match")) {
      return reply.code(409).send({ error: "MATCHMAKING_STATE_CONFLICT" });
    }
    request.log.error({ err: cause }, "failed to enqueue competitive party");
    return reply.code(500).send({ error: "TEAM_MATCHMAKING_FAILED" });
  }
});

app.delete<{ Params: { code: string } }>("/api/rooms/:code/team-matchmaking", (request, reply) => {
  const session = sessions.resolve(request);
  if (session === null) return reply.code(401).send({ error: "UNAUTHENTICATED" });
  const room = rooms.getRoom(request.params.code);
  if (room === null) return reply.code(404).send({ error: "ROOM_NOT_FOUND" });
  if (!rooms.hasMember(session.id, room.code)) {
    return reply.code(403).send({ error: "NOT_A_MEMBER" });
  }
  if (
    room.mode !== "TEAM_MATCH" ||
    room.stage !== "WAITING" ||
    room.teamQueueStartedAt === null ||
    database.getCurrentCompetitiveMatch(session.id) !== null
  ) {
    return reply.code(409).send({ error: "ACTION_NOT_AVAILABLE" });
  }
  matchmaking.cancelParty(room.id);
  const reset = rooms.resetTeamMatch(room.code);
  if (reset === null || reset === "ACTION_NOT_AVAILABLE") {
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
  const room = rooms.updateSettings(session.id, request.params.code, parsed.data);
  if (room === null) return reply.code(404).send({ error: "ROOM_NOT_FOUND" });
  if (room === "FORBIDDEN") return reply.code(403).send({ error: "OWNER_ONLY" });
  if (room === "ACTION_NOT_AVAILABLE") {
    return reply.code(409).send({ error: "ACTION_NOT_AVAILABLE" });
  }
  sockets.to(room.id).emit("room:update", { version: room.version });
  return rooms.project(room, session.id);
});

app.post<{ Params: { code: string } }>("/api/rooms/:code/bots", (request, reply) => {
  const session = sessions.resolve(request);
  if (session === null) return reply.code(401).send({ error: "UNAUTHENTICATED" });
  const room = rooms.addBot(session.id, request.params.code);
  if (room === null) return reply.code(404).send({ error: "ROOM_NOT_FOUND" });
  if (room === "FORBIDDEN") return reply.code(403).send({ error: "OWNER_ONLY" });
  if (room === "ACTION_NOT_AVAILABLE") {
    return reply.code(409).send({ error: "ACTION_NOT_AVAILABLE" });
  }
  sockets.to(room.id).emit("room:update", { version: room.version });
  return rooms.project(room, session.id);
});

app.delete<{ Params: { code: string; seat: string } }>(
  "/api/rooms/:code/bots/:seat",
  (request, reply) => {
    const session = sessions.resolve(request);
    if (session === null) return reply.code(401).send({ error: "UNAUTHENTICATED" });
    const parsed = removeRoomBotSchema.safeParse({ seat: Number(request.params.seat) });
    if (!parsed.success) return reply.code(400).send({ error: "INVALID_INPUT" });
    const room = rooms.removeBot(session.id, request.params.code, parsed.data.seat);
    if (room === null) return reply.code(404).send({ error: "ROOM_NOT_FOUND" });
    if (room === "FORBIDDEN") return reply.code(403).send({ error: "OWNER_ONLY" });
    if (room === "ACTION_NOT_AVAILABLE") {
      return reply.code(409).send({ error: "ACTION_NOT_AVAILABLE" });
    }
    sockets.to(room.id).emit("room:update", { version: room.version });
    return rooms.project(room, session.id);
  },
);

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
  const existing = rooms.getRoom(request.params.code);
  if (existing?.mode === "TEAM_MATCH" && existing.ownerSessionId === session.id) {
    matchmaking.cancelParty(existing.id);
  }
  const room = rooms.requestDissolve(session.id, request.params.code);
  if (room === null) return reply.code(404).send({ error: "ROOM_NOT_FOUND" });
  if (room === "FORBIDDEN") return reply.code(403).send({ error: "OWNER_ONLY" });
  if (room.status === "CLOSED") {
    notifySocial(database.expireRoomInvitesForRoom(room.id), "ROOM_INVITE");
  }
  sockets.to(room.id).emit("room:update", { version: room.version });
  return rooms.project(room, session.id);
});

app.delete<{ Params: { code: string } }>("/api/rooms/:code", (request, reply) => {
  const session = sessions.resolve(request);
  if (session === null) return reply.code(401).send({ error: "UNAUTHENTICATED" });
  const existing = rooms.getRoom(request.params.code);
  if (
    existing?.mode === "TEAM_MATCH" &&
    rooms.hasMember(session.id, existing.code) &&
    database.listMatchmakingPartyEntries(existing.id).length > 0
  ) {
    matchmaking.cancelParty(existing.id);
    rooms.resetTeamMatch(existing.code);
  }
  const room = rooms.leaveRoom(session.id, request.params.code);
  if (room === null) return reply.code(404).send({ error: "ROOM_NOT_FOUND" });
  if (room.status === "CLOSED") {
    notifySocial(database.expireRoomInvitesForRoom(room.id), "ROOM_INVITE");
  }
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
  void socket.join(socialChannel(sessionId));
  if (presence.connect(sessionId, socket.id) === "FIRST_CONNECTED") {
    matchmaking.setConnected(sessionId, true);
    notifySocial(
      database.listFriends(sessionId).map((friend) => friend.session.id),
      "PRESENCE",
    );
  }
  socket.on("room:subscribe", (roomCode: string, acknowledge: (value: unknown) => void) => {
    const room = rooms.getRoom(roomCode);
    if (room?.status !== "ACTIVE") return acknowledge({ error: "ROOM_NOT_FOUND" });
    if (!rooms.hasMember(sessionId, roomCode)) return acknowledge({ error: "NOT_A_MEMBER" });
    void socket.join(room.id);
    if (roomPresence.subscribe(room.id, sessionId, socket.id)) {
      const update = rooms.setRoomConnected(sessionId, room.id, true);
      if (update !== null)
        sockets.to(update.roomId).emit("room:update", { version: update.version });
    }
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
    const commandRoom = rooms.getRoomById(parsed.data.roomId);
    if (
      commandRoom?.mode === "MATCH" &&
      !roomPresence.isSubscribed(parsed.data.roomId, sessionId, socket.id)
    ) {
      return acknowledge({ accepted: false, errorCode: "ROOM_NOT_SUBSCRIBED" });
    }
    const result = rooms.execute(sessionId, parsed.data);
    if (result.accepted) {
      const room = rooms.getRoomById(parsed.data.roomId);
      acknowledge(
        room === null ? result : { ...result, projection: rooms.project(room, sessionId) },
      );
      // The sender already receives its member-specific projection in the
      // acknowledgement. Push member-specific projections to peers so nobody
      // needs an extra HTTP snapshot request before rendering the accepted cue.
      void emitRoomProjection(parsed.data.roomId, socket.id);
    } else {
      acknowledge(result);
    }
  });
  socket.on("disconnect", () => {
    for (const membership of roomPresence.disconnect(socket.id)) {
      if (!membership.lastSubscription) continue;
      const update = rooms.setRoomConnected(membership.sessionId, membership.roomId, false);
      if (update !== null)
        sockets.to(update.roomId).emit("room:update", { version: update.version });
    }
    if (presence.disconnect(sessionId, socket.id) === "LAST_DISCONNECTED") {
      matchmaking.setConnected(sessionId, false);
      notifySocial(
        database.listFriends(sessionId).map((friend) => friend.session.id),
        "PRESENCE",
      );
    }
  });
});

// Effect transitions share their deadline with the visible animation. Keep the
// scheduler fine-grained so the accepted state lands with the final frame
// instead of sitting behind a noticeable polling tail.
const roomTimer = setInterval(() => {
  for (const update of rooms.tick()) {
    // Effect completion is latency-sensitive: directly push the new private
    // projection instead of asking every client to perform a follow-up GET.
    void emitRoomProjection(update.roomId);
  }
}, 50);
roomTimer.unref();

const matchmakingTimer = setInterval(() => {
  tickMatchmaking();
}, 1_000);
matchmakingTimer.unref();

app.addHook("onClose", async () => {
  clearInterval(roomTimer);
  clearInterval(matchmakingTimer);
  await sockets.close();
  database.close();
});

const port = Number(process.env.PORT ?? 3000);
await app.listen({ host: "0.0.0.0", port });
