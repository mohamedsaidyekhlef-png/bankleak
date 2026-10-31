import { merchantOf } from "./merchant.mjs";

const DAY = 864e5;
const days = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / DAY);
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const r2 = (n) => Math.round(n * 100) / 100 || 0; // "|| 0" turns -0 into 0

const CADENCES = [
  { name: "weekly", min: 5, max: 9, perYear: 52 },
  { name: "every 2 weeks", min: 12, max: 17, perYear: 26 },
  { name: "monthly", min: 25, max: 36, perYear: 12 },
  { name: "every 2 months", min: 55, max: 67, perYear: 6 },
  { name: "quarterly", min: 80, max: 100, perYear: 4 },
  { name: "every 6 months", min: 170, max: 195, perYear: 2 },
  { name: "yearly", min: 330, max: 400, perYear: 1 },
];

const FEE_RULES = [
  ["Overdraft & interest", /overdraft|\bod\s?fee|interest charge|debit interest|agios|int(é|e)r(ê|e)ts?\s+d(é|e)bit|commission\s+d'?intervention|فوائد مدينة|insufficient funds|\bnsf\b/i],
  ["Penalties & rejected payments", /\b(late|returned|unpaid|bounced)\s+(payment\s+|item\s+)?(fee|charge)|rejet|impay(é|e)|frais\s+de\s+rejet|penalt(y|ies)|p(é|e)nalit(é|e)/i],
  ["Foreign & currency fees", /^fee:.*(exchang|convert|conversion|fx\b)|foreign\s+(transaction|exchange|currency)\s*(fee|charge)?|non-?sterling|\bfx\s+(fee|charge|commission)|international\s+(transaction|payment)\s+fee|frais\s+(sur\s+)?(op(é|e)ration|paiement|achat|retrait)s?\s+(à\s+l'?|a\s+l'?|hors\s+)?(é|e)tranger|commission\s+(de\s+)?change|currency\s+conversion\s+fee/i],
  ["Cash machine (ATM) fees", /^fee:.*(\batm\b|cash at|cash withdrawal)|\batm\s+(fee|charge|withdrawal fee)|cash\s+withdrawal\s+fee|(frais|commission)\s+(de\s+|sur\s+)?retrait|(frais|commission).{0,20}\b(gab|dab)\b|رسوم\s+السحب/i],
  ["Account & card fees", /(monthly|annual|account|maintenance|service|package|card)\s+(account\s+)?(fee|charge)|tenue\s+de\s+compte|cotisation\s+(carte|package|offre|compte|formule|annuelle\s+carte|visa|mastercard|cb\b)|frais\s+(de\s+)?(gestion|tenue|carte|package|abonnement\s+banc)|droits?\s+de\s+timbre|tva\s+s\/?\s*comm|commission\s+(de\s+)?(gestion|compte|tenue)|رسوم\s+(الحساب|البطاقة)|عمولة\s+(تسيير|الحساب)/i],
  ["Transfer fees", /(wire|transfer|swift|sepa)\s+(fee|charge)|frais\s+(de\s+)?virement|commission\s+(sur\s+)?virement|رسوم\s+التحويل/i],
  // Banks label their own charges by starting the line with the fee word; "SCHOOL FEES" or "COTISATION MUTUELLE" are not bank fees.
  ["Other bank fees", /\bbank\s+(fee|charge)s?\b|^\s*(fees?|frais|commissions?|charges?)\b|\bfrais\s+bancaires?\b|^\s*(رسوم|عمولة)/i],
];

function classifyFee(desc) {
  if (/refund|reversal|rembours|annulation|ristourne|cashback/i.test(desc)) return null;
  for (const [cat, re] of FEE_RULES) if (re.test(desc)) return cat;
  return null;
}

/**
 * Analyse transactions. Returns everything the report needs.
 * opts: { currency, today }
 */
export function analyse(txns, opts = {}) {
  const tx = txns
    .filter((t) => t.date && isFinite(t.amount))
    .map((t, i) => ({ ...t, id: i, merchant: merchantOf(t.description) }))
    .sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
  if (!tx.length) throw new Error("No usable transactions found.");
  const start = tx[0].date, end = tx[tx.length - 1].date;
  const spanDays = Math.max(1, days(start, end) + 1);
  const annualise = (sum) => (spanDays >= 28 ? (sum * 365) / spanDays : null);
  const currency = opts.currency || mostCommon(tx.map((t) => t.currency).filter(Boolean)) || "";

  const debits = tx.filter((t) => t.amount < 0);
  const credits = tx.filter((t) => t.amount > 0);

  // ── Fees ─────────────────────────────────────────────
  const feeTx = [];
  for (const t of debits) {
    if (t.merchant.known) continue;
    const cat = classifyFee(t.description);
    if (cat) feeTx.push({ ...t, feeCategory: cat });
  }
  const feeIds = new Set(feeTx.map((t) => t.id));
  const feeByCat = {};
  for (const t of feeTx) (feeByCat[t.feeCategory] ||= []).push(t);
  const feeTotal = r2(-feeTx.reduce((s, t) => s + t.amount, 0));
  const fees = {
    total: feeTotal,
    perYear: annualise(feeTotal) !== null ? r2(annualise(feeTotal)) : null,
    categories: Object.entries(feeByCat).map(([category, list]) => ({
      category, count: list.length, total: r2(-list.reduce((s, t) => s + t.amount, 0)),
      examples: list.slice(0, 4).map((t) => ({ date: t.date, description: t.description, amount: t.amount })),
    })).sort((a, b) => b.total - a.total),
  };

  // ── Recurring payments ───────────────────────────────
  const CASH = /\b(atm|cash withdrawal|withdrawal|retrait|gab|dab|distributeur)\b|سحب/i;
  const groups = new Map();
  for (const t of debits) {
    if (feeIds.has(t.id)) continue;
    if (CASH.test(t.description) && !t.merchant.known) continue; // cash isn't a subscription
    const k = t.merchant.key;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(t);
  }
  const recurring = [];
  const inSeries = new Set();
  for (const [key, list] of groups) {
    const series = findSeries(list, end);
    if (!series) continue;
    series.items.forEach((t) => inSeries.add(t.id));
    const m = list[0].merchant;
    recurring.push({ key, name: m.name, category: m.category, known: m.known, ...series.summary, sample: series.items.at(-1).description });
  }
  recurring.sort((a, b) => b.perYear - a.perYear);
  const active = recurring.filter((r) => r.active);

  // ── Price increases ─────────────────────────────────
  const priceIncreases = recurring
    .filter((r) => r.active && r.amountChange && r.amountChange.to > r.amountChange.from * 1.03 && r.amountChange.to - r.amountChange.from >= 0.5)
    .map((r) => ({ name: r.name, from: r.amountChange.from, to: r.amountChange.to, since: r.amountChange.since, extraPerYear: r2((r.amountChange.to - r.amountChange.from) * r.perYearCount) }));

  // ── Possible duplicate charges ──────────────────────
  const duplicates = [];
  for (const list of groups.values()) {
    const frequent = list.length >= 8;
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i], b = list[j];
        const gap = days(a.date, b.date);
        if (gap > 2) break;
        if (a.amount !== b.amount || -a.amount < 5) continue;
        if (frequent && !a.merchant.known) continue; // a café you visit daily isn't a duplicate
        if (duplicates.some((d) => d.ids.includes(a.id) || d.ids.includes(b.id))) continue;
        duplicates.push({ name: a.merchant.name, amount: -a.amount, dates: [a.date, b.date], description: b.description, ids: [a.id, b.id] });
      }
    }
  }

  // ── Overlapping services ────────────────────────────
  const OVERLAP_CATS = new Set(["video", "music", "cloud storage", "AI assistants", "VPN", "delivery", "office & cloud", "design"]);
  const byCat = {};
  for (const r of active) if (r.known && OVERLAP_CATS.has(r.category)) (byCat[r.category] ||= []).push(r);
  const overlaps = Object.entries(byCat).filter(([, l]) => l.length >= 2).map(([category, l]) => {
    const sorted = [...l].sort((a, b) => b.perYear - a.perYear);
    return { category, services: sorted.map((r) => ({ name: r.name, perYear: r.perYear })), keepOneSaves: r2(sorted.slice(1).reduce((s, r) => s + r.perYear, 0)) };
  });

  // ── Subscription charges outside a series (annual renewals, new sign-ups) ──
  const singles = debits
    .filter((t) => t.merchant.known && !inSeries.has(t.id) && !feeIds.has(t.id) && -t.amount >= 3)
    .map((t) => ({ name: t.merchant.name, category: t.merchant.category, date: t.date, amount: -t.amount, description: t.description, recent: days(t.date, end) <= 45 }))
    .sort((a, b) => b.amount - a.amount);

  const leak = {
    fees: fees.perYear ?? fees.total,
    priceIncreases: r2(priceIncreases.reduce((s, p) => s + p.extraPerYear, 0)),
    overlaps: r2(overlaps.reduce((s, o) => s + o.keepOneSaves, 0)),
    duplicates: r2(duplicates.reduce((s, d) => s + d.amount, 0)),
  };
  leak.total = r2(leak.fees + leak.priceIncreases + leak.overlaps + leak.duplicates);

  return {
    tool: "bankleak",
    version: "0.1.0",
    period: { start, end, days: spanDays },
    currency,
    counts: { transactions: tx.length, debits: debits.length, credits: credits.length },
    spending: r2(-debits.reduce((s, t) => s + t.amount, 0)),
    income: r2(credits.reduce((s, t) => s + t.amount, 0)),
    recurring,
    recurringPerYear: r2(active.reduce((s, r) => s + r.perYear, 0)),
    fees,
    priceIncreases,
    duplicates: duplicates.map(({ ids, ...d }) => d),
    overlaps,
    singles,
    leak,
  };
}

