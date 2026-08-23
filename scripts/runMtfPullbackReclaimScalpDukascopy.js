const path = require('path');

const original = require.resolve('./backtestHistoryV21');
const dukascopy = require('./backtestHistoryDukascopyLocal');

require.cache[original] = {
  id: original,
  filename: original,
  loaded: true,
  exports: dukascopy,
  children: [],
  paths: module.paths
};

console.log('📊 DATA SOURCE: DUKASCOPY LOCAL M5');
require('./backtestMtfPullbackReclaimScalp');
