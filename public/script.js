const STORAGE_KEY = "tinini_ai_chats_v4_admin";

const messagesEl = document.getElementById("messages");
const chatForm = document.getElementById("chatForm");
const userInput = document.getElementById("userInput");
const sendBtn = document.getElementById("sendBtn");
const welcomeScreen = document.getElementById("welcomeScreen");
const newChatBtn = document.getElementById("newChatBtn");
const renameChatBtn = document.getElementById("renameChatBtn");
const deleteAllChatsBtn = document.getElementById("deleteAllChatsBtn");
const chatList = document.getElementById("chatList");
const chatListTitle = document.getElementById("chatListTitle");
const searchChats = document.getElementById("searchChats");
const openSidebarBtn = document.getElementById("openSidebarBtn");
const closeSidebarBtn = document.getElementById("closeSidebarBtn");
const adminPanelBtn = document.getElementById("adminPanelBtn");
const backToChatBtn = document.getElementById("backToChatBtn");
const chatView = document.getElementById("chatView");
const adminView = document.getElementById("adminView");
const refreshAdminBtn = document.getElementById("refreshAdminBtn");
const adminUsersEl = document.getElementById("adminUsers");
const adminChatsEl = document.getElementById("adminChats");
const adminChatsTitle = document.getElementById("adminChatsTitle");
const adminChatPreview = document.getElementById("adminChatPreview");
const adminPreviewTitle = document.getElementById("adminPreviewTitle");
const adminSystemPromptEl = document.getElementById("adminSystemPrompt");
const saveSystemPromptBtn = document.getElementById("saveSystemPromptBtn");
const resetSystemPromptBtn = document.getElementById("resetSystemPromptBtn");
const systemPromptStatus = document.getElementById("systemPromptStatus");
const topSubtitle = document.getElementById("topSubtitle");
const toastEl = document.getElementById("toast");

let chats = loadLocalChats();
let activeChatId = chats[0]?.id || createChat(false).id;
let isSending = false;
let me = null;
let viewMode = "chat";
let adminUsers = [];
let selectedAdminUser = null;
let selectedAdminChats = [];
let selectedAdminChat = null;
let defaultSystemPrompt = "";

renderAll();

window.addEventListener("firebase-user-changed", async (event) => {
  if (!event.detail.user) {
    me = null;
    chats = [];
    activeChatId = createChat(false).id;
    adminPanelBtn.classList.add("hidden");
    showChatView();
    renderAll();
    return;
  }

  await loadMe();
  await loadChatsFromCloud();
  renderAll();
});

chatForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  await sendCurrentMessage();
});

userInput.addEventListener("input", autoResizeTextarea);

userInput.addEventListener("keydown", async (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    await sendCurrentMessage();
  }
});

newChatBtn.addEventListener("click", () => {
  showChatView();
  createChat(true);
  closeMobileSidebar();
});

renameChatBtn.addEventListener("click", renameActiveChat);
deleteAllChatsBtn.addEventListener("click", deleteAllMyChats);
searchChats.addEventListener("input", renderChatList);

openSidebarBtn?.addEventListener("click", () => document.body.classList.add("sidebar-open"));
closeSidebarBtn?.addEventListener("click", closeMobileSidebar);

adminPanelBtn.addEventListener("click", async () => {
  await openAdminDashboard();
  closeMobileSidebar();
});

backToChatBtn.addEventListener("click", showChatView);
refreshAdminBtn.addEventListener("click", async () => {
  await loadAdminSettings();
  await loadAdminUsers();
});
saveSystemPromptBtn?.addEventListener("click", saveAdminSystemPrompt);
resetSystemPromptBtn?.addEventListener("click", resetAdminSystemPrompt);
adminSystemPromptEl?.addEventListener("input", updateSystemPromptStatus);

document.querySelectorAll(".prompt-card").forEach((card) => {
  card.addEventListener("click", () => {
    userInput.value = card.dataset.prompt || "";
    userInput.focus();
    autoResizeTextarea();
  });
});

async function loadMe() {
  try {
    const data = await apiFetch("/api/me");
    me = data;

    if (data.isAdmin) {
      adminPanelBtn.classList.remove("hidden");
    } else {
      adminPanelBtn.classList.add("hidden");
    }
  } catch (error) {
    console.error(error);
    showToast(error.message);
  }
}

