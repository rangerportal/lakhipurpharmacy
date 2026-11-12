// =====================================================================
//  Paste the Firebase web app config of your PHARMACY project here.
//  (Use a separate Firebase project from the clinic app — see README.)
//  Firebase Console -> Project settings -> General -> Your apps -> Config
// =====================================================================
export const firebaseConfig = {
  apiKey: "AIzaSyB3QHieMEPBXahE6aSn0zRKSYMvLY4qI2c",
  authDomain: "lakhipur-pharmacy.firebaseapp.com",
  projectId: "lakhipur-pharmacy",
  storageBucket: "lakhipur-pharmacy.firebasestorage.app",
  messagingSenderId: "1008077197169",
  appId: "1:1008077197169:web:a0721bddb19afd585170d0"
};

// Usernames become login emails like  username@lakhipurpharmacy.app (no email is sent).
// If you change this, also change the admin email in firestore.rules.
export const LOGIN_DOMAIN = "lakhipurpharmacy.app";
export const ADMIN_USERNAME = "admin";

// Default shop details (admin can change all of these in Settings).
export const DEFAULT_SETTINGS = {
  name: "Lakhipur Pharmacy",
  tagline: "",
  tags: "",
  logo: "",
  address: "Amolapatty Road, Near Lakhipur Sub Divisional Civil Hospital, Lakhipur, Goalpara, Assam, India",
  phone: "",
  email: "",
  gstin: "",
  state: "Assam",
  dlNo: "",              // Drug licence numbers, e.g. "20B: AS/GLP/1234, 21B: AS/GLP/1235"
  pharmacist: "",        // Registered pharmacist name & reg. no.
  gstType: "regular",    // "regular" (Tax Invoice with CGST/SGST) or "composition" (Bill of Supply)
  billPrefix: "LPH",
  expiryAlertDays: 90,
  doctors: "",           // one per line — shown as suggestions while billing
  terms: "Medicines once sold can be returned only with bill within 7 days. Please check the expiry date before leaving.",
  paperSize: "A5"
};
