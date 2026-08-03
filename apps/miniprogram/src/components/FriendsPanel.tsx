import { useMemo, useRef, useState } from "react";
import { Button, Image, Input, ScrollView, Text, View } from "@tarojs/components";
import Taro from "@tarojs/taro";
import type { FriendSummary, PlayerSearchResult, SocialPlayer } from "@huanghuang/protocol";
import { API_BASE } from "../config";
import type { SocialController } from "../hooks/useSocial";
import { rankScore } from "../lib/rankScore";
import { RankBadge } from "./RankBadge";
import "./FriendsPanel.scss";

type FriendsPanelProps = {
  social: SocialController;
  roomCode?: string;
  onClose: () => void;
};

type RankedFriend = {
  player: FriendSummary | SocialPlayer;
  isSelf: boolean;
  online: boolean;
  place: number;
  isPodium: boolean;
};

const FRIEND_DELETE_REVEAL_WIDTH = 82;

type TouchPoint = { clientX: number; clientY: number };
type TouchEventPayload = { touches?: TouchPoint[]; changedTouches?: TouchPoint[] };

function FriendAvatar({ player }: { player: SocialPlayer }) {
  return (
    <View className="friends-avatar">
      {player.avatarUrl !== null ? (
        <Image
          className="friends-avatar__image"
          src={`${API_BASE}${player.avatarUrl}`}
          mode="aspectFill"
        />
      ) : (
        <Text className="friends-avatar__fallback">{player.nickname.slice(0, 1)}</Text>
      )}
    </View>
  );
}

function SearchAction({
  result,
  social,
}: {
  result: PlayerSearchResult;
  social: SocialController;
}) {
  if (result.relationship === "SELF") {
    return <Text className="friends-row__state">这是你自己</Text>;
  }
  if (result.relationship === "FRIEND") {
    return <Text className="friends-row__state is-online">已经是好友</Text>;
  }
  if (result.relationship === "OUTGOING_PENDING") {
    return (
      <Button
        className="friends-mini-btn is-quiet"
        disabled={social.busy || result.requestId === null}
        onClick={() => {
          if (result.requestId !== null) void social.withdrawRequest(result.requestId);
        }}
      >
        撤回申请
      </Button>
    );
  }
  if (result.relationship === "INCOMING_PENDING") {
    return (
      <Button
        className="friends-mini-btn"
        disabled={social.busy || result.requestId === null}
        onClick={() => {
          if (result.requestId !== null) void social.acceptRequest(result.requestId);
        }}
      >
        同意
      </Button>
    );
  }
  return (
    <Button
      className="friends-mini-btn"
      disabled={social.busy}
      onClick={() => void social.sendRequest(result.playerId)}
    >
      加好友
    </Button>
  );
}

