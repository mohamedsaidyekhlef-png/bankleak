import { test } from "node:test";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeDateParser, parseAmount, parseCsv, parseStatement } from "../src/read.mjs";
import { analyse } from "../src/detect.mjs";
import { merchantOf } from "../src/merchant.mjs";
import { toHtml } from "../src/report.mjs";

const run = promisify(execFile);
const fx = (f) => readFileSync(new URL(`./fixtures/${f}`, import.meta.url));
const load = (f) => analyse(parseStatement(fx(f), f).txns);

test("amounts in every common format", () => {
  const cases = { "1 234,56": 1234.56, "1.234,56": 1234.56, "1,234.56": 1234.56, "-12.50": -12.5, "(12.50)": -12.5, "12.50 DR": -12.5, "−3,00 €": -3, "1,234": 1234, "12,5": 12.5, "MAD 99,00": 99, "$1,000.00": 1000, "": null, "abc": null };
  for (const [raw, want] of Object.entries(cases)) assert.equal(parseAmount(raw), want, raw);
});

test("dates: day-first vs month-first is decided from the whole column", () => {
  assert.equal(makeDateParser(["03/04/2026", "25/04/2026"])("03/04/2026"), "2026-04-03");
  assert.equal(makeDateParser(["03/04/2026", "04/25/2026"])("03/04/2026"), "2026-03-04");
  const p = makeDateParser([]);
  assert.equal(p("2026-10-05"), "2026-10-05");
  assert.equal(p("5 oct. 2026"), "2026-10-05");
  assert.equal(p("Oct 5, 2026"), "2026-10-05");
  assert.equal(p("31/02/2026"), null, "impossible dates are rejected");
});

test("messy descriptions map to one merchant", () => {
  assert.equal(merchantOf("CARTE X1234 07/08 NETFLIX.COM").name, "Netflix");
  assert.equal(merchantOf("PRLV SEPA NETFLIX INTERNATIONAL").name, "Netflix");
  assert.equal(merchantOf("PAYPAL *SPOTIFY 4029357733").name, "Spotify");
  assert.equal(merchantOf("BEST BUY 00001543").key, merchantOf("BEST BUY 00002277").key);
});

test("US Chase export: every planted leak is found", () => {
  const a = load("us-chase.csv");
  assert.deepEqual(a.priceIncreases.map((p) => [p.name, p.from, p.to]), [["Netflix", 15.49, 17.99]]);
  assert.equal(a.duplicates.length, 1);
  assert.equal(a.duplicates[0].name, "Best Buy");
  assert.deepEqual(a.overlaps.map((o) => o.category).sort(), ["AI assistants", "video"]);
  assert.deepEqual(a.fees.categories.map((c) => c.category).sort(), ["Account & card fees", "Cash machine (ATM) fees", "Foreign & currency fees", "Overdraft & interest"]);
  assert.equal(a.fees.total, 122.87);
  assert.ok(a.singles.some((s) => s.name === "Adobe" && s.amount === 239.88), "annual renewal surfaced");
  assert.ok(!a.recurring.some((r) => /trader joe/i.test(r.name)), "weekly groceries with varying amounts are not a subscription");
});

test("French export: Windows-1252, ';' separated, preamble, Débit/Crédit columns", () => {
  const p = parseStatement(fx("fr-credit-agricole.csv"), "fr");
  assert.equal(p.txns.length, 85);
  assert.ok(p.txns.some((t) => t.description === "COMMISSION D'INTERVENTION"));
  const a = analyse(p.txns);
  assert.equal(a.currency, "EUR");
  assert.deepEqual(a.priceIncreases.map((x) => [x.from, x.to]), [[24.99, 29.99]]);
  assert.equal(a.duplicates[0].amount, 89.99);
  assert.equal(a.fees.total, 176.27);
});

