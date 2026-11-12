// Inventory: medicines (products), batches, purchases / opening stock, stock adjustments
import {
  F, S, can, ctx, db, col, ref, newRef, list, $, $$, esc, num, r2, money, money2, pad, dayKey, fmtDate, fmtKey, sum, formObj,
  toast, openModal, confirmBox, busy, friendlyError, rangeControl, byDate, stamp, downloadFile, toCSV, safeId,
  expLabel, monthKey, isExpired, expiryCutoff, expiringSoon, fmtStock, isComposition,
} from "./core.js";
import { vendorModal, loadVendors } from "./parties.js";

export const PACKS = ["Strip", "Bottle", "Box", "Tube", "Vial", "Ampoule", "Packet", "Sachet", "Jar", "Piece", "Kit"];
export const UNITS = ["Tab", "Cap", "ml", "g", "Pc", "Sachet", "Dose"];
export const CATEGORIES = ["Tablet", "Capsule", "Syrup / Suspension", "Injection", "Drops", "Ointment / Cream", "Powder", "Inhaler", "Surgical", "Device", "Baby care", "Ayurvedic", "FMCG / General", "Other"];
export const SCHEDULES = ["OTC", "G", "H", "H1", "X"];
export const GST_RATES = [0, 5, 12, 18, 28];

export const lowFlag = (stock, minStock) => (num(minStock) > 0 ? num(stock) <= num(minStock) : num(stock) <= 0);

/* ---------------- Search ---------------- */
export async function searchProducts(term) {
  term = (term || "").trim();
  if (!term) return list(await F.getDocs(F.query(col("products"), F.orderBy("nameLower"), F.limit(60))));
  const t = term.toLowerCase();
  const qs = [
    F.query(col("products"), F.where("nameLower", ">=", t), F.where("nameLower", "<=", t + ""), F.limit(20)),
    F.query(col("products"), F.where("genericLower", ">=", t), F.where("genericLower", "<=", t + ""), F.limit(10)),
  ];
  if (/^[0-9A-Za-z-]{6,}$/.test(term)) qs.push(F.query(col("products"), F.where("barcode", "==", term)));
  const res = await Promise.all(qs.map((q) => F.getDocs(q)));
  const m = new Map();
  res.forEach((s) => list(s).forEach((p) => m.set(p.id, p)));
  return [...m.values()].sort((a, b) => (a.barcode === term ? -1 : 0) - (b.barcode === term ? -1 : 0) || a.nameLower.localeCompare(b.nameLower));
}

export async function getBatches(productId) {
  const s = await F.getDocs(F.query(col("batches"), F.where("productId", "==", productId)));
  return list(s).filter((b) => num(b.qty) > 0).sort((a, b) => (a.expiry || "").localeCompare(b.expiry || ""));
}

// A search box with a dropdown of medicines. onPick(product)
export function productPicker(input, box, onPick, { showStock = true } = {}) {
  let tmr, results = [], idx = 0;
  const render = () => {
    box.classList.remove("hidden");
    box.innerHTML = results.length ? results.map((p, i) => `
      <div class="item ${i === idx ? "on" : ""}" data-i="${i}">
        <div class="pp-row"><b>${esc(p.name)}</b>${showStock ? `<span class="${num(p.stock) > 0 ? "muted" : "txt-danger"} small">${num(p.stock) > 0 ? esc(fmtStock(p.stock, p)) : "Out of stock"}</span>` : ""}</div>
        <div class="muted small">${esc([p.generic, p.manufacturer, p.packSize > 1 ? `${p.pack} of ${p.packSize} ${p.unit}` : p.pack, p.mrp ? "MRP " + money(p.mrp) : "", p.rack ? "Rack " + p.rack : ""].filter(Boolean).join(" · "))}${p.schedule && p.schedule !== "OTC" ? ` <span class="badge warn">Sch ${esc(p.schedule)}</span>` : ""}</div>
      </div>`).join("") : `<div class="item muted">No medicine found${can.enter() ? " — use “+ New medicine”" : ""}</div>`;
    $$(".item[data-i]", box).forEach((it) => it.onmousedown = (e) => { e.preventDefault(); pick(+it.dataset.i); });
  };
  const pick = (i) => { const p = results[i]; if (!p) return; box.classList.add("hidden"); input.value = ""; onPick(p); };
  const run = async () => {
    const t = input.value.trim();
    if (!t) { box.classList.add("hidden"); return; }
    try { results = await searchProducts(t); idx = 0; render(); }
    catch (e) { box.classList.remove("hidden"); box.innerHTML = `<div class="item">${esc(friendlyError(e))}</div>`; }
  };
  input.addEventListener("input", () => { clearTimeout(tmr); tmr = setTimeout(run, 220); });
  input.addEventListener("keydown", async (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); idx = Math.min(idx + 1, results.length - 1); render(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); idx = Math.max(idx - 1, 0); render(); }
    else if (e.key === "Enter") {
      e.preventDefault(); clearTimeout(tmr);
      if (box.classList.contains("hidden") || !results.length) await run();
      if (results.length) pick(idx);
    } else if (e.key === "Escape") box.classList.add("hidden");
  });
  input.addEventListener("blur", () => setTimeout(() => box.classList.add("hidden"), 150));
}

