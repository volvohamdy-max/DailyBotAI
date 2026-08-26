'use strict';
const { getGoldCandlesResilient } = require('../src/services/goldCandleRecovery');
(async()=>{
  for (const [tf,n] of [['5min',150],['1h',260]]) {
    const rows=await getGoldCandlesResilient(tf,n);
    const last=rows.at(-1), prev=rows.at(-2);
    console.log(tf,{bars:rows.length,prev:new Date(prev.timestamp).toISOString(),last:new Date(last.timestamp).toISOString()});
  }
})().catch(e=>{console.error(e);process.exit(1)});