function FriendListRow({
  entry,
  roomCode,
  invited,
  busy,
  onInvite,
  onDelete,
}: {
  entry: RankedFriend;
  roomCode?: string;
  invited: boolean;
  busy: boolean;
  onInvite: () => void;
  onDelete: () => Promise<void>;
}) {
  const [swipeOffset, setSwipeOffset] = useState(0);
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const suppressClick = useRef(false);
  const isDeleteEnabled = roomCode === undefined && !entry.isSelf;

  function handleTouchStart(event: unknown) {
    if (!isDeleteEnabled) return;
    const touch = (event as TouchEventPayload).touches?.[0];
    if (touch === undefined) return;
    touchStart.current = { x: touch.clientX, y: touch.clientY };
  }

  function handleTouchMove(event: unknown) {
    if (!isDeleteEnabled || touchStart.current === null) return;
    const touch = (event as TouchEventPayload).touches?.[0];
    if (touch === undefined) return;
    const deltaX = touch.clientX - touchStart.current.x;
    const deltaY = touch.clientY - touchStart.current.y;
    if (Math.abs(deltaY) > Math.abs(deltaX) || deltaX >= 0) return;
    setSwipeOffset(Math.min(FRIEND_DELETE_REVEAL_WIDTH, Math.abs(deltaX)));
  }

  function handleTouchEnd(event: unknown) {
    if (!isDeleteEnabled || touchStart.current === null) return;
    const touch = (event as TouchEventPayload).changedTouches?.[0];
    if (touch === undefined) return;
    const deltaX = touch.clientX - touchStart.current.x;
    const deltaY = touch.clientY - touchStart.current.y;
    touchStart.current = null;
    if (Math.abs(deltaX) > Math.abs(deltaY) && deltaX < -36) {
      setSwipeOffset(FRIEND_DELETE_REVEAL_WIDTH);
      suppressClick.current = true;
      return;
    }
    if (Math.abs(deltaX) > 12) {
      setSwipeOffset(0);
      suppressClick.current = true;
    }
  }

  function handleRowClick() {
    if (suppressClick.current) {
      suppressClick.current = false;
      return;
    }
    if (swipeOffset > 0) setSwipeOffset(0);
  }

  const rank = entry.player.competitiveProfile;
  const rowClass = [
    "friends-row",
    "friends-row--friend",
    entry.isPodium ? "is-podium" : "",
    entry.isPodium ? `is-podium--${entry.place}` : "",
    entry.isSelf ? "is-self" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    // No catchMove here: catching touchmove inside the ScrollView would block
    // vertical list scrolling. The row's own handlers ignore vertical drags,
    // so the scroll view keeps them while horizontal drags reveal the delete
    // button. Deletion is swipe-only — tap the revealed button, then confirm.
    <View className="friends-swipe">
      {isDeleteEnabled && swipeOffset > 0 ? (
        <Button
          className="friends-swipe__delete"
          ariaLabel={`删除好友 ${entry.player.nickname}`}
          disabled={busy}
          onClick={(event) => {
            event.stopPropagation();
            setSwipeOffset(0);
            void onDelete();
          }}
        >
          删除
        </Button>
      ) : null}
      <View
        className={rowClass}
        style={{ transform: `translateX(-${swipeOffset}px)` }}
        onClick={handleRowClick}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        <View
          className={`friends-ranking${entry.isPodium ? ` friends-ranking--${entry.place}` : " friends-ranking--other"}`}
        >
          <Text className="friends-ranking__number">{entry.place}</Text>
        </View>
        <View className="friends-avatar-wrap">
          <FriendAvatar player={entry.player} />
          <View className={`friends-presence${entry.online ? " is-online" : ""}`} />
        </View>
        <View className="friends-row__copy">
          <View className="friends-row__name-row">
            <Text className="friends-row__name">{entry.player.nickname}</Text>
            {entry.isSelf ? <Text className="friends-row__self-label">我</Text> : null}
          </View>
          <Text className="friends-row__id">
            ID {entry.player.playerId} · {entry.online ? "在线" : "离线"}
            {rank !== null ? ` · ${rank.rankDisplay.displayName}` : " · 暂无段位"}
          </Text>
        </View>
        {roomCode !== undefined && !entry.isSelf ? (
          <Button
            className="friends-mini-btn"
            disabled={busy || !entry.online || invited}
            onClick={(event) => {
              event.stopPropagation();
              onInvite();
            }}
          >
            {invited ? "已邀请" : entry.online ? "邀请" : "离线"}
          </Button>
        ) : null}
        <View className={`friends-row__rank${rank === null ? " is-empty" : ""}`}>
          {rank !== null ? (
            <RankBadge
              rank={rank.rankDisplay}
              size="compact"
              showLabel={false}
              className="friends-row__rank-badge"
            />
          ) : null}
        </View>
      </View>
    </View>
  );
}

