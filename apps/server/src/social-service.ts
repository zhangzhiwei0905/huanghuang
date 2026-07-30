import { formatRankLevel } from "@huanghuang/game-engine";
import type {
  FriendRequestProjection,
  FriendSummary,
  PlayerSearchResult,
  RoomInviteProjection,
  SocialPlayer,
  SocialSnapshot,
} from "@huanghuang/protocol";
import type {
  AnonymousSession,
  FriendRequestRow,
  GameDatabase,
  RoomInviteRow,
} from "./database.js";
import type { RoomService } from "./room-service.js";

const ROOM_INVITE_TTL_MS = 10 * 60 * 1_000;

export class SocialService {
  constructor(
    private readonly database: GameDatabase,
    private readonly rooms: RoomService,
    private readonly isOnline: (sessionId: string) => boolean,
  ) {}

  private player(session: AnonymousSession): SocialPlayer {
    if (session.playerId == null) throw new Error("PLAYER_NOT_FOUND");
    const profile = this.database.getPublicCompetitiveProfiles([session.id])[0];
    return {
      playerId: session.playerId,
      nickname: session.nickname,
      avatarUrl: session.avatarUrl ?? null,
      competitiveProfile:
        profile === undefined
          ? null
          : {
              rankDisplay: formatRankLevel(profile.rankLevel),
              achievements: {
                exposedKong: profile.exposedKongCount,
                indicatorPongKong: profile.indicatorPongKongCount,
                addedKong: profile.addedKongCount,
                concealedKong: profile.concealedKongCount,
                releaseWildcard: profile.releaseWildcardCount,
                hardLaiyou: profile.hardLaiyouCount,
                softLaiyou: profile.softLaiyouCount,
              },
            },
    };
  }

  search(actor: AnonymousSession, playerId: string): PlayerSearchResult {
    const target = this.database.findSessionByPlayerId(playerId);
    if (target === null) throw new Error("PLAYER_NOT_FOUND");
    if (target.id === actor.id) {
      return { ...this.player(target), relationship: "SELF", requestId: null };
    }
    if (this.database.isFriends(actor.id, target.id)) {
      return { ...this.player(target), relationship: "FRIEND", requestId: null };
    }
    const pending = this.database.getPendingFriendRequestBetween(actor.id, target.id);
    if (pending === null) {
      return { ...this.player(target), relationship: "NONE", requestId: null };
    }
    return {
      ...this.player(target),
      relationship:
        pending.requesterSessionId === actor.id ? "OUTGOING_PENDING" : "INCOMING_PENDING",
      requestId: pending.id,
    };
  }

  snapshot(actor: AnonymousSession): SocialSnapshot {
    const friends: FriendSummary[] = this.database.listFriends(actor.id).map((friend) => ({
      ...this.player(friend.session),
      online: this.isOnline(friend.session.id),
      friendsSince: friend.friendsSince,
    }));
    friends.sort(
      (left, right) =>
        Number(right.online) - Number(left.online) ||
        left.nickname.localeCompare(right.nickname, "zh-CN"),
    );

    const requests = this.database.listPendingFriendRequests(actor.id);
    const requestSessions = this.database.findSessionsByIds(
      requests.map((request) =>
        request.requesterSessionId === actor.id
          ? request.recipientSessionId
          : request.requesterSessionId,
      ),
    );
    const sessionsById = new Map(requestSessions.map((session) => [session.id, session]));
    const friendRequests = requests.flatMap((request): FriendRequestProjection[] => {
      const otherId =
        request.requesterSessionId === actor.id
          ? request.recipientSessionId
          : request.requesterSessionId;
      const other = sessionsById.get(otherId);
      return other?.playerId == null
        ? []
        : [
            {
              id: request.id,
              direction: request.requesterSessionId === actor.id ? "OUTGOING" : "INCOMING",
              player: this.player(other),
              createdAt: request.createdAt,
            },
          ];
    });

    const roomInvites = this.validRoomInvites(actor.id);
    return { self: this.player(actor), friends, friendRequests, roomInvites };
  }

