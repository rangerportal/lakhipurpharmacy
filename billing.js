// Billing: new bill (FEFO batches, loose sale, GST), sales list, returns, cancel, A5 invoice
import {
  F, S, can, ctx, db, col, ref, newRef, list, $, $$, esc, num, r2, money, money2, pad, dayKey, fmtDate, fmtTime, fmtDT, sum, phoneId,
  toast, openModal, confirmBox, busy, friendlyError, rangeControl, byDate, stamp, downloadFile, toCSV, fyCode,
  expLabel, isExpired, expiringSoon, fmtStock, isComposition, splitGst, inWords, logoHtml,
} from "./core.js";
import { productPicker, getBatches, productModal, lowFlag } from "./stock.js";

/* ======================= New bill ======================= */
export async function viewNewBill(el) {
  const lines = [];
  let customer = null;
  const doctors = (S.settings.doctors || "").split("\n").map((s) => s.trim()).filter(Boolean);
  el.innerHTML = `
  <div class="page-head"><h1>New Bill</h1><span class="muted small">${fmtDate(Date.now())} · ${isComposition() ? "Bill of Supply" : "Tax Invoice"}</span></div>
  <div class="bill-grid">
    <div>
      <div class="card">
        <div class="btn-row" style="flex-wrap:nowrap">
          <div class="search-box" style="flex:1"><input id="nb-search" placeholder="Scan barcode or type medicine name… (Enter to add)" autofocus><div class="search-results hidden" id="nb-results"></div></div>
          ${can.enter() ? `<button type="button" class="btn ghost" id="nb-newp" title="Add a medicine that is not in the list">+ New</button>` : ""}
        </div>
        <div class="table-wrap" style="margin-top:12px"><table class="lines" id="nb-lines">
          <thead><tr><th>#</th><th style="min-width:170px">Medicine</th><th>Batch / Exp</th><th>Sell as</th><th>Qty</th><th class="num">Price</th><th>Disc%</th><th class="num">Amount</th><th></th></tr></thead>
          <tbody></tbody>
        </table></div>
      </div>
    </div>
    <div>
      <div class="card">
        <h3 style="margin-bottom:10px">Patient / customer</h3>
        <div class="field"><label>Phone</label><input id="nb-phone" inputmode="tel" maxlength="10" placeholder="10-digit mobile (optional)"></div>
        <div id="nb-cust-info" class="small" style="margin:-6px 0 8px"></div>
        <div class="field"><label>Name</label><input id="nb-name" placeholder="Patient name"></div>
        <div class="field"><label>Doctor</label><input id="nb-doctor" list="nb-doclist" placeholder="Prescribed by (optional)"><datalist id="nb-doclist">${doctors.map((d) => `<option>${esc(d)}</option>`).join("")}</datalist></div>
      </div>
      <div class="card">
        <div class="grid g2">
          <div class="field"><label>Payment</label><select id="nb-mode"><option>Cash</option><option>UPI</option><option>Card</option><option>Credit</option></select></div>
          <div class="field"><label>Disc % (all lines)</label><input id="nb-alldisc" type="number" min="0" max="100" step="0.5" placeholder="0"></div>
        </div>
        <div class="totals" id="nb-totals"></div>
        <div class="grid g2" id="nb-cash-wrap" style="margin-top:10px">
          <div class="field"><label>Cash received</label><input id="nb-recv" type="number" min="0"></div>
          <div class="field"><label>Return change</label><div class="change" id="nb-change">—</div></div>
        </div>
        <div class="btn-row" style="margin-top:6px">
          <button class="btn ghost" id="nb-clear" type="button">Clear</button>
          <button class="btn lg" id="nb-save" type="button" style="flex:1">Save &amp; Print <span class="kbd">Ctrl+Enter</span></button>
        </div>
      </div>
    </div>
  </div>`;
  const tbody = $("#nb-lines tbody");

  const used = (batchId, except) => sum(lines.filter((l, i) => l.batchId === batchId && i !== except), (l) => l.units);
  const calc = (l) => {
    const b = l.batches.find((x) => x.id === l.batchId);
    const ps = num(l.p.packSize) || 1;
    const loose = l.unit === "loose";
    l.mrp = num(b?.mrp);
    l.price = r2(loose ? l.mrp / ps : l.mrp);
    l.units = Math.round(num(l.qty) * (loose ? 1 : ps));
    l.gross = r2(l.price * num(l.qty));
    l.discAmt = r2(l.gross * num(l.disc) / 100);
    l.amount = r2(l.gross - l.discAmt);
    const g = splitGst(l.amount, l.p.gst);
    l.taxable = g.taxable; l.gstAmt = g.gst;
    l.cost = r2(l.units * num(b?.costUnit));
    l.avail = num(b?.qty);
    return l;
  };
  const totals = () => {
    lines.forEach(calc);
    const gross = r2(sum(lines, "gross")), discount = r2(sum(lines, "discAmt")), amount = r2(sum(lines, "amount"));
    const taxable = r2(sum(lines, "taxable")), gst = r2(sum(lines, "gstAmt"));
    const net = Math.round(amount);
    return { gross, discount, amount, taxable, gst, cgst: r2(gst / 2), sgst: r2(gst - r2(gst / 2)), net, roundOff: r2(net - amount), cost: r2(sum(lines, "cost")) };
  };
  const drawTotals = () => {
    const t = totals();
    $("#nb-totals").innerHTML = `
      <div><span>Items</span><b>${lines.length}</b></div>
      <div><span>MRP total</span><b>${money2(t.gross)}</b></div>
      ${t.discount ? `<div><span>Discount</span><b>− ${money2(t.discount)}</b></div>` : ""}
      ${!isComposition() ? `<div class="muted"><span>Incl. GST (CGST ${money2(t.cgst)} + SGST ${money2(t.sgst)})</span><b></b></div>` : ""}
      <div><span>Round off</span><b>${money2(t.roundOff)}</b></div>
      <div class="grand"><span>Net payable</span><b>${money(t.net)}</b></div>`;
    lines.forEach((l, i) => {
      const a = $(`[data-amt="${i}"]`, tbody); if (a) a.textContent = money2(l.amount);
      const pr = $(`[data-price="${i}"]`, tbody); if (pr) pr.textContent = money2(l.price);
      const w = $(`[data-warn="${i}"]`, tbody);
      if (w) { const over = l.units + used(l.batchId, i) > l.avail; w.textContent = over ? `Only ${fmtStock(l.avail - used(l.batchId, i), l.p)} left in this batch` : ""; }
    });
    const recv = num($("#nb-recv").value);
    $("#nb-change").textContent = recv ? money(r2(recv - t.net)) : "—";
    $("#nb-cash-wrap").classList.toggle("hidden", $("#nb-mode").value !== "Cash");
    return t;
  };
  const drawLines = () => {
    tbody.innerHTML = lines.length ? lines.map((l, i) => {
      const ps = num(l.p.packSize) || 1;
      return `<tr>
        <td class="muted">${i + 1}</td>
        <td><b>${esc(l.p.name)}</b>${l.p.schedule && l.p.schedule !== "OTC" ? ` <span class="badge warn">${esc(l.p.schedule)}</span>` : ""}
          <div class="muted small">${esc(ps > 1 ? `${l.p.pack} of ${ps}` : l.p.pack)}${l.p.rack ? " · Rack " + esc(l.p.rack) : ""}</div><div class="txt-danger small" data-warn="${i}"></div></td>
        <td data-label="Batch / Exp"><select data-i="${i}" data-k="batchId" style="width:132px">${l.batches.map((b) => `<option value="${b.id}" ${b.id === l.batchId ? "selected" : ""} ${isExpired(b.expiry) ? "disabled" : ""}>${esc(b.batchNo)} · ${expLabel(b.expiry)}${isExpired(b.expiry) ? " EXPIRED" : ""} · ${esc(fmtStock(b.qty, l.p))}</option>`).join("")}</select>
          ${expiringSoon(l.batches.find((b) => b.id === l.batchId)?.expiry) ? `<div class="small txt-warn">Expiring soon</div>` : ""}</td>
        <td data-label="Sell as">${l.p.allowLoose && ps > 1 ? `<select data-i="${i}" data-k="unit" style="width:78px"><option value="pack" ${l.unit === "pack" ? "selected" : ""}>${esc(l.p.pack)}</option><option value="loose" ${l.unit === "loose" ? "selected" : ""}>${esc(l.p.unit || "Loose")}</option></select>` : `<span class="small">${esc(l.p.pack)}</span>`}</td>
        <td data-label="Qty"><input data-i="${i}" data-k="qty" type="number" min="1" step="1" value="${esc(l.qty)}" style="width:58px"></td>
        <td class="num" data-label="Price" data-price="${i}"></td>
        <td data-label="Disc%"><input data-i="${i}" data-k="disc" type="number" min="0" max="100" step="0.5" value="${esc(l.disc)}" style="width:52px"></td>
        <td class="num" data-label="Amount"><b data-amt="${i}"></b></td>
        <td><button type="button" class="icon-btn" data-rm="${i}" title="Remove">×</button></td>
      </tr>`;
    }).join("") : `<tr><td colspan="9" class="empty">Scan or search a medicine to start the bill</td></tr>`;
    $$("[data-k]", tbody).forEach((inp) => {
      const ev = inp.tagName === "SELECT" ? "change" : "input";
      inp.addEventListener(ev, () => {
        const l = lines[+inp.dataset.i]; l[inp.dataset.k] = inp.value;
        if (inp.tagName === "SELECT") drawLines(); else drawTotals();
      });
      if (inp.dataset.k === "qty") inp.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); $("#nb-search").focus(); } });
    });
    $$("[data-rm]", tbody).forEach((b) => (b.onclick = () => { lines.splice(+b.dataset.rm, 1); drawLines(); }));
    drawTotals();
  };

  const addProduct = async (p) => {
    const existing = lines.findIndex((l) => l.p.id === p.id);
    if (existing >= 0) {
      lines[existing].qty = num(lines[existing].qty) + 1; drawLines();
      $(`[data-i="${existing}"][data-k="qty"]`, tbody)?.select(); return;
    }
    let batches;
    try { batches = await getBatches(p.id); } catch (e) { toast(friendlyError(e), "error"); return; }
    const good = batches.filter((b) => !isExpired(b.expiry));
    if (!good.length) { toast(batches.length ? `${p.name}: only EXPIRED stock left` : `${p.name} is out of stock`, "error"); return; }
    const defDisc = $("#nb-alldisc").value;
    lines.push({ p, batches, batchId: good[0].id, unit: "pack", qty: 1, disc: defDisc || "" });
    drawLines();
    setTimeout(() => $(`[data-i="${lines.length - 1}"][data-k="qty"]`, tbody)?.select(), 30);
  };
  productPicker($("#nb-search"), $("#nb-results"), addProduct);
  const np = $("#nb-newp"); if (np) np.onclick = () => productModal(null, () => toast("Medicine added. Add its stock through Purchases first."));

  $("#nb-alldisc").oninput = (e) => { lines.forEach((l) => (l.disc = e.target.value)); drawLines(); };
  $("#nb-mode").onchange = drawTotals;
  $("#nb-recv").oninput = drawTotals;
  $("#nb-phone").oninput = async (e) => {
    const ph = phoneId(e.target.value);
    customer = null; $("#nb-cust-info").innerHTML = "";
    if (ph.length !== 10) return;
    try {
      const s = await F.getDoc(ref("customers", ph));
      if (s.exists()) {
        customer = { id: ph, ...s.data() };
        if (!$("#nb-name").value) $("#nb-name").value = customer.name;
        $("#nb-cust-info").innerHTML = `<span class="badge teal">Regular customer</span> ${num(customer.balance) > 0 ? `<span class="badge off">Old dues ${money(customer.balance)}</span>` : ""}`;
      } else $("#nb-cust-info").innerHTML = `<span class="muted">New customer — will be saved</span>`;
    } catch (err) {}
  };
  $("#nb-clear").onclick = async () => { if (!lines.length || await confirmBox("Clear this bill?", { okText: "Clear" })) ctx.rerender(); };
  const keyHandler = (e) => { if ((e.ctrlKey || e.metaKey) && e.key === "Enter" && $("#nb-save")) { e.preventDefault(); $("#nb-save").click(); } };
  document.addEventListener("keydown", keyHandler);
  window.addEventListener("hashchange", () => document.removeEventListener("keydown", keyHandler), { once: true });
  drawLines();

  $("#nb-save").onclick = async (e) => {
    if (!lines.length) { toast("Add medicines to the bill", "error"); return; }
    for (const [i, l] of lines.entries()) {
      if (num(l.qty) <= 0) { toast(`Enter quantity for ${l.p.name}`, "error"); return; }
      if (l.units + used(l.batchId, i) > l.avail) { toast(`Not enough stock: ${l.p.name}`, "error"); return; }
    }
    const mode = $("#nb-mode").value;
    const phone = phoneId($("#nb-phone").value), name = $("#nb-name").value.trim(), doctor = $("#nb-doctor").value.trim();
    if (mode === "Credit" && (phone.length !== 10 || !name)) { toast("Credit bill needs customer name and 10-digit phone", "error"); return; }
    if (lines.some((l) => ["H1", "X"].includes(l.p.schedule)) && (!name || !doctor)) {
      if (!(await confirmBox("This bill has Schedule H1/X medicine. Patient name and doctor name should be entered for the register. Save anyway?", { okText: "Save anyway" }))) return;
    }
    const t = totals();
    const btn = e.currentTarget;
    await busy(btn, async () => {
      try {
        const sRef = newRef("sales");
        const fy = fyCode();
        await F.runTransaction(db, async (tx) => {
          const cRef = ref("counters", `bill_${fy}`);
          const cSnap = await tx.get(cRef);
          const bids = [...new Set(lines.map((l) => l.batchId))], pids = [...new Set(lines.map((l) => l.p.id))];
          const bS = {}, pS = {};
          for (const id of bids) bS[id] = await tx.get(ref("batches", id));
          for (const id of pids) pS[id] = await tx.get(ref("products", id));
          const custSnap = phone.length === 10 ? await tx.get(ref("customers", phone)) : null;
          // stock check with live data
          const need = {};
          lines.forEach((l) => (need[l.batchId] = (need[l.batchId] || 0) + l.units));
          for (const id of bids) {
            const have = bS[id].exists() ? num(bS[id].data().qty) : 0;
            if (need[id] > have) throw new Error(`Not enough stock for ${lines.find((l) => l.batchId === id).p.name} (batch has ${have}).`);
          }
          const n = cSnap.exists() ? num(cSnap.data().next) : 1;
          const billNo = `${S.settings.billPrefix || "LPH"}/${fy}/${pad(n, 5)}`;
          // writes
          tx.set(cRef, { next: n + 1 });
          bids.forEach((id) => { const q = num(bS[id].data().qty) - need[id]; if (q <= 0) tx.delete(ref("batches", id)); else tx.update(ref("batches", id), { qty: q }); });
          pids.forEach((id) => {
            if (!pS[id].exists()) return;
            const st = num(pS[id].data().stock) - sum(lines.filter((l) => l.p.id === id), "units");
            tx.update(ref("products", id), { stock: st, lowStock: lowFlag(st, pS[id].data().minStock) });
          });
          const paid = mode === "Credit" ? 0 : t.net, due = mode === "Credit" ? t.net : 0;
          tx.set(sRef, {
            billNo, fy, ...stamp(),
            custId: phone.length === 10 ? phone : "", custName: name, custPhone: phone, doctor,
            items: lines.map((l) => {
              const b = bS[l.batchId].data();
              return {
                productId: l.p.id, name: l.p.name, pack: l.p.pack, unit: l.p.unit || "", packSize: num(l.p.packSize) || 1, hsn: l.p.hsn || "", gst: num(l.p.gst), schedule: l.p.schedule || "",
                batchId: l.batchId, batchNo: b.batchNo, expiry: b.expiry, mrp: num(b.mrp), costUnit: num(b.costUnit), vendorName: b.vendorName || "",
                saleUnit: l.unit, qty: num(l.qty), units: l.units, price: l.price, gross: l.gross, disc: num(l.disc), amount: l.amount, taxable: l.taxable, gstAmt: l.gstAmt, cost: l.cost, returnedUnits: 0,
              };
            }),
            gross: t.gross, discount: t.discount, amount: t.amount, taxable: t.taxable, gst: t.gst, cgst: t.cgst, sgst: t.sgst, roundOff: t.roundOff, net: t.net,
            cost: t.cost, profit: r2(t.taxable - t.cost), paymentMode: mode, paid, due, received: num($("#nb-recv").value) || 0,
            gstType: S.settings.gstType, status: "active", returnedAmount: 0,
          });
          if (phone.length === 10) {
            const old = custSnap.exists() ? custSnap.data() : null;
            tx.set(ref("customers", phone), {
              name: name || old?.name || "Customer", nameLower: (name || old?.name || "customer").toLowerCase(), phone,
              address: old?.address || "", balance: r2(num(old?.balance) + due), lastBillMs: Date.now(), createdAtMs: old?.createdAtMs || Date.now(),
            });
          }
        });
        toast("Bill saved", "ok");
        location.hash = `#/invoice/${sRef.id}?auto=1`;
      } catch (err) { console.error(err); toast(friendlyError(err), "error"); }
    });
  };
}

