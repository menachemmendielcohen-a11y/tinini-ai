import "dotenv/config";
import express from "express";
import admin, { db, firebaseAdminReady, firestoreReady } from "./firebase-admin.js";

const app = express();
const PORT = process.env.PORT || 3000;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || "openrouter/free";
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || "")
  .split(",")
  .map((email) => email.trim().toLowerCase())
  .filter(Boolean);

const SETTINGS_COLLECTION = "appSettings";
const SETTINGS_DOC_ID = "main";
const DEFAULT_SYSTEM_PROMPT = `אתה תניני AI, בוט AI חכם בעברית.
ענה תמיד בעברית תקינה בלבד.
אל תערבב שפות, רוסית, ג׳יבריש או סימנים מוזרים.
אם המשתמש שואל בעברית — ענה בעברית.
ענה ברור, טבעי ומסודר.
אם המשתמש שואל מי יצר אותך, ענה: מנדי כהן יצר אותי.`;

app.use(express.json({ limit: "2mb" }));
app.use(express.static("public"));

app.get("/api/health", async (req, res) => {
  let systemPromptConfigured = false;

  try {
    if (db) {
      const settings = await getAppSettings();
      systemPromptConfigured = Boolean(settings.systemPrompt && settings.systemPrompt.trim());
    }
  } catch {
    systemPromptConfigured = false;
  }

  res.json({
    ok: true,
    hasOpenRouterKey: Boolean(OPENROUTER_API_KEY),
    firebaseAdminReady,
    firestoreReady,
    adminEmailsConfigured: ADMIN_EMAILS.length > 0,
    systemPromptConfigured,
    model: OPENROUTER_MODEL
  });
});

async function requireFirebaseUser(req, res, next) {
  try {
    if (!firebaseAdminReady) {
      return res.status(500).json({
        error: "Firebase Admin לא מוגדר בשרת. צריך להוסיף serviceAccountKey.json בתיקייה הראשית."
      });
    }

    const authHeader = req.headers.authorization || "";

    if (!authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        error: "צריך להתחבר עם Google כדי להשתמש בבוט."
      });
    }

    const idToken = authHeader.replace("Bearer ", "").trim();
    const decodedToken = await admin.auth().verifyIdToken(idToken);

    req.user = decodedToken;
    req.isAdmin = isAdminEmail(decodedToken.email);

    await saveUserProfile(decodedToken, req.isAdmin);
    next();
  } catch (error) {
    console.error("Firebase auth error:", error.message);
    return res.status(401).json({
      error: "ההתחברות לא תקינה או שפג התוקף שלה. נסה להתנתק ולהתחבר שוב."
    });
  }
}

function requireAdmin(req, res, next) {
  if (!req.isAdmin) {
    return res.status(403).json({
      error: "אין הרשאת מנהל. ודא שהאימייל שלך נמצא ב-ADMIN_EMAILS בקובץ .env"
    });
  }

  next();
}

function isAdminEmail(email) {
  return Boolean(email && ADMIN_EMAILS.includes(String(email).toLowerCase()));
}

async function saveUserProfile(user, isAdmin) {
  if (!db || !user?.uid) return;

  const userRef = db.collection("users").doc(user.uid);
  const snap = await userRef.get();
  const now = Date.now();

  await userRef.set(
    {
      uid: user.uid,
      email: user.email || "",
      displayName: user.name || user.displayName || "משתמש",
      photoURL: user.picture || user.photoURL || "",
      role: isAdmin ? "admin" : "user",
      createdAt: snap.exists ? snap.data().createdAt || now : now,
      lastSeenAt: now
    },
    { merge: true }
  );
}

function getPublicUser(user) {
  return {
    uid: user.uid,
    email: user.email || "",
    displayName: user.name || user.displayName || "משתמש",
    photoURL: user.picture || user.photoURL || "",
    isAdmin: isAdminEmail(user.email)
  };
}

function cleanText(value, max = 20000) {
  return String(value || "").slice(0, max);
}

function cleanSystemPrompt(value) {
  return cleanText(value, 8000).trim();
}

function sanitizeMessages(messages) {
  if (!Array.isArray(messages)) return [];

  return messages
    .filter((msg) => msg && ["user", "assistant"].includes(msg.role) && typeof msg.content === "string")
    .slice(-80)
    .map((msg) => ({
      id: msg.id || crypto.randomUUID(),
      role: msg.role,
      content: cleanText(msg.content),
      createdAt: typeof msg.createdAt === "number" ? msg.createdAt : Date.now()
    }));
}

