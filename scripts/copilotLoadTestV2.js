const db = require('../src/database/db');
const initDatabase = require('../src/database/init');

const {
  evaluateCopilotTrade
} = require('../src/services/tradeCopilot');

const USERS =
  Number(process.env.LOAD_USERS || 500);

const ROUNDS =
  Number(process.env.LOAD_ROUNDS || 10);

const CONCURRENCY =
  Number(process.env.LOAD_CONCURRENCY || 25);

const BURST_USERS =
  Number(process.env.LOAD_BURST_USERS || 100);

const SNAPSHOT_WAIT_MS =
  Number(process.env.LOAD_SNAPSHOT_WAIT_MS || 27000);


// =====================================================
// METRICS
// =====================================================

let snapshotBuilds = 0;

const originalLog = console.log;

console.log = (...args) => {
  const text =
    args
      .map(x =>
        typeof x === 'string'
          ? x
          : ''
      )
      .join(' ');

  if (
    text.includes(
      'Building shared Copilot market snapshot'
    )
  ) {
    snapshotBuilds++;
  }

  originalLog(...args);
};


function percentile(values, p) {
  if (!values.length) return 0;

  const sorted =
    [...values].sort((a, b) => a - b);

  const index =
    Math.min(
      sorted.length - 1,
      Math.floor(
        (p / 100) * sorted.length
      )
    );

  return sorted[index];
}


function memoryMb() {
  const m =
    process.memoryUsage();

  return {
    rss:
      m.rss / 1024 / 1024,

    heap:
      m.heapUsed / 1024 / 1024
  };
}


async function sleep(ms) {
  return new Promise(
    resolve =>
      setTimeout(resolve, ms)
  );
}


// =====================================================
// CONCURRENCY POOL
// =====================================================

