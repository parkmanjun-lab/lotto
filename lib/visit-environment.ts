/** Coarse, untrusted visit estimates. Never use these values for identity or authorization. */
export const VISIT_DEVICES = ['iphone', 'ipad', 'android-phone', 'android-tablet', 'desktop', 'unknown'] as const;
export const VISIT_OSES = ['ios', 'android', 'windows', 'macos', 'linux', 'unknown'] as const;
export const VISIT_BROWSERS = ['safari', 'chrome', 'edge', 'firefox', 'samsung', 'other', 'unknown'] as const;
export const VISIT_DISPLAY_MODES = ['browser', 'standalone', 'unknown'] as const;

export type VisitDevice = typeof VISIT_DEVICES[number];
export type VisitOs = typeof VISIT_OSES[number];
export type VisitBrowser = typeof VISIT_BROWSERS[number];
export type VisitDisplayMode = typeof VISIT_DISPLAY_MODES[number];
export type VisitEnvironment = { device: VisitDevice; os: VisitOs; browser: VisitBrowser };

export const VISIT_DEVICE_LABELS: Record<VisitDevice, string> = {
  iphone: '아이폰', ipad: '아이패드', 'android-phone': '안드로이드폰',
  'android-tablet': '안드로이드 태블릿', desktop: 'PC', unknown: '미확인',
};
export const VISIT_OS_LABELS: Record<VisitOs, string> = {
  ios: 'iOS', android: 'Android', windows: 'Windows', macos: 'macOS', linux: 'Linux', unknown: '미확인',
};
export const VISIT_BROWSER_LABELS: Record<VisitBrowser, string> = {
  safari: 'Safari', chrome: 'Chrome', edge: 'Edge', firefox: 'Firefox',
  samsung: '삼성 인터넷', other: '기타 브라우저', unknown: '미확인',
};
export const VISIT_DISPLAY_MODE_LABELS: Record<VisitDisplayMode, string> = {
  browser: '일반 브라우저', standalone: '홈 화면 앱', unknown: '미확인',
};

export const VISIT_USER_AGENT_MAX_LENGTH = 1024;

function category<T extends string>(value: unknown, choices: readonly T[]): T | 'unknown' {
  return typeof value === 'string' && (choices as readonly string[]).includes(value) ? value as T : 'unknown';
}
export function normalizeVisitDevice(value: unknown): VisitDevice { return category(value, VISIT_DEVICES); }
export function normalizeVisitOs(value: unknown): VisitOs { return category(value, VISIT_OSES); }
export function normalizeVisitBrowser(value: unknown): VisitBrowser { return category(value, VISIT_BROWSERS); }
export function normalizeVisitDisplayMode(value: unknown): VisitDisplayMode { return category(value, VISIT_DISPLAY_MODES); }

/** Classify a bounded UA in memory only; never return or retain the raw header, model, or versions. */
export function parseVisitEnvironment(userAgent: unknown): VisitEnvironment {
  const result: VisitEnvironment = { device: 'unknown', os: 'unknown', browser: 'unknown' };
  if (typeof userAgent !== 'string' || !userAgent || userAgent.length > VISIT_USER_AGENT_MAX_LENGTH || /[\u0000-\u001f\u007f]/.test(userAgent)) return result;

  // Some iPads advertise Macintosh plus Mobile. Fully desktop-style iPad UAs
  // cannot be distinguished from a Mac without collecting extra client signals.
  if (/\biPad\b/i.test(userAgent) || (/\bMacintosh\b/i.test(userAgent) && /\bMobile\//i.test(userAgent))) {
    result.device = 'ipad'; result.os = 'ios';
  } else if (/\biPod\b/i.test(userAgent)) {
    result.os = 'ios';
  } else if (/\biPhone\b/i.test(userAgent)) {
    result.device = 'iphone'; result.os = 'ios';
  } else if (/\bAndroid\b/i.test(userAgent)) {
    result.device = /\bMobile\b/i.test(userAgent) ? 'android-phone' : 'android-tablet'; result.os = 'android';
  } else if (/\bWindows (?:NT|Phone)\b/i.test(userAgent)) {
    result.device = /\bWindows Phone\b/i.test(userAgent) ? 'unknown' : 'desktop'; result.os = 'windows';
  } else if (/\b(?:Macintosh|Mac OS X)\b/i.test(userAgent)) {
    result.device = 'desktop'; result.os = 'macos';
  } else if (/\bCrOS\b/i.test(userAgent)) {
    result.device = 'desktop';
  } else if (/\bLinux\b/i.test(userAgent)) {
    result.device = 'desktop'; result.os = 'linux';
  }

  // Browser families overlap in UA tokens, so specific variants precede Chrome/Safari.
  if (/\b(?:Edg|EdgA|EdgiOS|Edge)\//i.test(userAgent)) result.browser = 'edge';
  else if (/\bSamsungBrowser\//i.test(userAgent)) result.browser = 'samsung';
  else if (/\b(?:Firefox|FxiOS)\//i.test(userAgent)) result.browser = 'firefox';
  else if (/\b(?:OPR|Opera|OPiOS|Vivaldi|UCBrowser|YaBrowser|DuckDuckGo)\//i.test(userAgent)) result.browser = 'other';
  else if (/\b(?:Chrome|CriOS|Chromium)\//i.test(userAgent)) result.browser = 'chrome';
  else if (/\bVersion\//i.test(userAgent) && /\bSafari\//i.test(userAgent)) result.browser = 'safari';
  else if (/\b(?:AppleWebKit|Gecko|Trident)\//i.test(userAgent) || /\bMSIE\s/i.test(userAgent)) result.browser = 'other';
  return result;
}
