// Generates realistic, deterministic test statements in four real-world layouts,
// each with known "leaks" planted so the tests can assert they are all found.
// Run: node test/make-fixtures.mjs
import { writeFileSync } from "node:fs";

let seed = 42;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = (a) => a[Math.floor(rnd() * a.length)];
const iso = (d) => d.toISOString().slice(0, 10);
const add = (d, n) => new Date(d.getTime() + n * 864e5);
const START = new Date(Date.UTC(2026, 4, 1)); // 1 May 2026
const END = new Date(Date.UTC(2026, 9, 31)); // 31 Oct 2026
const monthly = (day, fn) => { const out = []; for (let m = 4; m <= 9; m++) { const d = new Date(Date.UTC(2026, m, day)); if (d >= START && d <= END) out.push(fn(d, m - 4)); } return out; };

// ── US: Chase-style CSV ─────────────────────────────────────
{
  const rows = [];
  const tx = (d, desc, amt, cat = "Shopping") => rows.push([iso(d), iso(add(d, 1)), desc, cat, amt < 0 ? "Sale" : "Payment", amt.toFixed(2)]);
  monthly(3, (d, i) => tx(d, "NETFLIX.COM 866-579-7172 CA", i < 3 ? -15.49 : -17.99, "Entertainment")); // price hike
  monthly(9, (d) => tx(d, "Spotify USA 877-778-1161 NY", -11.99, "Entertainment"));
  monthly(14, (d) => tx(d, "HULU 877-8244858 CA", -9.99, "Entertainment"));                             // overlaps Netflix
  monthly(18, (d) => tx(d, "OPENAI *CHATGPT SUBSCR OPENAI.COM CA", -20.0, "Shopping"));
  monthly(21, (d) => tx(d, "CLAUDE.AI SUBSCRIPTION ANTHROPIC.COM CA", -20.0, "Shopping"));             // overlaps ChatGPT
  monthly(1, (d) => tx(d, "PLANET FITNESS #1234", -24.99, "Health & Wellness"));
  monthly(28, (d) => tx(d, "MONTHLY SERVICE FEE", -12.0, "Fees & Adjustments"));                          // bank fee
  monthly(2, (d) => tx(d, "ZELLE PAYMENT TO JORDAN LEE (RENT)", -1850.0, "Bills & Utilities"));
  monthly(15, (d) => tx(d, "PAYROLL ACME CORP", 4200.0, "Income"));
  tx(new Date(Date.UTC(2026, 6, 11)), "ADOBE *CREATIVE CLD 408-536-6000 CA", -239.88, "Shopping");       // annual renewal
  for (let d = new Date(START); d <= END; d = add(d, 7)) tx(d, "TRADER JOE S #552 QPS", -(48 + rnd() * 70), "Groceries");
  for (let i = 0; i < 40; i++) tx(add(START, Math.floor(rnd() * 180)), pick(["STARBUCKS STORE 08812", "CHIPOTLE 2291", "SHELL OIL 57444", "TARGET T-1902", "UBER *TRIP"]), -(4 + rnd() * 60), "Food & Drink");
  tx(new Date(Date.UTC(2026, 7, 22)), "BEST BUY 00001543", -349.99, "Shopping");
  tx(new Date(Date.UTC(2026, 7, 22)), "BEST BUY 00001543", -349.99, "Shopping");                          // duplicate
  tx(new Date(Date.UTC(2026, 8, 5)), "AIRBNB * HMXY2 LONDON GBR", -412.33, "Travel");
  tx(new Date(Date.UTC(2026, 8, 5)), "FOREIGN TRANSACTION FEE", -12.37, "Fees & Adjustments");            // fx fee
  tx(new Date(Date.UTC(2026, 8, 9)), "OVERDRAFT FEE", -35.0, "Fees & Adjustments");                       // overdraft
  tx(new Date(Date.UTC(2026, 9, 2)), "ATM FEE - NON-CHASE ATM", -3.5, "Fees & Adjustments");
  rows.sort((a, b) => b[0].localeCompare(a[0]));
  const fmt = (s) => { const [y, m, d] = s.split("-"); return `${m}/${d}/${y}`; };
  const csv = ["Transaction Date,Post Date,Description,Category,Type,Amount,Memo", ...rows.map((r) => [fmt(r[0]), fmt(r[1]), `"${r[2]}"`, r[3], r[4], r[5], ""].join(","))].join("\n");
  writeFileSync(new URL("./fixtures/us-chase.csv", import.meta.url), csv + "\n");
}

