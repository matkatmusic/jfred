// trace-log (api): shared opt-in trace logging for the whole Engine B pipeline.
// Off by default; enableTrace(true) flips it on for every source file that
// requires this module (one shared module singleton holds the flag). logTrace
// is a no-op unless enabled, so threading calls through the hot path costs
// nothing in normal runs.

var enabled = false;

// Turn tracing on or off for the entire pipeline.
function enableTrace(on) {
    enabled = on === true;
}

// Whether tracing is currently on (for callers that want to skip building an
// expensive message before calling logTrace).
function isTraceEnabled() {
    return enabled;
}

// Emit one trace line when enabled; otherwise do nothing.
function logTrace(message) {
    if (enabled) { console.log('[trace] ' + message); }
}

module.exports = {
    enableTrace: enableTrace,
    isTraceEnabled: isTraceEnabled,
    logTrace: logTrace
};
