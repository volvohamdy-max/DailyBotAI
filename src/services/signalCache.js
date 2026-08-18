const cache = {};

function saveSignal(pair, data) {
  cache[pair] = {
    data,
    time: Date.now()
  };
}

function getSignal(pair) {
  const item = cache[pair];

  if (!item) return null;

  // صالح لمدة 5 دقائق
  if (Date.now() - item.time > 300000) {
    delete cache[pair];
    return null;
  }

  return item.data;
}

module.exports = {
  saveSignal,
  getSignal
};
