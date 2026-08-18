Backtest Tournament V2.1
- Does NOT modify live bot trading files.
- Adds a dedicated backtest-only historical loader.
- Supports up to 60,000 candles.
- Loads 5m, then 15m, then 1h sequentially.
- Retries HTTP 429 with exponential backoff / Retry-After support.
- Persists historical candles under data/backtests/history-cache so reruns reuse downloaded data.
