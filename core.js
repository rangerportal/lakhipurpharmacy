// Shared helpers, Firebase setup and app state for Lakhipur Pharmacy.
import * as FA from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import * as AU from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import * as F from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig, LOGIN_DOMAIN, ADMIN_USERNAME, DEFAULT_SETTINGS } from "./firebase-config.js";

export { F, AU, LOGIN_DOMAIN, ADMIN_USERNAME, DEFAULT_SETTINGS };
export const ADMIN_EMAIL = `${ADMIN_USERNAME}@${LOGIN_DOMAIN}`;
export const ROLES = { admin: "Admin", copartner: "Co-partner", staff: "Staff" };

/* ---------------- Firebase ---------------- */
export const CONFIG_OK = !!firebaseConfig.apiKey && !firebaseConfig.apiKey.startsWith("PASTE");
export let auth = null, db = null;
if (CONFIG_OK) {
  const app = FA.initializeApp(firebaseConfig);
  auth = AU.getAuth(app);
  try {
    db = F.initializeFirestore(app, { localCache: F.persistentLocalCache({ tabManager: F.persistentMultipleTabManager() }) });
  } catch (e) { db = F.getFirestore(app); }
}
export const col = (name) => F.collection(db, name);
export const ref = (name, id) => F.doc(db, name, id);
export const newRef = (name) => F.doc(F.collection(db, name));
export const list = (snap) => snap.docs.map((d) => ({ id: d.id, ...d.data() }));

// Creates someone else's login without logging the admin out.
export async function createLoginAccount(email, password) {
  const sec = FA.initializeApp(firebaseConfig, "secondary-" + Date.now());
  try {
    const secAuth = AU.initializeAuth(sec, { persistence: AU.inMemoryPersistence });
    const cred = await AU.createUserWithEmailAndPassword(secAuth, email, password);
    await AU.signOut(secAuth);
    return cred.user.uid;
  } finally { await FA.deleteApp(sec).catch(() => {}); }
}

/* ---------------- State ---------------- */
export const S = {
  user: null, profile: null,
  settings: { ...DEFAULT_SETTINGS },
  unsub: [], loginMsg: "", installPrompt: null,
};
export const can = {
  dashboard: () => ["admin", "copartner"].includes(S.profile?.role),
  enter: () => ["admin", "staff"].includes(S.profile?.role),
  admin: () => S.profile?.role === "admin",
  money: () => ["admin", "copartner"].includes(S.profile?.role),
};
export const isComposition = () => S.settings.gstType === "composition";
export const ctx = { rerender: () => {} };

/* ---------------- Small helpers ---------------- */
export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const num = (v) => { const n = parseFloat(v); return isFinite(n) ? n : 0; };
export const r2 = (n) => Math.round((num(n) + Number.EPSILON) * 100) / 100;
export const money = (n) => { const v = Number(n) || 0; return (v < 0 ? "−₹" : "₹") + Math.abs(v).toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 2 }); };
export const money2 = (n) => (Math.abs(Number(n) || 0) < 0.005 ? 0 : Number(n) || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const pad = (n, w) => String(n).padStart(w, "0");
export const dayKey = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1, 2)}-${pad(d.getDate(), 2)}`;
export const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
export const fmtDate = (ms) => ms ? new Date(ms).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "";
export const fmtTime = (ms) => ms ? new Date(ms).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) : "";
export const fmtDT = (ms) => ms ? `${fmtDate(ms)}, ${fmtTime(ms)}` : "";
export const fmtKey = (k) => { if (!k) return ""; const [y, m, d] = k.split("-").map(Number); return fmtDate(new Date(y, m - 1, d).getTime()); };
export const sum = (arr, f) => arr.reduce((a, x) => a + (typeof f === "function" ? num(f(x)) : num(x[f])), 0);
export const formObj = (form) => Object.fromEntries(new FormData(form).entries());
export const phoneId = (p) => String(p || "").replace(/\D/g, "").slice(-10);
export const safeId = (s) => String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

// Financial year code, e.g. 25-26 for Apr 2025 – Mar 2026
export function fyCode(d = new Date()) {
  const y = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
  return `${String(y).slice(2)}-${String(y + 1).slice(2)}`;
}

/* ---------------- Expiry & stock ---------------- */
// expiry stored as "YYYY-MM"; medicine is usable until the end of that month
export const expLabel = (e) => e ? `${e.slice(5, 7)}/${e.slice(2, 4)}` : "";
export const monthKey = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1, 2)}`;
export const isExpired = (e) => !!e && e < monthKey();
export const expiryCutoff = (days) => monthKey(addDays(new Date(), num(days) || 90));
export const expiringSoon = (e, days = S.settings.expiryAlertDays) => !!e && !isExpired(e) && e <= expiryCutoff(days);
export function fmtStock(units, p) {
  units = Math.round(num(units));
  const ps = Math.max(1, num(p?.packSize) || 1);
  if (ps === 1) return `${units} ${p?.pack || ""}`.trim();
  const packs = Math.floor(units / ps), loose = units % ps;
  return `${packs} ${p?.pack || "pk"}${loose ? ` + ${loose} ${p?.unit || ""}` : ""}`.trim();
}

