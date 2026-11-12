// Vendors (suppliers) and customers, with dues and payments
import {
  F, S, can, ctx, db, col, ref, newRef, list, $, $$, esc, num, r2, money, fmtDate, fmtKey, sum, formObj, phoneId,
  toast, openModal, busy, friendlyError, stamp, downloadFile, toCSV, dayKey,
} from "./core.js";

/* ---------------- Vendors ---------------- */
export async function loadVendors() {
  return list(await F.getDocs(col("vendors"))).sort((a, b) => (a.name || "").localeCompare(b.name || ""));
}

export function vendorModal(v, onSaved) {
  const isNew = !v?.id;
  v = v || { state: S.settings.state };
  const m = openModal(isNew ? "New vendor / supplier" : "Edit vendor", `
  <form id="vm-form">
    <div class="grid g2">
      <div class="field span2"><label class="req">Vendor / distributor name</label><input name="name" required value="${esc(v.name)}"></div>
      <div class="field"><label>GSTIN</label><input name="gstin" maxlength="15" style="text-transform:uppercase" value="${esc(v.gstin)}"></div>
      <div class="field"><label>Drug licence no.</label><input name="dlNo" value="${esc(v.dlNo)}"></div>
      <div class="field"><label>Phone</label><input name="phone" value="${esc(v.phone)}"></div>
      <div class="field"><label>Contact person</label><input name="contact" value="${esc(v.contact)}"></div>
      <div class="field"><label>State</label><input name="state" value="${esc(v.state)}"><div class="muted small">Different state from yours = IGST.</div></div>
      <div class="field"><label>Payment terms (days)</label><input name="creditDays" type="number" min="0" value="${esc(v.creditDays)}"></div>
      <div class="field span2"><label>Address</label><input name="address" value="${esc(v.address)}"></div>
      ${isNew ? `<div class="field"><label>Old dues (opening balance ₹)</label><input name="balance" type="number" step="0.01" value="0"></div>` : ""}
    </div>
    <div class="modal-foot"><button type="button" class="btn ghost" data-close>Cancel</button><button class="btn" type="submit">Save vendor</button></div>
  </form>`, { wide: true });
  $("#vm-form", m.el).onsubmit = async (e) => {
    e.preventDefault();
    const f = formObj(e.target);
    const data = { name: f.name.trim(), gstin: f.gstin.trim().toUpperCase(), dlNo: f.dlNo.trim(), phone: f.phone.trim(), contact: f.contact.trim(), state: f.state.trim(), creditDays: num(f.creditDays), address: f.address.trim() };
    await busy($("button[type=submit]", e.target), async () => {
      try {
        let id = v.id;
        if (isNew) { const r = newRef("vendors"); await F.setDoc(r, { ...data, balance: num(f.balance), createdAtMs: Date.now() }); id = r.id; }
        else await F.updateDoc(ref("vendors", id), data);
        m.close(); toast("Vendor saved", "ok"); onSaved && onSaved({ ...v, ...data, id });
      } catch (err) { toast(friendlyError(err), "error"); }
    });
  };
}

