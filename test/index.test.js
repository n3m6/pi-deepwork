const test = require('node:test');
const assert = require('node:assert/strict');

const { getReadyMessage } = require('../dist/index.js');

test('getReadyMessage returns expected startup message', () => {
  assert.equal(getReadyMessage(), 'pi-deepwork TypeScript project ready');
});
