function formatSignal(signal) {
  return [
    `الاتجاه: ${signal.action}`,
    `الدخول: ${signal.entry}`,
    `وقف الخسارة: ${signal.stopLoss}`,
    `الأهداف: ${signal.targets.join(' / ')}`,
    `الثقة: ${signal.confidence}%`,
    `السبب: ${signal.reason}`
  ].join('\n');
}

module.exports = { formatSignal };
