const {
  getPrice
} = require('./marketService');

async function getLivePrice(pair) {
  return getPrice(pair);
}

module.exports = {
  getLivePrice
};
