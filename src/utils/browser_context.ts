export interface BrowserContext {
  /** e.g. Chrome, Firefox, Safari, Edge, Opera, Samsung Internet, unknown */
  name: string;
  /** Semver-ish string when known */
  version: string;
  os: string;
  osVersion: string;
  /** mobile | tablet | desktop | unknown */
  device: string;
  language: string;
  userAgent: string;
  /** True when UA looks like a crawler / headless fetcher. */
  bot: boolean;
  /** Friendly crawler name when recognized (e.g. Baiduspider). */
  botName?: string;
}

/** Known browser triage tags; typed as TagMap for mergeTags compatibility. */
export type BrowserContextTags = {
  'browser.name': string;
  'browser.version': string;
  'os.name': string;
  'os.version': string;
  device: string;
  bot?: string;
  'bot.name'?: string;
} & Record<string, string>;

/** Known crawlers — prefer specific names before the generic bot/spider fallback. */
const BOT_RULES: Array<{ name: string; re: RegExp }> = [
  { name: 'Baiduspider', re: /Baiduspider/i },
  { name: 'Googlebot', re: /Googlebot/i },
  { name: 'Bingbot', re: /bingbot/i },
  { name: 'DuckDuckBot', re: /DuckDuckBot/i },
  { name: 'YandexBot', re: /Yandex(Bot|Images)/i },
  { name: 'Applebot', re: /Applebot/i },
  { name: 'facebookexternalhit', re: /facebookexternalhit|Facebot/i },
  { name: 'Twitterbot', re: /Twitterbot/i },
  { name: 'LinkedInBot', re: /LinkedInBot/i },
  { name: 'Slackbot', re: /Slackbot/i },
  { name: 'Discordbot', re: /Discordbot/i },
  { name: 'Bytespider', re: /Bytespider/i },
  { name: 'PetalBot', re: /PetalBot/i },
  { name: 'SemrushBot', re: /SemrushBot/i },
  { name: 'AhrefsBot', re: /AhrefsBot/i },
  { name: 'DotBot', re: /DotBot/i },
  { name: 'GPTBot', re: /GPTBot/i },
  { name: 'ClaudeBot', re: /ClaudeBot|anthropic-ai/i },
  { name: 'Amazonbot', re: /Amazonbot/i },
  { name: 'Sogou', re: /Sogou/i },
  // Generic last — still mark as bot without inventing a browser name.
  { name: 'bot', re: /\b(?:bot|crawler|spider|slurp)\b/i },
];

export function detectBot(ua: string): { bot: boolean; botName?: string } {
  if (!ua) return { bot: false };
  for (const rule of BOT_RULES) {
    if (rule.re.test(ua)) {
      return {
        bot: true,
        botName: rule.name === 'bot' ? undefined : rule.name,
      };
    }
  }
  return { bot: false };
}

/**
 * Lightweight UA parse — no dependency. Good enough for triage tags;
 * full UA is still attached in extra for debugging.
 */