// ── France: Crédit Agricole-style, ';' separated, Windows-1252, preamble ──
{
  const rows = [];
  const tx = (d, lib, amt) => rows.push({ d, lib, amt });
  const fr = (n) => Math.abs(n).toFixed(2).replace(".", ",").replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  monthly(5, (d) => tx(d, "PRLV SEPA FREE MOBILE FM-2290184", -19.99));
  monthly(7, (d) => tx(d, `CARTE X1234 ${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")} NETFLIX.COM`, -13.49));
  monthly(12, (d) => tx(d, "CARTE X1234 DISNEY PLUS", -8.99));                                           // overlaps Netflix
  monthly(20, (d, i) => tx(d, "PRLV SEPA BASIC-FIT FRANCE", i < 2 ? -24.99 : -29.99));                      // price hike
  monthly(30, (d) => tx(d, "FRAIS TENUE DE COMPTE", -2.0));
  monthly(1, (d) => tx(d, "VIR SEPA SALAIRE SOCIETE GENERALE IMMO", 2650));
  monthly(4, (d) => tx(d, "PRLV SEPA LOYER FONCIA", -890));
  tx(new Date(Date.UTC(2026, 5, 16)), "COMMISSION D'INTERVENTION", -8.0);
  tx(new Date(Date.UTC(2026, 6, 16)), "COMMISSION D'INTERVENTION", -8.0);
  tx(new Date(Date.UTC(2026, 6, 31)), "AGIOS ARRETE AU 31/07", -14.27);
  tx(new Date(Date.UTC(2026, 8, 1)), "COTISATION CARTE GOLD MASTERCARD", -134.0);
  tx(new Date(Date.UTC(2026, 7, 3)), "CARTE X1234 03/08 FNAC PARIS", -89.99);
  tx(new Date(Date.UTC(2026, 7, 4)), "CARTE X1234 03/08 FNAC PARIS", -89.99);                            // duplicate
  for (let d = new Date(START); d <= END; d = add(d, 5)) tx(d, `CARTE X1234 ${pick(["CARREFOUR MARKET", "MONOPRIX", "BOULANGERIE PAUL", "SNCF INTERNET"])}`, -(6 + rnd() * 85));
  rows.sort((a, b) => b.d - a.d);
  const lines = [
    "Téléchargement du 31/10/2026;",
    "Compte de Dépôt carte n° xxxx1234;",
    "Solde au 31/10/2026 1 245,30 €;",
    "",
    "Date;Libellé;Débit euros;Crédit euros;",
    ...rows.map((r) => `${String(r.d.getUTCDate()).padStart(2, "0")}/${String(r.d.getUTCMonth() + 1).padStart(2, "0")}/${r.d.getUTCFullYear()};"${r.lib}";${r.amt < 0 ? fr(r.amt) : ""};${r.amt > 0 ? fr(r.amt) : ""};`),
  ];
  // Real French exports are often Windows-1252, not UTF-8.
  const text = lines.join("\r\n") + "\r\n";
  const buf = Buffer.from([...text].map((ch) => { const c = ch.charCodeAt(0); const map = { 0x20ac: 0x80, 0xe9: 0xe9, 0xe8: 0xe8, 0xb0: 0xb0 }; return c < 256 ? c : map[c] ?? 0x3f; }));
  writeFileSync(new URL("./fixtures/fr-credit-agricole.csv", import.meta.url), buf);
}

