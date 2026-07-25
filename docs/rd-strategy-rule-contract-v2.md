# RD strategy rule contract v2

Version 2.0.0 governs 5m entry observation and paper selection only.
Version 1 remains frozen historical evidence.

- Official channel: `@RD_Forex` / `UC54xbL96tU58iez3YbTVTAg`
- Active models: `DIR_CLOSE`, `HTF_FLIP`
- Legacy observations: `LEGACY_BREAK_CANDLE`, `LEGACY_REJECTION_RESPECT`
- First touch: `ZONE_ENGAGED`
- Real execution: prohibited

Claim-level precedence is encoded in
`config/phase0/rd-strategy-rule-contract-v2.json`. Later silence does not
override compatible earlier rules. `NARROWS` and `SUPERSEDES` always point
to an older official claim.
