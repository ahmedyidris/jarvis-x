// Gate for tests that need the live internet.
//
// The point is NOT to make a red test green. test-agent-data-integration.js
// passes on Ahmed's machine; it fails in CI and in sandboxes because CoinGecko
// is unreachable there, which says nothing about the code. Gating makes the
// default suite deterministic offline while keeping the network path runnable
// on demand:
//
//   npm test        -> network tests SKIP  (reported as skipped, never passed)
//   npm run test:net -> network tests RUN  (JX_NET=1)
//
// A skip must never read as a pass. jest-runner.js looks for the marker below
// and counts skips in their own column, so the summary can't quietly inflate.
const SKIP_MARKER = 'JX_TEST_SKIPPED';

function requireNet(reason) {
  if (process.env.JX_NET) return;
  console.log(`${SKIP_MARKER}: ${reason} — set JX_NET=1 (or run \`npm run test:net\`) to include it`);
  process.exit(0);
}

module.exports = { requireNet, SKIP_MARKER };