/* ---------------- Product (medicine) form ---------------- */
export function productModal(p, onSaved) {
  const isNew = !p?.id;
  p = p || { pack: "Strip", packSize: 10, unit: "Tab", gst: 5, hsn: "3004", schedule: "H", allowLoose: true, active: true, category: "Tablet" };
  const opts = (arr, v) => arr.map((x) => `<option ${String(x) === String(v) ? "selected" : ""}>${x}</option>`).join("");
  const m = openModal(isNew ? "New medicine / product" : "Edit medicine", `
  <form id="pm-form">
    <div class="grid g3">
      <div class="field span2"><label class="req">Medicine / product name</label><input name="name" required value="${esc(p.name)}" placeholder="e.g. Paracetamol 650 Tablet"></div>
      <div class="field"><label>Category</label><select name="category">${opts(CATEGORIES, p.category)}</select></div>
      <div class="field span2"><label>Generic name / composition</label><input name="generic" value="${esc(p.generic)}" placeholder="e.g. Paracetamol 650mg"></div>
      <div class="field"><label>Manufacturer / company</label><input name="manufacturer" value="${esc(p.manufacturer)}"></div>
      <div class="field"><label class="req">Sold as (pack)</label><select name="pack">${opts(PACKS, p.pack)}</select></div>
      <div class="field"><label class="req">Units in one pack</label><input name="packSize" type="number" min="1" step="1" required value="${esc(p.packSize)}"><div class="muted small">e.g. 10 tablets in a strip. 1 for bottles/tubes.</div></div>
      <div class="field"><label>Unit name</label><select name="unit">${opts(UNITS, p.unit)}</select></div>
      <div class="field"><label>GST %</label><select name="gst">${opts(GST_RATES, p.gst)}</select></div>
      <div class="field"><label>HSN code</label><input name="hsn" value="${esc(p.hsn)}"></div>
      <div class="field"><label>Schedule</label><select name="schedule">${opts(SCHEDULES, p.schedule)}</select><div class="muted small">H1 sales are listed in the H1 register report.</div></div>
      <div class="field"><label>Rack / shelf</label><input name="rack" value="${esc(p.rack)}" placeholder="e.g. A-3"></div>
      <div class="field"><label>Reorder level (packs)</label><input name="minPacks" type="number" min="0" value="${esc(p.minStock ? r2(num(p.minStock) / Math.max(1, num(p.packSize))) : "")}"><div class="muted small">Shows in “Low stock” at or below this.</div></div>
      <div class="field"><label>Barcode</label><input name="barcode" value="${esc(p.barcode)}"></div>
      <div class="field"><label>&nbsp;</label><label class="check"><input type="checkbox" name="allowLoose" ${p.allowLoose !== false ? "checked" : ""}> Allow loose sale (single tablets)</label></div>
      <div class="field"><label>&nbsp;</label><label class="check"><input type="checkbox" name="active" ${p.active !== false ? "checked" : ""}> Active</label></div>
    </div>
    <div class="modal-foot"><button type="button" class="btn ghost" data-close>Cancel</button><button class="btn" type="submit">Save medicine</button></div>
  </form>`, { xwide: true });
  $("#pm-form", m.el).onsubmit = async (e) => {
    e.preventDefault();
    const f = formObj(e.target);
    const packSize = Math.max(1, Math.round(num(f.packSize)));
    const minStock = Math.round(num(f.minPacks) * packSize);
    const data = {
      name: f.name.trim(), nameLower: f.name.trim().toLowerCase(), generic: f.generic.trim(), genericLower: f.generic.trim().toLowerCase(),
      manufacturer: f.manufacturer.trim(), category: f.category, pack: f.pack, packSize, unit: f.unit,
      allowLoose: !!f.allowLoose && packSize > 1, gst: num(f.gst), hsn: f.hsn.trim(), schedule: f.schedule, rack: f.rack.trim(),
      minStock, barcode: f.barcode.trim(), active: !!f.active, updatedAtMs: Date.now(),
    };
    await busy($("button[type=submit]", e.target), async () => {
      try {
        let id = p.id;
        if (isNew) {
          const r = newRef("products");
          await F.setDoc(r, { ...data, stock: 0, lowStock: true, mrp: 0, createdAtMs: Date.now() });
          id = r.id;
        } else {
          if (num(p.packSize) !== packSize && num(p.stock) > 0) throw new Error("Pack size can't be changed while there is stock. Adjust stock to 0 first.");
          await F.updateDoc(ref("products", id), { ...data, lowStock: lowFlag(p.stock, minStock) });
        }
        m.close(); toast("Medicine saved", "ok");
        onSaved && onSaved({ ...p, ...data, id, stock: p.stock || 0 });
      } catch (err) { toast(friendlyError(err), "error"); }
    });
  };
  setTimeout(() => $("#pm-form [name=name]", m.el).focus(), 50);
}

