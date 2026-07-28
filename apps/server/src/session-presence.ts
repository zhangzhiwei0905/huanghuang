export type PresenceTransition =
  "FIRST_CONNECTED" | "STILL_CONNECTED" | "LAST_DISCONNECTED" | "ALREADY_DISCONNECTED";

export class SessionPresence {
  private readonly socketIdsBySession = new Map<string, Set<string>>();

  connect(sessionId: string, socketId: string): PresenceTransition {
    const socketIds = this.socketIdsBySession.get(sessionId);
    if (socketIds !== undefined) {
      socketIds.add(socketId);
      return "STILL_CONNECTED";
    }
    this.socketIdsBySession.set(sessionId, new Set([socketId]));
    return "FIRST_CONNECTED";
  }

  disconnect(sessionId: string, socketId: string): PresenceTransition {
    const socketIds = this.socketIdsBySession.get(sessionId);
    if (socketIds?.delete(socketId) !== true) return "ALREADY_DISCONNECTED";
    if (socketIds.size > 0) return "STILL_CONNECTED";
    this.socketIdsBySession.delete(sessionId);
    return "LAST_DISCONNECTED";
  }

  isConnected(sessionId: string): boolean {
    return (this.socketIdsBySession.get(sessionId)?.size ?? 0) > 0;
  }

  count(sessionId: string): number {
    return this.socketIdsBySession.get(sessionId)?.size ?? 0;
  }
}