  sendFriendRequest(actor: AnonymousSession, playerId: string): FriendRequestRow {
    const target = this.database.findSessionByPlayerId(playerId);
    if (target === null) throw new Error("PLAYER_NOT_FOUND");
    if (target.id === actor.id) throw new Error("SELF_FRIEND_REQUEST");
    if (this.database.isFriends(actor.id, target.id)) throw new Error("ALREADY_FRIENDS");
    const existing = this.database.getPendingFriendRequestBetween(actor.id, target.id);
    if (existing !== null) {
      if (existing.requesterSessionId === actor.id) return existing;
      throw new Error("INCOMING_FRIEND_REQUEST_PENDING");
    }
    return this.database.createFriendRequest(actor.id, target.id);
  }

  updateFriendRequest(
    actor: AnonymousSession,
    requestId: string,
    action: "ACCEPT" | "DECLINE" | "WITHDRAW",
  ): FriendRequestRow {
    return this.database.updateFriendRequest(requestId, actor.id, action);
  }

  removeFriend(actor: AnonymousSession, playerId: string): string {
    const target = this.database.findSessionByPlayerId(playerId);
    if (target === null || !this.database.removeFriend(actor.id, target.id)) {
      throw new Error("NOT_FRIENDS");
    }
    return target.id;
  }

  createRoomInvite(
    actor: AnonymousSession,
    roomCode: string,
    playerId: string,
    now = Date.now(),
  ): RoomInviteRow {
    const target = this.database.findSessionByPlayerId(playerId);
    if (target === null) throw new Error("PLAYER_NOT_FOUND");
    if (!this.database.isFriends(actor.id, target.id)) throw new Error("NOT_FRIENDS");
    if (!this.isOnline(target.id)) throw new Error("FRIEND_OFFLINE");
    const room = this.rooms.getRoom(roomCode);
    if (
      room?.mode !== "TEAM_MATCH" ||
      room.stage !== "WAITING" ||
      room.teamQueueStartedAt !== null ||
      !this.rooms.hasMember(actor.id, roomCode) ||
      Object.values(room.seats).every((seat) => seat.controller !== "EMPTY")
    ) {
      throw new Error("ROOM_INVITE_NOT_AVAILABLE");
    }
    return this.database.createRoomInvite(
      room.id,
      actor.id,
      target.id,
      new Date(now + ROOM_INVITE_TTL_MS).toISOString(),
    );
  }

  getAcceptableInvite(actor: AnonymousSession, inviteId: string, now = Date.now()): RoomInviteRow {
    const invite = this.database.getRoomInvite(inviteId);
    if (
      invite?.inviteeSessionId !== actor.id ||
      invite.status !== "PENDING" ||
      Date.parse(invite.expiresAt) <= now
    ) {
      throw new Error("ROOM_INVITE_NOT_AVAILABLE");
    }
    const room = this.rooms.getRoomById(invite.roomId);
    if (
      room?.mode !== "TEAM_MATCH" ||
      room.stage !== "WAITING" ||
      room.teamQueueStartedAt !== null ||
      Object.values(room.seats).every((seat) => seat.controller !== "EMPTY")
    ) {
      this.database.updateRoomInvite(invite.id, actor.id, "EXPIRED");
      throw new Error("ROOM_INVITE_NOT_AVAILABLE");
    }
    return invite;
  }

  updateRoomInvite(
    actor: AnonymousSession,
    inviteId: string,
    status: "ACCEPTED" | "DECLINED" | "EXPIRED",
  ): RoomInviteRow {
    return this.database.updateRoomInvite(inviteId, actor.id, status);
  }

  private validRoomInvites(actorSessionId: string, now = Date.now()): RoomInviteProjection[] {
    return this.database
      .listPendingRoomInvites(actorSessionId)
      .flatMap((invite): RoomInviteProjection[] => {
        const room = this.rooms.getRoomById(invite.roomId);
        const invalid =
          Date.parse(invite.expiresAt) <= now ||
          room?.mode !== "TEAM_MATCH" ||
          room.stage !== "WAITING" ||
          room.teamQueueStartedAt !== null ||
          Object.values(room.seats).every((seat) => seat.controller !== "EMPTY");
        if (invalid) {
          this.database.updateRoomInvite(invite.id, actorSessionId, "EXPIRED");
          return [];
        }
        const inviter = this.database.findSessionsByIds([invite.inviterSessionId])[0];
        if (inviter?.playerId == null) return [];
        return [
          {
            id: invite.id,
            roomCode: room.code,
            inviter: this.player(inviter),
            expiresAt: invite.expiresAt,
          },
        ];
      });
  }
}