/* ---------------- Inventory list ---------------- */
export async function viewInventory(el, params) {
  const tab = (params[0] || "all");
  const tabs = [["all", "All medicines"], ["low", "Low stock"], ["expiring", "Expiring soon"], ["expired", "Expired"], ["out", "Out of stock"]];
  el.innerHTML = `
    <div class="page-head"><h1>Inventory</h1>
      <div class="btn-row">
        ${can.money() ? `<button class="btn ghost" id="inv-value">Stock value</button>` : ""}
        ${can.enter() ? `<a class="btn ghost" href="#/new-purchase">+ Stock in (purchase)</a><button class="btn" id="inv-add">+ New medicine</button>` : ""}
      </div></div>
    <div class="tabs">${tabs.map(([k, l]) => `<a href="#/inventory/${k}" class="${k === tab ? "on" : ""}">${l}</a>`).join("")}</div>
    <div class="card">
      ${tab === "all" ? `<div class="toolbar"><div class="field grow"><input id="inv-q" placeholder="Search by medicine name, generic name or barcode"></div></div>` : ""}
      <div id="inv-list"><div class="loading">Loading…</div></div>
    </div>`;
  const addBtn = $("#inv-add");
  if (addBtn) addBtn.onclick = () => productModal(null, (p) => (location.hash = `#/product/${p.id}`));
  const valBtn = $("#inv-value");
  if (valBtn) valBtn.onclick = () => stockValueModal();
  const box = $("#inv-list");

  const productTable = (rows) => rows.length ? `<div class="table-wrap"><table class="mcards">
    <thead><tr><th>Medicine</th><th>Pack</th><th class="num">Stock</th><th class="num">MRP</th><th class="num">GST</th><th>Rack</th><th></th></tr></thead>
    <tbody>${rows.map((p) => `<tr class="click" data-id="${p.id}">
      <td class="mc-title" data-label="Medicine"><b>${esc(p.name)}</b>${p.schedule && p.schedule !== "OTC" ? ` <span class="badge warn">${esc(p.schedule)}</span>` : ""}<div class="muted small">${esc([p.generic, p.manufacturer].filter(Boolean).join(" · "))}</div></td>
      <td data-label="Pack">${esc(p.packSize > 1 ? `${p.pack} of ${p.packSize}` : p.pack)}</td>
      <td class="num" data-label="Stock"><b class="${num(p.stock) <= 0 ? "txt-danger" : p.lowStock ? "txt-warn" : ""}">${esc(fmtStock(p.stock, p))}</b></td>
      <td class="num" data-label="MRP">${p.mrp ? money(p.mrp) : "—"}</td>
      <td class="num" data-label="GST">${num(p.gst)}%</td>
      <td data-label="Rack">${esc(p.rack)}</td>
      <td class="mc-actions right">${p.active === false ? `<span class="badge off">Inactive</span>` : p.lowStock ? `<span class="badge warn">Low</span>` : ""}</td>
    </tr>`).join("")}</tbody></table></div>` : `<div class="empty">Nothing here 🎉</div>`;

  const batchTable = (rows, expired) => rows.length ? `
    <div class="btn-row small" style="margin-bottom:10px"><span class="badge ${expired ? "off" : "warn"}">${rows.length} batches</span><span class="badge teal">Value at cost ${money(sum(rows, (b) => num(b.qty) * num(b.costUnit)))}</span>
    <button class="btn ghost sm" id="exp-csv">Export CSV</button></div>
    <div class="table-wrap"><table class="mcards">
    <thead><tr><th>Medicine</th><th>Batch</th><th>Expiry</th><th class="num">Qty</th><th class="num">MRP</th><th class="num">Cost value</th><th>Supplier</th><th></th></tr></thead>
    <tbody>${rows.map((b) => `<tr>
      <td class="mc-title" data-label="Medicine"><a href="#/product/${b.productId}"><b>${esc(b.productName)}</b></a></td>
      <td data-label="Batch">${esc(b.batchNo)}</td>
      <td data-label="Expiry"><span class="badge ${isExpired(b.expiry) ? "off" : "warn"}">${expLabel(b.expiry)}</span></td>
      <td class="num" data-label="Qty">${esc(fmtStock(b.qty, b))}</td>
      <td class="num" data-label="MRP">${money(b.mrp)}</td>
      <td class="num" data-label="Cost value">${money(num(b.qty) * num(b.costUnit))}</td>
      <td class="small" data-label="Supplier">${esc(b.vendorName)}</td>
      <td class="mc-actions right">${can.admin() ? `<button class="btn danger-ghost sm" data-adj="${b.id}">Write off / return</button>` : ""}</td>
    </tr>`).join("")}</tbody></table></div>` : `<div class="empty">No batches here 🎉</div>`;

  const bindRows = () => $$("tr[data-id]", box).forEach((tr) => (tr.onclick = () => (location.hash = `#/product/${tr.dataset.id}`)));

  try {
    if (tab === "all") {
      const load = async () => { box.innerHTML = productTable(await searchProducts($("#inv-q").value)); bindRows(); };
      let tmr; $("#inv-q").oninput = () => { clearTimeout(tmr); tmr = setTimeout(load, 250); };
      await load();
      if (!$("#inv-q").value) box.insertAdjacentHTML("beforeend", `<p class="muted small">Showing the first 60 medicines (A–Z). Search to find others.</p>`);
    } else if (tab === "low" || tab === "out") {
      const q = tab === "low" ? F.where("lowStock", "==", true) : F.where("stock", "<=", 0);
      const rows = list(await F.getDocs(F.query(col("products"), q))).filter((p) => p.active !== false).sort((a, b) => a.nameLower.localeCompare(b.nameLower));
      box.innerHTML = (tab === "low" ? `<div class="btn-row" style="margin-bottom:10px"><button class="btn ghost sm" id="low-csv">Download order list (CSV)</button></div>` : "") + productTable(rows);
      bindRows();
      const lc = $("#low-csv");
      if (lc) lc.onclick = () => downloadFile(`order-list-${dayKey()}.csv`, toCSV([["Medicine", "Generic", "Company", "Pack", "In stock", "Reorder level (packs)", "Last rate"],
        ...rows.map((p) => [p.name, p.generic, p.manufacturer, `${p.pack} of ${p.packSize}`, fmtStock(p.stock, p), r2(num(p.minStock) / Math.max(1, p.packSize)), p.lastRate || ""])]));
    } else {
      const cutoff = tab === "expired" ? monthKey() : expiryCutoff(S.settings.expiryAlertDays);
      let rows = list(await F.getDocs(F.query(col("batches"), F.where("expiry", "<=", cutoff)))).filter((b) => num(b.qty) > 0);
      rows = rows.filter((b) => (tab === "expired" ? isExpired(b.expiry) : !isExpired(b.expiry))).sort((a, b) => a.expiry.localeCompare(b.expiry));
      box.innerHTML = (tab === "expiring" ? `<p class="muted small" style="margin-top:0">Batches expiring within ${num(S.settings.expiryAlertDays)} days. Sell these first or return them to the supplier.</p>` : "") + batchTable(rows, tab === "expired");
      $$("[data-adj]", box).forEach((b) => (b.onclick = () => adjustModal(rows.find((x) => x.id === b.dataset.adj), tab === "expired" ? "Expired – write off" : "Returned to vendor")));
      const ec = $("#exp-csv");
      if (ec) ec.onclick = () => downloadFile(`${tab}-${dayKey()}.csv`, toCSV([["Medicine", "Batch", "Expiry", "Qty", "MRP", "Cost value", "Supplier"],
        ...rows.map((b) => [b.productName, b.batchNo, expLabel(b.expiry), fmtStock(b.qty, b), b.mrp, r2(num(b.qty) * num(b.costUnit)), b.vendorName])]));
    }
  } catch (e) { box.innerHTML = `<div class="form-error">${esc(friendlyError(e))}</div>`; }
}

