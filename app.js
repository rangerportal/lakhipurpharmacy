// Lakhipur Pharmacy — app shell: login, menu, router, logins, account, settings
import {
  F, AU, S, can, ctx, auth, db, col, ref, list, CONFIG_OK, ADMIN_EMAIL, ADMIN_USERNAME, LOGIN_DOMAIN, DEFAULT_SETTINGS, ROLES,
  $, $$, esc, num, icon, toast, openModal, confirmBox, busy, friendlyError, formObj, logoHtml, resizeImage, createLoginAccount, downloadFile, dayKey,
} from "./core.js";
import { viewNewBill, viewSales, viewInvoice } from "./billing.js";
import { viewInventory, viewProduct, viewPurchases, viewNewPurchase, viewPurchase } from "./stock.js";
import { viewVendors, viewVendor, viewCustomers, viewCustomer } from "./parties.js";
import { viewDashboard, viewReports, viewExpenses } from "./reports.js";

const appEl = $("#app");

/* ---------------- Settings cache & branding ---------------- */
function cacheSettings() { try { localStorage.setItem("lph_settings", JSON.stringify(S.settings)); } catch (e) {} }
try { const s = JSON.parse(localStorage.getItem("lph_settings") || "null"); if (s) S.settings = { ...DEFAULT_SETTINGS, ...s }; } catch (e) {}

const brandInner = () => `${logoHtml(S.settings)}<div class="sb-text"><b>${esc(S.settings.name)}</b><span>${esc(S.settings.tagline || "Pharmacy Management")}</span></div>`;
function applySettings() {
  const st = S.settings;
  $("#page-size").textContent = `@page { size: ${st.paperSize === "A4" ? "A4" : "A5"}; margin: ${st.paperSize === "A4" ? "10mm" : "6mm"}; }`;
  document.title = st.name;
  const b = $("#sb-brand"); if (b) b.innerHTML = brandInner();
  const tb = $("#tb-name"); if (tb) tb.textContent = st.name;
  const tl = $(".topbar .tb-logo"); if (tl) tl.outerHTML = logoHtml(st, "tb-logo");
}

/* ---------------- Install prompt ---------------- */
window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); S.installPrompt = e; $$(".install-btn").forEach((b) => b.classList.remove("hidden")); });
async function doInstall() {
  if (!S.installPrompt) return;
  S.installPrompt.prompt(); await S.installPrompt.userChoice; S.installPrompt = null;
  $$(".install-btn").forEach((b) => b.classList.add("hidden"));
}

/* ---------------- Boot / auth ---------------- */
if (!CONFIG_OK) {
  appEl.innerHTML = `<div class="setup-box"><h2>Almost ready — connect Firebase</h2>
    <p>Open <code>firebase-config.js</code> and paste your Firebase web app config, then reload this page.</p>
    <p class="muted">See README.md for step-by-step instructions.</p></div>`;
} else {
  AU.onAuthStateChanged(auth, handleAuth);
}

async function handleAuth(u) {
  S.unsub.forEach((f) => f()); S.unsub = [];
  if (!u) { S.user = null; S.profile = null; showLogin(); return; }
  try {
    const r = ref("users", u.uid);
    let snap = await F.getDoc(r);
    if (!snap.exists()) {
      if ((u.email || "").toLowerCase() === ADMIN_EMAIL) {
        await F.setDoc(r, { username: ADMIN_USERNAME, name: "Administrator", role: "admin", active: true, createdAtMs: Date.now() });
        snap = await F.getDoc(r);
      } else { S.loginMsg = "This login is not set up. Please contact the admin."; await AU.signOut(auth); return; }
    }
    const p = snap.data();
    if (!p.active) { S.loginMsg = "This login has been disabled by the admin."; await AU.signOut(auth); return; }
    S.user = u; S.profile = { uid: u.uid, ...p };
    await new Promise((resolve) => {
      let first = true;
      S.unsub.push(F.onSnapshot(ref("settings", "shop"), (s) => {
        S.settings = { ...DEFAULT_SETTINGS, ...(s.exists() ? s.data() : {}) };
        cacheSettings(); applySettings();
        if (first) { first = false; resolve(); }
      }, () => resolve()));
      setTimeout(resolve, 4000);
    });
    showShell(); route();
  } catch (e) {
    console.error(e); S.loginMsg = friendlyError(e); await AU.signOut(auth);
  }
}

