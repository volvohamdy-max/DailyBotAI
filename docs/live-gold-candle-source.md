# Live gold candle source

All live XAUUSD strategy candles must use `goldCandleRecovery` backed by Binance PAXGUSDT and calibrated to the live XAUUSD price feed. Strategy evaluation uses closed candles; cache validity follows the actual timeframe bucket so a newly closed M5/H1 candle is visible on the next scan.

No trading thresholds, sessions, SL/TP rules, or signal conditions are changed by this fix.