function sanitizeChat(input, chatId) {
  const now = Date.now();
  const messages = sanitizeMessages(input.messages || []);
  const firstUserMessage = messages.find((msg) => msg.role === "user")?.content || "שיחה חדשה";

  return {
    id: chatId,
    title: cleanText(input.title || firstUserMessage, 90) || "שיחה חדשה",
    messages,
    createdAt: typeof input.createdAt === "number" ? input.createdAt : now,
    updatedAt: now
  };
}

async function recordAdminAudit(req, action, details = {}) {
  if (!db) return;

  try {
    await db.collection("adminLogs").add({
      action,
      adminUid: req.user.uid,
      adminEmail: req.user.email || "",
      details,
      createdAt: Date.now()
    });
  } catch (error) {
    console.warn("Admin audit log failed:", error.message);
  }
}

async function getAppSettings() {
  if (!db) {
    return {
      systemPrompt: DEFAULT_SYSTEM_PROMPT,
      updatedAt: null,
      updatedBy: "default"
    };
  }

  const doc = await db.collection(SETTINGS_COLLECTION).doc(SETTINGS_DOC_ID).get();

  if (!doc.exists) {
    return {
      systemPrompt: DEFAULT_SYSTEM_PROMPT,
      updatedAt: null,
      updatedBy: "default"
    };
  }

  const data = doc.data() || {};
  const systemPrompt = cleanSystemPrompt(data.systemPrompt) || DEFAULT_SYSTEM_PROMPT;

  return {
    systemPrompt,
    updatedAt: data.updatedAt || null,
    updatedBy: data.updatedBy || "unknown",
    updatedByEmail: data.updatedByEmail || ""
  };
}

async function saveSystemPrompt(req, systemPrompt) {
  if (!db) throw new Error("Firestore לא מוכן");

  const cleanedPrompt = cleanSystemPrompt(systemPrompt) || DEFAULT_SYSTEM_PROMPT;
  const payload = {
    systemPrompt: cleanedPrompt,
    updatedAt: Date.now(),
    updatedBy: req.user.uid,
    updatedByEmail: req.user.email || ""
  };

  await db.collection(SETTINGS_COLLECTION).doc(SETTINGS_DOC_ID).set(payload, { merge: true });
  await recordAdminAudit(req, "update_system_prompt", {
    length: cleanedPrompt.length,
    preview: cleanedPrompt.slice(0, 180)
  });

  return payload;
}

app.get("/api/me", requireFirebaseUser, (req, res) => {
  res.json({
    ok: true,
    user: getPublicUser(req.user),
    isAdmin: req.isAdmin
  });
});

app.get("/api/chats", requireFirebaseUser, async (req, res) => {
  try {
    if (!db) throw new Error("Firestore לא מוכן");

    const snap = await db
      .collection("users")
      .doc(req.user.uid)
      .collection("chats")
      .orderBy("updatedAt", "desc")
      .limit(80)
      .get();

    res.json({
      ok: true,
      chats: snap.docs.map((doc) => {
        const data = doc.data() || {};
        return {
          ...data,
          id: data.id || doc.id,
          messages: Array.isArray(data.messages) ? data.messages : []
        };
      })
    });
  } catch (error) {
    console.error("Load chats error:", error.message);
    res.status(500).json({
      error: "לא הצלחתי לטעון שיחות מהענן. בדוק ש-Firestore פועל."
    });
  }
});

app.put("/api/chats/:chatId", requireFirebaseUser, async (req, res) => {
  try {
    if (!db) throw new Error("Firestore לא מוכן");

    const chatId = cleanText(req.params.chatId, 120);
    const chat = sanitizeChat(req.body, chatId);

    await db
      .collection("users")
      .doc(req.user.uid)
      .collection("chats")
      .doc(chatId)
      .set(chat, { merge: true });

    res.json({ ok: true, chat });
  } catch (error) {
    console.error("Save chat error:", error.message);
    res.status(500).json({
      error: "לא הצלחתי לשמור את השיחה בענן. בדוק Firestore."
    });
  }
});

app.delete("/api/chats/:chatId", requireFirebaseUser, async (req, res) => {
  try {
    if (!db) throw new Error("Firestore לא מוכן");

    const chatId = cleanText(req.params.chatId, 120);
    await db.collection("users").doc(req.user.uid).collection("chats").doc(chatId).delete();

    res.json({ ok: true });
  } catch (error) {
    console.error("Delete chat error:", error.message);
    res.status(500).json({ error: "לא הצלחתי למחוק את השיחה מהענן." });
  }
});

