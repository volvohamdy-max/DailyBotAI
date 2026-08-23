const fs = require('fs');
const path = require('path');

const basePath = path.join(__dirname, 'backtest-all-live-strategies-v2.js');
let source = fs.readFileSync(basePath, 'utf8');

// Patch the unified backtest so New York matches the current live settings.
const marker = "if(!source.includes('⚡ GROK GOLD 92 — LIVE')){";
const patches = String.raw`
source = source.replace('if(!(adx>=22))continue;','if(!(adx>=24))continue;');
source = source.replace('if(chase>0.5)continue;','if(chase>0.2)continue;');
source = source.replace('if(md!==side||Math.abs(str)<1)continue;','if(md!==side||Math.abs(str)<2)continue;');
source = source.replace('if(Math.abs(close-open)/atr>0.35)continue;','if(Math.abs(close-open)/atr>0.20)continue;');
source = source.replace('if(Math.min(Math.abs(entry-ema20),Math.abs(entry-vw))/atr>0.5)continue;','if(Math.min(Math.abs(entry-ema20),Math.abs(entry-vw))/atr>0.20)continue;');
source = source.replace("const sl=side==='BUY'?entry-risk:entry+risk,tp=side==='BUY'?entry+risk:entry-risk;","const sl=side==='BUY'?entry-risk:entry+risk,tp=side==='BUY'?entry+risk*1.5:entry-risk*1.5;");
source = source.replace('🤖 ALL 5 LIVE GOLD STRATEGIES — UNIFIED BACKTEST','🤖 ALL 5 LIVE GOLD STRATEGIES — UNIFIED BACKTEST V3');
`;
if(!source.includes(marker)) throw new Error('V2 injection marker not found');
source = source.replace(marker, patches + '\n' + marker);

eval(source);
