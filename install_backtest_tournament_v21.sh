#!/data/data/com.termux/files/usr/bin/bash
set -e
PROJECT="$HOME/DailyBotAI"
SRC="$(cd "$(dirname "$0")" && pwd)/DailyBotAI/scripts"
mkdir -p "$PROJECT/scripts"
cp "$SRC/backtestTournamentV21.js" "$PROJECT/scripts/backtestTournamentV21.js"
cp "$SRC/backtestHistoryV21.js" "$PROJECT/scripts/backtestHistoryV21.js"
cd "$PROJECT"
node --check scripts/backtestHistoryV21.js
node --check scripts/backtestTournamentV21.js
echo "✅ Backtest Tournament V2.1 installed"
echo "Run: node scripts/backtestTournamentV21.js"