const loginBrand = () => {
  const st = S.settings;
  return `${logoHtml(st)}<h1>${esc(st.name)}</h1>${st.tagline ? `<div class="tagline">${esc(st.tagline)}</div>` : ""}<p>${esc(st.address)}</p>`;
};

function showLogin() {
  applySettings();
  appEl.innerHTML = `
  <div class="login-wrap">
    <form class="login-card" id="login-form" autocomplete="on">
      <div class="login-brand" id="login-brand">${loginBrand()}</div>
      <div id="login-err">${S.loginMsg ? `<div class="form-error">${esc(S.loginMsg)}</div>` : ""}</div>
      <div class="field"><label>Username</label><input name="username" autocomplete="username" autocapitalize="none" required autofocus></div>
      <div class="field"><label>Password</label><input name="password" type="password" autocomplete="current-password" required></div>
      <button class="btn block" type="submit">Log in</button>
      <button class="btn ghost block install-btn ${S.installPrompt ? "" : "hidden"}" type="button" style="margin-top:10px">Install app on this device</button>
    </form>
  </div>`;
  S.loginMsg = "";
  F.getDoc(ref("settings", "shop")).then((s) => {
    if (!s.exists()) return;
    S.settings = { ...DEFAULT_SETTINGS, ...s.data() }; cacheSettings(); applySettings();
    const lb = $("#login-brand"); if (lb) lb.innerHTML = loginBrand();
  }).catch(() => {});
  $(".install-btn").onclick = doInstall;
  $("#login-form").onsubmit = async (e) => {
    e.preventDefault();
    const f = formObj(e.target);
    const uname = f.username.trim().toLowerCase();
    const email = uname.includes("@") ? uname : `${uname}@${LOGIN_DOMAIN}`;
    await busy($("button[type=submit]", e.target), async () => {
      try { await AU.signInWithEmailAndPassword(auth, email, f.password); }
      catch (err) {
        let msg = friendlyError(err);
        if (email === ADMIN_EMAIL && ["auth/invalid-credential", "auth/user-not-found"].includes(err.code)) {
          try { await AU.createUserWithEmailAndPassword(auth, email, f.password); return; }
          catch (e2) { msg = e2.code === "auth/email-already-in-use" ? "Wrong username or password." : friendlyError(e2); }
        }
        $("#login-err").innerHTML = `<div class="form-error">${esc(msg)}</div>`;
      }
    });
  };
}