export function parseBrowserContext(
  ua = typeof navigator !== 'undefined' ? navigator.userAgent : '',
  language = typeof navigator !== 'undefined' ? navigator.language : '',
): BrowserContext {
  const userAgent = ua || '';
  const lang = language || '';
  const botInfo = detectBot(userAgent);

  let name = 'unknown';
  let version = '';

  // Order matters: Edge/Opera/Samsung before Chrome; Chrome before Safari.
  const rules: Array<{ name: string; re: RegExp }> = [
    { name: 'Edge', re: /Edg(?:e|A|iOS)?\/([\d.]+)/ },
    { name: 'Opera', re: /OPR\/([\d.]+)/ },
    { name: 'Samsung Internet', re: /SamsungBrowser\/([\d.]+)/ },
    { name: 'Firefox', re: /Firefox\/([\d.]+)/ },
    { name: 'Chrome', re: /(?:Chrome|CriOS)\/([\d.]+)/ },
    { name: 'Safari', re: /Version\/([\d.]+).*Safari/ },
  ];

  // Don't invent a browser for crawlers — leave name unknown.
  if (!botInfo.bot) {
    for (const rule of rules) {
      const m = userAgent.match(rule.re);
      if (m) {
        name = rule.name;
        version = m[1] ?? '';
        break;
      }
    }

    // iOS WebKit without Version/ (rare) — still label Safari-ish.
    if (name === 'unknown' && /iPhone|iPad|iPod/.test(userAgent) && /AppleWebKit/.test(userAgent)) {
      name = 'Safari';
      const m = userAgent.match(/OS ([\d_]+)/);
      if (m?.[1]) version = m[1].replace(/_/g, '.');
    }
  }

  let os = 'unknown';
  let osVersion = '';
  const win = userAgent.match(/Windows NT ([\d.]+)/);
  if (win) {
    os = 'Windows';
    osVersion = win[1] ?? '';
  } else {
    const android = userAgent.match(/Android ([\d.]+)/);
    if (android) {
      os = 'Android';
      osVersion = android[1] ?? '';
    } else {
      const ios = userAgent.match(/(?:iPhone|iPad|iPod).*OS ([\d_]+)/);
      if (ios) {
        os = 'iOS';
        osVersion = (ios[1] ?? '').replace(/_/g, '.');
      } else {
        const mac = userAgent.match(/Mac OS X ([\d_]+)/);
        if (mac) {
          os = 'macOS';
          osVersion = (mac[1] ?? '').replace(/_/g, '.');
        } else if (/CrOS/.test(userAgent)) {
          os = 'Chrome OS';
        } else if (/Linux/.test(userAgent)) {
          os = 'Linux';
        }
      }
    }
  }

  let device: BrowserContext['device'] = 'desktop';
  if (/iPad|Tablet|Android(?!.*Mobile)/i.test(userAgent)) {
    device = 'tablet';
  } else if (/Mobi|iPhone|iPod|Android.*Mobile/i.test(userAgent)) {
    device = 'mobile';
  } else if (!userAgent) {
    device = 'unknown';
  }

  return {
    name,
    version,
    os,
    osVersion,
    device,
    language: lang,
    userAgent,
    bot: botInfo.bot,
    ...(botInfo.botName ? { botName: botInfo.botName } : {}),
  };
}

export function browserContextTags(ctx: BrowserContext): BrowserContextTags {
  return {
    'browser.name': ctx.name,
    'browser.version': ctx.version || 'unknown',
    'os.name': ctx.os,
    'os.version': ctx.osVersion || 'unknown',
    device: ctx.device,
    ...(ctx.bot
      ? {
          bot: 'true',
          ...(ctx.botName ? { 'bot.name': ctx.botName } : {}),
        }
      : {}),
  };
}

/** Prefer Client Hints when available (Chromium). */
export async function collectBrowserContext(): Promise<BrowserContext> {
  const base = parseBrowserContext();

  // Keep crawler classification from UA — Client Hints are for real browsers.
  if (base.bot) return base;

  const nav = typeof navigator !== 'undefined' ? navigator : undefined;
  const uad = (
    nav as Navigator & {
      userAgentData?: {
        brands?: Array<{ brand: string; version: string }>;
        mobile?: boolean;
        platform?: string;
        getHighEntropyValues?: (hints: string[]) => Promise<{
          platformVersion?: string;
          fullVersionList?: Array<{ brand: string; version: string }>;
        }>;
      };
    }
  )?.userAgentData;

  if (!uad) return base;

  if (uad.mobile === true) base.device = 'mobile';
  if (uad.platform) {
    const p = uad.platform;
    if (/Windows/i.test(p)) base.os = 'Windows';
    else if (/macOS|Mac OS/i.test(p)) base.os = 'macOS';
    else if (/Android/i.test(p)) base.os = 'Android';
    else if (/iOS|iPhone/i.test(p)) base.os = 'iOS';
    else if (/Linux/i.test(p)) base.os = 'Linux';
    else if (/Chrome OS|Chromium OS/i.test(p)) base.os = 'Chrome OS';
    else base.os = p;
  }

  const brands = uad.brands ?? [];
  const interesting = brands.find(
    (b) =>
      !/Not.?A.?Brand/i.test(b.brand) &&
      !/Chromium/i.test(b.brand),
  );
  if (interesting) {
    base.name = interesting.brand.replace(/^Google /, '');
    base.version = interesting.version;
  }

  try {
    if (typeof uad.getHighEntropyValues === 'function') {
      const hi = await uad.getHighEntropyValues([
        'platformVersion',
        'fullVersionList',
      ]);
      if (hi.platformVersion) base.osVersion = hi.platformVersion;
      const full = hi.fullVersionList?.find(
        (b) =>
          !/Not.?A.?Brand/i.test(b.brand) &&
          !/Chromium/i.test(b.brand),
      );
      if (full) {
        base.name = full.brand.replace(/^Google /, '');
        base.version = full.version;
      }
    }
  } catch {
    // Permissions / unsupported — keep UA parse.
  }

  return base;
}
