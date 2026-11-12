// Dashboard (sales, profit & loss, cash), Reports (GST, HSN, H1 register, item-wise), Expenses
import {
  F, S, can, ctx, db, col, ref, newRef, list, $, $$, esc, num, r2, money, money2, dayKey, addDays, fmtDate, fmtTime, fmtKey, sum, formObj,
  toast, openModal, confirmBox, busy, friendlyError, rangeControl, byDate, stamp, downloadFile, toCSV, expLabel, isExpired, expiryCutoff, monthKey, isComposition,
} from "./core.js";

const EXP_CATS = ["Rent", "Salary", "Electricity", "Internet / Phone", "Transport / Delivery", "Repairs", "Stationery / Printing", "Tea / Snacks", "Bank charges", "Licence / Fees", "Other"];

async function loadPeriod(from, to) {
  const [sales, returns, purchases, expenses, adjustments, payments] = await Promise.all(
    ["sales", "returns", "purchases", "expenses", "adjustments", "payments"].map((c) => byDate(c, from, to)));
  return { sales: sales.filter((s) => s.status !== "cancelled"), cancelled: sales.filter((s) => s.status === "cancelled"), returns, purchases, expenses, adjustments, payments };
}

function computePL(d) {
  const buys = d.purchases.filter((p) => p.type !== "opening");
  const salesNet = sum(d.sales, "net"), returnsAmt = sum(d.returns, "amount");
  const taxable = r2(sum(d.sales, "taxable") - sum(d.returns, "taxable"));
  const cogs = r2(sum(d.sales, "cost") - sum(d.returns, "cost"));
  const gross = r2(taxable - cogs);
  const writeOff = r2(-sum(d.adjustments, "costValue"));
  const expenses = r2(sum(d.expenses, "amount"));
  const net = r2(gross - writeOff - expenses);
  const gstOut = r2(sum(d.sales, "gst") - sum(d.returns, "gst"));
  const gstIn = r2(sum(buys, "gstTotal"));
  const byCat = {};
  d.expenses.forEach((e) => (byCat[e.category] = (byCat[e.category] || 0) + num(e.amount)));
  // cash & bank movement
  const modes = ["Cash", "UPI", "Card", "Bank", "Cheque"];
  const flow = Object.fromEntries(modes.map((m) => [m, { in: 0, out: 0 }]));
  const add = (m, k, v) => { if (!flow[m]) flow[m] = { in: 0, out: 0 }; flow[m][k] += num(v); };
  d.sales.forEach((s) => s.paymentMode !== "Credit" && add(s.paymentMode, "in", s.paid));
  d.payments.filter((p) => p.type === "customer").forEach((p) => add(p.mode, "in", p.amount));
  d.returns.forEach((r) => r.refundMode !== "Adjust in dues" && add(r.refundMode, "out", r.amount));
  d.expenses.forEach((e) => add(e.mode || "Cash", "out", e.amount));
  d.payments.filter((p) => p.type === "vendor").forEach((p) => add(p.mode, "out", p.amount));
  buys.forEach((p) => num(p.paid) && p.payMode !== "Credit" && add(p.payMode, "out", p.paid));
  return {
    bills: d.sales.length, salesNet, returnsAmt, netSales: r2(salesNet - returnsAmt), taxable, cogs, gross, writeOff, expenses, net,
    margin: taxable ? (gross / taxable) * 100 : 0, gstOut, gstIn, gstPayable: r2(gstOut - gstIn), purchases: r2(sum(buys, "net")),
    creditGiven: r2(sum(d.sales, "due")), discount: r2(sum(d.sales, "discount")), byCat, flow,
    custReceived: r2(sum(d.payments.filter((p) => p.type === "customer"), "amount")),
  };
}