// ── Morocco: CIH-style, MAD, space thousands, separate Débit/Crédit ──
{
  const rows = [];
  const tx = (d, lib, amt) => rows.push({ d, lib, amt });
  const ma = (n) => Math.abs(n).toFixed(2).replace(".", ",").replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  monthly(6, (d) => tx(d, "PRELEVEMENT INWI FACTURE MOBILE", -99));
  monthly(10, (d) => tx(d, "PAIEMENT CARTE SHAHID.NET", -39.99));
  monthly(11, (d) => tx(d, "PAIEMENT CARTE OSN PLUS", -69));                                             // overlaps Shahid
  monthly(17, (d) => tx(d, "PAIEMENT CARTE CLAUDE.AI ANTHROPIC SAN FRANCISCO", -206.4));
  monthly(17, (d) => tx(d, "FRAIS OPERATION A L'ETRANGER", -5.16));                                        // fx fee
  monthly(28, (d) => tx(d, "COMMISSION TENUE DE COMPTE", -15));
  monthly(28, (d) => tx(d, "TVA S/COMM TENUE DE COMPTE", -1.5));
  monthly(25, (d) => tx(d, "VIREMENT RECU PAYONEER UPWORK", 12500));
  for (let i = 0; i < 12; i++) tx(add(START, 7 + i * 15), "RETRAIT GAB AUTRE BANQUE TETOUAN", -500);
  for (let i = 0; i < 12; i++) tx(add(START, 7 + i * 15), "FRAIS RETRAIT GAB CONFRERE", -6);             // ATM fees
  tx(new Date(Date.UTC(2026, 6, 1)), "DROITS DE TIMBRE CHEQUIER", -20);
  for (let d = new Date(START); d <= END; d = add(d, 4)) tx(d, `PAIEMENT CARTE ${pick(["MARJANE TETOUAN", "CARREFOUR MARKET", "BIM STORES", "AFRIQUIA STATION"])}`, -(40 + rnd() * 400));
  rows.sort((a, b) => a.d - b.d);
  const lines = ["Date opération,Date valeur,Libellé,Débit,Crédit",
    ...rows.map((r) => { const ds = `${String(r.d.getUTCDate()).padStart(2, "0")}/${String(r.d.getUTCMonth() + 1).padStart(2, "0")}/${r.d.getUTCFullYear()}`; return `${ds},${ds},"${r.lib}","${r.amt < 0 ? ma(r.amt) : ""}","${r.amt > 0 ? ma(r.amt) : ""}"`; })];
  writeFileSync(new URL("./fixtures/ma-cih.csv", import.meta.url), lines.join("\n") + "\n");
}

// ── OFX (QuickBooks / Money export) ─────────────────────────
{
  const t = [];
  const tx = (d, name, amt) => t.push(`<STMTTRN><TRNTYPE>${amt < 0 ? "DEBIT" : "CREDIT"}<DTPOSTED>${iso(d).replace(/-/g, "")}120000<TRNAMT>${amt.toFixed(2)}<FITID>${t.length + 1}<NAME>${name}</STMTTRN>`);
  monthly(8, (d) => tx(d, "GOOGLE *Google One", -2.99));
  monthly(8, (d) => tx(d, "APPLE.COM/BILL ICLOUD", -2.99));                                             // overlap storage
  monthly(13, (d) => tx(d, "NORDVPN", -12.99));
  monthly(19, (d) => tx(d, "WIRE TRANSFER FEE", -25));
  monthly(1, (d) => tx(d, "DIRECT DEP EMPLOYER", 3100));
  const ofx = `OFXHEADER:100\nDATA:OFXSGML\nVERSION:102\n\n<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><CURDEF>USD<BANKTRANLIST>\n${t.join("\n")}\n</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>\n`;
  writeFileSync(new URL("./fixtures/statement.ofx", import.meta.url), ofx);
}
console.log("fixtures written");
