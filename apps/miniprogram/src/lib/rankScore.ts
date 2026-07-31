import type { PublicCompetitiveProfile } from "@huanghuang/protocol";

/**
 * Minor-tier ordering. The protocol lists minor labels from lowest to highest
 * (Ⅴ, Ⅳ, Ⅲ, Ⅱ, Ⅰ), so the array index is already an ascending score within
 * a major tier. A null minor (e.g. 黑铁, which has no sub-rank) scores 0.
 */
const MINOR_LABELS = ["Ⅴ", "Ⅳ", "Ⅲ", "Ⅱ", "Ⅰ"] as const;

/**
 * A single comparable number for a competitive rank, higher = stronger.
 * `majorIndex` runs 0 (黑铁) to 7 (雀神); each major has 5 minor steps, so
 * `majorIndex * 5 + minorScore` gives a monotonic ladder. A null profile
 * (new player with no ranked matches yet) scores -1 so it always sorts
 * below any ranked player.
 */
export function rankScore(profile: PublicCompetitiveProfile | null | undefined): number {
  if (profile === null || profile === undefined) return -1;
  const major = profile.rankDisplay.majorIndex * 5;
  const minorIndex = profile.rankDisplay.minorLabel
    ? MINOR_LABELS.indexOf(profile.rankDisplay.minorLabel)
    : -1;
  return major + (minorIndex >= 0 ? minorIndex : 0);
}
