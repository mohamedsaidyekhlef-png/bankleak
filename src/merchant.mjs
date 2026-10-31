// Turn messy bank descriptions into stable merchant keys, so
// "CB NETFLIX.COM 12/09 4970XXXX1234 AMSTERDAM" and "PRLV SEPA NETFLIX INTL" match.

/** Known recurring services: display name, category, and patterns. */
export const KNOWN = [
  ["Netflix", "video", /netflix/],
  ["Disney+", "video", /disney\s?(plus|\+)|disneyplus/],
  ["Amazon Prime", "video", /prime\s?video|amazon\s?prime|amzn\s?prime|primevideo/],
  ["Max", "video", /\bhbo\b|hbomax|\bmax\.com/],
  ["Apple TV+", "video", /apple\s?tv/],
  ["Paramount+", "video", /paramount/],
  ["Hulu", "video", /\bhulu\b/],
  ["Shahid", "video", /shahid/],
  ["OSN+", "video", /\bosn\b/],
  ["Canal+", "video", /canal\s?\+|canalplus|canal plus/],
  ["YouTube Premium", "video", /youtube\s?(premium|music)|google\s?\*?youtube/],
  ["Spotify", "music", /spotify/],
  ["Apple Music", "music", /apple\s?music/],
  ["Deezer", "music", /deezer/],
  ["Anghami", "music", /anghami/],
  ["Tidal", "music", /\btidal\b/],
  ["iCloud+", "cloud storage", /icloud/],
  ["Google One", "cloud storage", /google\s?(\*|\s)?(one|storage)|google one/],
  ["Dropbox", "cloud storage", /dropbox/],
  ["OneDrive / Microsoft 365", "office & cloud", /microsoft\s?365|office\s?365|msft\s?\*?\s?(365|office)|onedrive/],
  ["ChatGPT", "AI assistants", /openai|chatgpt/],
  ["Claude", "AI assistants", /anthropic|claude\.ai/],
  ["Gemini / Google AI", "AI assistants", /google\s?(\*|\s)?(gemini|ai premium)/],
  ["Perplexity", "AI assistants", /perplexity/],
  ["Midjourney", "AI assistants", /midjourney/],
  ["GitHub", "developer tools", /github/],
  ["Cursor", "developer tools", /cursor(\.com|\s?ai|\.sh)/],
  ["Vercel", "developer tools", /vercel/],
  ["Adobe", "design", /adobe/],
  ["Canva", "design", /canva/],
  ["Figma", "design", /figma/],
  ["Notion", "productivity", /notion\.so|\bnotion\b/],
  ["Grammarly", "productivity", /grammarly/],
  ["LinkedIn Premium", "productivity", /linkedin/],
  ["Audible", "books", /audible/],
  ["Kindle Unlimited", "books", /kindle/],
  ["Duolingo", "learning", /duolingo/],
  ["Xbox Game Pass", "gaming", /xbox|game\s?pass|microsoft\s?\*?xbox/],
  ["PlayStation Plus", "gaming", /playstation|sony\s?interactive|psn/],
  ["Nintendo Online", "gaming", /nintendo/],
  ["NordVPN", "VPN", /nordvpn|nord\s?sec/],
  ["ExpressVPN", "VPN", /expressvpn/],
  ["Surfshark", "VPN", /surfshark/],
  ["Apple (App Store)", "app store", /apple\.com\/bill|itunes|app\s?store|apple services/],
  ["Google Play", "app store", /google\s?\*?\s?play|google\s?\*(?!youtube|one|gemini)/],
  ["Uber One", "delivery", /uber\s?one/],
  ["Deliveroo Plus", "delivery", /deliveroo/],
  ["Glovo Prime", "delivery", /glovo/],
  ["Gym", "fitness", /\bgym\b|fitness|basic-?fit|planet fitness|city club|crossfit/],
  ["Orange", "phone & internet", /\borange\b/],
  ["Maroc Telecom", "phone & internet", /maroc\s?telecom|iam\b|\biam\s/],
  ["inwi", "phone & internet", /\binwi\b/],
];

const NOISE = [
  /\b(cb|carte|card|paiement|payment|purchase|achat|pos|visa|mastercard|mc|debit|prlv|sepa|prelevement|prélèvement|direct debit|dd|sto|standing order|recurring|abonnement|subscription|facture|fact|vir|virement|transfer|trf|online|www|com|net|org|inc|ltd|llc|sarl|sas|sa|gmbh|bv|intl|international|eur|usd|gbp|mad|dh|dhs)\b/g,
  /\b\d{2}[\/.\-]\d{2}([\/.\-]\d{2,4})?\b/g,      // dates
  /\b[\dx*]{4,}\b/g,                               // card numbers, refs
  /\b[a-z]*\d+[a-z\d]*\b/g,                        // tokens with digits (refs, store numbers)
  /[*#:/\\._|,'"()\-+]/g,
];

export function normalize(desc) {
  let s = desc.toLowerCase();
  s = s.replace(/^(paypal|pp|sq|sumup|zettle|stripe|google pay|apple pay)\s*\*\s*/i, "");
  for (const re of NOISE) s = s.replace(re, " ");
  return s.replace(/\s+/g, " ").trim();
}

/** { key, name, category } for a transaction description. */
export function merchantOf(desc) {
  const low = desc.toLowerCase();
  for (const [name, category, re] of KNOWN) if (re.test(low)) return { key: "k:" + name, name, category, known: true };
  const norm = normalize(desc);
  const STOP = new Set(["to", "from", "for", "the", "de", "du", "des", "la", "le", "les", "a", "à", "au", "en", "par", "chez", "and", "et", "via"]);
  const words = norm.split(" ").filter((w) => w.length > 1 && !STOP.has(w));
  const key = words.slice(0, 2).join(" ") || norm || low.slice(0, 20);
  const nameWords = words.slice(0, 4);
  while (nameWords.length > 1 && nameWords.at(-1).length <= 2) nameWords.pop(); // drop trailing codes like "FM"
  const name = nameWords.join(" ").replace(/(^|\s)\S/g, (c) => c.toUpperCase()) || key;
  return { key: "u:" + key, name, category: null, known: false };
}
