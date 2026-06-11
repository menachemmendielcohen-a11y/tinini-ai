import admin from "firebase-admin";
import { existsSync, readFileSync } from "fs";

function loadServiceAccount() {
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    return JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  }

  if (existsSync("./serviceAccountKey.json")) {
    return JSON.parse(readFileSync("./serviceAccountKey.json", "utf8"));
  }

  return null;
}

const serviceAccount = loadServiceAccount();

if (serviceAccount && !admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
} else if (!serviceAccount) {
  console.warn("⚠️ Firebase Admin לא הופעל: חסר serviceAccountKey.json או FIREBASE_SERVICE_ACCOUNT");
}

export default admin;
export const firebaseAdminReady = Boolean(serviceAccount && admin.apps.length);
export const db = firebaseAdminReady ? admin.firestore() : null;
export const firestoreReady = Boolean(db);
