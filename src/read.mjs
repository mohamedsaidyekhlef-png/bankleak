// Turns statement files (CSV in any common bank layout, or OFX/QFX) into
// plain transactions: { date: "YYYY-MM-DD", description, amount, currency? }.
// Debits are negative, credits positive.

const MONTHS = {
  jan: 1, january: 1, janv: 1, janvier: 1, feb: 2, february: 2, fev: 2, fevr: 2, février: 2, fevrier: 2, févr: 2,
  mar: 3, march: 3, mars: 3, apr: 4, april: 4, avr: 4, avril: 4, may: 5, mai: 5, jun: 6, june: 6, juin: 6,
  jul: 7, july: 7, juil: 7, juillet: 7, aug: 8, august: 8, aou: 8, août: 8, aout: 8, sep: 9, sept: 9, september: 9, septembre: 9,
  oct: 10, october: 10, octobre: 10, nov: 11, november: 11, novembre: 11, dec: 12, december: 12, déc: 12, décembre: 12, decembre: 12,
};

/** Decode bytes as UTF-8, falling back to Windows-1252 (common for French bank exports). */
export function decode(buf) {
  let s;
  try { s = new TextDecoder("utf-8", { fatal: true }).decode(buf); }
  catch { s = new TextDecoder("windows-1252").decode(buf); }
  return s.replace(/^﻿/, "");
}

// ── CSV ─────────────────────────────────────────────────────
export function detectDelimiter(lines) {
  const cands = [";", ",", "\t", "|"];
  let best = ",", bestScore = -1;
  for (const d of cands) {
    const counts = lines.slice(0, 30).map((l) => splitCsvLine(l, d).length).filter((n) => n > 1);
    if (!counts.length) continue;
    const mode = counts.sort((a, b) => counts.filter((x) => x === b).length - counts.filter((x) => x === a).length)[0];
    const score = counts.filter((n) => n === mode).length * mode;
    if (score > bestScore) { best = d; bestScore = score; }
  }
  return best;
}

export function splitCsvLine(line, d) {
  const out = [];
  let cur = "", q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; }
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === d) { out.push(cur.trim()); cur = ""; }
    else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