export function FriendsPanel({ social, roomCode, onClose }: FriendsPanelProps) {
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [result, setResult] = useState<PlayerSearchResult | null>(null);
  const [invitedIds, setInvitedIds] = useState<Set<string>>(() => new Set());
  const incoming = useMemo(
    () =>
      social.snapshot?.friendRequests.filter((request) => request.direction === "INCOMING") ?? [],
    [social.snapshot],
  );
  const outgoing = useMemo(
    () =>
      social.snapshot?.friendRequests.filter((request) => request.direction === "OUTGOING") ?? [],
    [social.snapshot],
  );
  // Rank the player list by competitive rank, including the current player so
  // the visible place is the player's actual position among friends.
  const rankedFriends = useMemo(() => {
    const players: Array<{
      player: FriendSummary | SocialPlayer;
      isSelf: boolean;
      online: boolean;
    }> =
      social.snapshot === null
        ? []
        : [
            { player: social.snapshot.self, isSelf: true, online: true },
            ...social.snapshot.friends.map((friend) => ({
              player: friend,
              isSelf: false,
              online: friend.online,
            })),
          ];
    players.sort((a, b) => {
      const byRank =
        rankScore(b.player.competitiveProfile) - rankScore(a.player.competitiveProfile);
      if (byRank !== 0) return byRank;
      if (a.online !== b.online) return a.online ? -1 : 1;
      return a.player.playerId < b.player.playerId
        ? -1
        : a.player.playerId > b.player.playerId
          ? 1
          : 0;
    });
    const ranked = players.map((entry, index): RankedFriend => ({
      ...entry,
      place: index + 1,
      isPodium: entry.player.competitiveProfile !== null && index < 3,
    }));
    return { friends: ranked };
  }, [social.snapshot]);

  async function search() {
    const normalized = query.trim();
    if (!/^[1-9]\d{3}$/u.test(normalized)) {
      setSearchError("请输入 4 位玩家 ID");
      setResult(null);
      return;
    }
    setSearching(true);
    setSearchError(null);
    const found = await social.search(normalized);
    setSearching(false);
    if (found === null) {
      setSearchError("未找到该玩家");
      setResult(null);
      return;
    }
    setResult(found);
  }

  async function invite(playerId: string) {
    if (roomCode === undefined) return;
    if (await social.invite(roomCode, playerId)) {
      setInvitedIds((current) => new Set(current).add(playerId));
    }
  }

  async function removeFriend(playerId: string, nickname: string) {
    const answer = await Taro.showModal({
      title: "删除好友",
      content: `确定删除 ${nickname}（ID ${playerId}）吗？`,
      confirmText: "删除",
      confirmColor: "#8b4038",
    });
    if (answer.confirm) await social.removeFriend(playerId);
  }

  return (
    <View className="friends-backdrop" onClick={onClose}>
      <View className="friends-panel" catchMove onClick={(event) => event.stopPropagation()}>
        <View className="friends-panel__head">
          <View className="friends-panel__head-main">
            <View className="friends-panel__mascot">
              <Text>友</Text>
              <View className="friends-panel__mascot-dot friends-panel__mascot-dot--a" />
              <View className="friends-panel__mascot-dot friends-panel__mascot-dot--b" />
            </View>
            <View className="friends-panel__heading">
              <Text className="friends-panel__eyebrow">
                {roomCode === undefined
                  ? `我的牌友 · ID ${social.snapshot?.self.playerId ?? "----"}`
                  : `邀请上桌 · 房号 ${roomCode}`}
              </Text>
              <Text className="friends-panel__title">
                {roomCode === undefined ? "好友茶馆" : "喊好友来一局"}
              </Text>
              <Text className="friends-panel__summary">
                {social.snapshot === null
                  ? "正在整理牌友名册"
                  : `${social.snapshot.friends.length} 位牌友 ${
                      social.snapshot.friends.filter((friend) => friend.online).length
                    } 位在线`}
              </Text>
            </View>
          </View>
          <Button className="friends-panel__close" onClick={onClose}>
            关闭
          </Button>
        </View>

        <View className="friends-search">
          <Input
            className="friends-search__input"
            type="number"
            maxlength={4}
            value={query}
            placeholder="输入 4 位好友 ID"
            onInput={(event) => {
              setQuery(event.detail.value.replace(/\D/gu, "").slice(0, 4));
              setSearchError(null);
              setResult(null);
            }}
            onConfirm={() => void search()}
          />
          <Button
            className="friends-search__button"
            disabled={searching || social.busy}
            onClick={() => void search()}
          >
            {searching ? "查找中" : "查找"}
          </Button>
        </View>
        {searchError !== null ? <Text className="friends-panel__error">{searchError}</Text> : null}
        {social.error !== null ? (
          <Text className="friends-panel__error">{social.error}</Text>
        ) : null}

        {result !== null ? (
          <View className="friends-row friends-row--search">
            <FriendAvatar player={result} />
            <View className="friends-row__copy">
              <Text className="friends-row__name">{result.nickname}</Text>
              <Text className="friends-row__id">ID {result.playerId}</Text>
            </View>
            <SearchAction result={result} social={social} />
          </View>
        ) : null}

        <ScrollView className="friends-panel__scroll" scrollY enhanced showScrollbar={false}>
          {incoming.length > 0 ? (
            <View className="friends-section">
              <Text className="friends-section__title">好友申请 · {incoming.length}</Text>
              {incoming.map((request) => (
                <View className="friends-row" key={request.id}>
                  <FriendAvatar player={request.player} />
                  <View className="friends-row__copy">
                    <Text className="friends-row__name">{request.player.nickname}</Text>
                    <Text className="friends-row__id">ID {request.player.playerId}</Text>
                  </View>
                  <Button
                    className="friends-mini-btn"
                    disabled={social.busy}
                    onClick={() => void social.acceptRequest(request.id)}
                  >
                    同意
                  </Button>
                  <Button
                    className="friends-mini-btn is-quiet"
                    disabled={social.busy}
                    onClick={() => void social.declineRequest(request.id)}
                  >
                    忽略
                  </Button>
                </View>
              ))}
            </View>
          ) : null}

          <View className="friends-section">
            <Text className="friends-section__title">
              好友排行 · {social.snapshot?.friends.length ?? 0} 位好友 + 我
            </Text>
            {social.loading ? (
              <View className="friends-section__empty">
                <View className="friends-section__empty-tile">
                  <Text>友</Text>
                </View>
                <Text>正在整理牌友名册</Text>
              </View>
            ) : (
              rankedFriends.friends.map((friend) => {
                const invited = invitedIds.has(friend.player.playerId);
                return (
                  <FriendListRow
                    key={friend.player.playerId}
                    entry={friend}
                    roomCode={roomCode}
                    invited={invited}
                    busy={social.busy}
                    onInvite={() => void invite(friend.player.playerId)}
                    onDelete={() => removeFriend(friend.player.playerId, friend.player.nickname)}
                  />
                );
              })
            )}
          </View>

          {outgoing.length > 0 ? (
            <View className="friends-section">
              <Text className="friends-section__title">已发出的申请</Text>
              {outgoing.map((request) => (
                <View className="friends-row" key={request.id}>
                  <FriendAvatar player={request.player} />
                  <View className="friends-row__copy">
                    <Text className="friends-row__name">{request.player.nickname}</Text>
                    <Text className="friends-row__id">ID {request.player.playerId}</Text>
                  </View>
                  <Button
                    className="friends-mini-btn is-quiet"
                    disabled={social.busy}
                    onClick={() => void social.withdrawRequest(request.id)}
                  >
                    撤回
                  </Button>
                </View>
              ))}
            </View>
          ) : null}
        </ScrollView>
      </View>
    </View>
  );
}