/* ---------------- GST ---------------- */
export function splitGst(amountInclusive, rate) {
  if (isComposition()) return { taxable: r2(amountInclusive), gst: 0 };
  const taxable = r2(amountInclusive / (1 + num(rate) / 100));
  return { taxable, gst: r2(amountInclusive - taxable) };
}

/* ---------------- Amount in words (Indian) ---------------- */
export function inWords(n) {
  n = Math.round(num(n));
  if (n === 0) return "Rupees Zero Only";
  const a = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
  const b = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
  const two = (x) => x < 20 ? a[x] : `${b[Math.floor(x / 10)]}${x % 10 ? " " + a[x % 10] : ""}`;
  const three = (x) => `${x >= 100 ? a[Math.floor(x / 100)] + " Hundred" + (x % 100 ? " " : "") : ""}${x % 100 ? two(x % 100) : ""}`;
  const parts = [];
  const crore = Math.floor(n / 1e7); n %= 1e7;
  const lakh = Math.floor(n / 1e5); n %= 1e5;
  const th = Math.floor(n / 1e3); n %= 1e3;
  if (crore) parts.push(three(crore) + " Crore");
  if (lakh) parts.push(two(lakh) + " Lakh");
  if (th) parts.push(two(th) + " Thousand");
  if (n) parts.push(three(n));
  return `Rupees ${parts.join(" ")} Only`;
}

/* ---------------- UI helpers ---------------- */
export const logoHtml = (st, cls = "logo") => st.logo ? `<img class="${cls} img" src="${esc(st.logo)}" alt="">` : `<div class="${cls}">℞</div>`;