test("Moroccan export: space thousands, MAD fees with VAT, cash withdrawals are not subscriptions", () => {
  const a = load("ma-cih.csv");
  assert.deepEqual(a.overlaps.map((o) => o.services.map((s) => s.name).sort()), [["OSN+", "Shahid"]]);
  const cats = Object.fromEntries(a.fees.categories.map((c) => [c.category, c.total]));
  assert.equal(cats["Cash machine (ATM) fees"], 72);
  assert.equal(cats["Foreign & currency fees"], 30.96);
  assert.ok(!a.recurring.some((r) => /retrait/i.test(r.name)), "ATM cash is not a recurring payment");
});

test("OFX export", () => {
  const a = load("statement.ofx");
  assert.equal(a.currency, "USD");
  assert.equal(a.fees.categories[0].category, "Transfer fees");
  assert.deepEqual(a.overlaps[0].services.map((s) => s.name).sort(), ["Google One", "iCloud+"]);
});

test("no false alarms: school fees, health-insurance dues and a refund are not bank fees", () => {
  const csv = ["Date,Description,Amount",
    "2026-09-01,SCHOOL FEES ST MARY ACADEMY,-450.00",
    "2026-09-02,COTISATION MUTUELLE SANTE,-38.00",
    "2026-09-03,REFUND OF OVERDRAFT FEE,35.00",
    "2026-09-04,FEE - INTERNATIONAL PAYMENT,-4.00"].join("\n");
  const a = analyse(parseCsv(csv).txns);
  assert.equal(a.fees.total, 4);
});

test("CLI: overlapping exports aren't double-counted, but a real duplicate in one file survives", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bankleak-"));
  writeFileSync(join(dir, "copy.csv"), fx("us-chase.csv"));
  const bin = fileURLToPath(new URL("../bin/bankleak.mjs", import.meta.url));
  const one = JSON.parse((await run("node", [bin, fileURLToPath(new URL("./fixtures/us-chase.csv", import.meta.url)), "--json", "-"])).stdout);
  const two = JSON.parse((await run("node", [bin, fileURLToPath(new URL("./fixtures/us-chase.csv", import.meta.url)), join(dir, "copy.csv"), "--currency", "USD", "--json", "-"])).stdout);
  assert.equal(two.counts.transactions, one.counts.transactions);
  assert.equal(two.duplicates.length, 1);
});

test("CLI: different currencies are never added together", async () => {
  const bin = fileURLToPath(new URL("../bin/bankleak.mjs", import.meta.url));
  const out = JSON.parse((await run("node", [bin, fileURLToPath(new URL("./fixtures/", import.meta.url)), "--json", "-"])).stdout);
  assert.ok(out.accounts.length >= 4, "one result per currency or currency-less file");
});

test("HTML report loads nothing from the internet", () => {
  const html = toHtml(load("us-chase.csv"));
  assert.ok(!/https?:\/\//.test(html.replace(/<p class="priv">[\s\S]*?<\/p>/, "")), "no external URLs");
  assert.ok(!/<script/i.test(html), "no scripts");
});

test("Revolut: fee column becomes fees, reverted payments are dropped", () => {
  const p = parseStatement(fx("revolut.csv"), "revolut");
  assert.ok(!p.txns.some((t) => /uber/i.test(t.description)), "reverted payment dropped");
  const a = analyse(p.txns);
  const cats = Object.fromEntries(a.fees.categories.map((c) => [c.category, c.total]));
  assert.equal(cats["Foreign & currency fees"], 2.4);
  assert.equal(cats["Cash machine (ATM) fees"], 3);
  assert.ok(a.recurring.some((r) => r.name === "Netflix"));
});

test("Monzo: a 'Card payment' type column doesn't flip the sign", () => {
  const p = parseStatement(fx("monzo.csv"), "monzo");
  assert.ok(p.txns.filter((t) => /spotify/i.test(t.description)).every((t) => t.amount < 0));
  assert.equal(analyse(p.txns).currency, "GBP");
});
