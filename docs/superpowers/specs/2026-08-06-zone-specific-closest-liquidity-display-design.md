# Zone-Specific Closest Liquidity Display Design

**Date:** 2026-08-06  
**Status:** Approved for specification

## Objective

For every visible fresh zone, display exactly one liquidity line: the closest valid liquidity candidate to that zone. The visual selector must compare the existing strict-liquidity candidate with the existing structural-liquidity candidate instead of automatically preferring structural liquidity whenever it exists.

This change is display-only. It must not change strict liquidity qualification, setup eligibility, paper-entry selection, alerts, exports, or payloads.

## Current behavior

Each zone can hold two independently selected candidates:

- the strict primary candidate in `liquidityPrimaryIndex` and its frozen zone fields;
- the display-only structural candidate in `structureLiquidityPrice` and its related fields.

The renderer currently gives the structural candidate unconditional priority whenever `Show bigger-structure liquidity` is enabled. A valid strict candidate can therefore be hidden even when it is closer to the zone. Separate visible zones may each draw a line, which is correct, but each zone's displayed candidate is not guaranteed to be the closest across both candidate sources.

## Display arbitration

Add one display-only arbitration step per visible zone.

### Eligible candidates

- The strict candidate is eligible only when its existing primary index, price, and bar fields are available and its existing zone-side and qualification rules have already accepted it.
- The structural candidate is eligible only when its existing price and bar fields are available and `Show bigger-structure liquidity` is enabled.
- No new candidate detector or relaxed validity rule is introduced.

### Distance

Distance is measured from the zone's proximal edge:

- demand: `candidate price - zone.top`;
- supply: `zone.bottom - candidate price`.

Only candidates with a strictly positive distance are eligible for display.

### Winner

- Select the eligible candidate with the smallest distance.
- When prices are equal within half a minimum tick, select the candidate with the earlier canonical swing bar.
- If only one candidate is eligible, display it.
- If neither candidate is eligible, display no liquidity line for that zone.

The winner is recomputed from the zone's frozen candidate fields during drawing. It does not write back into strict or structural detector state.

## Rendering lifecycle

Each visible zone owns at most one displayed primary liquidity line and one price label associated with that winner. The existing proof line remains available only when the strict candidate wins because the structural display candidate does not carry the same strict anchor semantics.

- Reuse the existing line object when the winner changes; update its price, starting bar, terminal bar, color, style, and width.
- Delete any stale line object belonging to the losing render path so strict and structural lines cannot remain visible simultaneously for one zone.
- Start the line at the winner's canonical swing bar, bounded by the existing safe bar-index helper.
- End the line at the first later touch or sweep of the displayed price, using the existing terminal-zone fallback and safe bar-index helper.
- A taken strict candidate keeps the existing swept color and dashed style. Structural candidates retain the pending visual style because they remain display-only.
- Price labels, when enabled, must use the winning candidate.
- The proof line is drawn only when the strict candidate wins and `Show liquidity proof lines` is enabled. It is deleted when the structural candidate wins.
- When a zone becomes hidden or ineligible, delete all of its liquidity display objects.

There is no global deduplication across zones. Three visible zones may display three lines, but every line must be the closest valid candidate for its owning zone.

## Safety boundary

The unified selector is visual-only and must not modify or influence:

- `liquidityPrimaryIndex` or strict liquidity lifecycle fields;
- `liquidityQualified`, eligibility state, or setup state;
- entry attempts, paper decisions, or exits;
- alert conditions or alert payloads;
- setup-export or validation payloads;
- reviewed detector or settings hashes.

## Testing

Static Pine regression tests must establish that:

1. Both strict and structural candidates enter the display arbitration.
2. Demand and supply use the correct proximal-edge distance formulas.
3. The smallest positive distance wins.
4. Equal-price candidates select the earlier swing bar.
5. Only one primary liquidity render path can be visible per zone.
6. Price labels follow the selected candidate, while proof lines exist only for a strict winner.
7. Hidden or candidate-less zones delete stale liquidity objects.
8. The selector cannot write strict qualification, setup, entry, alert, or payload state.
9. Existing safe bar-index bounds protect all selected line endpoints.
10. The complete V3 Pine static suite continues to pass.

## Acceptance criteria

1. Every visible fresh zone displays zero or one primary liquidity line.
2. When both strict and structural candidates exist, the line represents the candidate closest to that zone.
3. A newly confirmed closer candidate replaces the previous visual without leaving a duplicate line.
4. Separate visible zones retain separate lines, even when their prices are close.
5. Toggling structural liquidity changes only structural-candidate eligibility for display.
6. Strict setup and execution behavior remains unchanged.
7. TradingView runs without historical bar-index drawing errors.

## Out of scope

- Global selection of one liquidity line for the entire chart.
- Deduplicating equal-price lines owned by different zones.
- Changing the strict or structural candidate detectors.
- Promoting structural liquidity into execution authority.
- Changing zone formation or visibility rules.
