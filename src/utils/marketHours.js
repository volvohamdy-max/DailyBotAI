function isCryptoPair(pair) {
  return (
    String(pair || '')
      .toUpperCase() === 'BTCUSD'
  );
}

function newYorkParts(date = new Date()) {
  const formatter =
    new Intl.DateTimeFormat(
      'en-US',
      {
        timeZone: 'America/New_York',
        weekday: 'short',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23'
      }
    );

  const parts =
    formatter.formatToParts(date);

  const get =
    type =>
      parts.find(
        x => x.type === type
      )?.value;

  return {
    weekday: get('weekday'),
    hour: Number(get('hour')),
    minute: Number(get('minute'))
  };
}

function minutesOfDay(parts) {
  return (
    parts.hour * 60 +
    parts.minute
  );
}

/*
 * Unified market session:
 *
 * BTCUSD:
 * 24/7
 *
 * XAUUSD + all Forex pairs:
 * Sunday 18:05 New York
 * through Friday 16:59 New York
 *
 * الفكرة:
 * لا نشغل أي Forex قبل افتتاح الذهب.
 */
function isUnifiedMarketOpen(
  date = new Date()
) {
  const ny =
    newYorkParts(date);

  const minutes =
    minutesOfDay(ny);

  // Saturday = closed
  if (ny.weekday === 'Sat') {
    return false;
  }

  // Sunday:
  // everything except crypto waits for gold open
  if (ny.weekday === 'Sun') {
    return minutes >= (
      18 * 60 + 5
    );
  }

  // Friday close
  if (ny.weekday === 'Fri') {
    return minutes < (
      16 * 60 + 59
    );
  }

  // Monday -> Thursday
  return true;
}

function isForexWeekend(
  date = new Date()
) {
  return !isUnifiedMarketOpen(date);
}

function isGoldMarketOpen(
  date = new Date()
) {
  return isUnifiedMarketOpen(date);
}

function isPairMarketOpen(
  pair,
  date = new Date()
) {
  const symbol =
    String(pair || '')
      .toUpperCase();

  if (isCryptoPair(symbol)) {
    return true;
  }

  return isUnifiedMarketOpen(date);
}

module.exports = {
  isForexWeekend,
  isCryptoPair,
  isGoldMarketOpen,
  isUnifiedMarketOpen,
  isPairMarketOpen
};
