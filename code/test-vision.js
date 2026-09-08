const path = require('path');
const { describe } = require('./vision.js');

// Regression test for three real bugs the old exec()-based describe() had
// (see comment in vision.js): it hung indefinitely on a non-tty stdin, broke
// on unescaped paths, and corrupted output with embedded ANSI escape codes.
// Uses a tiny generated fixture (not a system file) so this runs the same on
// any machine. Real end-to-end call to Ollama -- no mocking, same discipline
// as test-kokoro.js and test-voice.js.

const FIXTURE = path.join(__dirname, 'test-fixtures', 'sample-red-square.png');

(async () => {
  let pass = 0;
  const results = [];
  const check = (label, ok) => { results.push(`${ok ? 'ok  ' : 'FAIL'} ${label}`); if (ok) pass++; };
  const total = 3;

  let text = null;
  try {
    text = await describe(FIXTURE);
    check(`describe() resolves ("${text.slice(0, 60)}${text.length > 60 ? '...' : ''}")`, true);
  } catch (e) {
    check(`describe() resolves (${e.message})`, false);
  }

  check('response is non-empty text', typeof text === 'string' && text.length > 0);
  // eslint-disable-next-line no-control-regex -- intentionally matching the ANSI escape byte itself
  check('response contains no raw ANSI escape codes', text !== null && !/\x1b\[/.test(text));

  results.forEach(r => console.log(r));
  console.log(`\n${pass}/${total} passed`);
  process.exitCode = pass === total ? 0 : 1;
})();
