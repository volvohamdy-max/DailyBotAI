const OriginalDateTimeFormat = Intl.DateTimeFormat;

function normalizeTimeZone(options) {
  if (!options || typeof options !== 'object') return options;
  if (options.timeZone !== 'Europe/Frankfurt') return options;
  return { ...options, timeZone: 'Europe/Berlin' };
}

function PatchedDateTimeFormat(locales, options) {
  return new OriginalDateTimeFormat(locales, normalizeTimeZone(options));
}

Object.setPrototypeOf(PatchedDateTimeFormat, OriginalDateTimeFormat);
PatchedDateTimeFormat.prototype = OriginalDateTimeFormat.prototype;
PatchedDateTimeFormat.supportedLocalesOf = OriginalDateTimeFormat.supportedLocalesOf.bind(OriginalDateTimeFormat);

Intl.DateTimeFormat = PatchedDateTimeFormat;

module.exports = { normalizeTimeZone };
