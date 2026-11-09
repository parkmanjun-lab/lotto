import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = fileURLToPath(new URL('..', import.meta.url));
const compiled = (await build({ absWorkingDir: root, entryPoints: ['lib/visit-environment.ts'], bundle: true, write: false, format: 'esm', platform: 'node', tsconfig: 'tsconfig.json' })).outputFiles[0].text;
const {
  parseVisitEnvironment, VISIT_USER_AGENT_MAX_LENGTH,
  VISIT_DEVICES, VISIT_OSES, VISIT_BROWSERS, VISIT_DISPLAY_MODES,
  VISIT_DEVICE_LABELS, VISIT_OS_LABELS, VISIT_BROWSER_LABELS, VISIT_DISPLAY_MODE_LABELS,
  normalizeVisitDevice, normalizeVisitOs, normalizeVisitBrowser, normalizeVisitDisplayMode,
} = await import('data:text/javascript;base64,' + Buffer.from(compiled).toString('base64'));

// Synthetic headers only. No live visitor or browser data is used in these fixtures.
const cases = [
  ['iPhone Safari', 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1', 'iphone', 'ios', 'safari'],
  ['iPhone Chrome', 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 CriOS/130.0.0.0 Mobile/15E148 Safari/604.1', 'iphone', 'ios', 'chrome'],
  ['iPhone Firefox', 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 FxiOS/130.0 Mobile/15E148 Safari/605.1.15', 'iphone', 'ios', 'firefox'],
  ['iPhone Edge', 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 EdgiOS/130.0 Mobile/15E148 Safari/605.1.15', 'iphone', 'ios', 'edge'],
  ['iPad Safari', 'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1', 'ipad', 'ios', 'safari'],
  ['iPad mobile hint', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/605.1.15', 'ipad', 'ios', 'safari'],
  ['Android phone Chrome', 'Mozilla/5.0 (Linux; Android 15; SyntheticPhone) AppleWebKit/537.36 Chrome/130.0.0.0 Mobile Safari/537.36', 'android-phone', 'android', 'chrome'],
  ['Android tablet Chrome', 'Mozilla/5.0 (Linux; Android 15; SyntheticTablet) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36', 'android-tablet', 'android', 'chrome'],
  ['Android Samsung Internet', 'Mozilla/5.0 (Linux; Android 15; SyntheticPhone) AppleWebKit/537.36 SamsungBrowser/26.0 Chrome/130.0.0.0 Mobile Safari/537.36', 'android-phone', 'android', 'samsung'],
  ['Android Edge', 'Mozilla/5.0 (Linux; Android 15; SyntheticPhone) AppleWebKit/537.36 Chrome/130.0.0.0 Mobile Safari/537.36 EdgA/130.0.0.0', 'android-phone', 'android', 'edge'],
  ['Windows Edge', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0', 'desktop', 'windows', 'edge'],
  ['Windows Chrome', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36', 'desktop', 'windows', 'chrome'],
  ['Mac Safari', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15', 'desktop', 'macos', 'safari'],
  ['Linux Firefox', 'Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0', 'desktop', 'linux', 'firefox'],
  ['Opera remains other', 'Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36 OPR/114.0.0.0', 'desktop', 'windows', 'other'],
  ['WebView is not claimed as Safari', 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148', 'iphone', 'ios', 'other'],
  ['ChromeOS has no precise supported OS category', 'Mozilla/5.0 (X11; CrOS x86_64 16000.0.0) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36', 'desktop', 'unknown', 'chrome'],
  ['iPod is not an iPhone', 'Mozilla/5.0 (iPod; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 Version/15.0 Mobile/15E148 Safari/604.1', 'unknown', 'ios', 'safari'],
];
for (const [name, ua, device, os, browser] of cases) {
  test('coarse UA estimate: ' + name, () => {
    assert.deepEqual(parseVisitEnvironment(ua), { device, os, browser });
  });
}

test('missing, malformed, unrecognized and oversized headers remain unknown', () => {
  const unknown = { device: 'unknown', os: 'unknown', browser: 'unknown' };
  for (const value of [undefined, null, '', true, 12, {}, [], 'SyntheticCrawler/1.0', 'Safari/605.1.15', 'iPhone\nSafari/1.0', 'iPhone\0Safari/1.0', 'iPhone' + 'x'.repeat(VISIT_USER_AGENT_MAX_LENGTH)]) {
    assert.deepEqual(parseVisitEnvironment(value), unknown);
  }
  const bounded = 'iPhone ' + ' '.repeat(VISIT_USER_AGENT_MAX_LENGTH - 7);
  assert.equal(bounded.length, VISIT_USER_AGENT_MAX_LENGTH);
  assert.equal(parseVisitEnvironment(bounded).device, 'iphone');
  assert.deepEqual(Object.keys(parseVisitEnvironment(cases[0][1])).sort(), ['browser', 'device', 'os']);
});

test('only exact enum values are accepted and every category has a readable label', () => {
  const sets = [
    [VISIT_DEVICES, normalizeVisitDevice, VISIT_DEVICE_LABELS],
    [VISIT_OSES, normalizeVisitOs, VISIT_OS_LABELS],
    [VISIT_BROWSERS, normalizeVisitBrowser, VISIT_BROWSER_LABELS],
    [VISIT_DISPLAY_MODES, normalizeVisitDisplayMode, VISIT_DISPLAY_MODE_LABELS],
  ];
  for (const [values, normalize, labels] of sets) {
    for (const value of values) { assert.equal(normalize(value), value); assert.equal(typeof labels[value], 'string'); }
    for (const value of [undefined, null, '', true, 1, {}, ['browser'], 'STANDALONE', ' browser', 'browser ', '__proto__', 'constructor', '<script>', 'x'.repeat(5000)]) assert.equal(normalize(value), 'unknown');
  }
});
