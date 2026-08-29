const modules=[
'../src/services/scalpStrategies/goldExhaustionV3Strategy',
'../src/services/scalpStrategies/goldRapidScalpStrategy',
'../src/services/scalpStrategies/grokGold92Strategy',
'../src/services/scalpStrategies/proStrategy',
'../src/services/scalpStrategies/goldRangeMrStrategy',
'../src/services/scalpStrategies/goldSweep5Strategy',
'../src/services/goldScalper',
'../src/services/autoSignals',
'../src/services/tradeMonitor'
];
for(const mod of modules){require(mod);console.log('✅ LOAD',mod)}
console.log('✅ ALL MEGA WINNER LIVE MODULES LOAD');
