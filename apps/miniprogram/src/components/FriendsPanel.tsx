import { useMemo, useState } from "react";
import { Button, Image, Input, ScrollView, Text, View } from "@tarojs/components";
import Taro from "@tarojs/taro";
import type { PlayerSearchResult, SocialPlayer } from "@huanghuang/protocol";
import { API_BASE } from "../config";
import type { SocialController } from "../hooks/useSocial";
import "./FriendsPanel.scss";

type FriendsPanelProps = {
  social: SocialController;
  roomCode?: string;
  onClose: () => void;
};

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
            <Text className="friends-section__title">好友</Text>
            {social.loading ? (
              <View className="friends-section__empty">
                <View className="friends-section__empty-tile">
                  <Text>友</Text>
                </View>
                <Text>正在整理牌友名册</Text>
              </View>
            ) : social.snapshot?.friends.length === 0 ? (
              <View className="friends-section__empty">
                <View className="friends-section__empty-tile">
                  <Text>友</Text>
                </View>
                <Text>茶馆里还没有牌友</Text>
                <Text className="friends-section__empty-hint">用上方 4 位 ID 邀请第一位好友</Text>
              </View>
            ) : (
              social.snapshot?.friends.map((friend) => {
                const invited = invitedIds.has(friend.playerId);
                return (
                  <View className="friends-row" key={friend.playerId}>
                    <View className="friends-avatar-wrap">
                      <FriendAvatar player={friend} />
                      <View className={`friends-presence${friend.online ? " is-online" : ""}`} />
                    </View>
                    <View className="friends-row__copy">
                      <Text className="friends-row__name">{friend.nickname}</Text>
                      <Text className="friends-row__id">
                        ID {friend.playerId} · {friend.online ? "在线" : "离线"}
                      </Text>
                    </View>
                    {roomCode !== undefined ? (
                      <Button
                        className="friends-mini-btn"
                        disabled={social.busy || !friend.online || invited}
                        onClick={() => void invite(friend.playerId)}
                      >
                        {invited ? "已邀请" : friend.online ? "邀请" : "离线"}
                      </Button>
                    ) : (
                      <Button
                        className="friends-mini-btn is-danger"
                        disabled={social.busy}
                        onClick={() => void removeFriend(friend.playerId, friend.nickname)}
                      >
                        删除
                      </Button>
                    )}
                  </View>
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
