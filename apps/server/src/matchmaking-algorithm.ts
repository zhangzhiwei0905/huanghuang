export type MatchmakingCandidate = {
  sessionId: string;
  rankLevel: number;
  enqueuedAt: string;
  recentOpponentSessionIds?: readonly string[];
  partyId?: string;
  partySize?: number;
};

export type MatchmakingGroup = readonly [
  MatchmakingCandidate,
  MatchmakingCandidate,
  MatchmakingCandidate,
  MatchmakingCandidate,
];

export type RankedBotCandidate = {
  sessionId: string;
  rankLevel: number;
  lastMatchedAt: string | null;
};

export type BotFillGroup = {
  humans: MatchmakingCandidate[];
  bots: RankedBotCandidate[];
};

const MATCH_SIZE = 4;

export function matchmakingRange(waitMs: number): number {
  if (waitMs < 10_000) return 2;
  if (waitMs < 20_000) return 5;
  if (waitMs < 40_000) return 10;
  return Number.POSITIVE_INFINITY;
}

function waitMs(candidate: MatchmakingCandidate, now: number): number {
  return Math.max(0, now - Date.parse(candidate.enqueuedAt));
}

function mutuallyCompatible(
  left: MatchmakingCandidate,
  right: MatchmakingCandidate,
  now: number,
): boolean {
  if (left.partyId !== undefined && left.partyId === right.partyId) return true;
  const distance = Math.abs(left.rankLevel - right.rankLevel);
  return (
    distance <= matchmakingRange(waitMs(left, now)) &&
    distance <= matchmakingRange(waitMs(right, now))
  );
}

function containsCompleteParties(group: readonly MatchmakingCandidate[]): boolean {
  const grouped = new Map<string, MatchmakingCandidate[]>();
  for (const candidate of group) {
    if (candidate.partyId === undefined) {
      if (candidate.partySize !== undefined) return false;
      continue;
    }
    if (
      candidate.partySize === undefined ||
      candidate.partySize < 1 ||
      candidate.partySize > MATCH_SIZE
    ) {
      return false;
    }
    const members = grouped.get(candidate.partyId) ?? [];
    members.push(candidate);
    grouped.set(candidate.partyId, members);
  }
  return [...grouped.values()].every(
    (members) =>
      members.length === members[0]?.partySize &&
      members.every((member) => member.partySize === members.length),
  );
}

function combinations<T>(values: readonly T[], size: number): T[][] {
  if (size === 0) return [[]];
  const result: T[][] = [];
  for (let index = 0; index <= values.length - size; index += 1) {
    const value = values[index];
    if (value === undefined) continue;
    for (const suffix of combinations(values.slice(index + 1), size - 1)) {
      result.push([value, ...suffix]);
    }
  }
  return result;
}

function recentOpponentPairs(group: readonly MatchmakingCandidate[]): number {
  let count = 0;
  for (let leftIndex = 0; leftIndex < group.length; leftIndex += 1) {
    const left = group[leftIndex];
    if (left === undefined) continue;
    for (let rightIndex = leftIndex + 1; rightIndex < group.length; rightIndex += 1) {
      const right = group[rightIndex];
      if (right === undefined) continue;
      if (
        left.recentOpponentSessionIds?.includes(right.sessionId) === true ||
        right.recentOpponentSessionIds?.includes(left.sessionId) === true
      ) {
        count += 1;
      }
    }
  }
  return count;
}

function groupSpread(group: readonly MatchmakingCandidate[]): number {
  const levels = group.map((candidate) => candidate.rankLevel);
  return Math.max(...levels) - Math.min(...levels);
}

function totalPairDistance(group: readonly MatchmakingCandidate[]): number {
  let total = 0;
  for (let leftIndex = 0; leftIndex < group.length; leftIndex += 1) {
    const left = group[leftIndex];
    if (left === undefined) continue;
    for (let rightIndex = leftIndex + 1; rightIndex < group.length; rightIndex += 1) {
      const right = group[rightIndex];
      if (right !== undefined) total += Math.abs(left.rankLevel - right.rankLevel);
    }
  }
  return total;
}

function enqueueOrderKey(group: readonly MatchmakingCandidate[]): string {
  return [...group]
    .sort(
      (left, right) =>
        Date.parse(left.enqueuedAt) - Date.parse(right.enqueuedAt) ||
        left.sessionId.localeCompare(right.sessionId),
    )
    .map((candidate) => `${candidate.enqueuedAt}:${candidate.sessionId}`)
    .join("|");
}