/* ======================= Sales list ======================= */
export async function viewSales(el, params) {
  const tab = params[0] === "returns" ? "returns" : "bills";
  el.innerHTML = `
    <div class="page-head"><h1>Sales &amp; Returns</h1><div class="btn-row">${can.enter() ? `<a class="btn" href="#/new-bill">+ New bill</a>` : ""}<button class="btn ghost" id="s-csv">Export CSV</button></div></div>
    <div class="tabs"><a href="#/sales" class="${tab === "bills" ? "on" : ""}">Bills</a><a href="#/sales/returns" class="${tab === "returns" ? "on" : ""}">Returns</a></div>
    <div class="card">
      <div class="toolbar">
        <div class="field"><label>Period</label><div class="range" id="s-range"></div></div>
        ${tab === "bills" ? `<div class="field"><label>Payment</label><select id="s-mode"><option value="">All</option><option>Cash</option><option>UPI</option><option>Card</option><option>Credit</option></select></div>` : ""}
        <div class="field grow"><label>Search</label><input id="s-q" placeholder="Bill no., name or phone"></div>
      </div>
      <div id="s-sum" class="btn-row small" style="margin-bottom:10px"></div>
      <div id="s-list"><div class="loading">Loading…</div></div>
    </div>`;
  let all = [], range = [], shown = [];
  const draw = () => {
    const q = $("#s-q").value.trim().toLowerCase();
    const mode = $("#s-mode")?.value || "";
    shown = all.filter((s) => (!mode || s.paymentMode === mode) && (!q || [s.billNo, s.custName, s.custPhone].some((x) => String(x || "").toLowerCase().includes(q))));
    if (tab === "returns") {
      $("#s-sum").innerHTML = `<span class="badge teal">${shown.length} returns</span><span class="badge off">Refunded ${money(sum(shown, "amount"))}</span>`;
      $("#s-list").innerHTML = shown.length ? `<div class="table-wrap"><table class="mcards"><thead><tr><th>Return no.</th><th>Date</th><th>Against bill</th><th>Customer</th><th class="num">Items</th><th class="num">Amount</th><th>Refund</th><th>By</th></tr></thead>
        <tbody>${shown.map((r) => `<tr class="click" data-sale="${r.saleId}"><td class="mc-title" data-label="Return"><b>${esc(r.returnNo)}</b></td><td data-label="Date">${fmtDT(r.createdAtMs)}</td><td data-label="Bill">${esc(r.billNo)}</td><td data-label="Customer">${esc(r.custName)}</td><td class="num" data-label="Items">${(r.items || []).length}</td><td class="num" data-label="Amount">${money(r.amount)}</td><td data-label="Refund">${esc(r.refundMode)}</td><td class="small" data-label="By">${esc(r.createdByName)}</td></tr>`).join("")}</tbody></table></div>` : `<div class="empty">No returns in this period</div>`;
    } else {
      const act = shown.filter((s) => s.status !== "cancelled");
      $("#s-sum").innerHTML = `<span class="badge teal">${act.length} bills</span><span class="badge ok">Sales ${money(sum(act, "net"))}</span>${can.money() ? `<span class="badge">Profit ${money(sum(act, "profit"))}</span>` : ""}<span class="badge warn">Credit ${money(sum(act, "due"))}</span>`;
      $("#s-list").innerHTML = shown.length ? `<div class="table-wrap"><table class="mcards"><thead><tr><th>Bill no.</th><th>Date</th><th>Customer</th><th class="num">Items</th><th class="num">Amount</th><th>Payment</th><th>By</th><th></th></tr></thead>
        <tbody>${shown.map((s) => `<tr class="click ${s.status === "cancelled" ? "cancelled" : ""}" data-sale="${s.id}">
          <td class="mc-title" data-label="Bill"><b>${esc(s.billNo)}</b></td><td data-label="Date">${fmtDate(s.createdAtMs)}<div class="muted small">${fmtTime(s.createdAtMs)}</div></td>
          <td data-label="Customer">${esc(s.custName || "—")}<div class="muted small">${esc(s.custPhone)}</div></td>
          <td class="num" data-label="Items">${(s.items || []).length}</td>
          <td class="num" data-label="Amount"><b>${money(s.net)}</b>${num(s.returnedAmount) ? `<div class="small txt-warn">Returned ${money(s.returnedAmount)}</div>` : ""}</td>
          <td data-label="Payment">${esc(s.paymentMode)}${num(s.due) ? ` <span class="badge off">Due</span>` : ""}</td>
          <td class="small" data-label="By">${esc(s.createdByName)}</td>
          <td class="nowrap right mc-actions">${s.status === "cancelled" ? `<span class="badge off">Cancelled</span>` : `
            ${can.enter() ? `<button class="btn ghost sm" data-ret="${s.id}">Return</button>` : ""}
            ${can.admin() && !num(s.returnedAmount) ? `<button class="btn danger-ghost sm" data-cancel="${s.id}">Cancel</button>` : ""}`}</td>
        </tr>`).join("")}</tbody></table></div>` : `<div class="empty">No bills in this period</div>`;
      $$("[data-ret]", el).forEach((b) => (b.onclick = () => returnModal(all.find((s) => s.id === b.dataset.ret))));
      $$("[data-cancel]", el).forEach((b) => (b.onclick = () => cancelSale(all.find((s) => s.id === b.dataset.cancel))));
    }
    $$("tr[data-sale]", $("#s-list")).forEach((tr) => tr.addEventListener("click", (e) => { if (!e.target.closest("button")) location.hash = `#/invoice/${tr.dataset.sale}`; }));
  };
  rangeControl($("#s-range"), async (a, b) => {
    range = [a, b];
    $("#s-list").innerHTML = `<div class="loading">Loading…</div>`;
    try { all = await byDate(tab === "returns" ? "returns" : "sales", a, b); draw(); } catch (e) { $("#s-list").innerHTML = `<div class="form-error">${esc(friendlyError(e))}</div>`; }
  }, "today");
  $("#s-q").oninput = draw;
  const m = $("#s-mode"); if (m) m.onchange = draw;
  $("#s-csv").onclick = () => {
    if (tab === "returns") downloadFile(`returns_${range[0]}_${range[1]}.csv`, toCSV([["Return no", "Date", "Bill no", "Customer", "Amount", "Taxable", "GST", "Refund mode", "By"], ...shown.map((r) => [r.returnNo, r.dateKey, r.billNo, r.custName, r.amount, r.taxable, r.gst, r.refundMode, r.createdByName])]));
    else downloadFile(`sales_${range[0]}_${range[1]}.csv`, toCSV([["Bill no", "Date", "Time", "Customer", "Phone", "Doctor", "Items", "MRP total", "Discount", "Taxable", "CGST", "SGST", "Round off", "Net", "Payment", "Paid", "Due", ...(can.money() ? ["Cost", "Profit"] : []), "Returned", "Status", "By"],
      ...shown.map((s) => [s.billNo, s.dateKey, fmtTime(s.createdAtMs), s.custName, s.custPhone, s.doctor, (s.items || []).length, s.gross, s.discount, s.taxable, s.cgst, s.sgst, s.roundOff, s.net, s.paymentMode, s.paid, s.due, ...(can.money() ? [s.cost, s.profit] : []), s.returnedAmount, s.status, s.createdByName])]));
  };
}

