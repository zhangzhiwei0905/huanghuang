import type { PlayerSearchResult, RoomProjection, SocialSnapshot } from "@huanghuang/protocol";
import { useCallback, useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-mp";
import { ApiError, socialApi } from "../api/http";
import { getStoredSessionToken } from "../api/session";
import { API_BASE } from "../config";
import { errorLabel } from "../lib/errors";

export type SocialController = {
  snapshot: SocialSnapshot | null;
  loading: boolean;
  busy: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  search: (playerId: string) => Promise<PlayerSearchResult | null>;
  sendRequest: (playerId: string) => Promise<void>;
  acceptRequest: (requestId: string) => Promise<void>;
  declineRequest: (requestId: string) => Promise<void>;
  withdrawRequest: (requestId: string) => Promise<void>;
  removeFriend: (playerId: string) => Promise<void>;
  invite: (roomCode: string, playerId: string) => Promise<boolean>;
  acceptInvite: (inviteId: string) => Promise<RoomProjection | null>;
  declineInvite: (inviteId: string) => Promise<void>;
  clearError: () => void;
};

export function useSocial(enabled: boolean): SocialController {
  const [snapshot, setSnapshot] = useState<SocialSnapshot | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refreshInFlight = useRef<Promise<void> | null>(null);
  const disposed = useRef(false);

  const labelError = useCallback((cause: unknown) => {
    setError(errorLabel(cause instanceof ApiError ? cause.code : "UNKNOWN_ERROR"));
  }, []);

  const refresh = useCallback(async () => {
    if (!enabled) return;
    if (refreshInFlight.current !== null) return refreshInFlight.current;
    const pending = socialApi
      .snapshot()
      .then((next) => {
        if (!disposed.current) {
          setSnapshot(next);
          setError(null);
        }
      })
      .catch((cause) => {
        if (!disposed.current) labelError(cause);
      })
      .finally(() => {
        refreshInFlight.current = null;
        if (!disposed.current) setLoading(false);
      });
    refreshInFlight.current = pending;
    return pending;
  }, [enabled, labelError]);

  useEffect(() => {
    disposed.current = false;
    if (!enabled) {
      setLoading(false);
      return;
    }
    void refresh();
    const token = getStoredSessionToken();
    if (token === null) return;
    const socket: Socket = io(API_BASE, {
      autoConnect: false,
      withCredentials: false,
      auth: { token },
      reconnection: true,
      reconnectionAttempts: 8,
      reconnectionDelay: 1_000,
      reconnectionDelayMax: 5_000,
    });
    const handleConnect = () => void refresh();
    const handleUpdate = () => void refresh();
    socket.on("connect", handleConnect);
    socket.on("social:update", handleUpdate);
    socket.connect();
    return () => {
      disposed.current = true;
      socket.off("connect", handleConnect);
      socket.off("social:update", handleUpdate);
      socket.disconnect();
    };
  }, [enabled, refresh]);

  const mutate = useCallback(
    async <T>(operation: () => Promise<T>, apply?: (result: T) => void): Promise<T | null> => {
      if (busy) return null;
      setBusy(true);
      setError(null);
      try {
        const result = await operation();
        if (!disposed.current) apply?.(result);
        return result;
      } catch (cause) {
        if (!disposed.current) labelError(cause);
        return null;
      } finally {
        if (!disposed.current) setBusy(false);
      }
    },
    [busy, labelError],
  );

  return {
    snapshot,
    loading,
    busy,
    error,
    refresh,
    search: (playerId) => mutate(() => socialApi.search(playerId)),
    sendRequest: async (playerId) => {
      await mutate(() => socialApi.sendRequest(playerId), setSnapshot);
    },
    acceptRequest: async (requestId) => {
      await mutate(() => socialApi.acceptRequest(requestId), setSnapshot);
    },
    declineRequest: async (requestId) => {
      await mutate(() => socialApi.declineRequest(requestId), setSnapshot);
    },
    withdrawRequest: async (requestId) => {
      await mutate(() => socialApi.withdrawRequest(requestId), setSnapshot);
    },
    removeFriend: async (playerId) => {
      await mutate(() => socialApi.removeFriend(playerId), setSnapshot);
    },
    invite: async (roomCode, playerId) =>
      (await mutate(() => socialApi.invite(roomCode, playerId))) !== null,
    acceptInvite: (inviteId) => mutate(() => socialApi.acceptInvite(inviteId)),
    declineInvite: async (inviteId) => {
      await mutate(() => socialApi.declineInvite(inviteId), setSnapshot);
    },
    clearError: () => setError(null),
  };
}