function compareGroups(left: MatchmakingGroup, right: MatchmakingGroup): number {
  return (
    recentOpponentPairs(left) - recentOpponentPairs(right) ||
    groupSpread(left) - groupSpread(right) ||
    totalPairDistance(left) - totalPairDistance(right) ||
    enqueueOrderKey(left).localeCompare(enqueueOrderKey(right))
  );
}

export function selectMatchmakingGroup(
  candidates: readonly MatchmakingCandidate[],
  now = Date.now(),
): MatchmakingGroup | null {
  if (candidates.length < MATCH_SIZE) return null;
  const ordered = [...candidates].sort(
    (left, right) =>
      Date.parse(left.enqueuedAt) - Date.parse(right.enqueuedAt) ||
      left.sessionId.localeCompare(right.sessionId),
  );

  for (const anchor of ordered) {
    const eligible = ordered.filter(
      (candidate) =>
        candidate.sessionId !== anchor.sessionId && mutuallyCompatible(anchor, candidate, now),
    );
    const groups = combinations(eligible, MATCH_SIZE - 1)
      .flatMap((others): MatchmakingGroup[] => {
        const [second, third, fourth] = others;
        return second === undefined || third === undefined || fourth === undefined
          ? []
          : [[anchor, second, third, fourth]];
      })
      .filter(
        (group) =>
          containsCompleteParties(group) &&
          group.every((left, leftIndex) =>
            group.every(
              (right, rightIndex) =>
                leftIndex === rightIndex || mutuallyCompatible(left, right, now),
            ),
          ),
      )
      .sort(compareGroups);
    const selected = groups[0];
    if (selected !== undefined) return selected;
  }

  return null;
}

export function selectBotFillGroup(
  candidates: readonly MatchmakingCandidate[],
  botCandidates: readonly RankedBotCandidate[],
  now = Date.now(),
  minimumWaitMs = 5_000,
): BotFillGroup | null {
  const units = new Map<string, MatchmakingCandidate[]>();
  for (const candidate of candidates) {
    const key = candidate.partyId ?? `solo:${candidate.sessionId}`;
    const unit = units.get(key) ?? [];
    unit.push(candidate);
    units.set(key, unit);
  }
  const completeUnits = [...units.values()]
    .filter(
      (unit) =>
        unit.length > 0 &&
        unit.length <= 3 &&
        unit.every((member) =>
          member.partyId === undefined
            ? member.partySize === undefined
            : member.partySize === unit.length,
        ),
    )
    .sort(
      (left, right) =>
        Math.min(...left.map((entry) => Date.parse(entry.enqueuedAt))) -
          Math.min(...right.map((entry) => Date.parse(entry.enqueuedAt))) ||
        (left[0]?.sessionId ?? "").localeCompare(right[0]?.sessionId ?? ""),
    );

  for (const anchor of completeUnits) {
    const anchorEnqueuedAt = Math.min(...anchor.map((entry) => Date.parse(entry.enqueuedAt)));
    if (now - anchorEnqueuedAt < minimumWaitMs) continue;
    let best = anchor;
    const remaining = completeUnits.filter((unit) => unit !== anchor);
    for (let mask = 1; mask < 1 << Math.min(remaining.length, 12); mask += 1) {
      const selected = [...anchor];
      for (let index = 0; index < Math.min(remaining.length, 12); index += 1) {
        const unit = remaining[index];
        if ((mask & (1 << index)) !== 0 && unit !== undefined) selected.push(...unit);
      }
      if (
        selected.length > 3 ||
        !selected.every((left, leftIndex) =>
          selected.every(
            (right, rightIndex) => leftIndex === rightIndex || mutuallyCompatible(left, right, now),
          ),
        )
      ) {
        continue;
      }
      if (
        selected.length > best.length ||
        (selected.length === best.length &&
          enqueueOrderKey(selected).localeCompare(enqueueOrderKey(best)) < 0)
      ) {
        best = selected;
      }
    }

    const compatibleBots = botCandidates
      .filter((bot) =>
        best.every(
          (human) =>
            Math.abs(human.rankLevel - bot.rankLevel) <= matchmakingRange(waitMs(human, now)),
        ),
      )
      .sort((left, right) => {
        if (left.lastMatchedAt === null && right.lastMatchedAt !== null) return -1;
        if (left.lastMatchedAt !== null && right.lastMatchedAt === null) return 1;
        return (
          (left.lastMatchedAt ?? "").localeCompare(right.lastMatchedAt ?? "") ||
          left.sessionId.localeCompare(right.sessionId)
        );
      });
    const needed = MATCH_SIZE - best.length;
    if (compatibleBots.length >= needed) {
      return { humans: best, bots: compatibleBots.slice(0, needed) };
    }
  }
  return null;
}