/* ======================= Returns ======================= */
function returnModal(sale) {
  const rows = sale.items.map((it, i) => {
    const per = it.saleUnit === "loose" ? 1 : (num(it.packSize) || 1);
    const left = Math.floor((num(it.units) - num(it.returnedUnits)) / per);
    return { it, i, per, left };
  });
  const custOk = !!sale.custId;
  const m = openModal(`Return — Bill ${sale.billNo}`, `
    <p class="muted" style="margin-top:0">${esc(sale.custName || "Walk-in")} · ${fmtDate(sale.createdAtMs)} · Enter how many to take back.</p>
    <div class="table-wrap"><table class="lines"><thead><tr><th>Medicine</th><th>Batch</th><th class="num">Sold</th><th class="num">Can return</th><th>Return qty</th></tr></thead>
    <tbody>${rows.map((r) => `<tr><td><b>${esc(r.it.name)}</b></td><td>${esc(r.it.batchNo)} · ${expLabel(r.it.expiry)}</td><td class="num">${r.it.qty} ${esc(r.it.saleUnit === "loose" ? r.it.unit : r.it.pack)}</td><td class="num">${r.left}</td>
      <td><input type="number" min="0" max="${r.left}" value="0" data-r="${r.i}" style="width:70px" ${r.left ? "" : "disabled"}></td></tr>`).join("")}</tbody></table></div>
    <div class="grid g2" style="margin-top:12px">
      <div class="field"><label>Refund by</label><select id="rt-mode"><option>Cash</option><option>UPI</option>${custOk ? `<option ${sale.paymentMode === "Credit" ? "selected" : ""}>Adjust in dues</option>` : ""}</select></div>
      <div class="field"><label>Refund amount</label><div class="change" id="rt-amt">₹0</div></div>
    </div>
    <div class="modal-foot"><button class="btn ghost" data-close>Cancel</button><button class="btn" id="rt-save">Save return</button></div>`, { wide: true });
  const pick = () => rows.map((r) => {
    const q = Math.min(r.left, Math.max(0, Math.floor(num($(`[data-r="${r.i}"]`, m.el).value))));
    const units = q * r.per;
    const f = units / num(r.it.units);
    return { ...r, q, units, amount: r2(num(r.it.amount) * f), taxable: r2(num(r.it.taxable) * f), gstAmt: r2(num(r.it.gstAmt) * f), cost: r2(num(r.it.cost) * f) };
  }).filter((x) => x.q > 0);
  $$("[data-r]", m.el).forEach((i) => (i.oninput = () => ($("#rt-amt", m.el).textContent = money(Math.round(sum(pick(), "amount"))))));
  $("#rt-save", m.el).onclick = async (e) => {
    const sel = pick();
    if (!sel.length) { toast("Enter a quantity to return", "error"); return; }
    const refundMode = $("#rt-mode", m.el).value;
    await busy(e.currentTarget, async () => {
      try {
        const fy = fyCode();
        await F.runTransaction(db, async (tx) => {
          const sSnap = await tx.get(ref("sales", sale.id));
          const cRef = ref("counters", `ret_${fy}`); const cSnap = await tx.get(cRef);
          const bS = {}, pS = {};
          for (const x of sel) { if (!bS[x.it.batchId]) bS[x.it.batchId] = await tx.get(ref("batches", x.it.batchId)); }
          for (const x of sel) { if (!pS[x.it.productId]) pS[x.it.productId] = await tx.get(ref("products", x.it.productId)); }
          const custSnap = refundMode === "Adjust in dues" ? await tx.get(ref("customers", sale.custId)) : null;
          const live = sSnap.data();
          if (live.status === "cancelled") throw new Error("This bill is cancelled.");
          const items = live.items.map((x) => ({ ...x }));
          for (const x of sel) {
            if (num(items[x.i].returnedUnits) + x.units > num(items[x.i].units)) throw new Error(`${x.it.name}: already returned.`);
            items[x.i].returnedUnits = num(items[x.i].returnedUnits) + x.units;
          }
          const amount = Math.round(sum(sel, "amount"));
          const n = cSnap.exists() ? num(cSnap.data().next) : 1;
          tx.set(cRef, { next: n + 1 });
          // stock back (batch may have been removed when it hit 0 — recreate it)
          const addB = {}, addP = {};
          sel.forEach((x) => { addB[x.it.batchId] = (addB[x.it.batchId] || 0) + x.units; addP[x.it.productId] = (addP[x.it.productId] || 0) + x.units; });
          Object.entries(addB).forEach(([id, u]) => {
            if (bS[id].exists()) tx.update(ref("batches", id), { qty: num(bS[id].data().qty) + u });
            else { const it = sel.find((x) => x.it.batchId === id).it; tx.set(ref("batches", id), { productId: it.productId, productName: it.name, pack: it.pack, unit: it.unit, packSize: it.packSize, hsn: it.hsn, batchNo: it.batchNo, expiry: it.expiry, mrp: it.mrp, gst: it.gst, costUnit: it.costUnit, qty: u, vendorName: it.vendorName || "", createdAtMs: Date.now() }); }
          });
          Object.entries(addP).forEach(([id, u]) => { if (pS[id].exists()) { const st = num(pS[id].data().stock) + u; tx.update(ref("products", id), { stock: st, lowStock: lowFlag(st, pS[id].data().minStock) }); } });
          tx.update(ref("sales", sale.id), { items, returnedAmount: r2(num(live.returnedAmount) + amount) });
          if (custSnap?.exists()) tx.update(ref("customers", sale.custId), { balance: r2(num(custSnap.data().balance) - amount) });
          tx.set(newRef("returns"), {
            returnNo: `CN/${fy}/${pad(n, 4)}`, saleId: sale.id, billNo: sale.billNo, custId: sale.custId || "", custName: sale.custName || "",
            items: sel.map((x) => ({ productId: x.it.productId, name: x.it.name, batchNo: x.it.batchNo, hsn: x.it.hsn, gst: x.it.gst, qty: x.q, saleUnit: x.it.saleUnit, units: x.units, amount: x.amount, taxable: x.taxable, gstAmt: x.gstAmt, cost: x.cost })),
            amount, taxable: r2(sum(sel, "taxable")), gst: r2(sum(sel, "gstAmt")), cost: r2(sum(sel, "cost")), refundMode, ...stamp(),
          });
        });
        m.close(); toast("Return saved — stock added back", "ok"); ctx.rerender();
      } catch (err) { toast(friendlyError(err), "error"); }
    });
  };
}

