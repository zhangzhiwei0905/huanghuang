import cookie from "@fastify/cookie";
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
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { Server } from "socket.io";
import { GameDatabase } from "./database.js";
import { RoomService } from "./room-service.js";
import { SessionService } from "./session-service.js";

const app = Fastify({ logger: true });
await app.register(cookie);

const database = new GameDatabase(process.env.DATABASE_PATH ?? ":memory:");
const sessions = new SessionService(database);
const rooms = new RoomService(database);
const sockets = new Server(app.server, {
  cors: { origin: true, credentials: true },
  connectionStateRecovery: {
    maxDisconnectionDuration: 2 * 60 * 1000,
    skipMiddlewares: false,
  },
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

app.post("/api/rooms", (request, reply) => {
  const parsed = createRoomSchema.safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ error: "INVALID_INPUT" });
  const session = sessions.ensure(request, reply, parsed.data.nickname);
  const room = rooms.createRoom(session, parsed.data.baseScore, parsed.data.mode);
  return reply.code(201).send(rooms.project(room, session.id));
});

app.post("/api/rooms/join", (request, reply) => {
  const parsed = joinRoomSchema.safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ error: "INVALID_INPUT" });
  const session = sessions.ensure(request, reply, parsed.data.nickname);
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
  const session = sessions.resolveRawCookie(socket.request.headers.cookie);
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