/* ======================= Dashboard ======================= */
export async function viewDashboard(el) {
  el.innerHTML = `
    <div class="page-head"><h1>Dashboard</h1><div class="range" id="d-range"></div></div>
    <div id="d-alerts" class="alerts"></div>
    <div id="d-body"><div class="loading">Loading…</div></div>`;
  loadAlerts();
  rangeControl($("#d-range"), async (from, to) => {
    const body = $("#d-body"); if (!body) return;
    body.innerHTML = `<div class="loading">Loading…</div>`;
    try { renderDash(body, await loadPeriod(from, to), from, to); }
    catch (e) { body.innerHTML = `<div class="form-error">${esc(friendlyError(e))}</div>`; }
  }, "today");
}

async function loadAlerts() {
  try {
    const [low, exp, cust, ven] = await Promise.all([
      F.getDocs(F.query(col("products"), F.where("lowStock", "==", true))).then(list),
      F.getDocs(F.query(col("batches"), F.where("expiry", "<=", expiryCutoff(S.settings.expiryAlertDays)))).then(list),
      F.getDocs(F.query(col("customers"), F.where("balance", ">", 0))).then(list),
      F.getDocs(F.query(col("vendors"), F.where("balance", ">", 0))).then(list),
    ]);
    const stocked = exp.filter((b) => num(b.qty) > 0);
    const expired = stocked.filter((b) => isExpired(b.expiry)).length;
    const a = $("#d-alerts"); if (!a) return;
    a.innerHTML = `
      <a href="#/inventory/low" class="alert ${low.length ? "warn" : ""}"><b>${low.filter((p) => p.active !== false).length}</b><span>Low stock</span></a>
      <a href="#/inventory/expiring" class="alert ${stocked.length - expired ? "warn" : ""}"><b>${stocked.length - expired}</b><span>Expiring ≤${num(S.settings.expiryAlertDays)}d</span></a>
      <a href="#/inventory/expired" class="alert ${expired ? "bad" : ""}"><b>${expired}</b><span>Expired in stock</span></a>
      <a href="#/customers" class="alert"><b>${money(sum(cust, "balance"))}</b><span>To collect (udhaar)</span></a>
      <a href="#/vendors" class="alert"><b>${money(sum(ven, "balance"))}</b><span>To pay vendors</span></a>`;
  } catch (e) {}
}

