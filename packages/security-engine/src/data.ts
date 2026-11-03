// Built-in reference data. Larger, regularly updated lists come from services/threat-intel.

/** Frequently impersonated brands and their official registrable domains. */
export const PROTECTED_BRANDS: { brand: string; domains: string[] }[] = [
  { brand: 'paypal', domains: ['paypal.com', 'paypal.me'] },
  { brand: 'google', domains: ['google.com', 'google.co.za', 'gmail.com', 'youtube.com', 'googleusercontent.com', 'gstatic.com'] },
  { brand: 'microsoft', domains: ['microsoft.com', 'live.com', 'outlook.com', 'office.com', 'microsoftonline.com', 'office365.com', 'bing.com', 'azure.com'] },
  { brand: 'apple', domains: ['apple.com', 'icloud.com'] },
  { brand: 'amazon', domains: ['amazon.com', 'amazon.co.uk', 'amazon.co.za', 'amazonaws.com', 'aws.amazon.com'] },
  { brand: 'facebook', domains: ['facebook.com', 'fb.com', 'meta.com'] },
  { brand: 'instagram', domains: ['instagram.com'] },
  { brand: 'whatsapp', domains: ['whatsapp.com', 'whatsapp.net'] },
  { brand: 'netflix', domains: ['netflix.com'] },
  { brand: 'linkedin', domains: ['linkedin.com'] },
  { brand: 'dropbox', domains: ['dropbox.com'] },
  { brand: 'github', domains: ['github.com', 'github.io'] },
  { brand: 'coinbase', domains: ['coinbase.com'] },
  { brand: 'binance', domains: ['binance.com'] },
  { brand: 'metamask', domains: ['metamask.io'] },
  { brand: 'steam', domains: ['steampowered.com', 'steamcommunity.com'] },
  { brand: 'dhl', domains: ['dhl.com', 'dhl.co.za'] },
  { brand: 'fedex', domains: ['fedex.com'] },
  // South African banks and services
  { brand: 'fnb', domains: ['fnb.co.za'] },
  { brand: 'absa', domains: ['absa.co.za', 'absa.africa'] },
  { brand: 'capitecbank', domains: ['capitecbank.co.za'] },
  { brand: 'capitec', domains: ['capitecbank.co.za'] },
  { brand: 'standardbank', domains: ['standardbank.co.za', 'standardbank.com'] },
  { brand: 'nedbank', domains: ['nedbank.co.za'] },
  { brand: 'discovery', domains: ['discovery.co.za'] },
  { brand: 'sars', domains: ['sars.gov.za'] },
  { brand: 'takealot', domains: ['takealot.com'] },
  { brand: 'vodacom', domains: ['vodacom.co.za'] },
  { brand: 'mtn', domains: ['mtn.co.za', 'mtn.com'] },
];

/** Words common in phishing URLs. Only meaningful combined with other signals. */
export const PHISHING_KEYWORDS = ['login', 'signin', 'sign-in', 'verify', 'verification', 'secure', 'account', 'update',
  'confirm', 'banking', 'wallet', 'unlock', 'suspended', 'recover', 'password', 'billing', 'invoice', 'support', 'auth', 'webscr', 'seed', 'airdrop', 'claim'];

/** TLDs disproportionately used for abuse (low weight; many legitimate sites use them). */
export const HIGH_RISK_TLDS = new Set(['zip', 'mov', 'top', 'xyz', 'click', 'country', 'gq', 'tk', 'ml', 'ga', 'cf', 'work', 'support', 'rest', 'fit', 'loan', 'cam', 'icu', 'buzz']);

/** Known URL shorteners (hide the real destination). */
export const URL_SHORTENERS = new Set(['bit.ly', 'tinyurl.com', 't.co', 'goo.gl', 'is.gd', 'ow.ly', 'buff.ly', 'rebrand.ly', 'cutt.ly', 'shorturl.at', 'rb.gy', 'tiny.cc']);

/**
 * Tracker domains (registrable domains) by category. A curated starter list; the threat-intel
 * service can supply larger lists (e.g. from Disconnect or EasyPrivacy, subject to their licences).
 */