/** Join physical lines that belong to one quoted CSV record. */
function logicalLines(text) {
  const raw = text.replace(/\r\n?/g, "\n").split("\n");
  const out = [];
  let buf = null;
  for (const l of raw) {
    buf = buf === null ? l : buf + " " + l;
    if (((buf.match(/"/g) || []).length % 2) === 0) { out.push(buf); buf = null; }
  }
  if (buf !== null) out.push(buf);
  return out.filter((l) => l.trim());
}

const H = {
  date: /^(date|transaction date|trans(action)?\.? date|posting date|posted date|booking date|value date|date op(é|e)ration|date d'?op(é|e)ration|date comptable|date de valeur|date valeur|completed date|started date|datum|fecha|تاريخ)$/i,
  desc: /^(description|details|transaction details|narrative|memo|payee|merchant|name|label|libell(é|e)|libell(é|e) op(é|e)ration|libell(é|e)s|op(é|e)ration|nature de l'?op(é|e)ration|reference|transaction description|beschreibung|concepto|البيان|الوصف)$/i,
  amount: /^(amount|montant|amount \(.+\)|montant \(.+\)|value|transaction amount|net amount|betrag|importe|المبلغ)$/i,
  debit: /^(debit|débit|debits|débits|debit amount|withdrawal|withdrawals|money out|paid out|out|sortie|retrait|مدين)$/i,
  credit: /^(credit|crédit|credits|crédits|credit amount|deposit|deposits|money in|paid in|in|entrée|versement|دائن)$/i,
  currency: /^(currency|devise|ccy|عملة)$/i,
  type: /^(type|transaction type|debit\/credit|credit\/debit|cr\/dr|dr\/cr|sens|d\/c|c\/d)$/i,
  fee: /^(fee|fees|frais|commission)$/i,
  state: /^(state|status|statut|état)$/i,
};

/** "Débit euros", "Amount (USD)", "Montant (DH)" → "débit", "amount", "montant". */
export function headerCell(c) {
  return c.toLowerCase().replace(/\((.*?)\)/g, " ").replace(/\b(euros?|eur|usd|mad|dh|dhs|dirhams?|gbp|chf|cad|aud|in\s+\w{3})\b|[$€£]/g, " ").replace(/\s+/g, " ").trim();
}

function findHeader(rows) {
  for (let i = 0; i < Math.min(rows.length, 40); i++) {
    const cells = rows[i].map(headerCell);
    const hasDate = cells.some((c) => H.date.test(c) || /^date/.test(c));
    const hasMoney = cells.some((c) => H.amount.test(c) || H.debit.test(c) || H.credit.test(c));
    const hasDesc = cells.some((c) => H.desc.test(c));
    if (hasDate && hasMoney && hasDesc) return i;
  }
  return -1;
}

function pickCol(cells, re, fallback) {
  let i = cells.findIndex((c) => re.test(c));
  if (i < 0 && fallback) i = cells.findIndex(fallback);
  return i;
}

/** Parse "1 234,56", "1.234,56", "1,234.56", "(12.50)", "-12,5 €", "12.50 DR", "−3.00". */
export function parseAmount(raw) {
  if (raw === undefined || raw === null) return null;
  let s = String(raw).trim();
  if (!s) return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  if (/\b(dr|debit|db)\b\.?$/i.test(s)) { neg = true; s = s.replace(/\b(dr|debit|db)\b\.?$/i, ""); }
  s = s.replace(/\b(cr|credit)\b\.?$/i, "");
  s = s.replace(/[−–]/g, "-").replace(/[^\d,.\-+]/g, "");
  if (s.includes("-")) { neg = !neg ? s.trim().startsWith("-") || s.trim().endsWith("-") : neg; s = s.replace(/[-+]/g, ""); }
  else s = s.replace(/\+/g, "");
  if (!/\d/.test(s)) return null;
  const lastComma = s.lastIndexOf(","), lastDot = s.lastIndexOf(".");
  if (lastComma > -1 && lastDot > -1) {
    if (lastComma > lastDot) s = s.replace(/\./g, "").replace(",", ".");
    else s = s.replace(/,/g, "");
  } else if (lastComma > -1) {
    const decimals = s.length - lastComma - 1;
    s = decimals === 3 && (s.match(/,/g) || []).length >= 1 && !/^0,/.test(s) ? s.replace(/,/g, "") : s.replace(/,/g, ".");
  } else if ((s.match(/\./g) || []).length > 1) {
    s = s.replace(/\./g, "");
  }
  const n = Number(s);
  if (!isFinite(n)) return null;
  return Math.round((neg ? -n : n) * 100) / 100;
}

/** Decide the date order used by a column of strings, then parse them all consistently. */
export function makeDateParser(samples) {
  let dayFirst = null;
  for (const s of samples) {
    const m = String(s).trim().match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})/);
    if (!m) continue;
    const a = +m[1], b = +m[2];
    if (a > 12 && b <= 12) { dayFirst = true; break; }
    if (b > 12 && a <= 12) { dayFirst = false; break; }
  }
  if (dayFirst === null) dayFirst = true; // most of the world; US exports usually contain a day > 12 somewhere
  return (raw) => {
    const s = String(raw).trim().toLowerCase().replace(/\s+/g, " ");
    let m = s.match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})/);
    if (m) return iso(+m[1], +m[2], +m[3]);
    m = s.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})/);
    if (m) {
      const y = m[3].length === 2 ? 2000 + +m[3] : +m[3];
      return dayFirst ? iso(y, +m[2], +m[1]) : iso(y, +m[1], +m[2]);
    }
    m = s.match(/^(\d{1,2})[\s\-]([a-zéûô]+)\.?[\s\-,]*(\d{2,4})/);
    if (m && MONTHS[m[2]]) return iso(m[3].length === 2 ? 2000 + +m[3] : +m[3], MONTHS[m[2]], +m[1]);
    m = s.match(/^([a-zéûô]+)\.?\s(\d{1,2}),?\s(\d{4})/);
    if (m && MONTHS[m[1]]) return iso(+m[3], MONTHS[m[1]], +m[2]);
    m = s.match(/^(\d{4})(\d{2})(\d{2})/);
    if (m) return iso(+m[1], +m[2], +m[3]);
    return null;
  };
}

function iso(y, mo, d) {
  if (!(mo >= 1 && mo <= 12 && d >= 1 && d <= 31 && y > 1990 && y < 2100)) return null;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCMonth() !== mo - 1) return null;
  return dt.toISOString().slice(0, 10);
}

/** Guess the currency from header words or symbols near the top of the file. */
function guessCurrency(head) {
  const t = head.toLowerCase();
  if (/\beuros?\b|€|\beur\b/.test(t)) return "EUR";
  if (/\bmad\b|\bdhs?\b|dirham/.test(t)) return "MAD";
  if (/\bgbp\b|£/.test(t)) return "GBP";
  if (/\busd\b|\$/.test(t)) return "USD";
  return undefined;
}