async function stockValueModal() {
  const m = openModal("Stock value", `<div class="loading">Calculating…</div>`);
  try {
    const rows = list(await F.getDocs(col("batches"))).filter((b) => num(b.qty) > 0);
    const cost = sum(rows, (b) => num(b.qty) * num(b.costUnit));
    const mrpVal = sum(rows, (b) => (num(b.qty) / Math.max(1, num(b.packSize))) * num(b.mrp));
    const exp = rows.filter((b) => isExpired(b.expiry));
    $(".modal-body", m.el).innerHTML = `
      <div class="stats" style="grid-template-columns:1fr 1fr">
        <div class="stat primary"><div class="label">At purchase cost</div><div class="value">${money(r2(cost))}</div></div>
        <div class="stat"><div class="label">At MRP</div><div class="value">${money(r2(mrpVal))}</div></div>
        <div class="stat"><div class="label">Batches in stock</div><div class="value">${rows.length}</div></div>
        <div class="stat"><div class="label">Expired (cost)</div><div class="value txt-danger">${money(r2(sum(exp, (b) => num(b.qty) * num(b.costUnit))))}</div></div>
      </div>
      <p class="muted small">${isComposition() ? "Cost includes GST (composition scheme)." : "Cost is before GST."} Possible profit if all stock sells at MRP: <b>${money(r2(mrpVal - cost))}</b> (before GST).</p>
      <div class="modal-foot"><button class="btn ghost" id="sv-csv">Download stock list (CSV)</button><button class="btn" data-close>Close</button></div>`;
    $("#sv-csv", m.el).onclick = () => downloadFile(`stock-${dayKey()}.csv`, toCSV([["Medicine", "Batch", "Expiry", "Qty (units)", "Qty", "MRP/pack", "Cost/unit", "Cost value", "MRP value", "Supplier"],
      ...rows.sort((a, b) => a.productName.localeCompare(b.productName)).map((b) => [b.productName, b.batchNo, expLabel(b.expiry), b.qty, fmtStock(b.qty, b), b.mrp, r2(b.costUnit), r2(num(b.qty) * num(b.costUnit)), r2((num(b.qty) / Math.max(1, num(b.packSize))) * num(b.mrp)), b.vendorName])]));
  } catch (e) { $(".modal-body", m.el).innerHTML = `<div class="form-error">${esc(friendlyError(e))}</div>`; }
}

/* ---------------- Product page ---------------- */
export async function viewProduct(el, params) {
  const id = params[0];
  const [ps, batches, adjs] = await Promise.all([
    F.getDoc(ref("products", id)), getBatches(id),
    F.getDocs(F.query(col("adjustments"), F.where("productId", "==", id))).then(list).catch(() => []),
  ]);
  if (!ps.exists()) { el.innerHTML = `<div class="card empty">Medicine not found</div>`; return; }
  const p = { id, ...ps.data() };
  el.innerHTML = `
    <div class="page-head"><h1>${esc(p.name)} ${p.schedule && p.schedule !== "OTC" ? `<span class="badge warn">Sch ${esc(p.schedule)}</span>` : ""}</h1>
      <div class="btn-row">
        ${can.enter() ? `<button class="btn ghost" id="pd-edit">Edit</button>` : ""}
        ${can.admin() && num(p.stock) <= 0 ? `<button class="btn danger-ghost" id="pd-del">Delete</button>` : ""}
        ${can.enter() ? `<a class="btn" href="#/new-purchase">+ Stock in</a>` : ""}
      </div></div>
    <div class="two-col">
      <div class="card"><div class="kv">
        <div class="k">Generic</div><div>${esc(p.generic) || "—"}</div>
        <div class="k">Company</div><div>${esc(p.manufacturer) || "—"}</div>
        <div class="k">Category</div><div>${esc(p.category)}</div>
        <div class="k">Pack</div><div>${esc(p.packSize > 1 ? `${p.pack} of ${p.packSize} ${p.unit}` : p.pack)}${p.allowLoose ? " · loose sale allowed" : ""}</div>
        <div class="k">HSN / GST</div><div>${esc(p.hsn)} · ${num(p.gst)}%</div>
        <div class="k">Rack</div><div>${esc(p.rack) || "—"}</div>
        <div class="k">Barcode</div><div>${esc(p.barcode) || "—"}</div>
      </div></div>
      <div class="stats" style="grid-template-columns:1fr 1fr;align-content:start">
        <div class="stat primary"><div class="label">In stock</div><div class="value">${esc(fmtStock(p.stock, p))}</div></div>
        <div class="stat"><div class="label">MRP</div><div class="value">${money(p.mrp)}</div></div>
        <div class="stat"><div class="label">Reorder at</div><div class="value">${esc(fmtStock(p.minStock || 0, p))}</div></div>
        ${can.money() ? `<div class="stat"><div class="label">Last buy rate</div><div class="value">${p.lastRate ? money(p.lastRate) : "—"}</div></div>` : ""}
      </div>
    </div>
    <div class="card"><div class="card-head"><h3>Batches in stock</h3></div>
      ${batches.length ? `<div class="table-wrap"><table class="mcards"><thead><tr><th>Batch</th><th>Expiry</th><th class="num">Qty</th><th class="num">MRP</th>${can.money() ? `<th class="num">Cost/${esc(p.unit || "unit")}</th>` : ""}<th>Supplier</th><th></th></tr></thead>
      <tbody>${batches.map((b) => `<tr>
        <td class="mc-title" data-label="Batch"><b>${esc(b.batchNo)}</b></td>
        <td data-label="Expiry"><span class="badge ${isExpired(b.expiry) ? "off" : expiringSoon(b.expiry) ? "warn" : "ok"}">${expLabel(b.expiry)}</span></td>
        <td class="num" data-label="Qty">${esc(fmtStock(b.qty, b))}</td>
        <td class="num" data-label="MRP">${money(b.mrp)}</td>
        ${can.money() ? `<td class="num" data-label="Cost">${money2(b.costUnit)}</td>` : ""}
        <td class="small" data-label="Supplier">${esc(b.vendorName)}</td>
        <td class="mc-actions right">${can.admin() ? `<button class="btn ghost sm" data-adj="${b.id}">Adjust</button>` : ""}</td>
      </tr>`).join("")}</tbody></table></div>` : `<div class="empty">No stock. Add stock through Purchases.</div>`}
    </div>
    ${adjs.length ? `<div class="card"><div class="card-head"><h3>Stock adjustments</h3></div><div class="table-wrap"><table class="mcards"><thead><tr><th>Date</th><th>Batch</th><th>Type</th><th class="num">Qty</th><th>By</th><th>Note</th></tr></thead>
      <tbody>${adjs.sort((a, b) => b.createdAtMs - a.createdAtMs).map((a) => `<tr><td class="mc-title" data-label="Date">${fmtDate(a.createdAtMs)}</td><td data-label="Batch">${esc(a.batchNo)}</td><td data-label="Type">${esc(a.type)}</td><td class="num" data-label="Qty">${a.units > 0 ? "+" : ""}${esc(a.units)} ${esc(p.unit)}</td><td data-label="By">${esc(a.createdByName)}</td><td data-label="Note" class="small">${esc(a.note)}</td></tr>`).join("")}</tbody></table></div></div>` : ""}`;
  const ed = $("#pd-edit"); if (ed) ed.onclick = () => productModal(p, () => ctx.rerender());
  const del = $("#pd-del");
  if (del) del.onclick = async () => {
    if (!(await confirmBox(`Delete ${p.name}? Old bills keep their details.`, { okText: "Delete", danger: true }))) return;
    try { await F.deleteDoc(ref("products", id)); toast("Deleted", "ok"); location.hash = "#/inventory"; } catch (e) { toast(friendlyError(e), "error"); }
  };
  $$("[data-adj]", el).forEach((b) => (b.onclick = () => adjustModal(batches.find((x) => x.id === b.dataset.adj))));
}