/* ---------------- Shell & router ---------------- */
const NAV = [
  { r: "dashboard", label: "Dashboard", short: "Home", ic: "home", show: () => can.dashboard() },
  { r: "new-bill", label: "New Bill", short: "New Bill", ic: "plus", show: () => can.enter() },
  { r: "sales", label: "Sales & Returns", short: "Sales", ic: "file", show: () => true },
  { r: "inventory", label: "Inventory", short: "Stock", ic: "box", show: () => true },
  { r: "purchases", label: "Purchases", short: "Purchase", ic: "truck", show: () => true },
  { r: "vendors", label: "Vendors", ic: "store", show: () => true },
  { r: "customers", label: "Customers & Credit", ic: "users", show: () => true },
  { r: "expenses", label: "Expenses", ic: "wallet", show: () => true },
  { r: "reports", label: "Reports & GST", ic: "chart", show: () => can.money() },
  { r: "users", label: "Logins", ic: "shield", show: () => can.admin() },
  { r: "settings", label: "Settings", ic: "sliders", show: () => can.admin() },
  { r: "account", label: "My Account", ic: "user", show: () => true },
];
const ROUTES = {
  dashboard: { ok: () => can.dashboard(), view: viewDashboard },
  "new-bill": { ok: () => can.enter(), view: viewNewBill },
  sales: { ok: () => true, view: viewSales },
  invoice: { ok: () => true, view: viewInvoice },
  inventory: { ok: () => true, view: viewInventory },
  product: { ok: () => true, view: viewProduct },
  purchases: { ok: () => true, view: viewPurchases },
  "new-purchase": { ok: () => can.enter(), view: viewNewPurchase },
  purchase: { ok: () => true, view: viewPurchase },
  vendors: { ok: () => true, view: viewVendors },
  vendor: { ok: () => true, view: viewVendor },
  customers: { ok: () => true, view: viewCustomers },
  customer: { ok: () => true, view: viewCustomer },
  expenses: { ok: () => true, view: viewExpenses },
  reports: { ok: () => can.money(), view: viewReports },
  users: { ok: () => can.admin(), view: viewUsers },
  settings: { ok: () => can.admin(), view: viewSettings },
  account: { ok: () => true, view: viewAccount },
};
const PARENT = { invoice: "sales", product: "inventory", "new-purchase": "purchases", purchase: "purchases", vendor: "vendors", customer: "customers" };
const homeRoute = () => (can.dashboard() ? "dashboard" : "new-bill");

function showShell() {
  const p = S.profile;
  const items = NAV.filter((n) => n.show());
  const bottom = items.filter((n) => ["dashboard", "new-bill", "sales", "inventory", "purchases"].includes(n.r)).slice(0, 4);
  appEl.innerHTML = `
  <div class="shell" id="shell">
    <aside class="sidebar">
      <div class="sb-brand" id="sb-brand">${brandInner()}</div>
      <nav class="nav">${items.map((n) => `<a href="#/${n.r}" data-r="${n.r}" title="${n.label}">${icon(n.ic)}<span>${n.label}</span></a>`).join("")}</nav>
      <div class="sb-user">
        <b>${esc(p.name)}</b><span class="muted">@${esc(p.username)}</span><br><span class="role">${ROLES[p.role] || p.role}</span>
        <button class="install-btn ${S.installPrompt ? "" : "hidden"}" type="button">Install app</button>
        <button id="logout" type="button" title="Log out">${icon("logout")} <span>Log out</span></button>
      </div>
    </aside>
    <div class="backdrop" id="backdrop"></div>
    <div class="main">
      <div class="topbar"><button class="icon-btn" id="menu-btn" aria-label="Menu">☰</button>${logoHtml(S.settings, "tb-logo")}<b id="tb-name">${esc(S.settings.name)}</b><span id="net-pill"></span></div>
      <div class="content" id="view"></div>
    </div>
    <nav class="bottom-nav">
      ${bottom.map((n) => `<a href="#/${n.r}" data-r="${n.r}">${icon(n.ic)}<span>${n.short || n.label}</span></a>`).join("")}
      <a href="javascript:void 0" id="more-btn">${icon("menu")}<span>More</span></a>
    </nav>
  </div>`;
  $("#more-btn").onclick = () => $("#shell").classList.add("nav-open");
  $("#logout").onclick = async () => { if (await confirmBox("Log out of this device?", { okText: "Log out" })) AU.signOut(auth); };
  $$(".install-btn").forEach((b) => (b.onclick = doInstall));
  $("#menu-btn").onclick = () => $("#shell").classList.toggle("nav-open");
  $("#backdrop").onclick = () => $("#shell").classList.remove("nav-open");
  updateNet();
}
function updateNet() { const el = $("#net-pill"); if (el) el.innerHTML = navigator.onLine ? "" : `<span class="offline-pill">Offline</span>`; }
window.addEventListener("online", () => { updateNet(); toast("Back online", "ok"); });
window.addEventListener("offline", () => { updateNet(); toast("You are offline — saving bills needs internet"); });
window.addEventListener("hashchange", () => S.profile && route());