export async function viewVendors(el) {
  const vendors = await loadVendors();
  const dues = sum(vendors, (v) => Math.max(0, num(v.balance)));
  el.innerHTML = `
    <div class="page-head"><h1>Vendors</h1>${can.enter() ? `<button class="btn" id="v-add">+ New vendor</button>` : ""}</div>
    <div class="stats"><div class="stat primary"><div class="label">Total payable to vendors</div><div class="value">${money(dues)}</div></div>
      <div class="stat"><div class="label">Vendors</div><div class="value">${vendors.length}</div></div></div>
    <div class="card">
      <div class="toolbar"><div class="field grow"><input id="v-q" placeholder="Search vendor"></div></div>
      <div id="v-list"></div>
    </div>`;
  const draw = () => {
    const q = $("#v-q").value.trim().toLowerCase();
    const rows = vendors.filter((v) => !q || (v.name || "").toLowerCase().includes(q));
    $("#v-list").innerHTML = rows.length ? `<div class="table-wrap"><table class="mcards">
      <thead><tr><th>Vendor</th><th>GSTIN</th><th>Phone</th><th>State</th><th class="num">Payable</th></tr></thead>
      <tbody>${rows.map((v) => `<tr class="click" data-id="${v.id}"><td class="mc-title" data-label="Vendor"><b>${esc(v.name)}</b></td><td data-label="GSTIN">${esc(v.gstin)}</td><td data-label="Phone">${esc(v.phone)}</td><td data-label="State">${esc(v.state)}</td><td class="num" data-label="Payable">${num(v.balance) > 0 ? `<b class="txt-danger">${money(v.balance)}</b>` : "—"}</td></tr>`).join("")}</tbody></table></div>` : `<div class="empty">No vendors yet</div>`;
    $$("tr[data-id]", $("#v-list")).forEach((tr) => (tr.onclick = () => (location.hash = `#/vendor/${tr.dataset.id}`)));
  };
  $("#v-q").oninput = draw; draw();
  const add = $("#v-add"); if (add) add.onclick = () => vendorModal(null, () => ctx.rerender());
}

export async function viewVendor(el, params) {
  const id = params[0];
  const [vs, purchases, pays] = await Promise.all([
    F.getDoc(ref("vendors", id)),
    F.getDocs(F.query(col("purchases"), F.where("vendorId", "==", id))).then(list),
    F.getDocs(F.query(col("payments"), F.where("partyId", "==", id))).then(list),
  ]);
  if (!vs.exists()) { el.innerHTML = `<div class="card empty">Vendor not found</div>`; return; }
  const v = { id, ...vs.data() };
  const rows = [
    ...purchases.map((p) => ({ ms: p.createdAtMs, date: p.invoiceDate, text: `Purchase · Inv ${p.invoiceNo}`, debit: num(p.net), credit: num(p.paid), link: `#/purchase/${p.id}` })),
    ...pays.map((p) => ({ ms: p.createdAtMs, date: p.dateKey, text: `Payment (${p.mode})${p.note ? " · " + p.note : ""}`, debit: 0, credit: num(p.amount) })),
  ].sort((a, b) => b.ms - a.ms);
  el.innerHTML = `
    <div class="page-head"><h1>${esc(v.name)}</h1><div class="btn-row">
      ${can.enter() ? `<button class="btn ghost" id="vd-edit">Edit</button><button class="btn" id="vd-pay">Pay vendor</button>` : ""}</div></div>
    <div class="two-col">
      <div class="card"><div class="kv">
        <div class="k">GSTIN</div><div>${esc(v.gstin) || "—"}</div><div class="k">Drug licence</div><div>${esc(v.dlNo) || "—"}</div>
        <div class="k">Phone</div><div>${v.phone ? `<a href="tel:${esc(v.phone)}">${esc(v.phone)}</a>` : "—"} ${esc(v.contact)}</div>
        <div class="k">Address</div><div>${esc(v.address) || "—"}, ${esc(v.state)}</div><div class="k">Credit days</div><div>${esc(v.creditDays || "—")}</div>
      </div></div>
      <div class="stats" style="grid-template-columns:1fr 1fr;align-content:start">
        <div class="stat primary"><div class="label">Payable now</div><div class="value">${money(v.balance)}</div></div>
        <div class="stat"><div class="label">Total purchased</div><div class="value">${money(sum(purchases, "net"))}</div></div>
      </div>
    </div>
    <div class="card"><div class="card-head"><h3>Ledger</h3></div>
      ${rows.length ? `<div class="table-wrap"><table class="mcards"><thead><tr><th>Date</th><th>Details</th><th class="num">Bill amount</th><th class="num">Paid</th></tr></thead>
      <tbody>${rows.map((r) => `<tr ${r.link ? `class="click" onclick="location.hash='${r.link}'"` : ""}><td class="mc-title" data-label="Date">${fmtKey(r.date)}</td><td data-label="Details">${esc(r.text)}</td><td class="num" data-label="Bill">${r.debit ? money(r.debit) : "—"}</td><td class="num" data-label="Paid">${r.credit ? money(r.credit) : "—"}</td></tr>`).join("")}</tbody></table></div>` : `<div class="empty">No entries yet</div>`}
    </div>`;
  const ed = $("#vd-edit"); if (ed) ed.onclick = () => vendorModal(v, () => ctx.rerender());
  const pay = $("#vd-pay"); if (pay) pay.onclick = () => paymentModal("vendor", v);
}

