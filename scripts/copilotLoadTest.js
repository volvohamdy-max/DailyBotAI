const db = require('../src/database/db');
const initDatabase = require('../src/database/init');

const {
  evaluateCopilotTrade
} = require('../src/services/tradeCopilot');

const USERS = Number(process.env.LOAD_USERS || 500);
const ROUNDS = Number(process.env.LOAD_ROUNDS || 3);
const CONCURRENCY = Number(process.env.LOAD_CONCURRENCY || 25);

function fakeTrades(count, basePrice = 4380) {
  const rows = [];

  for (let i = 0; i < count; i++) {
    const action =
      i % 2 === 0 ? 'BUY' : 'SELL';

    const offset =
      ((i % 41) - 20) * 0.35;

    rows.push({
      id: i + 1,
      telegram_id: `LOAD_${i + 1}`,
      pair: 'XAUUSD',
      action,
      entry: basePrice + offset,
      stop_loss: null,
      target1: null,
      target2: null,
      status: 'watching',
      health_status: 'NEW'
    });
  }

  return rows;
}

async function runPool(items, limit, worker) {
  let cursor = 0;

  const workers =
    Array.from(
      {
        length:
          Math.min(limit, items.length)
      },
      async () => {
        while (true) {
          const index = cursor++;

          if (index >= items.length) {
            return;
          }

          await worker(
            items[index],
            index
          );
        }
      }
    );

  await Promise.all(workers);
}

function memMb() {
  const m = process.memoryUsage();

  return {
    rss:
      Number(
        (m.rss / 1024 / 1024)
          .toFixed(1)
      ),

    heapUsed:
      Number(
        (m.heapUsed / 1024 / 1024)
          .toFixed(1)
      )
  };
}

async function main() {
  await db.ready;

  initDatabase();

  const trades =
    fakeTrades(USERS);

  console.log('');
  console.log('================================');
  console.log('🤖 COPILOT LOAD TEST');
  console.log('================================');
  console.log(`Users:       ${USERS}`);
  console.log(`Rounds:      ${ROUNDS}`);
  console.log(`Concurrency: ${CONCURRENCY}`);
  console.log('');

  let previousStatuses =
    new Map();

  for (
    let round = 1;
    round <= ROUNDS;
    round++
  ) {
    const start =
      process.hrtime.bigint();

    let ok = 0;
    let failed = 0;

    let changed = 0;

    const statusCounts = {
      STRONG: 0,
      HEALTHY: 0,
      WARNING: 0,
      INVALIDATED: 0
    };

    await runPool(
      trades,
      CONCURRENCY,
      async trade => {
        try {
          const result =
            await evaluateCopilotTrade(
              trade
            );

          ok++;

          if (
            Object.prototype
              .hasOwnProperty.call(
                statusCounts,
                result.healthStatus
              )
          ) {
            statusCounts[
              result.healthStatus
            ]++;
          }

          const previous =
            previousStatuses.get(
              trade.id
            );

          if (
            previous &&
            previous !==
              result.healthStatus
          ) {
            changed++;
          }

          previousStatuses.set(
            trade.id,
            result.healthStatus
          );

        } catch (error) {
          failed++;

          if (failed <= 5) {
            console.log(
              '❌ Load test evaluation error:',
              error.message
            );
          }
        }
      }
    );

    const end =
      process.hrtime.bigint();

    const durationMs =
      Number(end - start) /
      1_000_000;

    const avgMs =
      durationMs / USERS;

    console.log(
      `ROUND ${round}`
    );

    console.log(
      `Duration: ${durationMs.toFixed(1)} ms`
    );

    console.log(
      `Avg/user: ${avgMs.toFixed(2)} ms`
    );

    console.log(
      `Success: ${ok}`
    );

    console.log(
      `Failed: ${failed}`
    );

    console.log(
      `Would notify: ${changed}`
    );

    console.log(
      'Statuses:',
      statusCounts
    );

    console.log(
      'Memory MB:',
      memMb()
    );

    console.log(
      '--------------------------------'
    );

    // Give the next round time to cross
    // the shared snapshot TTL when desired.
    if (round < ROUNDS) {
      await new Promise(
        resolve =>
          setTimeout(resolve, 3000)
      );
    }
  }

  console.log('');
  console.log('✅ LOAD TEST FINISHED');
}

main()
  .then(() => {
    process.exit(0);
  })
  .catch(error => {
    console.error(
      '❌ LOAD TEST FATAL:',
      error.stack || error
    );

    process.exit(1);
  });