function renderDash(body, d, from, to) {
  const pl = computePL(d);
  // daily series
  const [fy, fm, fd] = from.split("-").map(Number), [ty, tm, td] = to.split("-").map(Number);
  const start = new Date(fy, fm - 1, fd), end = new Date(ty, tm - 1, td);
  const span = Math.round((end - start) / 864e5) + 1;
  const days = [];
  if (span > 1 && span <= 62) for (let x = new Date(start); x <= end; x = addDays(x, 1)) days.push(dayKey(x));
  const byDay = {};
  d.sales.forEach((s) => { const k = s.dateKey; byDay[k] = byDay[k] || { s: 0, p: 0 }; byDay[k].s += num(s.net); byDay[k].p += num(s.profit); });
  d.returns.forEach((r) => { const k = r.dateKey; byDay[k] = byDay[k] || { s: 0, p: 0 }; byDay[k].s -= num(r.amount); byDay[k].p -= num(r.taxable) - num(r.cost); });
  const maxDay = Math.max(1, ...days.map((k) => byDay[k]?.s || 0));
  // top medicines
  const prod = new Map();
  d.sales.forEach((s) => s.items.forEach((it) => {
    const g = prod.get(it.productId) || { name: it.name, units: 0, amount: 0, profit: 0, packSize: it.packSize, pack: it.pack, unit: it.unit };
    g.units += num(it.units); g.amount += num(it.amount); g.profit += num(it.taxable) - num(it.cost); prod.set(it.productId, g);
  }));
  const top = [...prod.values()].sort((a, b) => b.amount - a.amount).slice(0, 10);
  const topProfit = [...prod.values()].sort((a, b) => b.profit - a.profit).slice(0, 10);
  const staff = new Map();
  d.sales.forEach((s) => { const g = staff.get(s.createdBy) || { name: s.createdByName, n: 0, amt: 0 }; g.n++; g.amt += num(s.net); staff.set(s.createdBy, g); });
  const plRow = (l, v, cls = "") => `<tr class="${cls}"><td>${l}</td><td class="num">${v}</td></tr>`;

  body.innerHTML = `
    <div class="stats">
      <div class="stat primary"><div class="label">Net sales</div><div class="value">${money(pl.netSales)}</div></div>
      <div class="stat"><div class="label">Bills</div><div class="value">${pl.bills}</div></div>
      <div class="stat ${pl.gross >= 0 ? "good" : "bad"}"><div class="label">Gross profit</div><div class="value">${money(pl.gross)}</div></div>
      <div class="stat ${pl.net >= 0 ? "good" : "bad"}"><div class="label">Net ${pl.net >= 0 ? "profit" : "loss"}</div><div class="value">${money(pl.net)}</div></div>
      <div class="stat"><div class="label">Margin</div><div class="value">${pl.margin.toFixed(1)}%</div></div>
      <div class="stat"><div class="label">Purchases</div><div class="value">${money(pl.purchases)}</div></div>
      <div class="stat"><div class="label">Expenses</div><div class="value">${money(pl.expenses)}</div></div>
      <div class="stat"><div class="label">Avg. bill</div><div class="value">${money(pl.bills ? Math.round(pl.salesNet / pl.bills) : 0)}</div></div>
    </div>

    ${days.length ? `<div class="card"><div class="card-head"><h3>Daily sales &amp; profit</h3><span class="muted small"><i class="dot s"></i> Sales <i class="dot p"></i> Profit</span></div>
      <div class="bars">${days.map((k) => `<div class="bar-pair" data-tip="${fmtKey(k)} · Sales ${money(byDay[k]?.s || 0)} · Profit ${money(byDay[k]?.p || 0)}"><div class="bar s" style="height:${Math.max(0, (byDay[k]?.s || 0) / maxDay) * 100}%"></div><div class="bar p" style="height:${Math.max(0, (byDay[k]?.p || 0) / maxDay) * 100}%"></div></div>`).join("")}</div>
      <div class="bar-labels">${days.map((k, i) => `<span>${days.length <= 14 || i % Math.ceil(days.length / 10) === 0 ? k.slice(8) : ""}</span>`).join("")}</div></div>` : ""}

    <div class="two-col">
      <div class="card">
        <div class="card-head"><h3>Profit &amp; Loss</h3><button class="btn ghost sm" id="pl-csv">Download</button></div>
        <table class="pl"><tbody>
          ${plRow("Sales (incl. GST)", money2(pl.salesNet))}
          ${plRow("Less: returns", "− " + money2(pl.returnsAmt))}
          ${!isComposition() ? plRow("Less: GST collected", "− " + money2(pl.gstOut)) : ""}
          ${plRow("<b>Net sales</b>", `<b>${money2(pl.taxable)}</b>`, "sub")}
          ${plRow(`Cost of medicines sold${isComposition() ? "" : " (excl. GST)"}`, "− " + money2(pl.cogs))}
          ${plRow("<b>Gross profit</b>", `<b>${money2(pl.gross)}</b>`, "sub")}
          ${plRow("Expired / damaged written off", "− " + money2(pl.writeOff))}
          ${Object.entries(pl.byCat).map(([k, v]) => plRow(`Expense: ${esc(k)}`, "− " + money2(v))).join("")}
          ${plRow(`<b>NET ${pl.net >= 0 ? "PROFIT" : "LOSS"}</b>`, `<b>${money2(pl.net)}</b>`, `grand ${pl.net >= 0 ? "good" : "bad"}`)}
        </tbody></table>
        ${!isComposition() ? `<div class="gst-box"><div><span>GST collected</span><b>${money(pl.gstOut)}</b></div><div><span>GST paid on purchases</span><b>${money(pl.gstIn)}</b></div><div><span>Approx. GST payable</span><b>${money(pl.gstPayable)}</b></div></div>` : ""}
      </div>
      <div>
        <div class="card">
          <div class="card-head"><h3>Money in / out</h3></div>
          <table><thead><tr><th>Mode</th><th class="num">In</th><th class="num">Out</th><th class="num">Net</th></tr></thead>
          <tbody>${Object.entries(pl.flow).filter(([, v]) => v.in || v.out).map(([m, v]) => `<tr><td>${esc(m)}</td><td class="num">${money(v.in)}</td><td class="num">${money(v.out)}</td><td class="num"><b>${money(v.in - v.out)}</b></td></tr>`).join("") || `<tr><td colspan="4" class="empty">No money movement</td></tr>`}</tbody></table>
          <p class="muted small">In = sales + dues received. Out = refunds, expenses, vendor payments. Use the Cash row to check the cash drawer.</p>
          <div class="kv small"><div class="k">Credit given</div><div>${money(pl.creditGiven)}</div><div class="k">Dues received</div><div>${money(pl.custReceived)}</div><div class="k">Discounts</div><div>${money(pl.discount)}</div></div>
        </div>
        <div class="card">
          <div class="card-head"><h3>Billed by</h3></div>
          ${staff.size ? `<table><tbody>${[...staff.values()].map((g) => `<tr><td>${esc(g.name)}</td><td class="num">${g.n} bills</td><td class="num"><b>${money(g.amt)}</b></td></tr>`).join("")}</tbody></table>` : `<div class="empty">—</div>`}
        </div>
      </div>
    </div>

    <div class="two-col">
      <div class="card"><div class="card-head"><h3>Top selling medicines</h3></div>
        ${top.length ? `<table class="mcards"><thead><tr><th>Medicine</th><th class="num">Qty</th><th class="num">Sales</th></tr></thead><tbody>${top.map((p) => `<tr><td class="mc-title" data-label="Medicine">${esc(p.name)}</td><td class="num" data-label="Qty">${esc(p.packSize > 1 ? `${r2(p.units / p.packSize)} ${p.pack}` : `${p.units}`)}</td><td class="num" data-label="Sales"><b>${money(p.amount)}</b></td></tr>`).join("")}</tbody></table>` : `<div class="empty">No sales</div>`}</div>
      <div class="card"><div class="card-head"><h3>Most profitable medicines</h3></div>
        ${topProfit.length ? `<table class="mcards"><thead><tr><th>Medicine</th><th class="num">Profit</th><th class="num">Margin</th></tr></thead><tbody>${topProfit.map((p) => `<tr><td class="mc-title" data-label="Medicine">${esc(p.name)}</td><td class="num" data-label="Profit"><b>${money(r2(p.profit))}</b></td><td class="num" data-label="Margin">${p.amount ? ((p.profit / p.amount) * 100).toFixed(0) : 0}%</td></tr>`).join("")}</tbody></table>` : `<div class="empty">No sales</div>`}</div>
    </div>`;

  $("#pl-csv").onclick = () => downloadFile(`profit-loss_${from}_${to}.csv`, toCSV([
    ["Profit & Loss", `${fmtKey(from)} to ${fmtKey(to)}`], [],
    ["Sales (incl. GST)", pl.salesNet], ["Less returns", pl.returnsAmt], ["Less GST collected", pl.gstOut], ["Net sales", pl.taxable],
    ["Cost of medicines sold", pl.cogs], ["Gross profit", pl.gross], ["Expired/damaged written off", pl.writeOff],
    ...Object.entries(pl.byCat).map(([k, v]) => [`Expense: ${k}`, v]), ["Net profit / loss", pl.net], [],
    ["Purchases", pl.purchases], ["GST collected", pl.gstOut], ["GST paid on purchases", pl.gstIn], ["Approx GST payable", pl.gstPayable], ["Bills", pl.bills]]));
}