async function sendCurrentMessage() {
  if (viewMode !== "chat") {
    showToast("במצב מנהל אפשר לצפות בלבד. חזור לצ׳אט שלך כדי לשלוח הודעה.");
    return;
  }

  const message = userInput.value.trim();

  if (!message || isSending) return;

  if (!window.currentUser) {
    showToast("צריך להתחבר עם Google לפני ששולחים הודעה");
    return;
  }

  let chat = getActiveChat();

  if (!chat) {
    chat = createChat(false);
    activeChatId = chat.id;
  }

  addMessage("user", message);
  userInput.value = "";
  autoResizeTextarea();

  const typingId = addTypingMessage();
  setSending(true);

  try {
    const currentChat = getActiveChat();
    const history = currentChat.messages
      .filter((msg) => msg.role === "user" || msg.role === "assistant")
      .filter((msg) => msg.content !== "__typing__")
      .slice(-14)
      .map((msg) => ({ role: msg.role, content: msg.content }));

    const data = await apiFetch("/api/chat", {
      method: "POST",
      body: JSON.stringify({ message, history })
    });

    const reply = data.reply || data.answer || "לא התקבלה תשובה מהשרת.";

    removeMessageById(typingId, false);
    addMessage("assistant", reply);
    await saveActiveChatToCloud();
  } catch (error) {
    removeMessageById(typingId, false);
    addMessage("assistant", `שגיאה: ${error.message}`);
    await saveActiveChatToCloud();
  } finally {
    setSending(false);
  }
}

async function apiFetch(url, options = {}) {
  const token = await getFirebaseTokenSafely();

  if (!token) {
    throw new Error("צריך להתחבר עם Google");
  }

  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(options.headers || {})
    }
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || data.message || "שגיאת שרת");
  }

  return data;
}

async function getFirebaseTokenSafely() {
  try {
    if (!window.currentUser) return null;
    return await window.currentUser.getIdToken();
  } catch (error) {
    console.error("Firebase token error:", error);
    return null;
  }
}

async function loadChatsFromCloud() {
  try {
    const data = await apiFetch("/api/chats");

    if (Array.isArray(data.chats) && data.chats.length > 0) {
      chats = data.chats.map(normalizeChat);
      activeChatId = chats[0].id;
    } else {
      chats = [createChat(false)];
      activeChatId = chats[0].id;
    }

    saveLocalChats();
  } catch (error) {
    console.error("Cloud load failed:", error);
    showToast("לא הצלחתי לטעון שיחות מהענן, משתמש בגיבוי מקומי");
  }
}

async function saveActiveChatToCloud() {
  const chat = getActiveChat();
  if (!chat || !window.currentUser) return;

  try {
    await apiFetch(`/api/chats/${encodeURIComponent(chat.id)}`, {
      method: "PUT",
      body: JSON.stringify(chat)
    });
  } catch (error) {
    console.error("Cloud save failed:", error);
    showToast("המחשב לא הצליח לשמור את השיחה בענן. בדוק Firestore.");
  }
}

async function saveChatToCloud(chat) {
  if (!chat || !window.currentUser) return;

  try {
    await apiFetch(`/api/chats/${encodeURIComponent(chat.id)}`, {
      method: "PUT",
      body: JSON.stringify(chat)
    });
  } catch (error) {
    console.error("Cloud save failed:", error);
  }
}

async function deleteChatFromCloud(chatId) {
  try {
    await apiFetch(`/api/chats/${encodeURIComponent(chatId)}`, { method: "DELETE" });
  } catch (error) {
    console.error("Cloud delete failed:", error);
    showToast("לא הצלחתי למחוק מהענן");
  }
}

function createChat(activate = true) {
  const now = Date.now();
  const chat = {
    id: crypto.randomUUID(),
    title: "שיחה חדשה",
    messages: [],
    createdAt: now,
    updatedAt: now
  };

  chats.unshift(chat);

  if (activate) {
    activeChatId = chat.id;
  }

  saveLocalChats();
  renderAll();
  saveChatToCloud(chat);
  return chat;
}