async function runPool(
  items,
  limit,
  worker
) {
  let cursor = 0;

  const count =
    Math.min(
      limit,
      items.length
    );

  const workers =
    Array.from(
      { length: count },
      async () => {
        while (true) {
          const index =
            cursor++;

          if (
            index >=
            items.length
          ) {
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


// =====================================================
// GENERATE REALISTIC USERS
// =====================================================

function createTrades({
  users,
  price,
  atr
}) {
  const rows = [];

  const safeAtr =
    Number.isFinite(atr) &&
    atr > 0
      ? atr
      : 3;

  for (
    let i = 0;
    i < users;
    i++
  ) {
    const action =
      i % 2 === 0
        ? 'BUY'
        : 'SELL';

    /*
      Different user entry situations:

      0 = near current price
      1 = already slightly profitable
      2 = slightly against entry
      3 = further from entry
      4 = almost at entry
    */
    const mode =
      i % 5;

    let offsetAtr;

    switch (mode) {
      case 0:
        offsetAtr = 0.05;
        break;

      case 1:
        offsetAtr = 0.45;
        break;

      case 2:
        offsetAtr = -0.35;
        break;

      case 3:
        offsetAtr = -0.85;
        break;

      default:
        offsetAtr = 0.15;
    }

    let entry;

    if (action === 'BUY') {
      entry =
        price -
        safeAtr * offsetAtr;
    } else {
      entry =
        price +
        safeAtr * offsetAtr;
    }

    const risk =
      Math.max(
        safeAtr * 1.2,
        3
      );

    let sl;
    let tp1;
    let tp2;

    if (action === 'BUY') {
      sl =
        entry - risk;

      tp1 =
        entry +
        risk * 1.2;

      tp2 =
        entry +
        risk * 2;

    } else {
      sl =
        entry + risk;

      tp1 =
        entry -
        risk * 1.2;

      tp2 =
        entry -
        risk * 2;
    }

    rows.push({
      id: i + 1,

      telegram_id:
        `LOAD_VIP_${i + 1}`,

      pair: 'XAUUSD',

      action,

      entry,

      stop_loss: sl,

      target1: tp1,

      target2: tp2,

      status: 'watching',

      health_status: 'NEW'
    });
  }

  return rows;
}


// =====================================================
// MAIN TEST
// =====================================================

async function main() {
  await db.ready;

  initDatabase();

  console.log('');
  console.log(
    '========================================'
  );
  console.log(
    '🤖 COPILOT LOAD TEST V2 — 500 VIP'
  );
  console.log(
    '========================================'
  );

  console.log(
    `Users:       ${USERS}`
  );

  console.log(
    `Rounds:      ${ROUNDS}`
  );

  console.log(
    `Concurrency: ${CONCURRENCY}`
  );

  console.log('');


  // ===================================================
  // REAL MARKET PROBE
  // ===================================================

  console.log(
    '📡 Getting real XAUUSD market snapshot...'
  );

  const probe =
    await evaluateCopilotTrade({
      id: 'PROBE',

      telegram_id:
        'LOAD_PROBE',

      pair: 'XAUUSD',

      action: 'BUY',

      entry: 4000,

      stop_loss: null,

      target1: null,

      target2: null,

      status: 'watching',

      health_status: 'NEW'
    });


  const livePrice =
    Number(
      probe.currentPrice
    );

  const atr =
    Number(
      probe.market?.atr5
    );


  console.log('');
  console.log(
    `💰 Live price: ${livePrice}`
  );

  console.log(
    `📊 ATR 5M:     ${atr}`
  );

  console.log(
    `📈 Trend15:    ${probe.market?.trend15}`
  );

  console.log(
    `💪 ADX:        ${probe.market?.adx5}`
  );

  console.log(
    `🎯 VWAP:       ${probe.market?.vwap5}`
  );

  console.log('');


  const trades =
    createTrades({
      users: USERS,
      price: livePrice,
      atr
    });


  let previousStatuses =
    new Map();

  let peakRss = 0;
  let peakHeap = 0;

  const allLatencies = [];

  let totalSuccess = 0;
  let totalFailed = 0;
  let totalTransitions = 0;


  // ===================================================
  // 10 ROUNDS
  // ===================================================

  for (
    let round = 1;
    round <= ROUNDS;
    round++
  ) {
    const start =
      process.hrtime.bigint();

    const latencies = [];

    let success = 0;
    let failed = 0;

    let transitions = 0;

    const counts = {
      STRONG: 0,
      HEALTHY: 0,
      WARNING: 0,
      INVALIDATED: 0
    };


    await runPool(
      trades,
      CONCURRENCY,

      async trade => {
        const itemStart =
          process.hrtime.bigint();

        try {
          const result =
            await evaluateCopilotTrade(
              trade
            );

          success++;

          if (
            Object.prototype
              .hasOwnProperty.call(
                counts,
                result.healthStatus
              )
          ) {
            counts[
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
            transitions++;
          }


          previousStatuses.set(
            trade.id,
            result.healthStatus
          );


          // Simulate DB state update locally
          trade.health_status =
            result.healthStatus;

        } catch (error) {
          failed++;

          if (failed <= 3) {
            console.log(
              '❌ Evaluation:',
              error.message
            );
          }

        } finally {
          const itemEnd =
            process.hrtime.bigint();

          const ms =
            Number(
              itemEnd -
              itemStart
            ) /
            1_000_000;

          latencies.push(ms);
          allLatencies.push(ms);
        }
      }
    );


    const end =
      process.hrtime.bigint();

    const durationMs =
      Number(
        end - start
      ) /
      1_000_000;


    const mem =
      memoryMb();

    peakRss =
      Math.max(
        peakRss,
        mem.rss
      );

    peakHeap =
      Math.max(
        peakHeap,
        mem.heap
      );


    totalSuccess +=
      success;

    totalFailed +=
      failed;

    totalTransitions +=
      transitions;


    console.log('');
    console.log(
      `========== ROUND ${round} ==========`
    );

    console.log(
      `Duration: ${durationMs.toFixed(1)} ms`
    );

    console.log(
      `Success: ${success}/${USERS}`
    );

    console.log(
      `Failed:  ${failed}`
    );

    console.log(
      `Transitions / notifications: ${transitions}`
    );

    console.log(
      'Statuses:',
      counts
    );

    console.log(
      `Latency P50: ${percentile(latencies, 50).toFixed(3)} ms`
    );

    console.log(
      `Latency P95: ${percentile(latencies, 95).toFixed(3)} ms`
    );

    console.log(
      `Latency P99: ${percentile(latencies, 99).toFixed(3)} ms`
    );

    console.log(
      `RAM RSS: ${mem.rss.toFixed(1)} MB`
    );

    console.log(
      `Heap:    ${mem.heap.toFixed(1)} MB`
    );

    console.log(
      `Snapshots built total: ${snapshotBuilds}`
    );


    // Short pause.
    // Snapshot should still be reused.
    if (round < ROUNDS) {
      await sleep(1000);
    }
  }


  // ===================================================
  // BURST TEST
  // ===================================================

  console.log('');
  console.log(
    '========================================'
  );

  console.log(
    `🚨 BURST TEST — ${BURST_USERS} simultaneous refreshes`
  );

  console.log(
    'Waiting for shared snapshot TTL to expire...'
  );


  await sleep(
    SNAPSHOT_WAIT_MS
  );


  const snapshotsBeforeBurst =
    snapshotBuilds;


  const burstTrades =
    trades.slice(
      0,
      BURST_USERS
    );


  const burstStart =
    process.hrtime.bigint();


  const burstResults =
    await Promise.allSettled(
      burstTrades.map(
        trade =>
          evaluateCopilotTrade(
            trade
          )
      )
    );


  const burstEnd =
    process.hrtime.bigint();


  const burstDuration =
    Number(
      burstEnd -
      burstStart
    ) /
    1_000_000;


  const burstOk =
    burstResults.filter(
      r =>
        r.status ===
        'fulfilled'
    ).length;


  const burstFailed =
    burstResults.length -
    burstOk;


  const newSnapshots =
    snapshotBuilds -
    snapshotsBeforeBurst;


  console.log('');
  console.log(
    `Burst duration: ${burstDuration.toFixed(1)} ms`
  );

  console.log(
    `Burst success: ${burstOk}/${BURST_USERS}`
  );

  console.log(
    `Burst failed:  ${burstFailed}`
  );

  console.log(
    `New market snapshots during 100-user burst: ${newSnapshots}`
  );


  // ===================================================
  // FINAL REPORT
  // ===================================================

  console.log('');
  console.log(
    '========================================'
  );

  console.log(
    '📊 FINAL 500-VIP CAPACITY REPORT'
  );

  console.log(
    '========================================'
  );


  console.log(
    `Evaluations: ${
      USERS * ROUNDS
    }`
  );

  console.log(
    `Success: ${totalSuccess}`
  );

  console.log(
    `Failed: ${totalFailed}`
  );

  console.log(
    `Status transitions: ${totalTransitions}`
  );

  console.log(
    `Total market snapshots built: ${snapshotBuilds}`
  );

  console.log(
    `Peak RSS: ${peakRss.toFixed(1)} MB`
  );

  console.log(
    `Peak Heap: ${peakHeap.toFixed(1)} MB`
  );

  console.log(
    `Overall P50: ${
      percentile(
        allLatencies,
        50
      ).toFixed(3)
    } ms`
  );

  console.log(
    `Overall P95: ${
      percentile(
        allLatencies,
        95
      ).toFixed(3)
    } ms`
  );

  console.log(
    `Overall P99: ${
      percentile(
        allLatencies,
        99
      ).toFixed(3)
    } ms`
  );


  console.log('');

  if (
    totalFailed === 0 &&
    burstFailed === 0 &&
    newSnapshots <= 1 &&
    peakRss < 300
  ) {
    console.log(
      '🟢 LOAD RESULT: PASS'
    );

    console.log(
      'Architecture handled the simulated 500 VIP workload.'
    );
  } else {
    console.log(
      '🟡 LOAD RESULT: NEEDS HARDENING'
    );
  }


  console.log('');
  console.log(
    '✅ LOAD TEST V2 FINISHED'
  );
}


main()
  .then(() => {
    process.exit(0);
  })
  .catch(error => {
    console.error(
      '❌ LOAD TEST V2 FATAL:',
      error.stack ||
      error
    );

    process.exit(1);
  });