app.delete("/api/chats", requireFirebaseUser, async (req, res) => {
  try {
    if (!db) throw new Error("Firestore לא מוכן");

    const chatsRef = db.collection("users").doc(req.user.uid).collection("chats");
    const snap = await chatsRef.get();
    const batch = db.batch();
    snap.docs.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();

    res.json({ ok: true, deleted: snap.size });
  } catch (error) {
    console.error("Delete all chats error:", error.message);
    res.status(500).json({ error: "לא הצלחתי למחוק את כל השיחות מהענן." });
  }
});

app.post("/api/chat", requireFirebaseUser, async (req, res) => {
  try {
    if (!OPENROUTER_API_KEY) {
      return res.status(500).json({
        error: "חסר OPENROUTER_API_KEY בקובץ .env"
      });
    }

    const { message } = req.body;
    const history = req.body.history || req.body.messages || [];

    if (!message || typeof message !== "string") {
      return res.status(400).json({
        error: "חסרה הודעה לשליחה."
      });
    }

    const safeHistory = Array.isArray(history)
      ? history
          .filter((item) => item && ["user", "assistant"].includes(item.role) && typeof item.content === "string")
          .slice(-14)
          .map((item) => ({ role: item.role, content: cleanText(item.content, 12000) }))
      : [];

    const settings = await getAppSettings();
    const systemPrompt = cleanSystemPrompt(settings.systemPrompt) || DEFAULT_SYSTEM_PROMPT;

    const openRouterResponse = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "http://localhost:3000",
        "X-Title": "Tinini AI"
      },
      body: JSON.stringify({
        model: OPENROUTER_MODEL,
        messages: [
          {
            role: "system",
            content: systemPrompt
          },
          ...safeHistory,
          { role: "user", content: cleanText(message, 12000) }
        ]
      })
    });

    const data = await openRouterResponse.json().catch(() => ({}));

    if (!openRouterResponse.ok) {
      console.error("OpenRouter error:", data);
      return res.status(openRouterResponse.status).json({
        error: data?.error?.message || "שגיאה מ-OpenRouter"
      });
    }

    const answer = data?.choices?.[0]?.message?.content || "לא התקבלה תשובה מהמודל.";
    res.json({ ok: true, answer, reply: answer });
  } catch (error) {
    console.error("Server error:", error);
    res.status(500).json({
      error: "שגיאת שרת. בדוק את הטרמינל."
    });
  }
});

app.get("/api/admin/settings", requireFirebaseUser, requireAdmin, async (req, res) => {
  try {
    const settings = await getAppSettings();
    await recordAdminAudit(req, "view_system_prompt", { length: settings.systemPrompt.length });

    res.json({
      ok: true,
      defaultSystemPrompt: DEFAULT_SYSTEM_PROMPT,
      systemPrompt: settings.systemPrompt,
      updatedAt: settings.updatedAt,
      updatedBy: settings.updatedBy,
      updatedByEmail: settings.updatedByEmail || ""
    });
  } catch (error) {
    console.error("Admin settings load error:", error.message);
    res.status(500).json({ error: "לא הצלחתי לטעון הגדרות מנהל." });
  }
});

app.put("/api/admin/settings/system-prompt", requireFirebaseUser, requireAdmin, async (req, res) => {
  try {
    const systemPrompt = cleanSystemPrompt(req.body.systemPrompt);

    if (!systemPrompt) {
      return res.status(400).json({ error: "ההנחיה לא יכולה להיות ריקה. השתמש באיפוס כדי לחזור לברירת מחדל." });
    }

    const saved = await saveSystemPrompt(req, systemPrompt);
    res.json({ ok: true, systemPrompt: saved.systemPrompt, updatedAt: saved.updatedAt });
  } catch (error) {
    console.error("Admin system prompt save error:", error.message);
    res.status(500).json({ error: "לא הצלחתי לשמור את הנחיית המערכת." });
  }
});

app.post("/api/admin/settings/system-prompt/reset", requireFirebaseUser, requireAdmin, async (req, res) => {
  try {
    const saved = await saveSystemPrompt(req, DEFAULT_SYSTEM_PROMPT);
    await recordAdminAudit(req, "reset_system_prompt", { length: DEFAULT_SYSTEM_PROMPT.length });
    res.json({ ok: true, systemPrompt: saved.systemPrompt, updatedAt: saved.updatedAt });
  } catch (error) {
    console.error("Admin system prompt reset error:", error.message);
    res.status(500).json({ error: "לא הצלחתי לאפס את הנחיית המערכת." });
  }
});