function getActiveChat() {
  return chats.find((chat) => chat.id === activeChatId) || chats[0] || null;
}

function addMessage(role, content) {
  const chat = getActiveChat();
  if (!chat) return;

  chat.messages.push({
    id: crypto.randomUUID(),
    role,
    content,
    createdAt: Date.now()
  });

  if (role === "user" && chat.title === "שיחה חדשה") {
    chat.title = createTitleFromMessage(content);
  }

  chat.updatedAt = Date.now();
  saveLocalChats();
  renderAll();
}

function addTypingMessage() {
  const chat = getActiveChat();
  const id = crypto.randomUUID();

  chat.messages.push({ id, role: "assistant", content: "__typing__", createdAt: Date.now() });
  chat.updatedAt = Date.now();
  renderAll();
  return id;
}

function removeMessageById(id, shouldSave = true) {
  const chat = getActiveChat();
  if (!chat) return;

  chat.messages = chat.messages.filter((msg) => msg.id !== id);
  chat.updatedAt = Date.now();

  if (shouldSave) saveLocalChats();
  renderAll();
}

async function renameActiveChat() {
  if (viewMode !== "chat") return;

  const chat = getActiveChat();
  if (!chat) return;

  const newTitle = prompt("שם חדש לשיחה:", chat.title || "שיחה חדשה");
  if (!newTitle) return;

  chat.title = newTitle.trim().slice(0, 90) || "שיחה חדשה";
  chat.updatedAt = Date.now();
  saveLocalChats();
  renderAll();
  await saveActiveChatToCloud();
}

async function deleteAllMyChats() {
  if (viewMode !== "chat") return;
  const ok = confirm("למחוק את כל השיחות שלך? זה ימחק גם מהענן.");
  if (!ok) return;

  try {
    if (window.currentUser) await apiFetch("/api/chats", { method: "DELETE" });
  } catch (error) {
    showToast(error.message);
  }

  chats = [createChat(false)];
  activeChatId = chats[0].id;
  saveLocalChats();
  renderAll();
}

async function deleteChat(chatId) {
  if (chats.length <= 1) {
    chats[0].messages = [];
    chats[0].title = "שיחה חדשה";
    chats[0].updatedAt = Date.now();
    activeChatId = chats[0].id;
    saveLocalChats();
    renderAll();
    await saveActiveChatToCloud();
    return;
  }

  chats = chats.filter((chat) => chat.id !== chatId);
  await deleteChatFromCloud(chatId);

  if (activeChatId === chatId) {
    activeChatId = chats[0]?.id || createChat(false).id;
  }

  saveLocalChats();
  renderAll();
}

function renderAll() {
  renderChatList();
  renderMessages();
}

function renderChatList() {
  if (!chatList) return;

  if (viewMode !== "chat") {
    chatListTitle.textContent = "מצב מנהל";
    chatList.innerHTML = `<div class="mini-note">אתה צופה בדשבורד מנהל. לחץ על משתמש כדי לראות את השיחות שלו.</div>`;
    return;
  }

  chatListTitle.textContent = "השיחות שלי";
  const query = (searchChats.value || "").trim().toLowerCase();
  const filteredChats = chats.filter((chat) => chat.title.toLowerCase().includes(query));

  chatList.innerHTML = filteredChats
    .map(
      (chat) => `
      <button class="chat-item ${chat.id === activeChatId ? "active" : ""}" type="button" data-chat-id="${chat.id}">
        <span class="chat-item-title">${escapeHtml(chat.title)}</span>
        <span class="chat-delete" data-delete-id="${chat.id}" title="מחק">🗑️</span>
      </button>
    `
    )
    .join("");

  chatList.querySelectorAll(".chat-item").forEach((item) => {
    item.addEventListener("click", (event) => {
      const deleteId = event.target.dataset.deleteId;

      if (deleteId) {
        event.stopPropagation();
        deleteChat(deleteId);
        return;
      }

      activeChatId = item.dataset.chatId;
      saveLocalChats();
      renderAll();
      closeMobileSidebar();
    });
  });
}