/* ---------------- Payments (receive from customer / pay vendor) ---------------- */
export function paymentModal(kind, party) {
  const isVendor = kind === "vendor";
  const m = openModal(isVendor ? `Pay ${party.name}` : `Receive payment — ${party.name}`, `
    <p class="muted" style="margin-top:0">${isVendor ? "Payable" : "Customer owes"}: <b>${money(party.balance)}</b></p>
    <form id="pay-form">
      <div class="grid g2">
        <div class="field"><label class="req">Amount (₹)</label><input name="amount" type="number" min="1" step="0.01" required value="${Math.max(0, num(party.balance)) || ""}"></div>
        <div class="field"><label>Mode</label><select name="mode"><option>Cash</option><option>UPI</option><option>Bank</option><option>Cheque</option><option>Card</option></select></div>
        <div class="field span2"><label>Note</label><input name="note" placeholder="${isVendor ? "e.g. Cheque no. / against invoice" : "e.g. Paid old dues"}"></div>
      </div>
      <div class="modal-foot"><button type="button" class="btn ghost" data-close>Cancel</button><button class="btn" type="submit">Save payment</button></div>
    </form>`);
  $("#pay-form", m.el).onsubmit = async (e) => {
    e.preventDefault();
    const f = formObj(e.target);
    const amount = r2(num(f.amount));
    await busy($("button[type=submit]", e.target), async () => {
      try {
        const pref = ref(isVendor ? "vendors" : "customers", party.id);
        await F.runTransaction(db, async (tx) => {
          const s = await tx.get(pref);
          tx.update(pref, { balance: r2(num(s.data()?.balance) - amount) });
          tx.set(newRef("payments"), { type: kind, partyId: party.id, partyName: party.name, amount, mode: f.mode, note: f.note.trim(), ...stamp() });
        });
        m.close(); toast("Payment saved", "ok"); ctx.rerender();
      } catch (err) { toast(friendlyError(err), "error"); }
    });
  };
}