/* ---------------- Stock adjustment (admin) ---------------- */
const ADJ_TYPES = [["Expired – write off", -1], ["Damaged / broken", -1], ["Returned to vendor", -1], ["Stock correction (less)", -1], ["Stock correction (more)", 1]];
function adjustModal(b, defType) {
  const ps = Math.max(1, num(b.packSize));
  const m = openModal(`Adjust stock — ${b.productName}`, `
    <p class="muted" style="margin-top:0">Batch <b>${esc(b.batchNo)}</b> · Exp ${expLabel(b.expiry)} · In stock <b>${esc(fmtStock(b.qty, b))}</b></p>
    <form id="adj-form">
      <div class="field"><label>Type</label><select name="type">${ADJ_TYPES.map(([t]) => `<option ${t === defType ? "selected" : ""}>${t}</option>`).join("")}</select></div>
      <div class="grid g2">
        <div class="field"><label>${esc(b.pack || "Packs")}</label><input name="packs" type="number" min="0" value="${ps > 1 ? Math.floor(num(b.qty) / ps) : num(b.qty)}"></div>
        ${ps > 1 ? `<div class="field"><label>Loose ${esc(b.unit || "units")}</label><input name="loose" type="number" min="0" max="${ps - 1}" value="${num(b.qty) % ps}"></div>` : ""}
      </div>
      <div class="field"><label>Note</label><input name="note" placeholder="e.g. Returned to ABC Distributors, credit note #123"></div>
      <div class="modal-foot"><button type="button" class="btn ghost" data-close>Cancel</button><button class="btn danger" type="submit">Save adjustment</button></div>
    </form>`);
  $("#adj-form", m.el).onsubmit = async (e) => {
    e.preventDefault();
    const f = formObj(e.target);
    const sign = ADJ_TYPES.find(([t]) => t === f.type)[1];
    const units = Math.round(num(f.packs) * ps + num(f.loose));
    if (units <= 0) { toast("Enter a quantity", "error"); return; }
    await busy($("button[type=submit]", e.target), async () => {
      try {
        await F.runTransaction(db, async (tx) => {
          const bs = await tx.get(ref("batches", b.id));
          const pr = await tx.get(ref("products", b.productId));
          const cur = bs.exists() ? num(bs.data().qty) : 0;
          if (sign < 0 && units > cur) throw new Error(`Only ${cur} ${b.unit || "units"} in this batch.`);
          const nq = cur + sign * units;
          if (nq <= 0) tx.delete(ref("batches", b.id)); else tx.update(ref("batches", b.id), { qty: nq });
          if (pr.exists()) { const st = num(pr.data().stock) + sign * units; tx.update(ref("products", b.productId), { stock: st, lowStock: lowFlag(st, pr.data().minStock) }); }
          tx.set(newRef("adjustments"), {
            productId: b.productId, productName: b.productName, batchId: b.id, batchNo: b.batchNo, expiry: b.expiry, type: f.type,
            units: sign * units, costValue: r2(units * num(b.costUnit)) * sign, note: f.note.trim(), ...stamp(),
          });
        });
        m.close(); toast("Stock updated", "ok"); ctx.rerender();
      } catch (err) { toast(friendlyError(err), "error"); }
    });
  };
}

/* ---------------- Purchases list ---------------- */
export async function viewPurchases(el) {
  el.innerHTML = `
    <div class="page-head"><h1>Purchases</h1>${can.enter() ? `<a class="btn" href="#/new-purchase">+ New purchase / stock in</a>` : ""}</div>
    <div class="card">
      <div class="toolbar">
        <div class="field"><label>Period</label><div class="range" id="pu-range"></div></div>
        <div class="field grow"><label>Search</label><input id="pu-q" placeholder="Vendor or invoice no."></div>
      </div>
      <div id="pu-sum" class="btn-row small" style="margin-bottom:10px"></div>
      <div id="pu-list"><div class="loading">Loading…</div></div>
    </div>`;
  let all = [], range = [];
  const draw = () => {
    const q = $("#pu-q").value.trim().toLowerCase();
    const rows = all.filter((p) => !q || [p.vendorName, p.invoiceNo].some((x) => String(x || "").toLowerCase().includes(q)));
    const real = rows.filter((p) => p.type !== "opening");
    $("#pu-sum").innerHTML = `<span class="badge teal">${rows.length} entries</span><span class="badge ok">Purchases ${money(sum(real, "net"))}</span><span class="badge">GST paid ${money(sum(real, "gstTotal"))}</span><span class="badge warn">Unpaid ${money(sum(real, "due"))}</span>
      ${can.money() ? `<button class="btn ghost sm" id="pu-csv">Export CSV</button>` : ""}`;
    $("#pu-list").innerHTML = rows.length ? `<div class="table-wrap"><table class="mcards">
      <thead><tr><th>Date</th><th>Vendor</th><th>Invoice</th><th class="num">Items</th><th class="num">Taxable</th><th class="num">GST</th><th class="num">Total</th><th class="num">Due</th></tr></thead>
      <tbody>${rows.map((p) => `<tr class="click" data-id="${p.id}">
        <td class="mc-title" data-label="Date"><b>${fmtKey(p.invoiceDate || p.dateKey)}</b>${p.type === "opening" ? ` <span class="badge teal">Opening stock</span>` : ""}</td>
        <td data-label="Vendor">${esc(p.vendorName || "—")}</td><td data-label="Invoice">${esc(p.invoiceNo)}</td>
        <td class="num" data-label="Items">${(p.items || []).length}</td>
        <td class="num" data-label="Taxable">${money(p.taxable)}</td><td class="num" data-label="GST">${money(p.gstTotal)}</td>
        <td class="num" data-label="Total"><b>${money(p.net)}</b></td>
        <td class="num" data-label="Due">${num(p.due) > 0 ? `<span class="txt-danger">${money(p.due)}</span>` : "—"}</td>
      </tr>`).join("")}</tbody></table></div>` : `<div class="empty">No purchases in this period</div>`;
    $$("tr[data-id]", $("#pu-list")).forEach((tr) => (tr.onclick = () => (location.hash = `#/purchase/${tr.dataset.id}`)));
    const c = $("#pu-csv");
    if (c) c.onclick = () => downloadFile(`purchases_${range[0]}_${range[1]}.csv`, toCSV([["Entry date", "Invoice date", "Type", "Vendor", "Vendor GSTIN", "Invoice no", "Taxable", "CGST", "SGST", "IGST", "Total GST", "Round off", "Net", "Paid", "Due", "Mode", "Entered by"],
      ...rows.map((p) => [p.dateKey, p.invoiceDate, p.type, p.vendorName, p.vendorGstin, p.invoiceNo, p.taxable, p.cgst, p.sgst, p.igst, p.gstTotal, p.roundOff, p.net, p.paid, p.due, p.payMode, p.createdByName])]));
  };
  rangeControl($("#pu-range"), async (a, b) => {
    range = [a, b];
    $("#pu-list").innerHTML = `<div class="loading">Loading…</div>`;
    try { all = await byDate("purchases", a, b); draw(); } catch (e) { $("#pu-list").innerHTML = `<div class="form-error">${esc(friendlyError(e))}</div>`; }
  }, "month");
  $("#pu-q").oninput = draw;
}