/* ======================= Reports ======================= */
export async function viewReports(el) {
  el.innerHTML = `
    <div class="page-head"><h1>Reports &amp; GST</h1><div class="range" id="r-range"></div></div>
    <div id="r-body"><div class="loading">Loading…</div></div>`;
  rangeControl($("#r-range"), async (from, to) => {
    const body = $("#r-body"); if (!body) return;
    body.innerHTML = `<div class="loading">Loading…</div>`;
    try { renderReports(body, await loadPeriod(from, to), from, to); }
    catch (e) { body.innerHTML = `<div class="form-error">${esc(friendlyError(e))}</div>`; }
  }, "month");
}

function renderReports(body, d, from, to) {
  const tag = `${from}_to_${to}`;
  // Output GST by rate (sales − returns)
  const out = {};
  const addOut = (rate, taxable, gst) => { const k = num(rate); out[k] = out[k] || { taxable: 0, gst: 0 }; out[k].taxable += num(taxable); out[k].gst += num(gst); };
  d.sales.forEach((s) => s.items.forEach((it) => addOut(it.gst, it.taxable, it.gstAmt)));
  d.returns.forEach((r) => r.items.forEach((it) => addOut(it.gst, -num(it.taxable), -num(it.gstAmt))));
  // HSN summary
  const hsn = {};
  d.sales.forEach((s) => s.items.forEach((it) => { const k = `${it.hsn || "—"}|${num(it.gst)}`; hsn[k] = hsn[k] || { hsn: it.hsn || "—", rate: num(it.gst), units: 0, taxable: 0, gst: 0, total: 0 }; hsn[k].units += num(it.units); hsn[k].taxable += num(it.taxable); hsn[k].gst += num(it.gstAmt); hsn[k].total += num(it.amount); }));
  d.returns.forEach((r) => r.items.forEach((it) => { const k = `${it.hsn || "—"}|${num(it.gst)}`; hsn[k] = hsn[k] || { hsn: it.hsn || "—", rate: num(it.gst), units: 0, taxable: 0, gst: 0, total: 0 }; hsn[k].units -= num(it.units); hsn[k].taxable -= num(it.taxable); hsn[k].gst -= num(it.gstAmt); hsn[k].total -= num(it.amount); }));
  // Input GST by rate
  const inp = {};
  d.purchases.filter((p) => p.type !== "opening").forEach((p) => p.items.forEach((it) => {
    const k = num(it.gst); inp[k] = inp[k] || { taxable: 0, cgst: 0, sgst: 0, igst: 0 };
    inp[k].taxable += num(it.taxable);
    if (p.interState) inp[k].igst += num(it.gstAmt); else { inp[k].cgst += num(it.gstAmt) / 2; inp[k].sgst += num(it.gstAmt) / 2; }
  }));
  // H1 register
  const h1 = [];
  d.sales.forEach((s) => s.items.forEach((it) => { if (["H1", "X"].includes(it.schedule)) h1.push({ s, it }); }));
  const outRows = Object.entries(out).sort((a, b) => a[0] - b[0]);
  const inRows = Object.entries(inp).sort((a, b) => a[0] - b[0]);
  const comp = isComposition();

  body.innerHTML = `
    <div class="card">
      <div class="card-head"><h3>${comp ? "Turnover (composition scheme)" : "GST on sales (output) — for GSTR-1 / 3B"}</h3><button class="btn ghost sm" id="r-out">CSV</button></div>
      <div class="table-wrap"><table><thead><tr><th>GST rate</th><th class="num">Taxable value</th><th class="num">CGST</th><th class="num">SGST</th><th class="num">Total GST</th><th class="num">Invoice value</th></tr></thead>
      <tbody>${outRows.map(([k, v]) => `<tr><td>${k}%</td><td class="num">${money2(v.taxable)}</td><td class="num">${money2(v.gst / 2)}</td><td class="num">${money2(v.gst / 2)}</td><td class="num">${money2(v.gst)}</td><td class="num">${money2(v.taxable + v.gst)}</td></tr>`).join("") || `<tr><td colspan="6" class="empty">No sales</td></tr>`}</tbody>
      <tfoot><tr><td>Total</td><td class="num">${money2(sum(outRows, ([, v]) => v.taxable))}</td><td class="num">${money2(sum(outRows, ([, v]) => v.gst) / 2)}</td><td class="num">${money2(sum(outRows, ([, v]) => v.gst) / 2)}</td><td class="num">${money2(sum(outRows, ([, v]) => v.gst))}</td><td class="num">${money2(sum(outRows, ([, v]) => v.taxable + v.gst))}</td></tr></tfoot></table></div>
      <p class="muted small">Sales to walk-in customers are B2C. Returns are already subtracted. Share these figures with your accountant/CA for filing.</p>
    </div>

    <div class="card">
      <div class="card-head"><h3>HSN-wise summary of sales</h3><button class="btn ghost sm" id="r-hsn">CSV</button></div>
      <div class="table-wrap"><table><thead><tr><th>HSN</th><th>GST%</th><th class="num">Qty (units)</th><th class="num">Taxable</th><th class="num">GST</th><th class="num">Total</th></tr></thead>
      <tbody>${Object.values(hsn).map((h) => `<tr><td>${esc(h.hsn)}</td><td>${h.rate}%</td><td class="num">${h.units}</td><td class="num">${money2(h.taxable)}</td><td class="num">${money2(h.gst)}</td><td class="num">${money2(h.total)}</td></tr>`).join("") || `<tr><td colspan="6" class="empty">No sales</td></tr>`}</tbody></table></div>
    </div>

    <div class="card">
      <div class="card-head"><h3>GST on purchases (input tax credit)</h3><button class="btn ghost sm" id="r-in">CSV</button></div>
      <div class="table-wrap"><table><thead><tr><th>GST rate</th><th class="num">Taxable</th><th class="num">CGST</th><th class="num">SGST</th><th class="num">IGST</th></tr></thead>
      <tbody>${inRows.map(([k, v]) => `<tr><td>${k}%</td><td class="num">${money2(v.taxable)}</td><td class="num">${money2(v.cgst)}</td><td class="num">${money2(v.sgst)}</td><td class="num">${money2(v.igst)}</td></tr>`).join("") || `<tr><td colspan="5" class="empty">No purchases</td></tr>`}</tbody></table></div>
    </div>

    <div class="card">
      <div class="card-head"><h3>Schedule H1 / X register</h3><button class="btn ghost sm" id="r-h1">CSV</button></div>
      ${h1.length ? `<div class="table-wrap"><table class="mcards"><thead><tr><th>Date</th><th>Bill</th><th>Patient</th><th>Doctor</th><th>Medicine</th><th>Batch</th><th class="num">Qty</th></tr></thead>
      <tbody>${h1.map(({ s, it }) => `<tr><td class="mc-title" data-label="Date">${fmtDate(s.createdAtMs)}</td><td data-label="Bill">${esc(s.billNo)}</td><td data-label="Patient">${esc(s.custName)} ${esc(s.custPhone)}</td><td data-label="Doctor">${esc(s.doctor)}</td><td data-label="Medicine">${esc(it.name)}</td><td data-label="Batch">${esc(it.batchNo)}</td><td class="num" data-label="Qty">${esc(it.qty)} ${esc(it.saleUnit === "loose" ? it.unit : it.pack)}</td></tr>`).join("")}</tbody></table></div>` : `<div class="empty">No Schedule H1/X sales in this period</div>`}
    </div>

    <div class="card">
      <div class="card-head"><h3>More downloads</h3></div>
      <div class="btn-row">
        <button class="btn ghost" id="r-items">Item-wise sales register</button>
        <button class="btn ghost" id="r-bills">Bill-wise sales register</button>
        <button class="btn ghost" id="r-pur">Purchase register</button>
        <button class="btn ghost" id="r-exp">Expenses</button>
        <button class="btn ghost" id="r-adj">Stock write-offs</button>
      </div>
    </div>`;

  $("#r-out").onclick = () => downloadFile(`gst-output_${tag}.csv`, toCSV([["GST rate", "Taxable", "CGST", "SGST", "Total GST", "Invoice value"], ...outRows.map(([k, v]) => [k, r2(v.taxable), r2(v.gst / 2), r2(v.gst / 2), r2(v.gst), r2(v.taxable + v.gst)])]));
  $("#r-hsn").onclick = () => downloadFile(`hsn-summary_${tag}.csv`, toCSV([["HSN", "GST rate", "Qty (units)", "Taxable", "CGST", "SGST", "Total"], ...Object.values(hsn).map((h) => [h.hsn, h.rate, h.units, r2(h.taxable), r2(h.gst / 2), r2(h.gst / 2), r2(h.total)])]));
  $("#r-in").onclick = () => downloadFile(`gst-input_${tag}.csv`, toCSV([["GST rate", "Taxable", "CGST", "SGST", "IGST"], ...inRows.map(([k, v]) => [k, r2(v.taxable), r2(v.cgst), r2(v.sgst), r2(v.igst)])]));
  $("#r-h1").onclick = () => downloadFile(`h1-register_${tag}.csv`, toCSV([["Date", "Bill no", "Patient", "Phone", "Doctor", "Medicine", "Batch", "Expiry", "Qty", "Unit"], ...h1.map(({ s, it }) => [s.dateKey, s.billNo, s.custName, s.custPhone, s.doctor, it.name, it.batchNo, expLabel(it.expiry), it.qty, it.saleUnit === "loose" ? it.unit : it.pack])]));
  $("#r-items").onclick = () => downloadFile(`sales-items_${tag}.csv`, toCSV([["Date", "Bill no", "Customer", "Medicine", "HSN", "GST%", "Batch", "Expiry", "Qty", "Unit", "MRP", "Disc%", "Amount", "Taxable", "GST", "Cost", "Profit"],
    ...d.sales.flatMap((s) => s.items.map((it) => [s.dateKey, s.billNo, s.custName, it.name, it.hsn, it.gst, it.batchNo, expLabel(it.expiry), it.qty, it.saleUnit === "loose" ? it.unit : it.pack, it.mrp, it.disc, it.amount, it.taxable, it.gstAmt, it.cost, r2(num(it.taxable) - num(it.cost))]))]));
  $("#r-bills").onclick = () => downloadFile(`sales-bills_${tag}.csv`, toCSV([["Bill no", "Date", "Customer", "Phone", "Doctor", "MRP total", "Discount", "Taxable", "CGST", "SGST", "Net", "Payment", "Due", "Cost", "Profit", "Returned", "By"],
    ...d.sales.map((s) => [s.billNo, s.dateKey, s.custName, s.custPhone, s.doctor, s.gross, s.discount, s.taxable, s.cgst, s.sgst, s.net, s.paymentMode, s.due, s.cost, s.profit, s.returnedAmount, s.createdByName])]));
  $("#r-pur").onclick = () => downloadFile(`purchases_${tag}.csv`, toCSV([["Invoice date", "Vendor", "GSTIN", "Invoice no", "Taxable", "CGST", "SGST", "IGST", "Net", "Paid", "Due", "Type"],
    ...d.purchases.map((p) => [p.invoiceDate, p.vendorName, p.vendorGstin, p.invoiceNo, p.taxable, p.cgst, p.sgst, p.igst, p.net, p.paid, p.due, p.type])]));
  $("#r-exp").onclick = () => downloadFile(`expenses_${tag}.csv`, toCSV([["Date", "Category", "Amount", "Mode", "Note", "By"], ...d.expenses.map((e) => [e.dateKey, e.category, e.amount, e.mode, e.note, e.createdByName])]));
  $("#r-adj").onclick = () => downloadFile(`write-offs_${tag}.csv`, toCSV([["Date", "Medicine", "Batch", "Expiry", "Type", "Units", "Cost value", "Note", "By"], ...d.adjustments.map((a) => [a.dateKey, a.productName, a.batchNo, expLabel(a.expiry), a.type, a.units, a.costValue, a.note, a.createdByName])]));
}

