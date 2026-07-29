import { afterEach, describe, expect, it } from "vitest";
import { GameDatabase } from "./database.js";
import { RoomService } from "./room-service.js";
import { SocialService } from "./social-service.js";

describe("SocialService", () => {
  const databases: GameDatabase[] = [];

  afterEach(() => {
    for (const database of databases.splice(0)) database.close();
  });

  function setup() {
    const database = new GameDatabase(":memory:");
    databases.push(database);
    const owner = database.upsertWechatSession(
      { openId: "owner-openid", nickname: "房主", avatarUrl: null },
      "owner-token",
    );
    const friend = database.upsertWechatSession(
      { openId: "friend-openid", nickname: "好友", avatarUrl: null },
      "friend-token",
    );
    const other = database.upsertWechatSession(
      { openId: "other-openid", nickname: "路人", avatarUrl: null },
      "other-token",
    );
    for (const session of [owner, friend, other]) {
      database.ensureCompetitiveProfile(session.id);
    }
    const online = new Set([owner.id, friend.id]);
    const rooms = new RoomService(database);
    const social = new SocialService(database, rooms, (sessionId) => online.has(sessionId));
    return { database, friend, online, other, owner, rooms, social };
  }

  it("assigns stable unique four-digit IDs to WeChat players", () => {
    const { database, friend, owner } = setup();

    expect(owner.playerId).toMatch(/^[1-9]\d{3}$/u);
    expect(friend.playerId).toMatch(/^[1-9]\d{3}$/u);
    expect(friend.playerId).not.toBe(owner.playerId);
    expect(database.ensurePlayerId(owner.id)).toBe(owner.playerId);
    expect(database.findSessionByPlayerId(owner.playerId!)).toMatchObject({ id: owner.id });
  });

  it("merges duplicate requests, supports accept/remove, and projects online state", () => {
    const { friend, owner, social } = setup();

    const first = social.sendFriendRequest(owner, friend.playerId!);
    expect(social.sendFriendRequest(owner, friend.playerId!).id).toBe(first.id);
    expect(social.search(friend, owner.playerId!)).toMatchObject({
      relationship: "INCOMING_PENDING",
      requestId: first.id,
    });
    expect(() => social.updateFriendRequest(owner, first.id, "ACCEPT")).toThrow("FORBIDDEN");

    social.updateFriendRequest(friend, first.id, "ACCEPT");
    expect(social.snapshot(owner).friends).toEqual([
      expect.objectContaining({
        playerId: friend.playerId,
        nickname: "好友",
        online: true,
      }),
    ]);
    expect(social.search(owner, friend.playerId!)).toMatchObject({ relationship: "FRIEND" });
    expect(social.removeFriend(owner, friend.playerId!)).toBe(friend.id);
    expect(social.snapshot(owner).friends).toEqual([]);
  });

  it("only invites online friends to a waiting team room and expires after ten minutes", () => {
    const { friend, online, other, owner, rooms, social } = setup();
    const request = social.sendFriendRequest(owner, friend.playerId!);
    social.updateFriendRequest(friend, request.id, "ACCEPT");
    const room = rooms.createRoom(owner, 2, "TEAM_MATCH", 20, "LOW");
    const now = Date.now();

    expect(() => social.createRoomInvite(owner, room.code, other.playerId!, now)).toThrow(
      "NOT_FRIENDS",
    );
    online.delete(friend.id);
    expect(() => social.createRoomInvite(owner, room.code, friend.playerId!, now)).toThrow(
      "FRIEND_OFFLINE",
    );
    online.add(friend.id);
    const invite = social.createRoomInvite(owner, room.code, friend.playerId!, now);
    expect(social.snapshot(friend).roomInvites).toEqual([
      expect.objectContaining({ id: invite.id, roomCode: room.code }),
    ]);
    expect(() => social.getAcceptableInvite(friend, invite.id, now + 10 * 60 * 1_000)).toThrow(
      "ROOM_INVITE_NOT_AVAILABLE",
    );
  });
});