function renderMessages() {
  if (!messagesEl) return;

  const chat = getActiveChat();
  messagesEl.innerHTML = "";

  if (!chat || chat.messages.length === 0) {
    welcomeScreen.classList.remove("hidden");
    messagesEl.classList.add("hidden");
    return;
  }

  welcomeScreen.classList.add("hidden");
  messagesEl.classList.remove("hidden");

  messagesEl.innerHTML = chat.messages.map(renderMessage).join("");
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function renderMessage(msg) {
  if (msg.content === "__typing__") {
    return `
      <div class="message-row bot-row">
        <img class="bot-avatar" src="/tinini-icon.png" alt="תניני AI" />
        <div class="message bot typing"><span></span><span></span><span></span></div>
      </div>
    `;
  }

  const isUser = msg.role === "user";

  return `
    <div class="message-row ${isUser ? "user-row" : "bot-row"}">
      ${isUser ? "" : `<img class="bot-avatar" src="/tinini-icon.png" alt="תניני AI" />`}
      <div class="message ${isUser ? "user" : "bot"}">${escapeHtml(msg.content)}</div>
    </div>
  `;
}

async function openAdminDashboard() {
  if (!me?.isAdmin) {
    showToast("אין הרשאת מנהל");
    return;
  }

  viewMode = "admin";
  chatView.classList.add("hidden");
  adminView.classList.remove("hidden");
  chatForm.classList.add("hidden");
  backToChatBtn.classList.remove("hidden");
  topSubtitle.textContent = "דשבורד מנהל";
  renderChatList();
  await loadAdminSettings();
  await loadAdminUsers();
}

function showChatView() {
  viewMode = "chat";
  chatView.classList.remove("hidden");
  adminView.classList.add("hidden");
  chatForm.classList.remove("hidden");
  backToChatBtn.classList.add("hidden");
  topSubtitle.textContent = "ממשק צ׳אט חכם בסגנון KGPT";
  renderAll();
}


async function loadAdminSettings() {
  if (!adminSystemPromptEl) return;

  try {
    adminSystemPromptEl.disabled = true;
    if (systemPromptStatus) systemPromptStatus.textContent = "טוען הנחיה...";

    const data = await apiFetch("/api/admin/settings");
    defaultSystemPrompt = data.defaultSystemPrompt || "";
    adminSystemPromptEl.value = data.systemPrompt || defaultSystemPrompt || "";
    adminSystemPromptEl.disabled = false;
    updateSystemPromptStatus(data.updatedAt);
  } catch (error) {
    adminSystemPromptEl.disabled = false;
    if (systemPromptStatus) systemPromptStatus.textContent = "שגיאה בטעינת ההנחיה";
    showToast(error.message);
  }
}

async function saveAdminSystemPrompt() {
  if (!adminSystemPromptEl) return;

  const systemPrompt = adminSystemPromptEl.value.trim();

  if (!systemPrompt) {
    showToast("אי אפשר לשמור הנחיה ריקה");
    return;
  }

  try {
    saveSystemPromptBtn.disabled = true;
    if (systemPromptStatus) systemPromptStatus.textContent = "שומר...";

    const data = await apiFetch("/api/admin/settings/system-prompt", {
      method: "PUT",
      body: JSON.stringify({ systemPrompt })
    });

    adminSystemPromptEl.value = data.systemPrompt || systemPrompt;
    updateSystemPromptStatus(data.updatedAt);
    showToast("הנחיית המערכת נשמרה");
  } catch (error) {
    showToast(error.message);
    if (systemPromptStatus) systemPromptStatus.textContent = "שמירה נכשלה";
  } finally {
    saveSystemPromptBtn.disabled = false;
  }
}

async function resetAdminSystemPrompt() {
  if (!adminSystemPromptEl) return;

  const ok = confirm("לאפס את הנחיית המערכת לברירת המחדל?");
  if (!ok) return;

  try {
    resetSystemPromptBtn.disabled = true;
    if (systemPromptStatus) systemPromptStatus.textContent = "מאפס...";

    const data = await apiFetch("/api/admin/settings/system-prompt/reset", {
      method: "POST"
    });

    adminSystemPromptEl.value = data.systemPrompt || defaultSystemPrompt || "";
    updateSystemPromptStatus(data.updatedAt);
    showToast("ההנחיה אופסה");
  } catch (error) {
    showToast(error.message);
    if (systemPromptStatus) systemPromptStatus.textContent = "איפוס נכשל";
  } finally {
    resetSystemPromptBtn.disabled = false;
  }
}

function updateSystemPromptStatus(updatedAt = null) {
  if (!adminSystemPromptEl || !systemPromptStatus) return;

  const length = adminSystemPromptEl.value.length;
  const dateText = updatedAt ? ` · נשמר לאחרונה: ${formatDate(updatedAt)}` : "";
  systemPromptStatus.textContent = `${length}/8000 תווים${dateText}`;
}

async function loadAdminUsers() {
  try {
    adminUsersEl.innerHTML = `<div class="loading-line">טוען משתמשים...</div>`;
    const data = await apiFetch("/api/admin/users");
    adminUsers = data.users || [];
    renderAdminUsers();
  } catch (error) {
    adminUsersEl.innerHTML = `<div class="error-box">${escapeHtml(error.message)}</div>`;
  }
}

function renderAdminUsers() {
  if (!adminUsers.length) {
    adminUsersEl.innerHTML = `<div class="empty-admin">אין משתמשים עדיין.</div>`;
    return;
  }

  adminUsersEl.innerHTML = adminUsers
    .map((user) => {
      const avatar = user.photoURL
        ? `<img src="${escapeAttr(user.photoURL)}" referrerpolicy="no-referrer" alt="">`
        : escapeHtml((user.displayName || user.email || "?").slice(0, 1));

      return `
        <button class="admin-user ${selectedAdminUser?.uid === user.uid ? "active" : ""}" type="button" data-uid="${escapeAttr(user.uid)}">
          <div class="avatar-mini">${avatar}</div>
          <div class="admin-user-main">
            <strong>${escapeHtml(user.displayName || "משתמש")}</strong>
            <small>${escapeHtml(user.email || "אין אימייל")}</small>
          </div>
          <div class="admin-user-meta">
            <span>${user.role === "admin" ? "מנהל" : "משתמש"}</span>
            <small>${user.chatCount || 0} שיחות</small>
          </div>
        </button>
      `;
    })
    .join("");

  adminUsersEl.querySelectorAll(".admin-user").forEach((btn) => {
    btn.addEventListener("click", () => loadAdminUserChats(btn.dataset.uid));
  });
}

async function loadAdminUserChats(uid) {
  try {
    selectedAdminUser = adminUsers.find((user) => user.uid === uid) || { uid };
    selectedAdminChat = null;
    adminChatsEl.innerHTML = `<div class="loading-line">טוען שיחות...</div>`;
    adminChatPreview.innerHTML = `<div class="empty-admin">בחר שיחה כדי לפתוח אותה כאן.</div>`;
    adminPreviewTitle.textContent = "תצוגת שיחה";
    renderAdminUsers();

    const data = await apiFetch(`/api/admin/users/${encodeURIComponent(uid)}/chats`);
    selectedAdminUser = data.user || selectedAdminUser;
    selectedAdminChats = data.chats || [];
    renderAdminChats();
  } catch (error) {
    adminChatsEl.innerHTML = `<div class="error-box">${escapeHtml(error.message)}</div>`;
  }
}

function renderAdminChats() {
  const userName = selectedAdminUser.displayName || selectedAdminUser.email || "משתמש";
  adminChatsTitle.textContent = `השיחות של ${userName}`;

  if (!selectedAdminChats.length) {
    adminChatsEl.innerHTML = `<div class="empty-admin">אין שיחות למשתמש הזה.</div>`;
    return;
  }

  adminChatsEl.innerHTML = selectedAdminChats
    .map(
      (chat) => `
      <button class="admin-chat-item ${selectedAdminChat?.id === chat.id ? "active" : ""}" type="button" data-chat-id="${escapeAttr(chat.id)}">
        <strong>${escapeHtml(chat.title || "שיחה ללא שם")}</strong>
        <small>${formatDate(chat.updatedAt)}</small>
      </button>
    `
    )
    .join("");

  adminChatsEl.querySelectorAll(".admin-chat-item").forEach((btn) => {
    btn.addEventListener("click", () => loadAdminChat(btn.dataset.chatId));
  });
}

async function loadAdminChat(chatId) {
  try {
    if (!chatId || chatId === "undefined") {
      throw new Error("חסר מזהה שיחה. עדכן את server.js לגרסה המתוקנת ואז רענן את הדף.");
    }

    const localChat = selectedAdminChats.find((chat) => chat.id === chatId) || null;
    selectedAdminChat = localChat;
    renderAdminChats();

    const data = await apiFetch(
      `/api/admin/users/${encodeURIComponent(selectedAdminUser.uid)}/chats/${encodeURIComponent(chatId)}`
    );

    selectedAdminChat = normalizeChat(data.chat || localChat || {});
    renderAdminChats();
    renderAdminChatPreview();
  } catch (error) {
    adminPreviewTitle.textContent = "שגיאה בפתיחת שיחה";
    adminChatPreview.innerHTML = `<div class="error-box">${escapeHtml(error.message)}</div>`;
  }
}

function renderAdminChatPreview() {
  if (!selectedAdminChat) return;

  adminPreviewTitle.textContent = selectedAdminChat.title || "שיחה";

  const messages = Array.isArray(selectedAdminChat.messages) ? selectedAdminChat.messages : [];

  adminChatPreview.innerHTML = `
    <div class="admin-preview-toolbar">
      <span>מצב צפייה בלבד · ${messages.length} הודעות</span>
      <button id="adminDeleteChatBtn" class="small-danger" type="button">מחק שיחה</button>
    </div>
    <div class="admin-preview-messages">
      ${messages.length
        ? messages
            .map(
              (msg) => `
                <div class="admin-preview-msg ${escapeAttr(msg.role || "assistant")}">
                  <b>${msg.role === "user" ? "משתמש" : "תניני AI"}</b>
                  <p>${escapeHtml(msg.content || "")}</p>
                </div>
              `
            )
            .join("")
        : `<div class="empty-admin">השיחה נפתחה, אבל אין בה הודעות שמורות. אם זו שיחה ישנה, שלח בה הודעה חדשה ואז פתח אותה שוב.</div>`}
    </div>
  `;

  document.getElementById("adminDeleteChatBtn")?.addEventListener("click", deleteAdminSelectedChat);
}

async function deleteAdminSelectedChat() {
  if (!selectedAdminUser || !selectedAdminChat) return;

  const ok = confirm("למחוק את השיחה הזו של המשתמש? הפעולה תירשם ביומן מנהל.");
  if (!ok) return;

  try {
    await apiFetch(
      `/api/admin/users/${encodeURIComponent(selectedAdminUser.uid)}/chats/${encodeURIComponent(selectedAdminChat.id)}`,
      { method: "DELETE" }
    );
    selectedAdminChat = null;
    await loadAdminUserChats(selectedAdminUser.uid);
    showToast("השיחה נמחקה");
  } catch (error) {
    showToast(error.message);
  }
}

function normalizeChat(chat) {
  return {
    id: chat.id || crypto.randomUUID(),
    title: chat.title || "שיחה חדשה",
    messages: Array.isArray(chat.messages) ? chat.messages : [],
    createdAt: chat.createdAt || Date.now(),
    updatedAt: chat.updatedAt || Date.now()
  };
}

function loadLocalChats() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) && parsed.length ? parsed.map(normalizeChat) : [];
  } catch {
    return [];
  }
}

function saveLocalChats() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(chats));
}

function createTitleFromMessage(message) {
  return message.replace(/\s+/g, " ").trim().slice(0, 34) || "שיחה חדשה";
}

function autoResizeTextarea() {
  userInput.style.height = "auto";
  userInput.style.height = `${Math.min(userInput.scrollHeight, 160)}px`;
}

function setSending(value) {
  isSending = value;
  sendBtn.disabled = value;
  sendBtn.textContent = value ? "שולח..." : "שלח";
}

function closeMobileSidebar() {
  document.body.classList.remove("sidebar-open");
}

function showToast(message) {
  toastEl.textContent = message;
  toastEl.classList.remove("hidden");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toastEl.classList.add("hidden"), 3200);
}

function formatDate(value) {
  if (!value) return "";
  return new Date(value).toLocaleString("he-IL", { dateStyle: "short", timeStyle: "short" });
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttr(value) {
  return escapeHtml(value);
}
