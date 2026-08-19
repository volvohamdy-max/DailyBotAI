// Centralized formatter for market/news text.
// Adds Telegram-searchable hashtags to currencies, assets and major US indices
// without changing trading logic or numeric values.

const RULES = [
  // Symbols / pairs first so USD inside XAUUSD is not touched separately.
  [/\bXAUUSD\b/gi, '#XAUUSD'],
  [/\bXAU\b/gi, '#XAU'],
  [/\bBTCUSD\b/gi, '#BTCUSD'],
  [/\bEURUSD\b/gi, '#EURUSD'],
  [/\bGBPUSD\b/gi, '#GBPUSD'],
  [/\bUSDJPY\b/gi, '#USDJPY'],
  [/\bUSDCHF\b/gi, '#USDCHF'],
  [/\bUSDCAD\b/gi, '#USDCAD'],
  [/\bAUDUSD\b/gi, '#AUDUSD'],
  [/\bNZDUSD\b/gi, '#NZDUSD'],
  [/\bEURJPY\b/gi, '#EURJPY'],
  [/\bGBPJPY\b/gi, '#GBPJPY'],
  [/\bEURGBP\b/gi, '#EURGBP'],
  [/\bCHFJPY\b/gi, '#CHFJPY'],

  [/\bUSD\b/gi, '#USD'],
  [/\bEUR\b/gi, '#EUR'],
  [/\bGBP\b/gi, '#GBP'],
  [/\bJPY\b/gi, '#JPY'],
  [/\bCHF\b/gi, '#CHF'],
  [/\bCAD\b/gi, '#CAD'],
  [/\bAUD\b/gi, '#AUD'],
  [/\bNZD\b/gi, '#NZD'],
  [/\bCNY\b/gi, '#CNY'],

  [/\bNASDAQ(?:\s*100)?\b/gi, '#NASDAQ'],
  [/\bNAS100\b/gi, '#NAS100'],
  [/\bUS100\b/gi, '#US100'],
  [/\bDOW\s*JONES\b/gi, '#DowJones'],
  [/\bDJIA\b/gi, '#DJIA'],
  [/\bUS30\b/gi, '#US30'],
  [/\bWALL\s*STREET\b/gi, '#WallStreet'],
  [/\bS&P\s*500\b/gi, '#SP500'],
  [/\bSPX\b/gi, '#SPX'],

  // Arabic: hashtags cannot contain spaces, so multi-word names are joined.
  [/(?:الدولار الأمريكي|الدولار الامريكي)/g, '#الدولار_الأمريكي'],
  [/الدولار/g, '#الدولار'],
  [/اليورو/g, '#اليورو'],
  [/(?:الجنيه الإسترليني|الجنيه الاسترليني)/g, '#الجنيه_الإسترليني'],
  [/(?:الإسترليني|الاسترليني)/g, '#الإسترليني'],
  [/الين الياباني/g, '#الين_الياباني'],
  [/الين/g, '#الين'],
  [/الفرنك السويسري/g, '#الفرنك_السويسري'],
  [/الفرنك/g, '#الفرنك'],
  [/الذهب/g, '#الذهب'],
  [/وول ستريت/g, '#وول_ستريت'],
  [/داو جونز/g, '#داو_جونز'],
  [/ناسداك/g, '#ناسداك']
];

function isInsideExistingHashtag(whole, offset) {
  const before = whole.slice(0, offset);
  const tokenStart = Math.max(
    before.lastIndexOf(' '),
    before.lastIndexOf('\n'),
    before.lastIndexOf('\t')
  ) + 1;
  return before.slice(tokenStart).includes('#');
}

function addMarketHashtags(text) {
  let out = String(text ?? '');

  for (const [pattern, replacement] of RULES) {
    out = out.replace(pattern, (match, offset, whole) => {
      if (isInsideExistingHashtag(whole, offset)) return match;
      return replacement;
    });
  }

  return out.replace(/#{2,}/g, '#');
}

module.exports = { addMarketHashtags };
