# All-Linked Closest Liquidity Display Fix Design

**Date:** 2026-08-22  
**Status:** Awaiting written-spec review  
**Supersedes:** The eligible-candidate and cross-zone deduplication limits in `2026-08-06-zone-specific-closest-liquidity-display-design.md`

## Objective

Make curated TradingView views display the genuinely closest valid liquidity reference for each visible zone level. The correction is visual-only: strict liquidity authority, qualification, setups, paper decisions, alerts, exports, and payloads remain unchanged.

## Evidence and root cause

The USDJPY 5-minute replay recorded on 2026-08-22 shows one demand zone displaying `LIQ 159.249`, then switching to the farther `LIQ 159.283` after a newer pivot is confirmed. A later overlapping zone record adds `LIQ 159.219`.

The strict selector intentionally ranks a newer valid pivot ahead of an older one. The current display selector sees only that strict primary and one structural display candidate. It does not inspect the other valid strict candidates already retained in `zone.liquidityIndexes`. Therefore “closest” currently means closest of two preselected values, not closest of every valid linked value.

## Approaches considered

### 1. Render-time scan of linked candidates — selected

Pass the immutable liquidity-level collection into the display selector. On the last-bar drawing pass, scan the owning zone's linked indexes, revalidate each candidate, and select the smallest positive proximal-edge distance. Then compare that winner with the existing structural candidate.

This keeps the correction inside presentation code and adds no persistent authority state. The drawing pass already runs only on `barstate.islast`, so the bounded scan does not restore the historical runtime problem.

### 2. Persist a second display-primary index — rejected

Adding `displayLiquidityPrimaryIndex` to every zone would avoid repeated scans, but it would introduce reset, replacement, serialization, and replay lifecycle concerns for a value that has no trading authority. It creates more state than the display requires.

### 3. Change strict ranking to distance-first — rejected

Changing `liquidityRanksCloser` would make the strict primary visually closer, but it would also change qualification chronology, setup eligibility, paper selection, and payload facts. That violates the paper-authority boundary.

## Display candidate arbitration

### Linked strict candidates

For each visible zone, inspect every index in `zone.liquidityIndexes`.

- Skip an index outside the current liquidity-level array.
- Reapply `liquiditySupportsZone` and require a positive proximal-edge distance.
- Require the candidate swing to be after the zone origin, matching the existing link rule.
- Select the smallest distance.
- For prices equal within half a minimum tick, select the earlier canonical swing bar.
- If no linked candidate survives, fall back to the existing frozen strict fields when they remain valid. This preserves display continuity for previously constructed zones.

The selected linked level supplies its price, swing bar, anchor price, and anchor bar to the renderer. Selecting it must not write to `liquidityPrimaryIndex`, `pendingLiquidityPrimaryIndex`, or any zone authority field.

### Structural candidate

The existing structural display candidate remains eligible only when `Show bigger-structure liquidity` is enabled and it has a positive proximal-edge distance. Compare it with the closest linked strict candidate using the same distance and half-tick/earlier-bar tie rule.

### Visual state

- Reuse the zone's single liquidity line and label for the selected price.
- A linked candidate inherits strict proof-line coordinates from its own anchor fields.
- Only the authoritative strict primary may inherit the zone's strict swept color/state. An alternate linked candidate remains pending-colored; its endpoint still stops at the first later visual touch through the existing drawing helper.
- A structural winner has no strict proof line and remains pending-colored.

## One owner for an overlapping curated level

Raw Audit remains unchanged and continues to show all linked evidence.

In Clean, Qualified Only, and Setups Only views, visible same-side zones whose boxes overlap form one visual level. Exactly one member owns the level's liquidity drawing. Ownership uses the existing curated ranking order:

1. the zone closer to current price;
2. for equal distance, the newer zone ID;
3. Setups Only keeps its existing armed/recent-outcome precedence.

Other visible boxes in the overlap may remain visible, but their stale liquidity line, proof line, and label are deleted. When ownership changes, the new owner draws on the same update and the previous owner cleans up on that update. Non-overlapping zones retain independent lines.

## Data flow and boundaries

1. `refreshZoneLiquidity` continues discovering and linking candidates exactly as today.
2. `liquidityDisplaySelection` receives the read-only level array and computes a temporary display winner.
3. A curated-level ownership helper determines whether the current visible zone may render liquidity.
4. `updateZoneDrawing` creates, moves, or deletes presentation objects only.
5. Raw Audit continues using `updateLiquidityDrawings` and is not deduplicated.

No display result can feed eligibility, setup materialization, entry arbitration, execution proposals, alerts, or exported facts.

## Testing

Static Pine regressions must fail before implementation and establish that:

1. The display selector iterates `zone.liquidityIndexes` rather than reading only the primary fields.
2. Invalid indexes and candidates failing `liquiditySupportsZone` are skipped.
3. Minimum positive distance wins, with the earlier swing bar as the half-tick tie-break.
4. Frozen strict fields are fallback-only.
5. The structural candidate competes with the closest linked strict candidate.
6. No display helper writes strict, qualification, setup, entry, alert, proposal, or payload state.
7. Overlapping curated zones have exactly one liquidity owner; non-overlapping zones remain independent.
8. Raw Audit rendering is unchanged.
9. Labels and strict proof coordinates follow the selected linked candidate.
10. LAB/RELEASE generation parity, the protected-region digest, Pine static tests, edge Pine parity, authority boundary, and secret scan all remain green.

## Acceptance criteria

1. In the recorded USDJPY replay pattern, confirming a newer but farther linked pivot cannot move the Clean-view line farther from the same zone.
2. A newly confirmed closer valid linked pivot replaces the previous visual on the next last-bar render.
3. An overlapping curated level displays no more than one primary liquidity line.
4. Separate non-overlapping zone levels keep separate liquidity lines.
5. Raw Audit still exposes all linked candidates.
6. Strict primary identity and every downstream trading fact remain byte-for-byte governed by the existing authority path.
7. The generated RELEASE compiles in TradingView and Bar Replay shows stable line ownership without stale duplicates.

## Out of scope

- Changing zone formation, confirmation delay, lifecycle, or visibility.
- Changing strict or structural candidate discovery.
- Promoting a display winner into qualification or execution authority.
- Treating `Fresh-zone projection bars` as zone age or expiration.
- Global selection of one liquidity line for the whole chart.