export const TRACKER_DOMAINS: Record<string, 'advertising' | 'analytics' | 'social' | 'fingerprinting' | 'cryptomining'> = {
  'doubleclick.net': 'advertising', 'googlesyndication.com': 'advertising', 'googleadservices.com': 'advertising',
  'adservice.google.com': 'advertising', 'adnxs.com': 'advertising', 'criteo.com': 'advertising', 'criteo.net': 'advertising',
  'taboola.com': 'advertising', 'outbrain.com': 'advertising', 'rubiconproject.com': 'advertising', 'pubmatic.com': 'advertising',
  'openx.net': 'advertising', 'casalemedia.com': 'advertising', 'adsrvr.org': 'advertising', 'amazon-adsystem.com': 'advertising',
  'moatads.com': 'advertising', 'scorecardresearch.com': 'analytics', 'quantserve.com': 'analytics', 'bidswitch.net': 'advertising',
  '3lift.com': 'advertising', 'sharethrough.com': 'advertising', 'yieldmo.com': 'advertising', 'media.net': 'advertising',
  'adform.net': 'advertising', 'smartadserver.com': 'advertising', 'teads.tv': 'advertising', 'zemanta.com': 'advertising',
  'google-analytics.com': 'analytics', 'googletagmanager.com': 'analytics', 'googletagservices.com': 'advertising',
  'hotjar.com': 'analytics', 'mixpanel.com': 'analytics', 'segment.io': 'analytics', 'segment.com': 'analytics',
  'amplitude.com': 'analytics', 'newrelic.com': 'analytics', 'nr-data.net': 'analytics', 'fullstory.com': 'analytics',
  'mouseflow.com': 'analytics', 'crazyegg.com': 'analytics', 'clarity.ms': 'analytics', 'chartbeat.com': 'analytics',
  'chartbeat.net': 'analytics', 'heap.io': 'analytics', 'heapanalytics.com': 'analytics', 'optimizely.com': 'analytics',
  'kissmetrics.com': 'analytics', 'statcounter.com': 'analytics', 'yandex.ru': 'analytics', 'mc.yandex.ru': 'analytics',
  'connect.facebook.net': 'social', 'facebook.net': 'social', 'ads-twitter.com': 'social', 'analytics.twitter.com': 'social',
  'licdn.com': 'social', 'ads.linkedin.com': 'social', 'snap.licdn.com': 'social', 'tiktok.com': 'social',
  'analytics.tiktok.com': 'social', 'pinimg.com': 'social', 'ct.pinterest.com': 'social', 'sc-static.net': 'social',
  'fingerprintjs.com': 'fingerprinting', 'fpjs.io': 'fingerprinting', 'iovation.com': 'fingerprinting', 'threatmetrix.com': 'fingerprinting',
  'coinhive.com': 'cryptomining', 'coin-hive.com': 'cryptomining', 'cryptoloot.pro': 'cryptomining', 'webminepool.com': 'cryptomining',
};

/** File extensions that can run code when opened. */
export const EXECUTABLE_EXTENSIONS = new Set([
  'exe', 'msi', 'msix', 'appx', 'bat', 'cmd', 'com', 'scr', 'pif', 'cpl', 'ps1', 'psm1', 'vbs', 'vbe', 'js', 'jse', 'wsf', 'wsh',
  'hta', 'lnk', 'reg', 'jar', 'apk', 'xapk', 'dmg', 'pkg', 'app', 'deb', 'rpm', 'sh', 'run', 'bin', 'appimage', 'dll', 'sys',
  'iso', 'img', 'vhd', 'vhdx', 'chm', 'msp', 'gadget', 'application', 'command', 'scpt',
]);

/** Documents that can carry macros or exploits. */
export const RISKY_DOCUMENT_EXTENSIONS = new Set(['docm', 'xlsm', 'pptm', 'dotm', 'xltm', 'xlam', 'one', 'svg', 'html', 'htm', 'xhtml', 'mht', 'pdf']);
export const ARCHIVE_EXTENSIONS = new Set(['zip', 'rar', '7z', 'tar', 'gz', 'tgz', 'bz2', 'xz', 'cab', 'ace', 'arj']);
