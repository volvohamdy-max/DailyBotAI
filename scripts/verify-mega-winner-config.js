const assert=require('assert');
const fs=require('fs');
const path=require('path');
const root=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const checks={
 E2:['src/services/scalpStrategies/goldExhaustionV3Strategy.js',['E2','59.5']],
 R3:['src/services/scalpStrategies/goldRapidScalpStrategy.js',['R3']],
 G1:['src/services/scalpStrategies/grokGold92Strategy.js',['GROK','92']],
 P1:['src/services/scalpStrategies/proStrategy.js',['buyExitLevel: 55','sellExitLevel: 45','stopDistance: 12','buyAdxMin: 18']],
 N4:['src/services/scalpStrategies/goldRangeMrStrategy.js',['N4']],
 S0:['src/services/scalpStrategies/goldSweep5Strategy.js',['SWEEP']]
};
for(const [id,[file,tokens]] of Object.entries(checks)){const text=read(file);for(const token of tokens)assert(text.includes(token),`${id} missing ${token}`);console.log(`✅ ${id} ${file}`)}
console.log('✅ SIX WINNER VARIANTS PRESENT: E2 + R3 + G1 + P1 + N4 + S0');