export async function viewPurchase(el, params) {
  const s = await F.getDoc(ref("purchases", params[0]));
  if (!s.exists()) { el.innerHTML = `<div class="card empty">Purchase not found</div>`; return; }
  const p = s.data();
  el.innerHTML = `
    <div class="page-head"><h1>${p.type === "opening" ? "Opening stock" : "Purchase"} — ${esc(p.invoiceNo)}</h1><div class="btn-row"><button class="btn ghost" onclick="history.back()">Back</button></div></div>
    <div class="card"><div class="kv">
      <div class="k">Vendor</div><div><b>${esc(p.vendorName || "—")}</b> ${p.vendorGstin ? `<span class="muted small">GSTIN ${esc(p.vendorGstin)}</span>` : ""}</div>
      <div class="k">Invoice date</div><div>${fmtKey(p.invoiceDate)}</div>
      <div class="k">Entered</div><div>${fmtDate(p.createdAtMs)} by ${esc(p.createdByName)}</div>
      <div class="k">Payment</div><div>Paid ${money(p.paid)} (${esc(p.payMode)})${num(p.due) > 0 ? ` · <span class="txt-danger">Due ${money(p.due)}</span>` : ""}</div>
    </div></div>
    <div class="card"><div class="table-wrap"><table class="mcards">
      <thead><tr><th>Medicine</th><th>Batch</th><th>Exp</th><th class="num">Qty</th><th class="num">Free</th><th class="num">Rate</th><th class="num">Disc%</th><th class="num">GST%</th><th class="num">MRP</th><th class="num">Amount</th></tr></thead>
      <tbody>${(p.items || []).map((i) => `<tr>
        <td class="mc-title" data-label="Medicine"><b>${esc(i.name)}</b></td><td data-label="Batch">${esc(i.batchNo)}</td><td data-label="Expiry">${expLabel(i.expiry)}</td>
        <td class="num" data-label="Qty">${esc(i.qty)}</td><td class="num" data-label="Free">${esc(i.free || 0)}</td><td class="num" data-label="Rate">${money2(i.rate)}</td>
        <td class="num" data-label="Disc%">${esc(i.disc || 0)}</td><td class="num" data-label="GST%">${esc(i.gst)}</td><td class="num" data-label="MRP">${money2(i.mrp)}</td><td class="num" data-label="Amount">${money2(i.total)}</td>
      </tr>`).join("")}</tbody>
      <tfoot>
        <tr><td colspan="9" class="right">Taxable</td><td class="num">${money2(p.taxable)}</td></tr>
        ${p.interState ? `<tr><td colspan="9" class="right">IGST</td><td class="num">${money2(p.igst)}</td></tr>` : `<tr><td colspan="9" class="right">CGST + SGST</td><td class="num">${money2(p.cgst)} + ${money2(p.sgst)}</td></tr>`}
        <tr><td colspan="9" class="right">Round off</td><td class="num">${money2(p.roundOff)}</td></tr>
        <tr><td colspan="9" class="right">Net total</td><td class="num">${money2(p.net)}</td></tr>
      </tfoot></table></div></div>
    <p class="muted small">To correct stock after saving, open the medicine in Inventory and use “Adjust” (admin).</p>`;
}

