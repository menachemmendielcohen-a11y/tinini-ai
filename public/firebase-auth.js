import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyDuLCKY1KPKFtbGdglELTlmGYy3IOFNEdI",
  authDomain: "mendy-ai-aa486.firebaseapp.com",
  projectId: "mendy-ai-aa486",
  storageBucket: "mendy-ai-aa486.firebasestorage.app",
  messagingSenderId: "105709413974",
  appId: "1:105709413974:web:228154a6a768989565fdf7",
  measurementId: "G-L310DT54PK"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const provider = new GoogleAuthProvider();

provider.setCustomParameters({
  prompt: "select_account"
});

window.currentUser = null;
window.firebaseAuth = auth;

const loginBtn = document.getElementById("loginWithGoogle");
const logoutBtn = document.getElementById("logoutBtn");
const userBox = document.getElementById("userBox");
const sidebarUser = document.getElementById("sidebarUser");
const connectionStatus = document.getElementById("connectionStatus");

if (loginBtn) {
  loginBtn.addEventListener("click", async () => {
    try {
      await signInWithPopup(auth, provider);
    } catch (error) {
      console.error("Firebase login error:", error);
      alert("שגיאת התחברות: " + error.message);
    }
  });
}

if (logoutBtn) {
  logoutBtn.addEventListener("click", async () => {
    try {
      await signOut(auth);
    } catch (error) {
      console.error("Firebase logout error:", error);
      alert("שגיאת התנתקות: " + error.message);
    }
  });
}

onAuthStateChanged(auth, (user) => {
  window.currentUser = user;
  updateAuthUI(user);

  window.dispatchEvent(
    new CustomEvent("firebase-user-changed", {
      detail: { user }
    })
  );
});

function updateAuthUI(user) {
  if (!user) {
    if (loginBtn) loginBtn.style.display = "inline-flex";
    if (logoutBtn) logoutBtn.style.display = "none";

    if (userBox) userBox.textContent = "לא מחובר";

    if (connectionStatus) {
      connectionStatus.className = "status-pill disconnected";
      connectionStatus.innerHTML = `<span class="status-dot"></span> לא מחובר`;
    }

    if (sidebarUser) {
      sidebarUser.innerHTML = `
        <div class="avatar-mini">?</div>
        <div>
          <strong>לא מחובר</strong>
          <small>התחבר עם Google</small>
        </div>
      `;
    }

    return;
  }

  const displayName = user.displayName || user.email || "משתמש";
  const email = user.email || "";
  const avatarHtml = getAvatarHtml(user, displayName);

  if (loginBtn) loginBtn.style.display = "none";
  if (logoutBtn) logoutBtn.style.display = "inline-flex";

  if (userBox) userBox.textContent = `מחובר בתור ${displayName}`;

  if (connectionStatus) {
    connectionStatus.className = "status-pill connected";
    connectionStatus.innerHTML = `<span class="status-dot"></span> מחובר`;
  }

  if (sidebarUser) {
    sidebarUser.innerHTML = `
      <div class="avatar-mini">${avatarHtml}</div>
      <div>
        <strong>${escapeHtml(displayName)}</strong>
        <small>${escapeHtml(email)}</small>
      </div>
    `;
  }
}

function getAvatarHtml(user, displayName) {
  const firstLetter = (displayName || user.email || "?").trim().slice(0, 1).toUpperCase();

  if (!user.photoURL) {
    return escapeHtml(firstLetter);
  }

  return `
    <img
      src="${escapeAttr(user.photoURL)}"
      alt="${escapeAttr(displayName)}"
      referrerpolicy="no-referrer"
      loading="lazy"
      onerror="this.parentElement.textContent='${escapeAttr(firstLetter)}'"
    />
  `;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttr(value) {
  return escapeHtml(value);
}
