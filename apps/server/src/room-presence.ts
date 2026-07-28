export type RoomPresenceTransition = {
  roomId: string;
  sessionId: string;
  lastSubscription: boolean;
};

function membershipKey(roomId: string, sessionId: string): string {
  return `${roomId}\u0000${sessionId}`;
}

function parseMembershipKey(key: string): { roomId: string; sessionId: string } {
  const separator = key.indexOf("\u0000");
  if (separator < 0) throw new Error("Invalid room presence membership key");
  return { roomId: key.slice(0, separator), sessionId: key.slice(separator + 1) };
}

export class RoomPresence {
  private readonly socketIdsByMembership = new Map<string, Set<string>>();
  private readonly membershipsBySocketId = new Map<string, Set<string>>();

  subscribe(roomId: string, sessionId: string, socketId: string): boolean {
    const key = membershipKey(roomId, sessionId);
    let socketIds = this.socketIdsByMembership.get(key);
    const firstSubscription = socketIds === undefined;
    socketIds ??= new Set<string>();
    socketIds.add(socketId);
    this.socketIdsByMembership.set(key, socketIds);

    let memberships = this.membershipsBySocketId.get(socketId);
    memberships ??= new Set<string>();
    memberships.add(key);
    this.membershipsBySocketId.set(socketId, memberships);
    return firstSubscription;
  }

  unsubscribe(roomId: string, sessionId: string, socketId: string): boolean {
    const key = membershipKey(roomId, sessionId);
    const socketIds = this.socketIdsByMembership.get(key);
    if (socketIds?.delete(socketId) !== true) return false;
    const memberships = this.membershipsBySocketId.get(socketId);
    memberships?.delete(key);
    if (memberships?.size === 0) this.membershipsBySocketId.delete(socketId);
    if (socketIds.size > 0) return false;
    this.socketIdsByMembership.delete(key);
    return true;
  }

  disconnect(socketId: string): RoomPresenceTransition[] {
    const memberships = [...(this.membershipsBySocketId.get(socketId) ?? [])];
    return memberships.map((key) => {
      const { roomId, sessionId } = parseMembershipKey(key);
      return {
        roomId,
        sessionId,
        lastSubscription: this.unsubscribe(roomId, sessionId, socketId),
      };
    });
  }

  isSubscribed(roomId: string, sessionId: string, socketId: string): boolean {
    return this.socketIdsByMembership.get(membershipKey(roomId, sessionId))?.has(socketId) === true;
  }
}
