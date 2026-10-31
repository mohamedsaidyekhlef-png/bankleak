// Reports for humans (terminal, Markdown, HTML) and machines (JSON).
// The HTML report loads nothing from the internet: no fonts, no scripts, no images.

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function money(n, cur) {
  if (n === null || n === undefined) return "–";
  try {
    if (cur && /^[A-Z]{3}$/.test(cur)) return new Intl.NumberFormat("en", { style: "currency", currency: cur, maximumFractionDigits: 2 }).format(n);
  } catch { /* unknown currency code */ }
  return new Intl.NumberFormat("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n) + (cur ? ` ${cur}` : "");
}

export function toJson(a) { return JSON.stringify(a, null, 2); }

export function toTerminal(a, color = true) {
  const c = color
    ? { r: (s) => `\x1b[31m${s}\x1b[0m`, y: (s) => `\x1b[33m${s}\x1b[0m`, g: (s) => `\x1b[32m${s}\x1b[0m`, d: (s) => `\x1b[2m${s}\x1b[0m`, b: (s) => `\x1b[1m${s}\x1b[0m` }
    : { r: (s) => s, y: (s) => s, g: (s) => s, d: (s) => s, b: (s) => s };
  const m = (n) => money(n, a.currency);
  const L = [];
  L.push("", c.b(`bankleak  ${a.period.start} → ${a.period.end}  (${a.counts.transactions} transactions)`));
  L.push(a.leak.total > 0 ? `${c.r(c.b(m(a.leak.total) + " a year"))} is leaking, by this statement's numbers.` : c.g("No leaks found in this statement."));
  L.push(c.d(`Fees ${m(a.leak.fees)}/yr · price rises ${m(a.leak.priceIncreases)}/yr · overlapping services ${m(a.leak.overlaps)}/yr · possible duplicates ${m(a.leak.duplicates)} once`));
  if (a.fees.categories.length) {
    L.push("", c.b(`Bank fees  ${m(a.fees.total)} in ${a.period.days} days${a.fees.perYear ? ` (≈ ${m(a.fees.perYear)}/yr)` : ""}`));
    for (const f of a.fees.categories) L.push(`  ${c.r("●")} ${f.category}: ${m(f.total)} (${f.count}×)  ${c.d(f.examples[0].description)}`);
  }
  if (a.priceIncreases.length) {
    L.push("", c.b("Price rises"));
    for (const p of a.priceIncreases) L.push(`  ${c.y("▲")} ${p.name}: ${m(p.from)} → ${m(p.to)} since ${p.since}  ${c.d(`+${m(p.extraPerYear)}/yr`)}`);
  }
  if (a.duplicates.length) {
    L.push("", c.b("Possible duplicate charges"));
    for (const d of a.duplicates) L.push(`  ${c.y("⧉")} ${d.name}: ${m(d.amount)} on ${d.dates.join(" and ")}`);
  }
  if (a.overlaps.length) {
    L.push("", c.b("Overlapping services"));
    for (const o of a.overlaps) L.push(`  ${c.y("◎")} ${o.category}: ${o.services.map((s) => `${s.name} ${m(s.perYear)}/yr`).join(", ")}  ${c.d(`keeping one saves ${m(o.keepOneSaves)}/yr`)}`);
  }
  if (a.recurring.length) {
    L.push("", c.b(`Recurring payments  ${m(a.recurringPerYear)}/yr active`));
    for (const r of a.recurring) L.push(`  ${r.active ? "•" : c.d("○")} ${r.name.padEnd(26)} ${m(r.typical).padStart(12)} ${r.cadence.padEnd(14)} ${m(r.perYear).padStart(12)}/yr${r.active ? "" : c.d("  stopped")}`);
  }
  if (a.singles.length) {
    L.push("", c.b("Subscription charges seen once (annual renewals or new sign-ups)"));
    for (const s of a.singles.slice(0, 8)) L.push(`  • ${s.name} ${m(s.amount)} on ${s.date}`);
  }
  L.push("");
  return L.join("\n");
}

export function toMarkdown(a) {
  const m = (n) => money(n, a.currency);
  const out = [`# bankleak report`, "", `${a.period.start} → ${a.period.end} · ${a.counts.transactions} transactions`, ""];
  out.push(`## ${m(a.leak.total)} a year is leaking`, "", "| Leak | Amount |", "|---|---|",
    `| Bank fees (yearly rate) | ${m(a.leak.fees)} |`, `| Price rises (extra per year) | ${m(a.leak.priceIncreases)} |`,
    `| Overlapping services (keep one each) | ${m(a.leak.overlaps)} |`, `| Possible duplicate charges (one-off) | ${m(a.leak.duplicates)} |`, "");
  if (a.fees.categories.length) {
    out.push("## Bank fees", "", "| Type | Count | Total | Example |", "|---|---|---|---|");
    for (const f of a.fees.categories) out.push(`| ${f.category} | ${f.count} | ${m(f.total)} | ${f.examples[0].description} |`);
    out.push("");
  }
  if (a.priceIncreases.length) { out.push("## Price rises", ""); for (const p of a.priceIncreases) out.push(`- **${p.name}**: ${m(p.from)} → ${m(p.to)} since ${p.since} (+${m(p.extraPerYear)}/yr)`); out.push(""); }
  if (a.duplicates.length) { out.push("## Possible duplicate charges", ""); for (const d of a.duplicates) out.push(`- **${d.name}**: ${m(d.amount)} on ${d.dates.join(" and ")} (${d.description})`); out.push(""); }
  if (a.overlaps.length) { out.push("## Overlapping services", ""); for (const o of a.overlaps) out.push(`- **${o.category}**: ${o.services.map((s) => `${s.name} (${m(s.perYear)}/yr)`).join(", ")}. Keeping one saves ${m(o.keepOneSaves)}/yr.`); out.push(""); }
  if (a.recurring.length) {
    out.push("## Recurring payments", "", "| Payment | Amount | How often | Per year | Status |", "|---|---|---|---|---|");
    for (const r of a.recurring) out.push(`| ${r.name} | ${m(r.typical)} | ${r.cadence} | ${m(r.perYear)} | ${r.active ? "active" : "stopped"} |`);
    out.push("");
  }
  if (a.singles.length) { out.push("## Subscription charges seen once", ""); for (const s of a.singles) out.push(`- ${s.name}: ${m(s.amount)} on ${s.date}`); out.push(""); }
  out.push("<sub>Made with bankleak. Everything ran on your computer; nothing was uploaded.</sub>", "");
  return out.join("\n");
}

export function toHtml(a) {
  const m = (n) => esc(money(n, a.currency));
  const parts = [
    ["Bank fees", a.leak.fees, "var(--fee)", "per year at this rate"],
    ["Price rises", a.leak.priceIncreases, "var(--rise)", "extra per year"],
    ["Overlapping services", a.leak.overlaps, "var(--overlap)", "per year if you keep one each"],
    ["Possible duplicates", a.leak.duplicates, "var(--dup)", "one-off, ask for a refund"],
  ];
  const max = Math.max(1, ...parts.map((p) => p[1]));
  const bars = parts.map(([label, v, col, note]) => `<div class="bar"><div class="bl"><b>${esc(label)}</b><span>${esc(note)}</span></div><div class="track"><i style="width:${Math.max(v > 0 ? 2 : 0, (v / max) * 100).toFixed(1)}%;background:${col}"></i></div><div class="bv">${m(v)}</div></div>`).join("");
  const sec = (title, body, sub = "") => body ? `<section><h2>${esc(title)}</h2>${sub ? `<p class="sub">${esc(sub)}</p>` : ""}${body}</section>` : "";
  const fees = a.fees.categories.length ? `<table><thead><tr><th>Type</th><th>Times</th><th>Total</th><th>Example</th></tr></thead><tbody>${a.fees.categories.map((f) => `<tr><td>${esc(f.category)}</td><td>${f.count}</td><td class="n">${m(f.total)}</td><td class="ex">${esc(f.examples[0].description)}</td></tr>`).join("")}</tbody></table>` : "";
  const rises = a.priceIncreases.map((p) => `<li><b>${esc(p.name)}</b> went from ${m(p.from)} to ${m(p.to)} on ${esc(p.since)}. That's <b>${m(p.extraPerYear)}</b> more a year.</li>`).join("");
  const dups = a.duplicates.map((d) => `<li><b>${esc(d.name)}</b>: ${m(d.amount)} charged on ${esc(d.dates.join(" and "))}. <span class="ex">${esc(d.description)}</span></li>`).join("");
  const over = a.overlaps.map((o) => `<li><b>${esc(o.category[0].toUpperCase() + o.category.slice(1))}</b>: ${o.services.map((s) => `${esc(s.name)} (${m(s.perYear)}/yr)`).join(", ")}. Keeping one saves <b>${m(o.keepOneSaves)}</b> a year.</li>`).join("");
  const rec = a.recurring.length ? `<table><thead><tr><th>Payment</th><th>Amount</th><th>How often</th><th>Per year</th><th></th></tr></thead><tbody>${a.recurring.map((r) => `<tr class="${r.active ? "" : "off"}"><td>${esc(r.name)}${r.category ? ` <span class="tag">${esc(r.category)}</span>` : ""}</td><td class="n">${m(r.typical)}</td><td>${esc(r.cadence)}</td><td class="n">${m(r.perYear)}</td><td>${r.active ? "" : "stopped"}</td></tr>`).join("")}</tbody></table>` : "";
  const singles = a.singles.map((s) => `<li>${esc(s.name)}: ${m(s.amount)} on ${esc(s.date)}${s.recent ? " <span class=\"tag\">recent</span>" : ""}</li>`).join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>bankleak report</title>
<style>
:root{--bg:#F4F2EE;--paper:#fff;--ink:#1B1D22;--muted:#626773;--line:#E2DFD8;--fee:#C2410C;--rise:#B45309;--overlap:#7C3AED;--dup:#0E7490;--ok:#15803D}
@media (prefers-color-scheme:dark){:root{--bg:#121316;--paper:#1B1C21;--ink:#ECEDF0;--muted:#A1A5B0;--line:#2D2F36;--fee:#FB923C;--rise:#FBBF24;--overlap:#A78BFA;--dup:#22D3EE;--ok:#4ADE80}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.55 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
.wrap{max-width:860px;margin:0 auto;padding:36px 16px 64px}
.k{color:var(--muted);font-size:14px;margin:0}h1{font-size:clamp(34px,7vw,60px);line-height:1;margin:6px 0 4px;letter-spacing:-.03em}h1 small{font-size:.38em;font-weight:600;color:var(--muted);letter-spacing:0}
.lede{margin:10px 0 24px;max-width:60ch}
.card{background:var(--paper);border:1px solid var(--line);border-radius:14px;padding:18px 20px}
.bar{display:grid;grid-template-columns:minmax(150px,220px) 1fr auto;gap:14px;align-items:center;padding:10px 0;border-bottom:1px solid var(--line)}.bar:last-child{border:0}
.bl b{display:block}.bl span{color:var(--muted);font-size:13px}.track{height:12px;background:var(--bg);border-radius:6px;overflow:hidden}.track i{display:block;height:100%;border-radius:6px}.bv{font-weight:700;font-variant-numeric:tabular-nums;text-align:right;min-width:90px}
section{background:var(--paper);border:1px solid var(--line);border-radius:14px;padding:18px 20px;margin-top:18px}h2{font-size:19px;margin:0 0 8px}.sub{color:var(--muted);margin:-4px 0 10px;font-size:14px}
ul{margin:0;padding-left:20px}li{margin:6px 0}
table{width:100%;border-collapse:collapse;font-size:15px;display:block;overflow-x:auto}th,td{text-align:left;padding:8px 10px;border-bottom:1px solid var(--line);white-space:nowrap}th{color:var(--muted);font-weight:600;font-size:13px}td.n{text-align:right;font-variant-numeric:tabular-nums}td.ex,.ex{color:var(--muted);font-size:13px;white-space:normal}
tr.off td{color:var(--muted)}.tag{font-size:12px;border:1px solid var(--line);border-radius:999px;padding:0 7px;color:var(--muted);margin-left:4px}
.priv{margin-top:22px;color:var(--muted);font-size:13px}
@media (max-width:560px){.bar{grid-template-columns:1fr auto}.track{grid-column:1/-1;order:3}}
@media print{body{background:#fff}section,.card{break-inside:avoid}}
</style></head><body><div class="wrap">
<p class="k">${esc(a.period.start)} to ${esc(a.period.end)} · ${a.counts.transactions} transactions</p>
<h1>${m(a.leak.total)} <small>a year leaking</small></h1>
<p class="lede">${a.leak.total > 0 ? "Fees, price rises, services that do the same job, and charges that look doubled. Each one below shows the evidence from your statement." : "No fees, price rises, overlaps or duplicate charges found in this statement."}</p>
<div class="card">${bars}</div>
${sec("Bank fees", fees, a.fees.perYear ? `${money(a.fees.total, a.currency)} in ${a.period.days} days, about ${money(a.fees.perYear, a.currency)} a year at this rate. Many banks waive fees if you ask, or switch to a cheaper account.` : "")}
${sec("Price rises", rises ? `<ul>${rises}</ul>` : "", "Subscriptions that now cost more than when you started.")}
${sec("Possible duplicate charges", dups ? `<ul>${dups}</ul>` : "", "Same merchant, same amount, within two days. Check your receipts, then ask the merchant or your bank to refund the extra one.")}
${sec("Overlapping services", over ? `<ul>${over}</ul>` : "", "Services that do the same job. You may want all of them; this is a prompt to check.")}
${sec(`Recurring payments · ${money(a.recurringPerYear, a.currency)} a year`, rec, "Everything that repeats. Ask of each one: do I still use it?")}
${sec("Subscription charges seen once", singles ? `<ul>${singles}</ul>` : "", "Annual renewals or new sign-ups. Annual plans are easy to forget until they renew.")}
<p class="priv">Made with bankleak. This report was built on your computer from your statement; nothing was uploaded and this page loads nothing from the internet.</p>
</div></body></html>`;
}
