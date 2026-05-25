// Root entry stub for the pi-deepwork extension.
//
// pi loads this file (via "main": "index.js"). It re-exports the compiled
// extension from ./dist/index.js. If dist/ is missing — typically because the
// package was installed from a git source without running the `prepare`
// hook (e.g. `--ignore-scripts`) — we throw a clear, actionable error instead
// of silently degrading to skill-only mode (where pi would still load the
// bundled SKILL.md but no /deepwork command handler would exist).

'use strict';

const path = require('node:path');

const distEntry = path.join(__dirname, 'dist', 'index.js');

try {
  module.exports = require(distEntry);
} catch (err) {
  if (
    err &&
    err.code === 'MODULE_NOT_FOUND' &&
    typeof err.message === 'string' &&
    err.message.includes(distEntry)
  ) {
    const message =
      'pi-deepwork: compiled output is missing at ' +
      distEntry +
      '. The extension package was not built. Recovery: `cd ' +
      __dirname +
      ' && npm install && npm run build`, then restart pi or re-run /deepwork. ' +
      'If you installed with --ignore-scripts, re-run `npm install` without it so the `prepare` script can build the extension.';
    const wrapped = new Error(message);
    wrapped.code = 'PI_DEEPWORK_NOT_BUILT';
    wrapped.cause = err;
    throw wrapped;
  }
  throw err;
}