/* ---------------- Customers ---------------- */
export async function viewCustomers(el) {
  el.innerHTML = `
    <div class="page-head"><h1>Customers &amp; Credit</h1>${can.enter() ? `<button class="btn" id="c-add">+ Add customer</button>` : ""}</div>
    <div class="stats" id="c-stats"></div>
    <div class="tabs"><a href="javascript:void 0" data-t="dues" class="on">With dues (udhaar)</a><a href="javascript:void 0" data-t="search">Search all</a></div>
    <div class="card">
      <div class="toolbar hidden" id="c-tb"><div class="field grow"><input id="c-q" placeholder="Search by phone number or name"></div></div>
      <div id="c-list"><div class="loading">Loading…</div></div>
    </div>`;
  const table = (rows) => rows.length ? `<div class="table-wrap"><table class="mcards">
    <thead><tr><th>Customer</th><th>Phone</th><th>Address</th><th>Last bill</th><th class="num">Dues</th></tr></thead>
    <tbody>${rows.map((c) => `<tr class="click" data-id="${c.id}"><td class="mc-title" data-label="Name"><b>${esc(c.name)}</b></td><td data-label="Phone">${esc(c.phone)}</td><td class="small" data-label="Address">${esc(c.address)}</td><td data-label="Last bill">${fmtDate(c.lastBillMs)}</td><td class="num" data-label="Dues">${num(c.balance) > 0 ? `<b class="txt-danger">${money(c.balance)}</b>` : "—"}</td></tr>`).join("")}</tbody></table></div>` : `<div class="empty">No customers found</div>`;
  const bind = () => $$("tr[data-id]", $("#c-list")).forEach((tr) => (tr.onclick = () => (location.hash = `#/customer/${tr.dataset.id}`)));
  const loadDues = async () => {
    const rows = list(await F.getDocs(F.query(col("customers"), F.where("balance", ">", 0)))).sort((a, b) => b.balance - a.balance);
    $("#c-stats").innerHTML = `<div class="stat primary"><div class="label">Total dues to collect</div><div class="value">${money(sum(rows, "balance"))}</div></div><div class="stat"><div class="label">Customers with dues</div><div class="value">${rows.length}</div></div>`;
    $("#c-list").innerHTML = (rows.length ? `<div class="btn-row" style="margin-bottom:10px"><button class="btn ghost sm" id="c-csv">Export dues list</button></div>` : "") + table(rows); bind();
    const c = $("#c-csv"); if (c) c.onclick = () => downloadFile(`customer-dues-${dayKey()}.csv`, toCSV([["Name", "Phone", "Address", "Dues"], ...rows.map((x) => [x.name, x.phone, x.address, x.balance])]));
  };
  const search = async () => {
    const t = $("#c-q").value.trim();
    let rows = [];
    if (!t) rows = list(await F.getDocs(F.query(col("customers"), F.orderBy("lastBillMs", "desc"), F.limit(40))));
    else if (/^\d+$/.test(t)) rows = list(await F.getDocs(F.query(col("customers"), F.where("phone", ">=", t), F.where("phone", "<=", t + ""), F.limit(30))));
    else { const l = t.toLowerCase(); rows = list(await F.getDocs(F.query(col("customers"), F.where("nameLower", ">=", l), F.where("nameLower", "<=", l + ""), F.limit(30)))); }
    $("#c-list").innerHTML = table(rows); bind();
  };
  $$(".tabs a", el).forEach((a) => (a.onclick = () => {
    $$(".tabs a", el).forEach((x) => x.classList.toggle("on", x === a));
    $("#c-tb").classList.toggle("hidden", a.dataset.t !== "search");
    $("#c-list").innerHTML = `<div class="loading">Loading…</div>`;
    (a.dataset.t === "dues" ? loadDues() : search()).catch((e) => ($("#c-list").innerHTML = `<div class="form-error">${esc(friendlyError(e))}</div>`));
  }));
  let tmr; $("#c-q").oninput = () => { clearTimeout(tmr); tmr = setTimeout(search, 300); };
  const add = $("#c-add"); if (add) add.onclick = () => customerModal(null);
  await loadDues();
}

export function customerModal(c) {
  const isNew = !c;
  const m = openModal(isNew ? "Add customer" : "Edit customer", `
    <form id="cm-form"><div class="grid g2">
      <div class="field"><label class="req">Name</label><input name="name" required value="${esc(c?.name)}"></div>
      <div class="field"><label class="req">Phone (10 digits)</label><input name="phone" required inputmode="tel" value="${esc(c?.phone)}" ${isNew ? "" : "disabled"}></div>
      <div class="field span2"><label>Address</label><input name="address" value="${esc(c?.address)}"></div>
      ${isNew ? `<div class="field"><label>Old dues (₹)</label><input name="balance" type="number" step="0.01" value="0"></div>` : ""}
    </div><div class="modal-foot"><button type="button" class="btn ghost" data-close>Cancel</button><button class="btn" type="submit">Save</button></div></form>`);
  $("#cm-form", m.el).onsubmit = async (e) => {
    e.preventDefault();
    const f = formObj(e.target);
    await busy($("button[type=submit]", e.target), async () => {
      try {
        if (isNew) {
          const id = phoneId(f.phone);
          if (id.length !== 10) throw new Error("Enter a 10-digit phone number.");
          const ex = await F.getDoc(ref("customers", id));
          if (ex.exists()) throw new Error("A customer with this phone already exists.");
          await F.setDoc(ref("customers", id), { name: f.name.trim(), nameLower: f.name.trim().toLowerCase(), phone: id, address: f.address.trim(), balance: num(f.balance), lastBillMs: 0, createdAtMs: Date.now() });
        } else await F.updateDoc(ref("customers", c.id), { name: f.name.trim(), nameLower: f.name.trim().toLowerCase(), address: f.address.trim() });
        m.close(); toast("Saved", "ok"); ctx.rerender();
      } catch (err) { toast(friendlyError(err), "error"); }
    });
  };
}