app.get("/api/admin/users", requireFirebaseUser, requireAdmin, async (req, res) => {
  try {
    if (!db) throw new Error("Firestore לא מוכן");

    const snap = await db.collection("users").orderBy("lastSeenAt", "desc").limit(200).get();

    const users = await Promise.all(
      snap.docs.map(async (doc) => {
        const user = doc.data();
        let chatCount = 0;

        try {
          const chatsSnap = await doc.ref.collection("chats").get();
          chatCount = chatsSnap.size;
        } catch {
          chatCount = 0;
        }

        return {
          uid: user.uid || doc.id,
          email: user.email || "",
          displayName: user.displayName || "משתמש",
          photoURL: user.photoURL || "",
          role: user.role || "user",
          createdAt: user.createdAt || null,
          lastSeenAt: user.lastSeenAt || null,
          chatCount
        };
      })
    );

    await recordAdminAudit(req, "list_users", { count: users.length });
    res.json({ ok: true, users });
  } catch (error) {
    console.error("Admin users error:", error.message);
    res.status(500).json({ error: "לא הצלחתי לטעון משתמשים." });
  }
});

app.get("/api/admin/users/:uid/chats", requireFirebaseUser, requireAdmin, async (req, res) => {
  try {
    if (!db) throw new Error("Firestore לא מוכן");

    const uid = cleanText(req.params.uid, 160);
    const userDoc = await db.collection("users").doc(uid).get();
    const chatsSnap = await db
      .collection("users")
      .doc(uid)
      .collection("chats")
      .orderBy("updatedAt", "desc")
      .limit(120)
      .get();

    await recordAdminAudit(req, "view_user_chats", { targetUid: uid });

    const chats = chatsSnap.docs.map((doc) => {
      const data = doc.data() || {};
      return {
        id: data.id || doc.id,
        title: data.title || "שיחה ללא שם",
        messages: Array.isArray(data.messages) ? data.messages : [],
        createdAt: data.createdAt || null,
        updatedAt: data.updatedAt || null
      };
    });

    res.json({
      ok: true,
      user: userDoc.exists ? userDoc.data() : { uid, displayName: "משתמש לא ידוע" },
      chats
    });
  } catch (error) {
    console.error("Admin user chats error:", error.message);
    res.status(500).json({ error: "לא הצלחתי לטעון את השיחות של המשתמש." });
  }
});

app.get("/api/admin/users/:uid/chats/:chatId", requireFirebaseUser, requireAdmin, async (req, res) => {
  try {
    if (!db) throw new Error("Firestore לא מוכן");

    const uid = cleanText(req.params.uid, 160);
    const chatId = cleanText(req.params.chatId, 160);
    const doc = await db.collection("users").doc(uid).collection("chats").doc(chatId).get();

    if (!doc.exists) {
      return res.status(404).json({ error: "השיחה לא נמצאה." });
    }

    const data = doc.data() || {};
    const chat = {
      id: data.id || doc.id,
      title: data.title || "שיחה ללא שם",
      messages: Array.isArray(data.messages) ? data.messages : [],
      createdAt: data.createdAt || null,
      updatedAt: data.updatedAt || null
    };

    await recordAdminAudit(req, "view_user_chat", { targetUid: uid, chatId });
    res.json({ ok: true, chat });
  } catch (error) {
    console.error("Admin single chat error:", error.message);
    res.status(500).json({ error: "לא הצלחתי לטעון את השיחה." });
  }
});

app.delete("/api/admin/users/:uid/chats/:chatId", requireFirebaseUser, requireAdmin, async (req, res) => {
  try {
    if (!db) throw new Error("Firestore לא מוכן");

    const uid = cleanText(req.params.uid, 160);
    const chatId = cleanText(req.params.chatId, 160);

    await db.collection("users").doc(uid).collection("chats").doc(chatId).delete();
    await recordAdminAudit(req, "delete_user_chat", { targetUid: uid, chatId });

    res.json({ ok: true });
  } catch (error) {
    console.error("Admin delete chat error:", error.message);
    res.status(500).json({ error: "לא הצלחתי למחוק את השיחה." });
  }
});

app.listen(PORT, () => {
  console.log(`✅ Server running: http://localhost:${PORT}`);
  console.log(`🤖 Model: ${OPENROUTER_MODEL}`);
  console.log(`👑 Admin emails: ${ADMIN_EMAILS.length ? ADMIN_EMAILS.join(", ") : "לא הוגדר"}`);
});