/** Find a regular series in one merchant's charges. */
function findSeries(list, end) {
  // One charge per day at most: same-day charges are a duplicate question, not cadence.
  const byDay = [];
  for (const t of list) if (!byDay.length || byDay.at(-1).date !== t.date) byDay.push(t);
  if (byDay.length < 2) return null;
  const gaps = byDay.slice(1).map((t, i) => days(byDay[i].date, t.date));
  const g = median(gaps);
  const cad = CADENCES.find((c) => g >= c.min && g <= c.max);
  if (!cad) return null;
  if (cad.perYear > 1 && byDay.length < 3) return null; // two monthly-ish charges could be chance
  const regular = gaps.filter((x) => x >= cad.min * 0.75 && x <= cad.max * 1.25).length / gaps.length;
  if (regular < 0.6) return null;
  const amounts = byDay.map((t) => -t.amount);
  const typical = median(amounts);
  const spread = (Math.max(...amounts) - Math.min(...amounts)) / typical;
  const known = list[0].merchant.known;
  if (!known && spread > 0.35) return null; // groceries every week aren't a subscription
  const last = byDay.at(-1);
  const active = days(last.date, end) <= g * 1.6 + 3;
  // Price change: compare the first and the latest amount when they differ consistently.
  let amountChange = null;
  const first = amounts[0], latest = amounts.at(-1);
  if (latest !== first) {
    const idx = amounts.findIndex((a) => a === latest);
    const since = byDay[idx].date;
    if (amounts.slice(idx).every((a) => Math.abs(a - latest) < 0.01)) amountChange = { from: first, to: latest, since };
  }
  return {
    items: byDay,
    summary: {
      cadence: cad.name,
      perYearCount: cad.perYear,
      typical: r2(latest),
      perYear: r2(latest * cad.perYear),
      count: byDay.length,
      first: byDay[0].date,
      last: last.date,
      active,
      variable: spread > 0.1,
      amountChange,
    },
  };
}

function mostCommon(xs) {
  const c = {};
  for (const x of xs) c[x] = (c[x] || 0) + 1;
  return Object.entries(c).sort((a, b) => b[1] - a[1])[0]?.[0];
}