export async function viewCustomer(el, params) {
  const id = params[0];
  const [cs, sales, pays] = await Promise.all([
    F.getDoc(ref("customers", id)),
    F.getDocs(F.query(col("sales"), F.where("custId", "==", id))).then(list),
    F.getDocs(F.query(col("payments"), F.where("partyId", "==", id))).then(list),
  ]);
  if (!cs.exists()) { el.innerHTML = `<div class="card empty">Customer not found</div>`; return; }
  const c = { id, ...cs.data() };
  const act = sales.filter((s) => s.status !== "cancelled");
  const rows = [
    ...act.map((s) => ({ ms: s.createdAtMs, text: `Bill ${s.billNo} (${s.paymentMode})`, amt: num(s.net), due: num(s.due), link: `#/invoice/${s.id}` })),
    ...pays.map((p) => ({ ms: p.createdAtMs, text: `Payment received (${p.mode})${p.note ? " · " + p.note : ""}`, amt: 0, paid: num(p.amount) })),
  ].sort((a, b) => b.ms - a.ms);
  el.innerHTML = `
    <div class="page-head"><h1>${esc(c.name)}</h1><div class="btn-row">
      ${can.enter() ? `<button class="btn ghost" id="cd-edit">Edit</button><button class="btn" id="cd-pay">Receive payment</button>` : ""}</div></div>
    <div class="stats">
      <div class="stat primary"><div class="label">Dues</div><div class="value">${money(c.balance)}</div></div>
      <div class="stat"><div class="label">Total purchases</div><div class="value">${money(sum(act, "net"))}</div></div>
      <div class="stat"><div class="label">Bills</div><div class="value">${act.length}</div></div>
      <div class="stat"><div class="label">Phone</div><div class="value" style="font-size:18px"><a href="tel:${esc(c.phone)}">${esc(c.phone)}</a></div></div>
    </div>
    <div class="card"><div class="card-head"><h3>History</h3></div>
      ${rows.length ? `<div class="table-wrap"><table class="mcards"><thead><tr><th>Date</th><th>Details</th><th class="num">Bill</th><th class="num">On credit</th><th class="num">Paid</th></tr></thead>
      <tbody>${rows.map((r) => `<tr ${r.link ? `class="click" onclick="location.hash='${r.link}'"` : ""}><td class="mc-title" data-label="Date">${fmtDate(r.ms)}</td><td data-label="Details">${esc(r.text)}</td><td class="num" data-label="Bill">${r.amt ? money(r.amt) : "—"}</td><td class="num" data-label="Credit">${r.due ? money(r.due) : "—"}</td><td class="num" data-label="Paid">${r.paid ? money(r.paid) : "—"}</td></tr>`).join("")}</tbody></table></div>` : `<div class="empty">No bills yet</div>`}
    </div>`;
  const ed = $("#cd-edit"); if (ed) ed.onclick = () => customerModal(c);
  const pay = $("#cd-pay"); if (pay) pay.onclick = () => paymentModal("customer", c);
}
