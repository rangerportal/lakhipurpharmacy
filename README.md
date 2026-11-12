# Lakhipur Pharmacy — Billing, Inventory & GST App (PWA)

This works like the clinic app: you install it on phones, tablets and computers, it uses the same kind of logins (1 admin, plus as many co-partner and staff logins as you need), and your data is stored in Firebase.

## Who can do what

| Feature | Admin | Co-partner | Staff |
|---|:-:|:-:|:-:|
| New bill (A5 GST invoice), print | ✔ | – | ✔ |
| Sales returns (stock goes back automatically) | ✔ | – | ✔ |
| Cancel a bill (with reason) | ✔ | – | – |
| Purchases from vendors (batch, expiry, GST, free qty), opening stock | ✔ | view | ✔ |
| Medicines master, inventory, expiry & low-stock lists | ✔ | view | ✔ |
| Write off expired/damaged stock, stock correction | ✔ | – | – |
| Vendors (payables) & customers (credit/udhaar), payments | ✔ | view | ✔ |
| Expenses | ✔ (delete) | view | ✔ (add) |
| **Dashboard: sales, profit & loss, cash in/out, top medicines** | ✔ | ✔ | – |
| **Reports: GST output/input, HSN summary, H1 register, CSV exports** | ✔ | ✔ | – |
| Logins, settings, backup | ✔ | – | – |

The admin username is `admin`. The password is whatever you type the **first time** you log in as admin, so use your usual admin password. It is never stored in these files.

---

## Setup (one time)

### 1. Create a NEW Firebase project for the pharmacy
Use a **separate project** from the clinic (for example `lakhipur-pharmacy`). This keeps the pharmacy staff logins out of the clinic app, and each project gets its own free quota.

Then follow the same steps as for the clinic:
1. **Add a web app** (the `</>` icon), then copy the config values into **`firebase-config.js`**. Keep the word `export`.
2. **Authentication → Sign-in method → Email/Password → Enable.**
3. **Firestore Database → Create database.** Choose **Standard edition**, leave the Database ID **blank**, pick **asia-south1 (Mumbai)**, and choose **production mode**.
4. **Firestore → Rules:** paste the whole of **`firestore.rules`** (from this folder, not the clinic one) and click **Publish**.

### 2. Host it on GitHub Pages
1. Create a new **public** repository, for example `lakhipur-pharmacy`.
2. Upload everything **inside** this folder (index.html at the top level) and commit.
3. Go to **Settings → Pages**, choose **Deploy from a branch**, then **main** and **/ (root)**.
4. In Firebase, go to **Authentication → Settings → Authorized domains** and add `YOUR-USERNAME.github.io`.
5. Open `https://YOUR-USERNAME.github.io/lakhipur-pharmacy/` and log in as **admin** straight away.

(Firebase Hosting with `firebase deploy` also works, the same way as for the clinic.)

### 3. First-day setup inside the app
1. **Settings:** logo, name, tagline, **GSTIN**, **drug licence nos.**, pharmacist, GST type (Regular or Composition), bill prefix and doctors list.
2. **Logins:** create the co-partner and staff logins.
3. **Vendors:** add your distributors (with GSTIN and state).
4. **Opening stock:** go to **Purchases → New purchase**, tick **“This is opening stock”**, and enter the medicines already in the shop with their batch, expiry, qty, rate and MRP. You can do this in several sittings.

---

## Daily use

**Billing (staff)**
- Scan a barcode or type the medicine name, then press **Enter**.
- The app picks the batch that expires soonest, and expired batches can't be sold.
- Choose Strip or Tab (loose) and enter the qty and a discount if any.
- Enter a phone number to save the customer. Repeat customers fill in automatically and their old dues are shown.
- Choose Cash, UPI, Card or **Credit (udhaar)**. Credit needs a name and phone number.
- Press **Save & Print**, or **Ctrl + Enter**. The A5 tax invoice prints with GST split, HSN, batch, expiry, amount in words and "You saved ₹…".

**Purchases (staff/admin)**
- Enter the vendor, invoice no. and date. For each medicine, enter batch, expiry, qty, free, rate, discount, GST % and MRP, exactly as on the supplier bill (per strip/bottle, rate before GST).
- A vendor from another state is billed with **IGST** automatically.
- Any unpaid amount is added to that vendor's dues.

**Returns:** go to Sales → **Return** on the bill, enter the qty, and choose refund by Cash/UPI or **Adjust in dues**.

**Expiry:** Inventory → **Expiring soon / Expired**. The admin can write off expired stock or mark it **Returned to vendor**.

**Reorder:** Inventory → **Low stock → Download order list**. Set each medicine's reorder level in its details.

## How profit is calculated
- Sale value excluding GST, minus purchase cost of the exact batch sold (free goods lower the cost), gives **gross profit**.
- Gross profit minus expired/damaged write-offs and expenses gives **net profit**.
- Under the **Composition** scheme, the bill is a *Bill of Supply* (no tax shown), and cost includes GST because it can't be claimed back.

## Good to know
- **GST rates:** the default for new medicines is 5%. Always check each medicine's rate and HSN against your supplier bill or your CA. The app is a record-keeping tool; it doesn't replace your accountant for GST filing.
- **Internet:** saving a bill or purchase needs internet (this keeps stock and bill numbers correct when two counters bill at once).
- **Bill numbers:** like `LPH/26-27/00001`. They restart every April (new financial year).
- **Backup:** Settings → Download full backup, monthly.
- **Free plan:** works on Firebase's free plan for a normal single shop. Opening the dashboard for long periods (a whole year) many times a day uses more of the daily free reads.
- **Updates:** after changing files, bump `CACHE = "lph-v1"` in `sw.js` (to `lph-v2`, and so on) and upload again.
