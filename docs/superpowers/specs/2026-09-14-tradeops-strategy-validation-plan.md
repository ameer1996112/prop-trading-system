# TradeOps long-term strategy validation plan

Date: 2026-09-14
Status: Proposed research and risk framework. Not evidence of profitability or
authorization to trade real funds.

## Objective

Determine whether the three-model strategy has a repeatable positive net
expectancy at an acceptable drawdown, and stop allocating risk when the evidence
does not support it. A correct implementation and a profitable strategy are two
different acceptance questions. There is no guaranteed return or completion date
at which profitability becomes established.

Companion engineering design:
`2026-09-14-three-model-demo-completion-design.md`.

## 1. Freeze a falsifiable strategy

Record one immutable configuration: producer/source digest, BOC/DIR_CLOSE/HTF_FLIP
rules, arbitration, symbols/feed mappings, sessions, entry/exit and stop/target
policies, risk limits and transaction-cost assumptions. Identify every experiment
and parameter variation; retain failed variants as well as winners.

Build support for all three models. Do not require all three to remain enabled
for future capital allocation if evidence later shows one is harmful. Disabling a
model changes arbitration and therefore defines a new portfolio strategy that
must be evaluated, not inferred by deleting its losing trades from old results.

## 2. Collect trustworthy evidence

For every observed candidate record model, setup/attempt, eligibility, reason for
rejection, competing models, source event time, edge receipt, command/send times,
broker result and actual fill/exit. Keep hypothetical alternatives separate from
executed trades. Record missing-data windows and outages, including signals not
executed; do not silently exclude failures from operational results.

DIR_CLOSE historical tests may use adequate confirmed-bar evidence. Intrabar BOC
and flip tests require recorded ordered evidence; five-minute high/low ranges
cannot supply a sequence that was never observed. Collect prospective evidence
where historical data cannot prove the model. Demo fills are not equivalent to
real-account execution.

## 3. Evaluate without repeatedly fitting the test set

Split data chronologically into development, validation and a final untouched
test period before optimization. Keep overlapping setup/holding periods out of
both sides of a split; document a gap appropriate to the maximum holding period.
Use walk-forward evaluation with parameters fitted only on preceding data.

Inspect performance by model, symbol, direction, session and market conditions,
and evaluate the actual combined arbitration policy. Subgroup searches are
exploratory, not independent confirmations. If test results guide a change, that
period becomes development evidence and a new untouched period is required.

## 4. Measure net results and uncertainty

Include spread, commission, swap, slippage and currency conversion consistently;
do not subtract spread twice when actual fills already incorporate it. Include
hosting/data/tool costs separately in the economic viability report.

Report trade count, elapsed period, net mean result per trade in money and R,
profit factor, average win/loss, drawdown and its duration, losing streaks,
exposure, tail losses, and execution rejection/latency/slippage distributions.
R uses the recorded initial planned cash risk; actual losses can exceed 1R.

Estimate uncertainty with resampling that preserves dependence (for example
day/week blocks rather than assuming each trade is independent). Report sensitivity
to block length and market concentration. No fixed count such as 100 or 200
trades automatically proves an edge. Continue observation when uncertainty is
too large; classify results as inconclusive rather than pass.

Stress cost assumptions, delays, missed signals, gaps, correlated positions and
parameter perturbations. Reject a proposal whose positive mean depends on one
exceptional trade, narrow hindsight-selected settings, or unrealistically cheap
execution. Stress tests are scenarios, not predictions or loss guarantees.

## 5. Separate release gates

Engineering gate: all three strict models work end to end on demo; duplicate,
restart, uncertainty and authentication tests pass; broker and dashboard records
reconcile. This permits continued demo evaluation, not a profitability claim.

Research gate: rules and evaluation procedure were frozen before the final test;
net out-of-sample and forward-demo results support positive expectancy with
reported uncertainty; stress results and drawdown fit owner-approved limits.
The proposed statistical criterion is a positive lower 95% confidence bound for
net expectancy under the documented dependence-aware procedure. This is evidence,
not proof of future returns, and cannot repair biased data or repeated selection.
If coverage, sample size or regime diversity is inadequate, remain on demo.

Real-capital gate: outside current demo scope; requires a separate explicit
decision, financial loss budget, suitability assessment and limited pilot plan.
Successful demo results alone never switch the system to real trading.

## 6. Preserve capital and review deliberately

Require an owner-defined maximum affordable loss before assigning real risk.
Per-trade risk, aggregate correlated exposure, daily loss and overall drawdown
limits must be configured and tested. Do not increase size to recover losses;
no martingale or automatic averaging down. Protective stops reduce risk but do
not guarantee a maximum realized loss.

Proposed cadence: weekly operational/data-quality review; monthly performance
review against the frozen baseline. Investigate risk-limit breaches, unexplained
broker differences and persistent execution deterioration immediately. Stop new
entries on safety failures; preserve records and reconcile existing exposure.
Any parameter/model change creates a new version and repeats validation. Do not
retune merely because of an ordinary losing streak or scale after a lucky week.

## Deliverables and present evidence

Required outputs: reproducible data manifest, frozen configuration, experiment
ledger, chronological evaluation report, cost/stress report, forward-demo report,
and explicit pass/fail/inconclusive gate decisions. The dashboard should eventually
expose these labels separately from connection or software-test status.

Current evidence in this conversation consists of software-test results and
read-only/demo integration progress, not a validated net-profit track record.
The strategy's long-term profitability remains unestablished.

## Sources for limitations

- SEC, Investor Bulletin: Performance Claims:
  https://www.investor.gov/introduction-investing/general-resources/news-alerts/alerts-bulletins/investor-bulletins-47
- CFTC, Commodity Trading Systems Sold on the Internet:
  https://www.cftc.gov/LearnAndProtect/AdvisoriesAndArticles/fraudadv_tradingsystem.html

The testing gates and cadence above are proposed project methodology, not
regulator endorsements or prescribed thresholds.