export function parseCsv(text, { source = "csv", signHint } = {}) {
  const lines = logicalLines(text);
  const d = detectDelimiter(lines);
  const rows = lines.map((l) => splitCsvLine(l, d));
  const h = findHeader(rows);
  if (h < 0) throw new Error(`${source}: couldn't find a header row with a date, a description and an amount column.`);
  const cells = rows[h].map(headerCell);
  const col = {
    date: pickCol(cells, H.date, (c) => /^date/.test(c)),
    desc: pickCol(cells, H.desc),
    amount: pickCol(cells, H.amount),
    debit: pickCol(cells, H.debit),
    credit: pickCol(cells, H.credit),
    currency: pickCol(cells, H.currency),
    type: pickCol(cells, H.type),
    fee: pickCol(cells, H.fee),
    state: pickCol(cells, H.state),
  };
  // Some banks split the description over two columns (e.g. "Libellé" + "Détail").
  const extraDesc = cells.findIndex((c, i) => i !== col.desc && /^(d(é|e)tail|details 2|additional info|compl(é|e)ment|reference 2)$/i.test(c));
  const body = rows.slice(h + 1).filter((r) => r.length >= 3);
  const fileCurrency = guessCurrency(lines.slice(0, h + 1).join(" "));
  const dateOf = makeDateParser(body.map((r) => r[col.date]));
  const txns = [];
  const skipped = [];
  for (const r of body) {
    const date = dateOf(r[col.date] || "");
    let amount = null;
    if (col.amount >= 0 && r[col.amount] !== "") {
      amount = parseAmount(r[col.amount]);
      if (amount !== null && col.type >= 0) {
        // Only exact debit/credit markers; a Type like "Card payment" says nothing about the sign.
        const t = (r[col.type] || "").toLowerCase().trim();
        if (/^(d|dr|db|debit|débit|dbit|out|withdrawal)$/.test(t)) amount = -Math.abs(amount);
        else if (/^(c|cr|credit|crédit|crdt|in|deposit)$/.test(t)) amount = Math.abs(amount);
      }
    } else if (col.debit >= 0 || col.credit >= 0) {
      const de = col.debit >= 0 ? parseAmount(r[col.debit]) : null;
      const cr = col.credit >= 0 ? parseAmount(r[col.credit]) : null;
      if (de) amount = -Math.abs(de);
      else if (cr) amount = Math.abs(cr);
      else if (de === 0 || cr === 0) amount = 0;
    }
    let description = (r[col.desc] || "").replace(/\s+/g, " ").trim();
    if (extraDesc >= 0 && r[extraDesc]) description += " " + r[extraDesc].trim();
    if (!date || amount === null || !description) { if (r.join("").trim()) skipped.push(r.join(d)); continue; }
    // Declined or reversed payments never left the account.
    if (col.state >= 0 && /^(reverted|declined|failed|cancell?ed|rejected|refus(é|e)|annul(é|e))$/i.test((r[col.state] || "").trim())) continue;
    // Some banks (Revolut, Wise) put their fee in its own column: count it as a fee line.
    if (col.fee >= 0) {
      const fee = parseAmount(r[col.fee]);
      if (fee) txns.push({ date, description: `FEE: ${description}`, amount: -Math.abs(fee), currency: (col.currency >= 0 && (r[col.currency] || "").toUpperCase()) || fileCurrency, source });
    }
    txns.push({ date, description, amount, currency: (col.currency >= 0 && (r[col.currency] || "").toUpperCase()) || fileCurrency, source });
  }
  // Exports that list every amount as positive with no debit/credit marker:
  // treat them as spending, which is what a statement of card payments is.
  if (txns.length && txns.every((t) => t.amount >= 0) && col.type < 0 && col.debit < 0 && signHint !== "credit") {
    for (const t of txns) t.amount = -t.amount;
    return { txns, skipped, delimiter: d, note: "All amounts were positive with no debit/credit column, so they were read as spending." };
  }
  return { txns, skipped, delimiter: d };
}

// ── OFX / QFX ───────────────────────────────────────────────
export function parseOfx(text, { source = "ofx" } = {}) {
  const cur = (text.match(/<CURDEF>\s*([A-Z]{3})/i) || [])[1];
  const txns = [];
  for (const m of text.matchAll(/<STMTTRN>([\s\S]*?)(?:<\/STMTTRN>|(?=<STMTTRN>)|<\/BANKTRANLIST>)/gi)) {
    const block = m[1];
    const tag = (t) => ((block.match(new RegExp(`<${t}>\\s*([^<\\r\\n]+)`, "i")) || [])[1] || "").trim();
    const dt = tag("DTPOSTED") || tag("DTUSER");
    const amount = parseAmount(tag("TRNAMT"));
    const date = dt ? `${dt.slice(0, 4)}-${dt.slice(4, 6)}-${dt.slice(6, 8)}` : null;
    const description = [tag("NAME"), tag("MEMO")].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(" ").replace(/&amp;/g, "&").trim();
    if (date && amount !== null && description) txns.push({ date, description, amount, currency: cur, source });
  }
  if (!txns.length) throw new Error(`${source}: no <STMTTRN> transactions found.`);
  return { txns, skipped: [] };
}

export function parseStatement(buf, name = "statement") {
  const text = decode(buf);
  if (/<OFX>|OFXHEADER|<STMTTRN>/i.test(text.slice(0, 5000))) return parseOfx(text, { source: name });
  return parseCsv(text, { source: name });
}