async function cancelSale(sale) {
  const reason = await confirmBox(`Cancel bill ${sale.billNo}? Stock will be added back and it will be removed from sales.`, { okText: "Cancel bill", danger: true, withReason: true });
  if (!reason) return;
  try {
    await F.runTransaction(db, async (tx) => {
      const sSnap = await tx.get(ref("sales", sale.id));
      const live = sSnap.data();
      if (live.status === "cancelled") throw new Error("Already cancelled.");
      if (num(live.returnedAmount)) throw new Error("This bill has returns. Use Return instead.");
      const bS = {}, pS = {};
      for (const it of live.items) { if (!bS[it.batchId]) bS[it.batchId] = await tx.get(ref("batches", it.batchId)); }
      for (const it of live.items) { if (!pS[it.productId]) pS[it.productId] = await tx.get(ref("products", it.productId)); }
      const cSnap = live.custId && num(live.due) ? await tx.get(ref("customers", live.custId)) : null;
      const addB = {}, addP = {};
      live.items.forEach((it) => { addB[it.batchId] = (addB[it.batchId] || 0) + num(it.units); addP[it.productId] = (addP[it.productId] || 0) + num(it.units); });
      Object.entries(addB).forEach(([id, u]) => {
        if (bS[id].exists()) tx.update(ref("batches", id), { qty: num(bS[id].data().qty) + u });
        else { const it = live.items.find((x) => x.batchId === id); tx.set(ref("batches", id), { productId: it.productId, productName: it.name, pack: it.pack, unit: it.unit, packSize: it.packSize, hsn: it.hsn, batchNo: it.batchNo, expiry: it.expiry, mrp: it.mrp, gst: it.gst, costUnit: it.costUnit, qty: u, vendorName: it.vendorName || "", createdAtMs: Date.now() }); }
      });
      Object.entries(addP).forEach(([id, u]) => { if (pS[id].exists()) { const st = num(pS[id].data().stock) + u; tx.update(ref("products", id), { stock: st, lowStock: lowFlag(st, pS[id].data().minStock) }); } });
      if (cSnap?.exists()) tx.update(ref("customers", live.custId), { balance: r2(num(cSnap.data().balance) - num(live.due)) });
      tx.update(ref("sales", sale.id), { status: "cancelled", cancelReason: reason, cancelledBy: S.profile.name, cancelledAtMs: Date.now() });
    });
    toast("Bill cancelled", "ok"); ctx.rerender();
  } catch (e) { toast(friendlyError(e), "error"); }
}

