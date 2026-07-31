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
    enqueueOrderKey(left).localeCompare(enqueueOrderKey(right))
  );
}

/**
 * Rank is intentionally not a matching criterion: any four candidates that
 * don't split a party are considered compatible. See design.md in
 * 07-31-team-matchmaking-bot-fill for why the range-widening tier system
 * was removed.
 */
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
    const eligible = ordered.filter((candidate) => candidate.sessionId !== anchor.sessionId);
    const groups = combinations(eligible, MATCH_SIZE - 1)
      .flatMap((others): MatchmakingGroup[] => {
        const [second, third, fourth] = others;
        return second === undefined || third === undefined || fourth === undefined
          ? []
          : [[anchor, second, third, fourth]];
      })
      .filter((group) => containsCompleteParties(group))
      .sort(compareGroups);
    const selected = groups[0];
    if (selected !== undefined) return selected;
  }

  return null;
}

function shuffled<T>(values: readonly T[]): T[] {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    const current = result[index];
    const swap = result[swapIndex];
    if (current === undefined || swap === undefined) continue;
    result[index] = swap;
    result[swapIndex] = current;
  }
  return result;
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
      if (selected.length > 3) continue;
      if (
        selected.length > best.length ||
        (selected.length === best.length &&
          enqueueOrderKey(selected).localeCompare(enqueueOrderKey(best)) < 0)
      ) {
        best = selected;
      }
    }

    const needed = MATCH_SIZE - best.length;
    const availableBots = shuffled(botCandidates);
    if (availableBots.length >= needed) {
      return { humans: best, bots: availableBots.slice(0, needed) };
    }
  }
  return null;
}
