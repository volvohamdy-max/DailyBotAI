let latest = null;

function setLatestRegimeDiagnostics(result) {
  latest = result && typeof result === 'object'
    ? { result, capturedAt: Date.now() }
    : null;
}

function getLatestRegimeDiagnostics(maxAgeMs = 2 * 60 * 1000) {
  if (!latest) return null;
  if (Date.now() - latest.capturedAt > maxAgeMs) return null;
  return latest.result;
}

module.exports = {
  setLatestRegimeDiagnostics,
  getLatestRegimeDiagnostics
};