/* ======================= Invoice (A5 print) ======================= */
export async function viewInvoice(el, params) {
  const [id, qs] = (params[0] || "").split("?");
  const snap = await F.getDoc(ref("sales", id));
  if (!snap.exists()) { el.innerHTML = `<div class="card empty">Bill not found</div>`; return; }
  const s = { id, ...snap.data() };
  const st = S.settings;
  const comp = s.gstType === "composition";
  const paper = st.paperSize === "A4" ? "A4" : "A5";
  // GST summary by rate
  const byRate = {};
  s.items.forEach((it) => { const k = num(it.gst); byRate[k] = byRate[k] || { taxable: 0, gst: 0 }; byRate[k].taxable += num(it.taxable); byRate[k].gst += num(it.gstAmt); });
  const saved = r2(num(s.gross) - num(s.net));
  el.innerHTML = `
    <div class="rx-actions">
      <button class="btn lg" id="inv-print">🖨 Print bill</button>
      ${can.enter() ? `<a class="btn ghost lg" href="#/new-bill">+ Next bill</a>` : ""}
      ${can.enter() && s.status !== "cancelled" ? `<button class="btn ghost lg" id="inv-ret">Return items</button>` : ""}
      <a class="btn ghost lg" href="#/sales">All bills</a>
    </div>
    <div class="rx-paper ${paper} inv print-target">
      ${s.status === "cancelled" ? `<div class="rx-cancel">CANCELLED — ${esc(s.cancelReason || "")}</div>` : ""}
      <div class="rx-head">
        ${logoHtml(st)}
        <div class="rx-clinic">
          <h2>${esc(st.name)}</h2>
          ${st.tagline ? `<div class="rx-tagline">${esc(st.tagline)}</div>` : ""}
          <p>${esc(st.address)}</p>
          ${st.phone || st.email ? `<p>${[st.phone ? `Ph: ${esc(st.phone)}` : "", esc(st.email)].filter(Boolean).join(" · ")}</p>` : ""}
        </div>
        <div class="inv-lic">${st.gstin ? `<div>GSTIN: <b>${esc(st.gstin)}</b></div>` : ""}${st.dlNo ? `<div>D.L.: ${esc(st.dlNo)}</div>` : ""}</div>
      </div>
      ${st.tags ? `<div class="rx-tags">${esc(st.tags)}</div>` : ""}
      <div class="inv-title">${comp ? "BILL OF SUPPLY" : "TAX INVOICE"}</div>
      <div class="inv-meta">
        <div><span>Bill No:</span> <b>${esc(s.billNo)}</b><br><span>Date:</span> ${fmtDate(s.createdAtMs)} ${fmtTime(s.createdAtMs)}</div>
        <div><span>Patient:</span> <b>${esc(s.custName || "Walk-in")}</b>${s.custPhone ? ` · ${esc(s.custPhone)}` : ""}<br><span>Doctor:</span> ${esc(s.doctor || "—")}</div>
      </div>
      <table class="inv-items">
        <thead><tr><th>#</th><th>Medicine</th><th>Batch</th><th>Exp</th><th class="num">Qty</th><th class="num">MRP</th><th class="num">Disc%</th><th class="num">Amount</th></tr></thead>
        <tbody>${s.items.map((it, i) => `<tr>
          <td>${i + 1}</td>
          <td><b>${esc(it.name)}</b><div class="sub">${esc(it.packSize > 1 ? `${it.pack} of ${it.packSize}` : it.pack)}${it.hsn ? ` · HSN ${esc(it.hsn)}` : ""}${!comp ? ` · GST ${num(it.gst)}%` : ""}${it.schedule && it.schedule !== "OTC" ? ` · Sch ${esc(it.schedule)}` : ""}</div></td>
          <td>${esc(it.batchNo)}</td><td>${expLabel(it.expiry)}</td>
          <td class="num">${esc(it.qty)}${it.saleUnit === "loose" ? ` ${esc(it.unit)}` : ""}</td>
          <td class="num">${money2(it.mrp)}</td><td class="num">${num(it.disc) ? esc(it.disc) : ""}</td><td class="num">${money2(it.amount)}</td>
        </tr>`).join("")}</tbody>
      </table>
      <div class="inv-bottom">
        <div class="inv-left">
          ${!comp ? `<table class="inv-gst"><thead><tr><th>GST%</th><th class="num">Taxable</th><th class="num">CGST</th><th class="num">SGST</th></tr></thead>
            <tbody>${Object.entries(byRate).sort((a, b) => a[0] - b[0]).map(([k, v]) => `<tr><td>${k}%</td><td class="num">${money2(v.taxable)}</td><td class="num">${money2(v.gst / 2)}</td><td class="num">${money2(v.gst - r2(v.gst / 2))}</td></tr>`).join("")}</tbody></table>`
            : `<div class="small">Composition taxable person, not eligible to collect tax on supplies.</div>`}
          <div class="inv-words">${esc(inWords(s.net))}</div>
          ${saved > 0 ? `<div class="inv-saved">You saved ${money(saved)} on MRP 🎉</div>` : ""}
        </div>
        <div class="inv-tot">
          <div><span>MRP total</span><b>${money2(s.gross)}</b></div>
          ${num(s.discount) ? `<div><span>Discount</span><b>− ${money2(s.discount)}</b></div>` : ""}
          <div><span>Round off</span><b>${money2(s.roundOff)}</b></div>
          <div class="grand"><span>NET AMOUNT</span><b>₹${money2(s.net)}</b></div>
          <div class="small"><span>Paid by ${esc(s.paymentMode)}</span>${num(s.due) ? `<b>Due ${money(s.due)}</b>` : ""}</div>
          ${num(s.returnedAmount) ? `<div class="small"><span>Returned</span><b>− ${money(s.returnedAmount)}</b></div>` : ""}
        </div>
      </div>
      <div class="rx-foot">
        <div class="small inv-terms">${esc(st.terms)}${st.pharmacist ? `<br>Pharmacist: ${esc(st.pharmacist)}` : ""}<br>Billed by: ${esc(s.createdByName)}</div>
        <div class="sign">For ${esc(st.name)}</div>
      </div>
    </div>`;
  $("#inv-print").onclick = () => window.print();
  const r = $("#inv-ret"); if (r) r.onclick = () => returnModal(s);
  if (qs && qs.includes("auto=1")) {
    history.replaceState(null, "", `#/invoice/${id}`);
    setTimeout(() => window.print(), 400);
  }
}