/* ---------------- New purchase / opening stock ---------------- */
export async function viewNewPurchase(el) {
  let vendors = await loadVendors();
  const lines = [];
  el.innerHTML = `
  <div class="page-head"><h1>New purchase / stock in</h1></div>
  <form id="np-form" autocomplete="off">
    <div class="card">
      <label class="check" style="margin-bottom:12px"><input type="checkbox" id="np-opening"> This is <b>opening stock</b> (medicines already in the shop — not a new purchase)</label>
      <div class="grid g4" id="np-head">
        <div class="field span2 vendor-f"><label class="req">Vendor / supplier</label><div class="btn-row" style="flex-wrap:nowrap"><select id="np-vendor" style="flex:1"><option value="">— Select vendor —</option>${vendors.map((v) => `<option value="${v.id}">${esc(v.name)}</option>`).join("")}</select>${can.enter() ? `<button type="button" class="btn ghost" id="np-newv">+ New</button>` : ""}</div></div>
        <div class="field vendor-f"><label class="req">Supplier invoice no.</label><input id="np-inv"></div>
        <div class="field vendor-f"><label class="req">Invoice date</label><input id="np-date" type="date" value="${dayKey()}"></div>
      </div>
      <label class="check vendor-f small" id="np-igst-wrap"><input type="checkbox" id="np-igst"> Inter-state purchase (IGST)</label>
    </div>

    <div class="card">
      <div class="card-head"><h3>Medicines</h3>${can.enter() ? `<button type="button" class="btn ghost sm" id="np-newp">+ New medicine</button>` : ""}</div>
      <div class="search-box"><input id="np-search" placeholder="Type medicine name to add a line (Enter to pick)"><div class="search-results hidden" id="np-results"></div></div>
      <div class="table-wrap" style="margin-top:12px"><table class="lines" id="np-lines">
        <thead><tr><th style="min-width:180px">Medicine</th><th>Batch*</th><th>Expiry*</th><th>Qty*</th><th>Free</th><th>Rate*</th><th>Disc%</th><th>GST%</th><th>MRP*</th><th class="num">Amount</th><th></th></tr></thead>
        <tbody></tbody>
      </table></div>
      <p class="muted small">Qty, free, rate and MRP are <b>per pack</b> (strip / bottle) exactly as on the supplier bill. Rate is before GST.</p>
    </div>

    <div class="card">
      <div class="grid g2">
        <div>
          <div class="grid g2">
            <div class="field pay-f"><label>Amount paid now (₹)</label><input id="np-paid" type="number" min="0" step="0.01"></div>
            <div class="field pay-f"><label>Paid by</label><select id="np-mode"><option>Credit</option><option>Cash</option><option>UPI</option><option>Bank</option><option>Cheque</option></select></div>
          </div>
          <p class="muted small pay-f">Any unpaid amount is added to the vendor's dues.</p>
        </div>
        <div class="totals" id="np-totals"></div>
      </div>
    </div>
    <div class="sticky-actions"><button type="submit" class="btn lg">Save &amp; add to stock</button></div>
  </form>`;

  const tbody = $("#np-lines tbody");
  const opening = () => $("#np-opening").checked;
  const vendor = () => vendors.find((v) => v.id === $("#np-vendor").value);
  const sameState = (v) => !v?.state || !S.settings.state || v.state.trim().toLowerCase() === S.settings.state.trim().toLowerCase();

  const calc = (l) => {
    const net = num(l.rate) * (1 - num(l.disc) / 100);
    l.taxable = r2(net * num(l.qty));
    l.gstAmt = r2(l.taxable * num(l.gst) / 100);
    l.total = r2(l.taxable + l.gstAmt);
    return l;
  };
  const totals = () => {
    lines.forEach(calc);
    const taxable = r2(sum(lines, "taxable")), gst = r2(sum(lines, "gstAmt"));
    const inter = $("#np-igst").checked;
    const total = r2(taxable + gst), net = Math.round(total);
    return { taxable, gst, inter, cgst: inter ? 0 : r2(gst / 2), sgst: inter ? 0 : r2(gst - r2(gst / 2)), igst: inter ? gst : 0, total, roundOff: r2(net - total), net };
  };
  const drawTotals = () => {
    const t = totals();
    $("#np-totals").innerHTML = `
      <div><span>Taxable value</span><b>${money2(t.taxable)}</b></div>
      ${t.inter ? `<div><span>IGST</span><b>${money2(t.igst)}</b></div>` : `<div><span>CGST</span><b>${money2(t.cgst)}</b></div><div><span>SGST</span><b>${money2(t.sgst)}</b></div>`}
      <div><span>Round off</span><b>${money2(t.roundOff)}</b></div>
      <div class="grand"><span>Bill total</span><b>${money(t.net)}</b></div>`;
    lines.forEach((l, i) => { const c = $(`[data-amt="${i}"]`, tbody); if (c) c.textContent = money2(l.total); });
    return t;
  };
  const drawLines = () => {
    tbody.innerHTML = lines.length ? lines.map((l, i) => `
      <tr>
        <td><b>${esc(l.name)}</b><div class="muted small">${esc(l.packSize > 1 ? `${l.pack} of ${l.packSize}` : l.pack)}</div></td>
        <td data-label="Batch"><input data-i="${i}" data-k="batchNo" value="${esc(l.batchNo)}" style="width:100px;text-transform:uppercase"></td>
        <td data-label="Expiry"><input data-i="${i}" data-k="expiry" type="month" value="${esc(l.expiry)}" style="width:140px"></td>
        <td data-label="Qty"><input data-i="${i}" data-k="qty" type="number" min="0" value="${esc(l.qty)}" style="width:70px"></td>
        <td data-label="Free"><input data-i="${i}" data-k="free" type="number" min="0" value="${esc(l.free)}" style="width:60px"></td>
        <td data-label="Rate"><input data-i="${i}" data-k="rate" type="number" min="0" step="0.01" value="${esc(l.rate)}" style="width:85px"></td>
        <td data-label="Disc%"><input data-i="${i}" data-k="disc" type="number" min="0" max="100" step="0.01" value="${esc(l.disc)}" style="width:60px"></td>
        <td data-label="GST%"><select data-i="${i}" data-k="gst" style="width:70px">${[0, 5, 12, 18, 28].map((g) => `<option ${num(l.gst) === g ? "selected" : ""}>${g}</option>`).join("")}</select></td>
        <td data-label="MRP"><input data-i="${i}" data-k="mrp" type="number" min="0" step="0.01" value="${esc(l.mrp)}" style="width:85px"></td>
        <td class="num" data-label="Amount" data-amt="${i}">0.00</td>
        <td><button type="button" class="icon-btn" data-rm="${i}" title="Remove">×</button></td>
      </tr>`).join("") : `<tr><td colspan="11" class="empty">Search above to add medicines from the supplier bill</td></tr>`;
    $$("[data-k]", tbody).forEach((inp) => inp.addEventListener("input", () => {
      const l = lines[+inp.dataset.i]; const k = inp.dataset.k;
      l[k] = k === "batchNo" ? inp.value.toUpperCase() : inp.value;
      drawTotals();
    }));
    $$("[data-rm]", tbody).forEach((b) => (b.onclick = () => { lines.splice(+b.dataset.rm, 1); drawLines(); }));
    drawTotals();
  };
  const addLine = (p) => {
    lines.push({ productId: p.id, name: p.name, pack: p.pack, unit: p.unit, packSize: num(p.packSize) || 1, hsn: p.hsn || "", gst: num(p.gst), batchNo: "", expiry: "", qty: "", free: "", rate: p.lastRate || "", disc: "", mrp: p.mrp || "" });
    drawLines();
    setTimeout(() => $(`[data-i="${lines.length - 1}"][data-k="batchNo"]`, tbody)?.focus(), 30);
  };
  productPicker($("#np-search"), $("#np-results"), addLine, { showStock: true });
  const np = $("#np-newp"); if (np) np.onclick = () => productModal(null, addLine);
  const nv = $("#np-newv");
  if (nv) nv.onclick = () => vendorModal(null, async (v) => {
    vendors = await loadVendors();
    $("#np-vendor").innerHTML = `<option value="">— Select vendor —</option>${vendors.map((x) => `<option value="${x.id}" ${x.id === v.id ? "selected" : ""}>${esc(x.name)}</option>`).join("")}`;
    $("#np-vendor").dispatchEvent(new Event("change"));
  });
  $("#np-vendor").onchange = () => { $("#np-igst").checked = !sameState(vendor()); drawTotals(); };
  $("#np-igst").onchange = drawTotals;
  $("#np-opening").onchange = () => {
    $$(".vendor-f, .pay-f", el).forEach((x) => x.classList.toggle("hidden", opening()));
  };
  drawLines();

  $("#np-form").onsubmit = async (e) => {
    e.preventDefault();
    const isOpen = opening();
    const v = vendor();
    if (!isOpen && !v) { toast("Select the vendor", "error"); return; }
    if (!isOpen && !$("#np-inv").value.trim()) { toast("Enter supplier invoice number", "error"); return; }
    if (!lines.length) { toast("Add at least one medicine", "error"); return; }
    for (const l of lines) {
      if (!l.batchNo.trim() || !l.expiry || num(l.qty) + num(l.free) <= 0 || num(l.mrp) <= 0) { toast(`Fill batch, expiry, qty and MRP for ${l.name}`, "error"); return; }
    }
    const t = totals();
    const paid = isOpen ? 0 : Math.min(num($("#np-paid").value), t.net);
    const payMode = isOpen ? "—" : $("#np-mode").value;
    const btn = $("button[type=submit]", e.target);
    await busy(btn, async () => {
      try {
        const pRef = newRef("purchases");
        await F.runTransaction(db, async (tx) => {
          // ---- reads ----
          const pids = [...new Set(lines.map((l) => l.productId))];
          const bids = [...new Set(lines.map((l) => `${l.productId}_${safeId(l.batchNo)}`))];
          const prodSnaps = {}, batchSnaps = {};
          for (const id of pids) prodSnaps[id] = await tx.get(ref("products", id));
          for (const id of bids) batchSnaps[id] = await tx.get(ref("batches", id));
          const vSnap = !isOpen ? await tx.get(ref("vendors", v.id)) : null;
          // ---- compute ----
          const prodState = {}, batchState = {};
          pids.forEach((id) => { if (!prodSnaps[id].exists()) throw new Error("A medicine in this bill was deleted."); prodState[id] = { ...prodSnaps[id].data() }; });
          bids.forEach((id) => { batchState[id] = batchSnaps[id].exists() ? { ...batchSnaps[id].data() } : null; });
          const items = lines.map((l) => {
            calc(l);
            const ps = num(l.packSize) || 1;
            const units = Math.round((num(l.qty) + num(l.free)) * ps);
            const costTotal = l.taxable + (isComposition() ? l.gstAmt : 0);
            const costUnit = units ? costTotal / units : 0;
            const bid = `${l.productId}_${safeId(l.batchNo)}`;
            const old = batchState[bid];
            if (old) {
              const q = num(old.qty) + units;
              old.costUnit = q ? (num(old.qty) * num(old.costUnit) + units * costUnit) / q : costUnit;
              Object.assign(old, { qty: q, mrp: num(l.mrp), expiry: l.expiry, rate: num(l.rate), gst: num(l.gst) });
            } else {
              batchState[bid] = {
                productId: l.productId, productName: l.name, pack: l.pack, unit: l.unit, packSize: ps, hsn: l.hsn, batchNo: l.batchNo.trim(),
                expiry: l.expiry, mrp: num(l.mrp), rate: num(l.rate), gst: num(l.gst), costUnit, qty: units,
                vendorName: isOpen ? "Opening stock" : v.name, createdAtMs: Date.now(),
              };
            }
            const pr = prodState[l.productId];
            pr.stock = num(pr.stock) + units; pr.mrp = num(l.mrp); pr.lastRate = num(l.rate); pr.gst = num(l.gst);
            return { productId: l.productId, name: l.name, pack: l.pack, packSize: ps, hsn: l.hsn, batchId: bid, batchNo: l.batchNo.trim(), expiry: l.expiry,
              qty: num(l.qty), free: num(l.free), units, rate: num(l.rate), disc: num(l.disc), gst: num(l.gst), mrp: num(l.mrp), taxable: l.taxable, gstAmt: l.gstAmt, total: l.total, costUnit: r2(costUnit * 10000) / 10000 };
          });
          // ---- writes ----
          Object.entries(batchState).forEach(([id, b]) => tx.set(ref("batches", id), { ...b, costUnit: Math.round(num(b.costUnit) * 10000) / 10000 }));
          Object.entries(prodState).forEach(([id, p]) => tx.update(ref("products", id), { stock: p.stock, lowStock: lowFlag(p.stock, p.minStock), mrp: p.mrp, lastRate: p.lastRate, gst: p.gst }));
          const due = r2(t.net - paid);
          tx.set(pRef, {
            type: isOpen ? "opening" : "purchase",
            vendorId: isOpen ? "" : v.id, vendorName: isOpen ? "Opening stock" : v.name, vendorGstin: isOpen ? "" : (v.gstin || ""), vendorState: isOpen ? "" : (v.state || ""),
            invoiceNo: isOpen ? "OPENING" : $("#np-inv").value.trim(), invoiceDate: isOpen ? dayKey() : $("#np-date").value,
            interState: t.inter, items, taxable: t.taxable, cgst: t.cgst, sgst: t.sgst, igst: t.igst, gstTotal: t.gst, total: t.total, roundOff: t.roundOff, net: t.net,
            paid, due, payMode, ...stamp(),
          });
          if (!isOpen && due > 0) tx.update(ref("vendors", v.id), { balance: r2(num(vSnap.data()?.balance) + due) });
        });
        toast("Saved — stock updated", "ok");
        location.hash = `#/purchase/${pRef.id}`;
      } catch (err) { console.error(err); toast(friendlyError(err), "error"); }
    });
  };
}