function route() {
  if (!S.profile) return;
  const parts = location.hash.replace(/^#\/?/, "").split("/");
  let r = parts[0];
  if (!ROUTES[r] || !ROUTES[r].ok()) { location.replace(`#/${homeRoute()}`); r = homeRoute(); }
  const navKey = PARENT[r] || r;
  $$(".nav a, .bottom-nav a[data-r]").forEach((a) => a.classList.toggle("active", a.dataset.r === navKey));
  $("#shell")?.classList.remove("nav-open");
  const v = $("#view");
  v.innerHTML = `<div class="loading">Loading…</div>`;
  window.scrollTo(0, 0);
  Promise.resolve(ROUTES[r].view(v, parts.slice(1))).catch((e) => {
    console.error(e);
    v.innerHTML = `<div class="card"><div class="form-error">${esc(friendlyError(e))}</div></div>`;
  });
}
ctx.rerender = route;

/* ---------------- Logins ---------------- */
async function viewUsers(el) {
  const users = list(await F.getDocs(col("users"))).map((u) => ({ uid: u.id, ...u }))
    .sort((a, b) => ["admin", "copartner", "staff"].indexOf(a.role) - ["admin", "copartner", "staff"].indexOf(b.role) || (a.name || "").localeCompare(b.name || ""));
  const count = (r) => users.filter((u) => u.role === r && u.active).length;
  el.innerHTML = `
    <div class="page-head"><h1>Logins</h1><button class="btn" id="u-add">+ Create login</button></div>
    <div class="stats">
      <div class="stat"><div class="label">Co-partners</div><div class="value">${count("copartner")}</div></div>
      <div class="stat"><div class="label">Staff</div><div class="value">${count("staff")}</div></div>
    </div>
    <div class="card"><div class="table-wrap"><table class="mcards">
      <thead><tr><th>Name</th><th>Username</th><th>Role</th><th>Phone</th><th>Status</th><th></th></tr></thead>
      <tbody>${users.map((u) => `<tr>
        <td class="mc-title" data-label="Name"><b>${esc(u.name)}</b></td><td data-label="Username">${esc(u.username)}</td>
        <td data-label="Role"><span class="badge ${u.role === "admin" ? "warn" : "teal"}">${ROLES[u.role] || u.role}</span></td>
        <td data-label="Phone">${esc(u.phone)}</td>
        <td data-label="Status">${u.active ? `<span class="badge ok">Active</span>` : `<span class="badge off">Disabled</span>`}</td>
        <td class="nowrap right mc-actions">${u.role === "admin" ? `<span class="muted small">Main admin</span>` : `
          <button class="btn ghost sm" data-edit="${u.uid}">Edit</button>
          <button class="btn ${u.active ? "danger-ghost" : "ghost"} sm" data-toggle="${u.uid}">${u.active ? "Disable" : "Enable"}</button>`}</td>
      </tr>`).join("")}</tbody></table></div>
      <p class="muted small">Staff: billing, purchases entry, stock, customers, expenses. Co-partner: dashboard, profit &amp; loss, reports (view only). Disabling a login blocks it immediately. To reset a forgotten password, disable the old login and create a new one with a different username.</p>
    </div>`;
  $("#u-add").onclick = () => userModal(null);
  $$("[data-edit]", el).forEach((b) => (b.onclick = () => userModal(users.find((u) => u.uid === b.dataset.edit))));
  $$("[data-toggle]", el).forEach((b) => (b.onclick = async () => {
    const u = users.find((x) => x.uid === b.dataset.toggle);
    if (u.active && !(await confirmBox(`Disable login for ${u.name}?`, { okText: "Disable", danger: true }))) return;
    try { await F.updateDoc(ref("users", u.uid), { active: !u.active }); toast("Updated", "ok"); route(); }
    catch (e) { toast(friendlyError(e), "error"); }
  }));
}

function userModal(u) {
  const isNew = !u;
  const m = openModal(isNew ? "Create login" : "Edit login", `
  <form id="um-form" autocomplete="off">
    <div class="field"><label class="req">Full name</label><input name="name" required value="${esc(u?.name)}"></div>
    <div class="field"><label class="req">Role</label><select name="role">
      <option value="staff" ${u?.role === "staff" ? "selected" : ""}>Staff — billing, purchases &amp; stock entry</option>
      <option value="copartner" ${u?.role === "copartner" ? "selected" : ""}>Co-partner — dashboard, profit/loss &amp; reports</option>
    </select></div>
    <div class="field"><label>Phone</label><input name="phone" value="${esc(u?.phone)}"></div>
    ${isNew ? `
    <div class="field"><label class="req">Username</label><input name="username" required pattern="[a-zA-Z0-9._\\-]{3,30}" autocapitalize="none" placeholder="e.g. staff1"><div class="muted small">3–30 letters/numbers, no spaces.</div></div>
    <div class="field"><label class="req">Password</label><div class="btn-row" style="flex-wrap:nowrap"><input name="password" id="um-pw" required minlength="6" style="flex:1"><button type="button" class="btn ghost" id="um-gen">Generate</button></div></div>` : ""}
    <div class="modal-foot"><button type="button" class="btn ghost" data-close>Cancel</button><button class="btn" type="submit">${isNew ? "Create login" : "Save"}</button></div>
  </form>`);
  const gen = $("#um-gen", m.el);
  if (gen) gen.onclick = () => {
    const chars = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
    const arr = crypto.getRandomValues(new Uint32Array(8));
    $("#um-pw", m.el).value = [...arr].map((x) => chars[x % chars.length]).join("") + "@" + (10 + (arr[0] % 90));
  };
  $("#um-form", m.el).onsubmit = async (e) => {
    e.preventDefault();
    const f = formObj(e.target);
    await busy($("button[type=submit]", e.target), async () => {
      try {
        if (isNew) {
          const username = f.username.trim().toLowerCase();
          if (username === ADMIN_USERNAME) throw new Error("This username is reserved.");
          const uid = await createLoginAccount(`${username}@${LOGIN_DOMAIN}`, f.password);
          await F.setDoc(ref("users", uid), { username, name: f.name.trim(), role: f.role, phone: f.phone.trim(), active: true, createdAtMs: Date.now(), createdBy: S.profile.uid });
          m.close();
          const link = location.origin + location.pathname;
          const done = openModal("Login created ✔", `
            <p>Share these details with <b>${esc(f.name)}</b>:</p>
            <div class="card" style="background:#f8fafc"><div class="kv"><div class="k">App link</div><div>${esc(link)}</div><div class="k">Username</div><div><b>${esc(username)}</b></div><div class="k">Password</div><div><b>${esc(f.password)}</b></div><div class="k">Role</div><div>${ROLES[f.role]}</div></div></div>
            <p class="muted small">Note this password now — it can't be shown again.</p>
            <div class="modal-foot"><button class="btn ghost" id="cp-copy">Copy</button><button class="btn" data-close>Done</button></div>`);
          $("#cp-copy", done.el).onclick = () => navigator.clipboard?.writeText(`${S.settings.name}\nApp: ${link}\nUsername: ${username}\nPassword: ${f.password}`).then(() => toast("Copied", "ok"));
        } else {
          await F.updateDoc(ref("users", u.uid), { name: f.name.trim(), role: f.role, phone: f.phone.trim() });
          m.close(); toast("Saved", "ok");
        }
        route();
      } catch (err) { toast(friendlyError(err), "error"); }
    });
  };
}

/* ---------------- Settings ---------------- */
function viewSettings(el) {
  const st = S.settings;
  el.innerHTML = `
    <div class="page-head"><h1>Settings</h1></div>
    <form id="st-form">
      <div class="card">
        <h2>Logo, name &amp; tagline</h2>
        <div class="brand-edit">
          <div class="logo-drop" id="st-logo-box">${logoHtml(st, "logo-preview")}</div>
          <div>
            <div class="btn-row">
              <label class="btn ghost" style="margin:0">Upload logo<input type="file" id="st-logo" accept="image/*" hidden></label>
              <button type="button" class="btn danger-ghost ${st.logo ? "" : "hidden"}" id="st-logo-rm">Remove logo</button>
            </div>
            <p class="muted small">PNG or JPG, square works best. Shown on login, menu and every bill.</p>
          </div>
        </div>
        <div class="grid g2" style="margin-top:14px">
          <div class="field span2"><label class="req">Pharmacy name</label><input name="name" required value="${esc(st.name)}"></div>
          <div class="field"><label>Tagline</label><input name="tagline" value="${esc(st.tagline)}" placeholder="e.g. Genuine medicines, honest prices"></div>
          <div class="field"><label>Tags / services line</label><input name="tags" value="${esc(st.tags)}" placeholder="e.g. Medicines • Surgicals • Baby care • Home delivery"></div>
        </div>
      </div>
      <div class="card">
        <h2>Licence &amp; GST (printed on bills)</h2>
        <div class="grid g2">
          <div class="field"><label>GSTIN</label><input name="gstin" value="${esc(st.gstin)}" maxlength="15" style="text-transform:uppercase" placeholder="18XXXXX0000X1Z5"></div>
          <div class="field"><label>GST type</label><select name="gstType">
            <option value="regular" ${st.gstType !== "composition" ? "selected" : ""}>Regular — Tax Invoice (CGST + SGST shown)</option>
            <option value="composition" ${st.gstType === "composition" ? "selected" : ""}>Composition scheme — Bill of Supply (no tax shown)</option>
          </select></div>
          <div class="field"><label>State</label><input name="state" value="${esc(st.state)}"><div class="muted small">Vendors from other states are billed with IGST.</div></div>
          <div class="field"><label>Drug licence no(s).</label><input name="dlNo" value="${esc(st.dlNo)}" placeholder="20B: …  21B: …"></div>
          <div class="field span2"><label>Registered pharmacist (name &amp; reg. no.)</label><input name="pharmacist" value="${esc(st.pharmacist)}"></div>
        </div>
      </div>
      <div class="card">
        <h2>Contact &amp; billing</h2>
        <div class="grid g2">
          <div class="field span2"><label>Address</label><textarea name="address" rows="2">${esc(st.address)}</textarea></div>
          <div class="field"><label>Phone</label><input name="phone" value="${esc(st.phone)}"></div>
          <div class="field"><label>Email</label><input name="email" value="${esc(st.email)}"></div>
          <div class="field"><label>Bill number prefix</label><input name="billPrefix" value="${esc(st.billPrefix)}" maxlength="6"><div class="muted small">Bills look like ${esc(st.billPrefix || "LPH")}/25-26/00001 and restart every April.</div></div>
          <div class="field"><label>Expiry alert (days before)</label><input name="expiryAlertDays" type="number" min="15" max="365" value="${esc(st.expiryAlertDays)}"></div>
          <div class="field"><label>Bill paper size</label><select name="paperSize"><option ${st.paperSize !== "A4" ? "selected" : ""}>A5</option><option ${st.paperSize === "A4" ? "selected" : ""}>A4</option></select></div>
          <div class="field span2"><label>Doctors list (one per line — suggestions while billing)</label><textarea name="doctors" rows="3">${esc(st.doctors)}</textarea></div>
          <div class="field span2"><label>Terms printed on bill</label><textarea name="terms" rows="2">${esc(st.terms)}</textarea></div>
        </div>
        <button class="btn" type="submit">Save settings</button>
      </div>
    </form>
    <div class="card">
      <h2>Backup</h2>
      <p class="muted">Download all data (medicines, stock, bills, purchases, customers, vendors, expenses) as one file. Keep a copy every month.</p>
      <button class="btn ghost" id="st-backup">Download full backup (JSON)</button>
    </div>`;
  let logo = st.logo || "";
  const showLogo = () => { $("#st-logo-box").innerHTML = logoHtml({ logo }, "logo-preview"); $("#st-logo-rm").classList.toggle("hidden", !logo); };
  $("#st-logo").onchange = async (e) => {
    const file = e.target.files[0]; if (!file) return;
    try { logo = await resizeImage(file); showLogo(); toast("Logo ready — press Save settings"); } catch (err) { toast(err.message, "error"); }
    e.target.value = "";
  };
  $("#st-logo-rm").onclick = () => { logo = ""; showLogo(); };
  $("#st-form").onsubmit = async (e) => {
    e.preventDefault();
    const f = formObj(e.target);
    const data = {
      name: f.name.trim(), tagline: f.tagline.trim(), tags: f.tags.trim(), logo,
      gstin: f.gstin.trim().toUpperCase(), gstType: f.gstType, state: f.state.trim(), dlNo: f.dlNo.trim(), pharmacist: f.pharmacist.trim(),
      address: f.address.trim(), phone: f.phone.trim(), email: f.email.trim(), billPrefix: (f.billPrefix.trim() || "LPH").toUpperCase(),
      expiryAlertDays: Math.max(15, num(f.expiryAlertDays) || 90), paperSize: f.paperSize, doctors: f.doctors.trim(), terms: f.terms.trim(),
    };
    await busy($("button[type=submit]", e.target), async () => {
      try { await F.setDoc(ref("settings", "shop"), data, { merge: true }); toast("Settings saved", "ok"); }
      catch (err) { toast(friendlyError(err), "error"); }
    });
  };
  $("#st-backup").onclick = (e) => busy(e.target, async () => {
    try {
      const out = { exportedAt: new Date().toISOString(), shop: S.settings };
      for (const c of ["products", "batches", "vendors", "customers", "purchases", "sales", "returns", "adjustments", "expenses", "payments", "users"]) {
        out[c] = list(await F.getDocs(col(c)));
      }
      downloadFile(`pharmacy-backup-${dayKey()}.json`, JSON.stringify(out, null, 1), "application/json");
    } catch (err) { toast(friendlyError(err), "error"); }
  });
}

/* ---------------- My account ---------------- */
function viewAccount(el) {
  const p = S.profile;
  el.innerHTML = `
    <div class="page-head"><h1>My Account</h1></div>
    <div class="two-col">
      <div class="card"><div class="kv">
        <div class="k">Name</div><div><b>${esc(p.name)}</b></div>
        <div class="k">Username</div><div>${esc(p.username)}</div>
        <div class="k">Role</div><div>${ROLES[p.role]}</div>
      </div></div>
      <form class="card" id="ac-form">
        <h2>Change password</h2>
        <div class="field"><label>Current password</label><input type="password" name="cur" required autocomplete="current-password"></div>
        <div class="field"><label>New password</label><input type="password" name="pw" required minlength="6" autocomplete="new-password"></div>
        <div class="field"><label>Confirm new password</label><input type="password" name="pw2" required minlength="6" autocomplete="new-password"></div>
        <button class="btn" type="submit">Update password</button>
      </form>
    </div>`;
  $("#ac-form").onsubmit = async (e) => {
    e.preventDefault();
    const f = formObj(e.target);
    if (f.pw !== f.pw2) { toast("New passwords don't match", "error"); return; }
    await busy($("button[type=submit]", e.target), async () => {
      try {
        await AU.reauthenticateWithCredential(auth.currentUser, AU.EmailAuthProvider.credential(auth.currentUser.email, f.cur));
        await AU.updatePassword(auth.currentUser, f.pw);
        e.target.reset(); toast("Password changed", "ok");
      } catch (err) { toast(friendlyError(err), "error"); }
    });
  };
}
