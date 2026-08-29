# Live Mega Winner

Promoted portfolio: **E2 + R3 + G1 + P1 + N4 + S0**.

Validated six-month optimizer result used for promotion: 610 trades, 382 wins, 228 losses, 62.6% WR, PF 1.56, +120.81R, DD 8R, ~4.66 trades/day.

Runtime wiring:
1. Six strategy scanners in `goldScalper.js`.
2. Portfolio/MAX OPEN guard in `autoSignals.js` before publication.
3. VIP delivery must succeed before `addTrade` persists the trade.
4. Persisted trades are followed by `tradeMonitor.js`.
5. TP/SL/BE and PRO P1 RSI 55/45 exits are routed back to VIP.

PRO P1 runtime: entry RSI 37/63, ADX >= 18, fixed $12 stop, exit RSI BUY >=55 / SELL <=45.
GROK G1 runtime override: RSI 50/50, volume spike 1.10x, reward 0.60R.

Pre-merge static verifier: `node scripts/verify-live-static.js`.