/* ======================= Expenses ======================= */
export async function viewExpenses(el) {
  el.innerHTML = `
    <div class="page-head"><h1>Expenses</h1>${can.enter() ? `<button class="btn" id="e-add">+ Add expense</button>` : ""}</div>
    <div class="card">
      <div class="toolbar"><div class="field"><label>Period</label><div class="range" id="e-range"></div></div></div>
      <div id="e-sum" class="btn-row small" style="margin-bottom:10px"></div>
      <div id="e-list"><div class="loading">Loading…</div></div>
    </div>`;
  const load = async (a, b) => {
    try {
      const rows = await byDate("expenses", a, b);
      const byCat = {};
      rows.forEach((e) => (byCat[e.category] = (byCat[e.category] || 0) + num(e.amount)));
      $("#e-sum").innerHTML = `<span class="badge teal">Total ${money(sum(rows, "amount"))}</span>${Object.entries(byCat).map(([k, v]) => `<span class="badge">${esc(k)} ${money(v)}</span>`).join("")}`;
      $("#e-list").innerHTML = rows.length ? `<div class="table-wrap"><table class="mcards"><thead><tr><th>Date</th><th>Category</th><th>Note</th><th>Mode</th><th class="num">Amount</th><th>By</th><th></th></tr></thead>
        <tbody>${rows.map((e) => `<tr><td class="mc-title" data-label="Date">${fmtKey(e.dateKey)}</td><td data-label="Category">${esc(e.category)}</td><td data-label="Note">${esc(e.note)}</td><td data-label="Mode">${esc(e.mode)}</td><td class="num" data-label="Amount"><b>${money(e.amount)}</b></td><td class="small" data-label="By">${esc(e.createdByName)}</td>
          <td class="mc-actions right">${can.admin() ? `<button class="btn danger-ghost sm" data-del="${e.id}">Delete</button>` : ""}</td></tr>`).join("")}</tbody></table></div>` : `<div class="empty">No expenses in this period</div>`;
      $$("[data-del]", el).forEach((b) => (b.onclick = async () => {
        if (!(await confirmBox("Delete this expense?", { okText: "Delete", danger: true }))) return;
        try { await F.deleteDoc(ref("expenses", b.dataset.del)); toast("Deleted", "ok"); ctx.rerender(); } catch (err) { toast(friendlyError(err), "error"); }
      }));
    } catch (e) { $("#e-list").innerHTML = `<div class="form-error">${esc(friendlyError(e))}</div>`; }
  };
  rangeControl($("#e-range"), load, "month");
  const add = $("#e-add");
  if (add) add.onclick = () => {
    const m = openModal("Add expense", `
      <form id="ex-form"><div class="grid g2">
        <div class="field"><label>Date</label><input name="date" type="date" value="${dayKey()}" max="${dayKey()}"></div>
        <div class="field"><label>Category</label><select name="category">${EXP_CATS.map((c) => `<option>${c}</option>`).join("")}</select></div>
        <div class="field"><label class="req">Amount (₹)</label><input name="amount" type="number" min="1" step="0.01" required></div>
        <div class="field"><label>Paid by</label><select name="mode"><option>Cash</option><option>UPI</option><option>Bank</option><option>Card</option></select></div>
        <div class="field span2"><label>Note</label><input name="note" placeholder="e.g. November rent"></div>
      </div><div class="modal-foot"><button type="button" class="btn ghost" data-close>Cancel</button><button class="btn" type="submit">Save</button></div></form>`);
    $("#ex-form", m.el).onsubmit = async (e) => {
      e.preventDefault();
      const f = formObj(e.target);
      await busy($("button[type=submit]", e.target), async () => {
        try {
          await F.setDoc(newRef("expenses"), { category: f.category, amount: r2(num(f.amount)), mode: f.mode, note: f.note.trim(), ...stamp(), dateKey: f.date || dayKey() });
          m.close(); toast("Expense saved", "ok"); ctx.rerender();
        } catch (err) { toast(friendlyError(err), "error"); }
      });
    };
  };
}
