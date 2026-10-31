#!/usr/bin/env node
import { readFileSync, writeFileSync, statSync, readdirSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseStatement } from "../src/read.mjs";
import { analyse } from "../src/detect.mjs";
import { toHtml, toJson, toMarkdown, toTerminal } from "../src/report.mjs";

const VERSION = JSON.parse(readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../package.json"), "utf8")).version;
const HELP = `bankleak ${VERSION}
Your bank statement is leaking money. bankleak finds every leak, on your computer.

Usage
  bankleak statement.csv                   one or more CSV or OFX/QFX exports
  bankleak ./statements/                   every .csv / .ofx / .qfx in a folder
  bankleak jan.csv feb.csv mar.csv         several months together find more

Options
  --html <file>       write a visual report (opens offline, loads nothing)
  --md <file>         write a Markdown report
  --json [file]       write JSON (stdout if no file)
  --currency <CODE>   e.g. EUR, MAD, USD, if the export doesn't say
  -q, --quiet         no terminal report         -v, --version   -h, --help

Nothing is uploaded. bankleak makes no network requests.`;

function die(msg) { console.error(`bankleak: ${msg}`); process.exit(1); }

const a = { files: [], quiet: false };
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  const k = argv[i];
  const val = () => { const v = argv[++i]; if (v === undefined) die(`${k} needs a value`); return v; };
  switch (k) {
    case "-h": case "--help": console.log(HELP); process.exit(0);
    case "-v": case "--version": console.log(VERSION); process.exit(0);
    case "--html": a.html = val(); break;
    case "--md": a.md = val(); break;
    case "--json": a.json = argv[i + 1] === "-" || (argv[i + 1] && !argv[i + 1].startsWith("-") && !/\.(csv|ofx|qfx|txt)$/i.test(argv[i + 1])) ? argv[++i] : "-"; break;
    case "--currency": a.currency = val().toUpperCase(); break;
    case "-q": case "--quiet": a.quiet = true; break;
    default: if (k.startsWith("-")) die(`Unknown option ${k}. Run bankleak --help.`); a.files.push(k);
  }
}
if (!a.files.length) { console.log(HELP); process.exit(1); }

const paths = [];
for (const f of a.files) {
  let st;
  try { st = statSync(f); } catch { die(`can't read ${f}`); }
  if (st.isDirectory()) for (const n of readdirSync(f).sort()) { if (/\.(csv|ofx|qfx|txt)$/i.test(n)) paths.push(join(f, n)); }
  else paths.push(f);
}
if (!paths.length) die("no .csv, .ofx or .qfx files found.");

const all = [];
for (const p of paths) {
  try {
    const r = parseStatement(readFileSync(p), basename(p));
    all.push(...r.txns);
    if (!a.quiet && a.json !== "-") {
      console.error(`Read ${r.txns.length} transactions from ${basename(p)}${r.skipped.length ? ` (skipped ${r.skipped.length} rows without a date or amount)` : ""}.`);
      if (r.note) console.error(`  Note: ${r.note}`);
    }
  } catch (e) { die(e.message); }
}
// Overlapping exports (say, Jan–Mar and Mar–May) repeat the same rows. Collapse
// repeats across files, but never within one file: two identical rows in one
// statement are two real charges, and possibly a duplicate worth refunding.
const unique = dedupeAcrossFiles(all);

function dedupeAcrossFiles(txns) {
  const perFile = new Map(); // key -> Map(source -> count)
  for (const t of txns) {
    const k = `${t.date}|${t.amount}|${t.description}`;
    if (!perFile.has(k)) perFile.set(k, new Map());
    const m = perFile.get(k);
    m.set(t.source, (m.get(t.source) || 0) + 1);
  }
  const keep = new Map([...perFile].map(([k, m]) => [k, Math.max(...m.values())]));
  return txns.filter((t) => {
    const k = `${t.date}|${t.amount}|${t.description}`;
    const left = keep.get(k);
    if (!left) return false;
    keep.set(k, left - 1);
    return true;
  });
}

// Never add up different currencies. Statements without a stated currency are kept
// per file unless --currency says they're all the same.
const groups = new Map();
for (const t of unique) {
  const cur = a.currency || t.currency;
  const key = cur ? `cur:${cur}` : `file:${t.source}`;
  if (!groups.has(key)) groups.set(key, { label: cur || t.source, currency: cur, txns: [] });
  groups.get(key).txns.push(t);
}
const results = [];
for (const g of groups.values()) {
  try { results.push({ label: g.label, result: analyse(g.txns, { currency: g.currency }) }); }
  catch (e) { die(`${g.label}: ${e.message}`); }
}
const multi = results.length > 1;
if (multi && !a.quiet && a.json !== "-") console.error(`These statements use ${results.length} different currencies or accounts, so each is analysed separately.`);

if (a.json === "-") process.stdout.write((multi ? JSON.stringify({ accounts: results.map((r) => ({ label: r.label, ...r.result })) }, null, 2) : toJson(results[0].result)) + "\n");
else {
  if (a.json) writeFileSync(a.json, multi ? JSON.stringify({ accounts: results.map((r) => ({ label: r.label, ...r.result })) }, null, 2) : toJson(results[0].result));
  if (!a.quiet) for (const r of results) {
    if (multi) console.log(`\n━━ ${r.label} ━━`);
    process.stdout.write(toTerminal(r.result, Boolean(process.stdout.isTTY) && !process.env.NO_COLOR));
  }
}
const suffix = (file, label) => (multi ? file.replace(/(\.\w+)?$/, (ext) => `-${String(label).replace(/[^\w.-]+/g, "_")}${ext || ""}`) : file);
for (const r of results) {
  if (a.md) writeFileSync(suffix(a.md, r.label), toMarkdown(r.result));
  if (a.html) {
    writeFileSync(suffix(a.html, r.label), toHtml(r.result));
    if (!a.quiet && a.json !== "-") console.log(`Report: ${suffix(a.html, r.label)}`);
  }
}