export function icon(name) {
  const P = {
    home: '<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>',
    plus: '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/>',
    file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>',
    box: '<path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/>',
    truck: '<rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/>',
    store: '<path d="M3 9l1.5-5h15L21 9"/><path d="M4 9v11h16V9"/><path d="M3 9h18"/><path d="M9 20v-6h6v6"/>',
    users: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
    wallet: '<rect x="2" y="6" width="20" height="14" rx="2"/><path d="M2 10h20"/><circle cx="17" cy="15" r="1"/>',
    chart: '<line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>',
    shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
    sliders: '<line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/>',
    user: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
    logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>',
    menu: '<line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/>',
  };
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${P[name] || ""}</svg>`;
}

export function toast(msg, type = "") {
  const t = document.createElement("div");
  t.className = `toast ${type}`;
  t.textContent = msg;
  $("#toasts").appendChild(t);
  setTimeout(() => t.remove(), 3200);
}

export function openModal(title, bodyHtml, opts = {}) {
  const wrap = document.createElement("div");
  wrap.className = "modal-wrap";
  wrap.innerHTML = `<div class="modal ${opts.wide ? "wide" : ""} ${opts.xwide ? "xwide" : ""}"><div class="modal-head"><h3>${esc(title)}</h3><button class="icon-btn" data-close aria-label="Close">×</button></div><div class="modal-body">${bodyHtml}</div></div>`;
  document.body.appendChild(wrap);
  const close = () => wrap.remove();
  wrap.addEventListener("mousedown", (e) => { if (e.target === wrap) close(); });
  wrap.addEventListener("click", (e) => { if (e.target.closest("[data-close]")) close(); });
  return { el: wrap, close };
}

export function confirmBox(message, { okText = "Yes", danger = false, withReason = false } = {}) {
  return new Promise((resolve) => {
    const m = openModal("Please confirm", `
      <p style="margin-top:0">${esc(message)}</p>
      ${withReason ? `<div class="field"><label class="req">Reason</label><input id="cf-reason"></div>` : ""}
      <div class="modal-foot"><button class="btn ghost" data-close>Cancel</button><button class="btn ${danger ? "danger" : ""}" id="cf-ok">${esc(okText)}</button></div>`);
    let done = false;
    $("#cf-ok", m.el).onclick = () => {
      const reason = withReason ? $("#cf-reason", m.el).value.trim() : true;
      if (withReason && !reason) { $("#cf-reason", m.el).focus(); return; }
      done = true; m.close(); resolve(reason);
    };
    const obs = new MutationObserver(() => { if (!document.body.contains(m.el)) { obs.disconnect(); if (!done) resolve(false); } });
    obs.observe(document.body, { childList: true });
  });
}

export async function busy(btn, fn) {
  const old = btn.innerHTML;
  btn.disabled = true; btn.innerHTML = "Please wait…";
  try { return await fn(); } finally { btn.disabled = false; btn.innerHTML = old; }
}

export function friendlyError(e) {
  const c = e?.code || "";
  const map = {
    "auth/invalid-credential": "Wrong username or password.",
    "auth/wrong-password": "Wrong username or password.",
    "auth/user-not-found": "Wrong username or password.",
    "auth/invalid-email": "Invalid username.",
    "auth/too-many-requests": "Too many attempts. Please wait a few minutes and try again.",
    "auth/network-request-failed": "No internet connection.",
    "auth/email-already-in-use": "This username is already taken.",
    "auth/weak-password": "Password must be at least 6 characters.",
    "auth/requires-recent-login": "Please log out and log in again, then retry.",
    "permission-denied": "You don't have permission to do this.",
    "unavailable": "You're offline. This action needs internet.",
    "failed-precondition": "You're offline. This action needs internet.",
  };
  return map[c] || e?.message || "Something went wrong.";
}

export function downloadFile(name, content, type = "text/csv") {
  const blob = new Blob([content], { type });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
const csvCell = (v) => { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
export const toCSV = (rows) => "﻿" + rows.map((r) => r.map(csvCell).join(",")).join("\n");

export function resizeImage(file, max = 360) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      let url = c.toDataURL("image/png");
      if (url.length > 300000) url = c.toDataURL("image/jpeg", 0.85);
      URL.revokeObjectURL(img.src); resolve(url);
    };
    img.onerror = () => reject(new Error("Could not read this image. Please use a PNG or JPG file."));
    img.src = URL.createObjectURL(file);
  });
}

// Period picker used by lists, dashboard and reports
export function rangeControl(container, onChange, preset = "today") {
  container.innerHTML = `
    <select class="rc-preset">
      <option value="today">Today</option><option value="yesterday">Yesterday</option>
      <option value="7d">Last 7 days</option><option value="month">This month</option>
      <option value="lastmonth">Last month</option><option value="fy">This financial year</option>
      <option value="custom">Custom dates…</option>
    </select>
    <input type="date" class="rc-from hidden"><input type="date" class="rc-to hidden">`;
  const sel = $(".rc-preset", container), f = $(".rc-from", container), t = $(".rc-to", container);
  sel.value = preset;
  const calc = (p) => {
    const d = new Date();
    switch (p) {
      case "yesterday": { const y = addDays(d, -1); return [dayKey(y), dayKey(y)]; }
      case "7d": return [dayKey(addDays(d, -6)), dayKey(d)];
      case "month": return [dayKey(new Date(d.getFullYear(), d.getMonth(), 1)), dayKey(d)];
      case "lastmonth": return [dayKey(new Date(d.getFullYear(), d.getMonth() - 1, 1)), dayKey(new Date(d.getFullYear(), d.getMonth(), 0))];
      case "fy": { const y = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1; return [dayKey(new Date(y, 3, 1)), dayKey(d)]; }
      default: return [dayKey(d), dayKey(d)];
    }
  };
  const fire = () => {
    if (sel.value === "custom") {
      f.classList.remove("hidden"); t.classList.remove("hidden");
      if (!f.value || !t.value) return;
      onChange(f.value <= t.value ? f.value : t.value, f.value <= t.value ? t.value : f.value);
    } else {
      f.classList.add("hidden"); t.classList.add("hidden");
      const [a, b] = calc(sel.value); f.value = a; t.value = b; onChange(a, b);
    }
  };
  sel.onchange = fire; f.onchange = fire; t.onchange = fire;
  fire();
}

// Load documents whose dateKey falls inside a range
export async function byDate(name, from, to) {
  const s = await F.getDocs(F.query(col(name), F.where("dateKey", ">=", from), F.where("dateKey", "<=", to)));
  return list(s).sort((a, b) => (b.createdAtMs || 0) - (a.createdAtMs || 0));
}

export const stamp = () => ({ createdAtMs: Date.now(), dateKey: dayKey(), createdBy: S.profile.uid, createdByName: S.profile.name });
