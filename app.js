// ==================== WEB VERSION — DIAMOND AI ====================
const SUPABASE_URL = 'https://pqgwrokpizeelfrjmgoc.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBxZ3dyb2twaXplZWxmcmptZ29jIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcxNTAyMDksImV4cCI6MjA5MjcyNjIwOX0.qtFCGBnpwdQbtmpwSZxI_hH3arq4HBAw62vs5h8WmAk';

// Состояние
let currentChatId = null;
let chats = [];
let folders = [];
let currentUser = null;               // { login, secretWord, name, avatar, fa_icon, ... }
let userApiKey = '';                  // OpenRouter API-ключ
let isWaitingForResponse = false;
let currentAbortController = null;
let currentStreamingMessageId = null;
let lastNotificationTime = 0;
const NOTIFICATION_DEBOUNCE = 1000;
let sidebarCollapsed = false;
let currentEditingFolderId = null;
let currentView = 'chat';
let placeholderInterval = null;
const placeholderTexts = [
    "Как создать успешный проект?",
    "Расскажи новости за сегодня",
    "Кто такой Илон Маск?",
    "Напиши стихотворение",
    "Как дела?",
    "Объясни квантовую физику",
    "Придумай идею для стартапа",
    "Сколько звёзд во Вселенной?"
];

const PRIORITY_MODELS = [
    'openai/gpt-3.5-turbo',
    'anthropic/claude-3-haiku',
    'google/gemini-flash-1.5'
];

const now = new Date();
const currentDateStr = now.toLocaleDateString('ru-RU', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
const SYSTEM_PROMPT = {
    role: 'system',
    content: `Ты — DIAMOND AI, абсолютный эксперт и идеальный собеседник. Сегодня: ${currentDateStr}. Отвечай максимально кратко и по делу, если пользователь не просит подробностей. Ты знаешь химию, физику, математику, программирование. Используй \ce{}, $$, тройные кавычки для кода.`
};

// ========== УТИЛИТЫ ==========
function log(msg) { console.log(`[DIAMOND] ${msg}`); }
function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/[&<>]/g, m => ({ '&':'&amp;','<':'&lt;','>':'&gt;' })[m] || m);
}
function showToast(title, message, type = 'info', duration = 3000) {
    const now = Date.now();
    if (now - lastNotificationTime < NOTIFICATION_DEBOUNCE) return;
    lastNotificationTime = now;
    const container = document.getElementById('toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `
        <div class="toast-content">
            <div class="toast-title">${escapeHtml(title)}</div>
            <div class="toast-message">${escapeHtml(message)}</div>
        </div>
        <button class="toast-close"><i class="fas fa-times"></i></button>
    `;
    container.appendChild(toast);
    toast.querySelector('.toast-close').addEventListener('click', () => toast.remove());
    setTimeout(() => toast.remove(), duration);
}
function saveChats() { localStorage.setItem('diamondChats', JSON.stringify(chats)); renderHistory(); }
function saveFolders() { localStorage.setItem('diamondFolders', JSON.stringify(folders)); }
function scrollToBottom() {
    const container = document.getElementById('messages-container');
    if (container) container.scrollTop = container.scrollHeight;
}

// ========== DIAMKEY / SUPABASE ==========
async function exchangeTicket(ticket) {
    const headers = {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
    };
    try {
        let resp = await fetch(`${SUPABASE_URL}/rest/v1/oauth_tickets?ticket=eq.${ticket}&used=eq.false`, { headers });
        if (!resp.ok) throw new Error('Ошибка поиска тикета');
        const tickets = await resp.json();
        if (!tickets.length) throw new Error('Тикет не найден или уже использован');
        const ticketData = tickets[0];

        resp = await fetch(`${SUPABASE_URL}/rest/v1/oauth_tickets?id=eq.${ticketData.id}`, {
            method: 'PATCH',
            headers: { ...headers, 'Content-Type': 'application/json' },
            body: JSON.stringify({ used: true })
        });
        if (!resp.ok) throw new Error('Не удалось обновить тикет');

        const login = ticketData.login;
        if (!login) throw new Error('Тикет не содержит логин');

        resp = await fetch(`${SUPABASE_URL}/rest/v1/users?login=eq.${login}`, { headers });
        if (!resp.ok) throw new Error('Ошибка получения пользователя');
        const users = await resp.json();
        if (!users.length) throw new Error('Пользователь не найден');
        const user = users[0];

        return {
            login: user.login,
            secretWord: user.secret_word,
            name: user.name || '',
            avatar: user.avatar || '',
            description: user.description || '',
            fa_icon: user.fa_icon || ''
        };
    } catch (e) {
        console.error('Ошибка обмена тикета:', e);
        throw e;
    }
}

function loadUserApiKey(login) {
    return localStorage.getItem(`openrouter_key_${login}`) || '';
}
function saveUserApiKey(login, key) {
    localStorage.setItem(`openrouter_key_${login}`, key);
    userApiKey = key;
}

async function processDiamkeyReturn() {
    const urlParams = new URLSearchParams(window.location.search);
    const ticket = urlParams.get('ticket');
    if (!ticket) return false;
    try {
        const user = await exchangeTicket(ticket);
        currentUser = user;
        localStorage.setItem('diamond_user', JSON.stringify(user));
        userApiKey = loadUserApiKey(user.login);
        window.history.replaceState({}, document.title, window.location.pathname);
        return true;
    } catch (e) {
        showToast('Ошибка входа', e.message, 'error');
        return false;
    }
}

function logout() {
    currentUser = null;
    userApiKey = '';
    localStorage.removeItem('diamond_user');
    document.getElementById('mainUI').style.display = 'none';
    document.getElementById('choiceScreen').style.display = 'flex';
    setupDiamkeyButton();
    showToast('Вы вышли', '', 'info');
}

// ========== АВАТАРЫ (из DiamKey, без локального изменения) ==========
function getBotAvatarHTML() {
    const url = 'bot-av.ico';
    return `<img src="${url}" style="width:100%; height:100%; object-fit:cover; border-radius:50%;" onerror="this.style.display='none'; this.nextSibling?.style.display='flex';"><i class="fas fa-gem" style="display:none;"></i>`;
}
function getUserAvatarHTML() {
    if (currentUser && currentUser.avatar) return `<img src="${currentUser.avatar}" style="width:100%; height:100%; object-fit:cover; border-radius:50%;">`;
    if (currentUser && currentUser.fa_icon) return `<i class="${currentUser.fa_icon}"></i>`;
    return '<i class="fas fa-user"></i>';
}

function updateUserPanel() {
    const nameSpan = document.getElementById('userNameDisplay');
    const avatarImg = document.getElementById('userAvatarImg');
    if (currentUser) {
        if (nameSpan) {
            const icon = currentUser.fa_icon ? `<i class="${currentUser.fa_icon}" style="margin-right:6px;"></i>` : '';
            nameSpan.innerHTML = `${icon}${currentUser.name || currentUser.login}`;
        }
        if (avatarImg) avatarImg.src = currentUser.avatar || '';
    } else {
        if (nameSpan) nameSpan.textContent = 'Пользователь';
        if (avatarImg) avatarImg.src = '';
    }
}

// ========== ЧАТЫ ==========
function generateChatTitle(msg) { return msg.length > 50 ? msg.slice(0,47)+'...' : msg; }
function createNewChat() { renderEmptyState(); currentChatId = null; showToast('Новый диалог', 'Напишите сообщение', 'info'); }
function deleteChat(id) {
    chats = chats.filter(c => c.id !== id);
    if (currentChatId === id) currentChatId = chats.length ? chats[0].id : null;
    saveChats(); renderHistory(); renderChat();
    if (chats.length === 0) renderEmptyState();
}
function switchChat(id) { currentChatId = id; renderChat(); renderHistory(); }
function togglePin(id) {
    const chat = chats.find(c => c.id === id);
    if (chat) { chat.pinned = !chat.pinned; saveChats(); renderHistory(); showToast(chat.pinned ? 'Закреплён' : 'Откреплён', '', 'success'); }
}
function renameChat(id, newTitle) {
    const chat = chats.find(c => c.id === id);
    if (chat) { chat.title = newTitle; saveChats(); renderHistory(); showToast('Чат переименован', newTitle, 'success'); }
}
function showRenameModal(chatId) {
    const chat = chats.find(c => c.id === chatId);
    if (!chat) return;
    const modal = document.createElement('div'); modal.className = 'rename-modal'; modal.style.cssText = 'position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.8); backdrop-filter:blur(4px); display:flex; align-items:center; justify-content:center; z-index:2600;';
    const content = document.createElement('div'); content.style.cssText = 'background: var(--bg-secondary); border-radius: 28px; padding: 24px; width: 90%; max-width: 400px; border: 1px solid var(--border-color);';
    content.innerHTML = `<h3 style="margin-bottom:16px;">Переименовать чат</h3><input type="text" id="rename-input" value="${escapeHtml(chat.title)}" style="width:100%; padding:10px; background: var(--bg-tertiary); border:1px solid var(--border-color); border-radius: 20px; color: white; margin-bottom:20px;"><div style="display:flex; gap:12px;"><button id="rename-confirm" class="btn btn-primary">Сохранить</button><button id="rename-cancel" class="btn btn-secondary">Отмена</button></div>`;
    modal.appendChild(content); document.body.appendChild(modal);
    const input = content.querySelector('#rename-input'); input.focus();
    const close = () => modal.remove();
    content.querySelector('#rename-confirm').onclick = () => { const newName = input.value.trim(); if(newName) renameChat(chatId, newName); close(); };
    content.querySelector('#rename-cancel').onclick = close;
    input.onkeydown = (e) => { if(e.key === 'Enter') { const newName = input.value.trim(); if(newName) renameChat(chatId, newName); close(); } };
}

// ========== ПАПКИ ==========
function loadFolders() { const stored = localStorage.getItem('diamondFolders'); if(stored) folders = JSON.parse(stored); else folders = []; }
function createFolder(name, desc, icon, color) {
    folders.push({ id: Date.now().toString(), name: name.trim(), description: desc || '', icon: icon || 'fa-folder', color: color || '#95a5a6', createdAt: Date.now() });
    saveFolders(); renderFoldersPage(); showToast('Папка создана', name, 'success');
}
function updateFolder(id, name, desc, icon, color) {
    const f = folders.find(f => f.id === id);
    if (f) { f.name = name.trim(); f.description = desc||''; f.icon = icon||'fa-folder'; f.color = color||'#95a5a6'; saveFolders(); renderFoldersPage(); showToast('Папка обновлена', name, 'success'); }
}
function deleteFolder(id) {
    const f = folders.find(f => f.id === id);
    if (f && confirm('Удалить папку? Чаты будут перемещены в корень.')) {
        folders = folders.filter(f => f.id !== id);
        chats.forEach(c => { if (c.folderId === id) c.folderId = null; });
        saveFolders(); saveChats(); renderFoldersPage(); renderHistory();
        showToast('Папка удалена', f.name, 'info');
    }
}
function moveChatToFolder(chatId, folderId) {
    const chat = chats.find(c => c.id === chatId);
    if (chat) { chat.folderId = folderId; saveChats(); renderHistory(); renderFoldersPage(); showToast('Чат перемещён', folderId ? 'В папку' : 'Из папки', 'success'); }
}

function renderFoldersPage() {
    const container = document.getElementById('foldersListContainer');
    if (!container) return;
    if (folders.length === 0) {
        container.innerHTML = '<div style="text-align:center; padding:40px; color:var(--text-secondary);">У вас пока нет папок. Создайте первую!</div>';
        return;
    }
    container.innerHTML = folders.map(f => `
        <div class="folder-card" data-id="${f.id}">
            <div class="folder-icon" style="background:${f.color}20; color:${f.color}"><i class="fas ${f.icon}"></i></div>
            <div class="folder-info">
                <div class="folder-name"><span style="color:${f.color}">${escapeHtml(f.name)}</span></div>
                <div class="folder-description">${escapeHtml(f.description) || 'Нет описания'}</div>
                <div class="folder-stats">${chats.filter(c => c.folderId === f.id).length} чатов</div>
            </div>
            <div class="folder-actions">
                <button class="view-folder-chats" data-id="${f.id}" title="Чаты"><i class="fas fa-comments"></i></button>
                <button class="edit-folder" data-id="${f.id}" title="Редактировать"><i class="fas fa-edit"></i></button>
                <button class="delete-folder" data-id="${f.id}" title="Удалить"><i class="fas fa-trash"></i></button>
            </div>
        </div>
    `).join('');

    // клик по чатам в папке — сразу переключаемся и возвращаемся к чату
    document.querySelectorAll('.view-folder-chats').forEach(btn => btn.onclick = (e) => {
        e.stopPropagation();
        const id = btn.dataset.id;
        const folder = folders.find(f => f.id === id);
        if (folder) {
            const chatsIn = chats.filter(c => c.folderId === id);
            if (chatsIn.length > 0) {
                switchChat(chatsIn[0].id);      // открываем первый чат в папке
                switchToChatView();             // сразу уходим из папок в чат
                showToast('Чат открыт', `Папка: ${folder.name}`, 'success');
            } else {
                showToast('Пусто', 'В этой папке нет чатов', 'info');
            }
        }
    });

    document.querySelectorAll('.edit-folder').forEach(btn => btn.onclick = (e) => {
        e.stopPropagation();
        currentEditingFolderId = btn.dataset.id;
        const f = folders.find(f => f.id === currentEditingFolderId);
        document.getElementById('folder-edit-title').innerText = 'Редактировать папку';
        document.getElementById('folder-name').value = f.name;
        document.getElementById('folder-description').value = f.description || '';
        setupFoldersUI();
        document.getElementById('folder-edit-modal').style.display = 'flex';
    });

    document.querySelectorAll('.delete-folder').forEach(btn => btn.onclick = (e) => {
        e.stopPropagation();
        deleteFolder(btn.dataset.id);
    });
}

function showFolderSelectModal(chatId) {
    const modal = document.createElement('div'); modal.className = 'folder-modal-temp';
    modal.style.cssText = 'position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.8); backdrop-filter:blur(4px); display:flex; align-items:center; justify-content:center; z-index:2500;';
    const content = document.createElement('div');
    content.style.cssText = 'background: var(--bg-secondary); border-radius: 28px; padding: 20px; min-width: 300px; max-width: 420px; border:1px solid var(--border-color);';
    content.innerHTML = `
        <h3 style="margin-bottom:16px;">Выбрать папку</h3>
        <div style="max-height:300px; overflow-y:auto;" id="folder-options-list"></div>
        <button id="create-folder-from-select" style="margin-top:12px;" class="btn btn-secondary">+ Новая папка</button>
        <button id="close-folder-select" class="btn btn-secondary">Отмена</button>
    `;
    modal.appendChild(content); document.body.appendChild(modal);

    const listDiv = content.querySelector('#folder-options-list');
    listDiv.innerHTML = `<div class="folder-option" data-id=""><i class="fas fa-times-circle"></i> Без папки</div>` +
        folders.map(f => `<div class="folder-option" data-id="${f.id}"><i class="fas ${f.icon}" style="color:${f.color}"></i> ${escapeHtml(f.name)}</div>`).join('');
    listDiv.querySelectorAll('.folder-option').forEach(opt => opt.onclick = () => {
        moveChatToFolder(chatId, opt.dataset.id || null);
        modal.remove();
    });
    content.querySelector('#create-folder-from-select').onclick = () => { modal.remove(); switchToFoldersView(); };
    content.querySelector('#close-folder-select').onclick = () => modal.remove();
}

// ========== ИСТОРИЯ ==========
function getDateGroup(ts) {
    const d = new Date(ts).setHours(0,0,0,0);
    const t = new Date().setHours(0,0,0,0);
    if (d === t) return 'Сегодня';
    if (d === t - 86400000) return 'Вчера';
    return 'Более 2-х дней назад';
}
function renderHistory() {
    const list = document.getElementById('history-list');
    if (!list) return;
    const searchTerm = document.getElementById('history-search')?.value.toLowerCase() || '';
    let filtered = chats.filter(c => c.title.toLowerCase().includes(searchTerm));
    const groups = { 'Сегодня': [], 'Вчера': [], 'Более 2-х дней назад': [] };
    filtered.forEach(c => groups[getDateGroup(c.lastActivity || c.createdAt)].push(c));
    for (const g in groups) groups[g].sort((a,b) => (a.pinned === b.pinned ? 0 : a.pinned ? -1 : 1) || (b.lastActivity - a.lastActivity));

    let html = '';
    for (const g of ['Сегодня', 'Вчера', 'Более 2-х дней назад']) {
        if (!groups[g].length) continue;
        html += `<div class="history-group"><div class="history-group-title">${g}</div>`;
        groups[g].forEach(c => html += `
            <div class="history-item ${c.id === currentChatId ? 'active' : ''}" data-id="${c.id}">
                <span class="chat-title">${escapeHtml(c.title)}</span>
                <div class="chat-actions-hover">
                    <button class="chat-action-btn rename-chat-hover" data-id="${c.id}" title="Переименовать"><i class="fas fa-pencil-alt"></i></button>
                    <button class="chat-action-btn pin-chat-hover" data-id="${c.id}" title="${c.pinned ? 'Открепить' : 'Закрепить'}"><i class="fas fa-thumbtack ${c.pinned ? 'pinned' : ''}"></i></button>
                    <button class="chat-action-btn move-to-folder-hover" data-id="${c.id}" title="Переместить"><i class="fas fa-folder-open"></i></button>
                    <button class="chat-action-btn delete-chat-hover" data-id="${c.id}" title="Удалить"><i class="fas fa-trash"></i></button>
                </div>
            </div>
        `);
        html += '</div>';
    }
    list.innerHTML = html || '<div style="text-align:center; padding:20px;">Нет чатов</div>';

    document.querySelectorAll('.history-item').forEach(el => el.addEventListener('click', (e) => {
        if (!e.target.closest('.chat-actions-hover')) switchChat(el.dataset.id);
    }));
    document.querySelectorAll('.rename-chat-hover').forEach(btn => btn.onclick = (e) => { e.stopPropagation(); showRenameModal(btn.dataset.id); });
    document.querySelectorAll('.pin-chat-hover').forEach(btn => btn.onclick = (e) => { e.stopPropagation(); togglePin(btn.dataset.id); });
    document.querySelectorAll('.delete-chat-hover').forEach(btn => btn.onclick = (e) => { e.stopPropagation(); deleteChat(btn.dataset.id); });
    document.querySelectorAll('.move-to-folder-hover').forEach(btn => btn.onclick = (e) => { e.stopPropagation(); showFolderSelectModal(btn.dataset.id); });
}

// ========== РЕНДЕР ЧАТА ==========
function renderChat() {
    const chat = chats.find(c => c.id === currentChatId);
    if (!chat || !chat.messages || chat.messages.length === 0) { renderEmptyState(); return; }
    document.getElementById('inputArea').style.display = 'flex';
    const container = document.getElementById('messages-container');
    container.innerHTML = '';
    let lastDate = null;
    chat.messages.forEach((msg) => {
        const date = new Date(msg.timestamp || chat.createdAt).toDateString();
        if (date !== lastDate) {
            container.innerHTML += `<div class="date-divider"><span>${formatDateHeader(msg.timestamp || chat.createdAt)}</span></div>`;
            lastDate = date;
        }
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${msg.role}`;
        if (msg.isTyping) messageDiv.classList.add('typing');
        const avatarHTML = msg.role === 'user' ? getUserAvatarHTML() : getBotAvatarHTML();
        const rawContent = msg.role === 'assistant' ? DOMPurify.sanitize(marked.parse(msg.content)) : escapeHtml(msg.content);
        messageDiv.innerHTML = `
            <div class="avatar">${avatarHTML}</div>
            <div class="message-content-wrapper">
                <div class="message-content">${rawContent}</div>
                <div class="message-time">${formatTime(msg.timestamp || Date.now())}</div>
            </div>`;
        if (msg.role === 'assistant' && msg.id !== currentStreamingMessageId && !msg.isTyping) {
            const actions = document.createElement('div');
            actions.className = 'message-actions';
            const copyBtn = document.createElement('button');
            copyBtn.className = 'action-btn';
            copyBtn.innerHTML = '<i class="fas fa-copy"></i>';
            copyBtn.title = 'Копировать';
            copyBtn.onclick = () => {
                navigator.clipboard.writeText(msg.content);
                copyBtn.innerHTML = '<i class="fas fa-check"></i>';
                setTimeout(() => copyBtn.innerHTML = '<i class="fas fa-copy"></i>', 1000);
            };
            const regenBtn = document.createElement('button');
            regenBtn.className = 'action-btn';
            regenBtn.innerHTML = '<i class="fas fa-sync-alt"></i>';
            regenBtn.title = 'Перегенерировать';
            regenBtn.onclick = () => regenerateResponse(msg);
            actions.appendChild(copyBtn);
            actions.appendChild(regenBtn);
            messageDiv.appendChild(actions);
        }
        container.appendChild(messageDiv);
    });
    scrollToBottom();
}
function formatDateHeader(ts) {
    const d = new Date(ts);
    const t = new Date();
    const y = new Date(t);
    y.setDate(y.getDate() - 1);
    if (d.toDateString() === t.toDateString()) return 'Сегодня';
    if (d.toDateString() === y.toDateString()) return 'Вчера';
    return d.toLocaleDateString('ru-RU');
}
function formatTime(ts) { return new Date(ts).toLocaleTimeString('ru-RU', { hour:'2-digit', minute:'2-digit' }); }

function addMessageToDOM(role, content, save = true) {
    const timestamp = Date.now();
    const messageId = timestamp + Math.random();
    if (save) {
        const chat = chats.find(c => c.id === currentChatId);
        if (chat) {
            if (!chat.messages) chat.messages = [];
            chat.messages.push({ id: messageId, role, content, timestamp });
            chat.lastActivity = timestamp;
            if (role === 'user' && chat.messages.filter(m => m.role === 'user').length === 1) chat.title = generateChatTitle(content);
            saveChats();
        }
    }
    if (role === 'assistant' && save) currentStreamingMessageId = messageId;
    renderChat();
    return messageId;
}

// ========== ОТПРАВКА СООБЩЕНИЯ ==========
async function sendMessage() {
    const text = document.getElementById('user-input').value.trim();
    if (!text || isWaitingForResponse) return;
    if (!userApiKey) {
        showToast('Ошибка', 'Сначала введите API-ключ OpenRouter', 'warning');
        return;
    }

    let chat = chats.find(c => c.id === currentChatId);
    if (!chat || chat.messages.length === 0) {
        const now = Date.now();
        chat = { id: now.toString(), title: generateChatTitle(text), messages: [], createdAt: now, lastActivity: now, pinned: false, folderId: null };
        chats.unshift(chat);
        currentChatId = chat.id;
        saveChats();
        renderHistory();
        document.getElementById('inputArea').style.display = 'flex';
    }

    addMessageToDOM('user', text, true);
    document.getElementById('user-input').value = '';
    updateSendButtonState();
    isWaitingForResponse = true;
    updateSendButtonState();
    document.getElementById('stop-btn').style.display = 'flex';

    const typingId = Date.now().toString();
    chat.messages.push({ id: typingId, role: 'assistant', content: '...', isTyping: true });
    renderChat();
    scrollToBottom();

    const contextMessages = chat.messages.filter(m => !m.isTyping).slice(-15).map(m => ({ role: m.role, content: m.content }));
    const messages = [SYSTEM_PROMPT, ...contextMessages];
    const controller = new AbortController();
    currentAbortController = controller;
    let success = false;
    let assistantMessage = '';
    const modelsToTry = [...PRIORITY_MODELS];

    for (const model of modelsToTry) {
        if (success) break;
        try {
            const resp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${userApiKey}` },
                body: JSON.stringify({ model, messages, temperature: 0.5, max_tokens: 2000 }),
                signal: controller.signal
            });
            if (!resp.ok) continue;
            const data = await resp.json();
            assistantMessage = data.choices[0].message.content;
            success = true;
        } catch (e) {
            if (e.name === 'AbortError') break;
            console.warn('Model fail:', model, e);
        }
    }

    const msgIndex = chat.messages.findIndex(m => m.id === typingId);
    if (msgIndex !== -1) chat.messages.splice(msgIndex, 1);

    if (success) {
        addMessageToDOM('assistant', assistantMessage, true);
    } else {
        addMessageToDOM('assistant', '❌ Не удалось получить ответ. Проверьте ключ или повторите позже.', true);
    }

    isWaitingForResponse = false;
    currentAbortController = null;
    updateSendButtonState();
    document.getElementById('stop-btn').style.display = 'none';
    renderChat();
    scrollToBottom();
}

function stopGeneration() {
    if (currentAbortController) {
        currentAbortController.abort();
        showToast('Генерация остановлена', '', 'info');
    }
}

async function regenerateResponse(msg) {
    const chat = chats.find(c => c.id === currentChatId);
    if (!chat) return;
    const idx = chat.messages.findIndex(m => m === msg);
    if (idx !== -1) {
        chat.messages.splice(idx, 1);
        saveChats();
        renderChat();
    }
    const lastUser = [...chat.messages].reverse().find(m => m.role === 'user');
    if (lastUser) {
        document.getElementById('user-input').value = lastUser.content;
        sendMessage();
    }
}

// ========== ЭКРАН ВХОДА ==========
function setupDiamkeyButton() {
    const btn = document.getElementById('diamkeyLoginBtn');
    if (!btn) return;
    btn.onclick = () => {
        const redirect = encodeURIComponent(window.location.origin + window.location.pathname);
        const appName = encodeURIComponent('Diamond AI');
        window.location.href = `https://diamkey.ru/oauth.html?redirect=${redirect}&app=${appName}`;
    };
}

// ========== МОДАЛКА API-КЛЮЧА ==========
function setupApiKeyModal() {
    const saveBtn = document.getElementById('save-apikey-btn');
    const cancelBtn = document.getElementById('cancel-apikey-btn');
    const input = document.getElementById('apikey-input');
    if (saveBtn) {
        saveBtn.onclick = () => {
            const key = input.value.trim();
            if (!key) {
                showToast('Ошибка', 'Введите ключ', 'warning');
                return;
            }
            if (!currentUser) {
                showToast('Ошибка', 'Нет активного пользователя Diamkey', 'error');
                return;
            }
            saveUserApiKey(currentUser.login, key);
            document.getElementById('apikey-modal').style.display = 'none';
            showToast('Ключ сохранён', 'OpenRouter активирован', 'success');
        };
    }
    if (cancelBtn) cancelBtn.onclick = () => document.getElementById('apikey-modal').style.display = 'none';
    const closeBtn = document.getElementById('close-apikey-modal');
    if (closeBtn) closeBtn.onclick = () => document.getElementById('apikey-modal').style.display = 'none';
}

// ========== ВСПОМОГАТЕЛЬНЫЕ UI ==========
function updateSendButtonState() {
    const btn = document.getElementById('send-btn');
    const input = document.getElementById('user-input');
    if (btn) btn.disabled = !input.value.trim() || isWaitingForResponse;
}
function switchToFoldersView() {
    currentView = 'folders';
    document.getElementById('chatView').style.display = 'none';
    document.getElementById('foldersPage').style.display = 'flex';
    document.getElementById('genhabPage').style.display = 'none';
    renderFoldersPage();
}
function switchToChatView() {
    if (placeholderInterval) clearInterval(placeholderInterval);
    currentView = 'chat';
    document.getElementById('chatView').style.display = 'flex';
    document.getElementById('foldersPage').style.display = 'none';
    document.getElementById('genhabPage').style.display = 'none';
    renderChat();
}
function toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    const titleBar = document.getElementById('titleBar');
    const collapsedActions = document.getElementById('collapsedActions');
    const isMobile = window.innerWidth <= 768;
    if (isMobile) {
        sidebar.classList.toggle('open');
    } else {
        sidebarCollapsed = !sidebarCollapsed;
        sidebar.classList.toggle('collapsed', sidebarCollapsed);
        if (titleBar) titleBar.classList.toggle('collapsed', sidebarCollapsed);
        if (collapsedActions) {
            collapsedActions.classList.toggle('show', sidebarCollapsed);
            // принудительно запускаем анимацию при показе
            if (sidebarCollapsed) {
                collapsedActions.style.animation = 'none';
                collapsedActions.offsetHeight; // рефлоу
                collapsedActions.style.animation = 'slideIn 0.3s ease forwards';
            }
        }
    }
}
window.addEventListener('resize', () => {
    const sidebar = document.getElementById('sidebar');
    const titleBar = document.getElementById('titleBar');
    const collapsedActions = document.getElementById('collapsedActions');
    if (window.innerWidth > 768) {
        sidebar.classList.remove('open');
        if (sidebarCollapsed) {
            sidebar.classList.add('collapsed');
            if (titleBar) titleBar.classList.add('collapsed');
            if (collapsedActions) collapsedActions.classList.add('show');
        } else {
            sidebar.classList.remove('collapsed');
            if (titleBar) titleBar.classList.remove('collapsed');
            if (collapsedActions) collapsedActions.classList.remove('show');
        }
    } else {
        sidebar.classList.remove('collapsed');
        if (titleBar) titleBar.classList.remove('collapsed');
        if (collapsedActions) collapsedActions.classList.remove('show');
    }
});

function setupFoldersUI() {
    const iconSel = document.getElementById('icon-selector');
    if (iconSel) {
        const icons = ['fa-folder', 'fa-folder-open', 'fa-book', 'fa-graduation-cap', 'fa-code', 'fa-music', 'fa-image', 'fa-video', 'fa-gamepad', 'fa-shopping-cart', 'fa-heart', 'fa-star', 'fa-rocket', 'fa-brain', 'fa-chart-line', 'fa-users', 'fa-calendar', 'fa-clock', 'fa-tag', 'fa-tasks'];
        iconSel.innerHTML = icons.map(icon => `<div class="icon-option" data-icon="${icon}"><i class="fas ${icon}"></i></div>`).join('');
        document.querySelectorAll('.icon-option').forEach(opt => opt.onclick = () => {
            document.querySelectorAll('.icon-option').forEach(o => o.classList.remove('selected'));
            opt.classList.add('selected');
        });
    }
    const colorSel = document.getElementById('color-selector');
    if (colorSel) {
        document.querySelectorAll('.color-option').forEach(opt => opt.onclick = () => {
            document.querySelectorAll('.color-option').forEach(o => o.classList.remove('selected'));
            opt.classList.add('selected');
        });
    }
}

// ========== ПУСТОЕ СОСТОЯНИЕ ==========
function renderEmptyState() {
    const container = document.getElementById('messages-container');
    container.innerHTML = `
        <div class="empty-state">
            <img src="fulco.ico" class="empty-logo" alt="Diamond AI">
            <div class="empty-text">Чем могу помочь?</div>
            <div class="empty-input-area">
                <div class="input-wrapper">
                    <textarea id="empty-input" placeholder="${placeholderTexts[0]}" rows="1"></textarea>
                    <button class="send-btn" id="empty-send-btn" disabled><i class="fas fa-arrow-up"></i></button>
                </div>
            </div>
        </div>`;
    document.getElementById('inputArea').style.display = 'none';
    const emptyInput = document.getElementById('empty-input');
    const emptySendBtn = document.getElementById('empty-send-btn');
    if (emptyInput) {
        if (placeholderInterval) clearInterval(placeholderInterval);
        let idx = 0;
        emptyInput.placeholder = placeholderTexts[0];
        placeholderInterval = setInterval(() => {
            if (document.activeElement !== emptyInput) {
                emptyInput.style.opacity = '0.5';
                setTimeout(() => {
                    idx = (idx + 1) % placeholderTexts.length;
                    emptyInput.placeholder = placeholderTexts[idx];
                    emptyInput.style.opacity = '1';
                }, 200);
            }
        }, 3000);
        emptyInput.oninput = function() {
            emptySendBtn.disabled = !this.value.trim();
            this.style.height = 'auto';
            this.style.height = Math.min(this.scrollHeight, 120) + 'px';
        };
        emptyInput.onkeydown = e => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                if (emptySendBtn && !emptySendBtn.disabled) sendMessageFromEmpty(emptyInput.value);
            }
        };
        emptySendBtn.onclick = () => { if (emptyInput.value.trim()) sendMessageFromEmpty(emptyInput.value); };
    }
}
function sendMessageFromEmpty(text) {
    document.getElementById('user-input').value = text;
    sendMessage();
}

// ========== ЗАГРУЗОЧНЫЙ ЭКРАН (простой спиннер 2.5 сек) ==========
async function showLoadingScreen() {
    const ws = document.getElementById('welcomeScreen');
    ws.style.display = 'flex';
    await new Promise(r => setTimeout(r, 2500));
    ws.classList.add('fade-out');
    await new Promise(r => setTimeout(r, 400));
    ws.style.display = 'none';
}

// ========== ОБРАБОТЧИКИ СОБЫТИЙ ==========
function setupEventListeners() {
    window.onclick = e => {
        if (e.target === document.getElementById('avatar-modal')) document.getElementById('avatar-modal').style.display = 'none';
        if (e.target === document.getElementById('folder-edit-modal')) document.getElementById('folder-edit-modal').style.display = 'none';
        if (e.target === document.getElementById('folder-chats-modal')) document.getElementById('folder-chats-modal').style.display = 'none';
        if (e.target === document.getElementById('terms-modal')) document.getElementById('terms-modal').style.display = 'none';
        if (e.target === document.getElementById('privacy-modal')) document.getElementById('privacy-modal').style.display = 'none';
        if (e.target === document.getElementById('rename-user-modal')) document.getElementById('rename-user-modal').style.display = 'none';
    };

    document.getElementById('sidebarToggleBtn')?.addEventListener('click', toggleSidebar);
    document.getElementById('new-chat-btn')?.addEventListener('click', createNewChat);
    document.getElementById('folders-page-btn')?.addEventListener('click', switchToFoldersView);
    document.getElementById('genhab-page-btn')?.addEventListener('click', () => showToast('🔮 В разработке', 'ГенХаб появится в следующем обновлении', 'info', 4000));
    document.getElementById('collapsedNewChat')?.addEventListener('click', createNewChat);
    document.getElementById('collapsedFolders')?.addEventListener('click', switchToFoldersView);
    document.getElementById('collapsedGenhab')?.addEventListener('click', () => showToast('🔮 В разработке', 'ГенХаб появится в следующем обновлении', 'info', 4000));
    document.getElementById('back-to-chat-from-folders')?.addEventListener('click', switchToChatView);
    document.getElementById('create-folder-page-btn')?.addEventListener('click', () => {
        currentEditingFolderId = null;
        document.getElementById('folder-edit-title').innerText = 'Создать папку';
        document.getElementById('folder-name').value = '';
        document.getElementById('folder-description').value = '';
        setupFoldersUI();
        document.getElementById('folder-edit-modal').style.display = 'flex';
    });
    document.getElementById('save-folder-btn')?.addEventListener('click', () => {
        const name = document.getElementById('folder-name').value.trim();
        if (!name) { showToast('Ошибка', 'Введите название', 'warning'); return; }
        const desc = document.getElementById('folder-description').value;
        const selectedIcon = document.querySelector('.icon-option.selected');
        const icon = selectedIcon ? selectedIcon.dataset.icon : 'fa-folder';
        const selectedColor = document.querySelector('.color-option.selected');
        const color = selectedColor ? selectedColor.dataset.color : '#95a5a6';
        if (currentEditingFolderId) updateFolder(currentEditingFolderId, name, desc, icon, color);
        else createFolder(name, desc, icon, color);
        document.getElementById('folder-edit-modal').style.display = 'none';
        currentEditingFolderId = null;
    });
    document.getElementById('cancel-folder-edit-btn')?.addEventListener('click', () => document.getElementById('folder-edit-modal').style.display = 'none');
    document.getElementById('close-folder-edit-modal')?.addEventListener('click', () => document.getElementById('folder-edit-modal').style.display = 'none');
    document.getElementById('close-folder-chats-modal')?.addEventListener('click', () => document.getElementById('folder-chats-modal').style.display = 'none');
    document.getElementById('user-input')?.addEventListener('input', function() {
        this.style.height = 'auto';
        this.style.height = this.scrollHeight + 'px';
        updateSendButtonState();
    });
    document.getElementById('user-input')?.addEventListener('keydown', e => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
    });
    document.getElementById('send-btn')?.addEventListener('click', sendMessage);
    document.getElementById('history-search')?.addEventListener('input', renderHistory);

    document.getElementById('dropdown-discord')?.addEventListener('click', () => window.open('https://discord.gg/diamondshop', '_blank'));
    document.getElementById('dropdown-terms')?.addEventListener('click', () => document.getElementById('terms-modal').style.display = 'flex');
    document.getElementById('dropdown-privacy')?.addEventListener('click', () => document.getElementById('privacy-modal').style.display = 'flex');
    document.getElementById('dropdown-logout')?.addEventListener('click', logout);
    document.getElementById('close-terms-modal')?.addEventListener('click', () => document.getElementById('terms-modal').style.display = 'none');
    document.getElementById('close-privacy-modal')?.addEventListener('click', () => document.getElementById('privacy-modal').style.display = 'none');
    document.getElementById('close-terms-btn')?.addEventListener('click', () => document.getElementById('terms-modal').style.display = 'none');
    document.getElementById('close-privacy-btn')?.addEventListener('click', () => document.getElementById('privacy-modal').style.display = 'none');

    document.getElementById('userMenuBtn')?.addEventListener('click', (e) => {
        e.stopPropagation();
        document.getElementById('userDropdown').classList.toggle('show');
    });
    document.addEventListener('click', (e) => {
        if (!document.getElementById('userPanel')?.contains(e.target)) document.getElementById('userDropdown')?.classList.remove('show');
    });

    document.getElementById('stop-btn')?.addEventListener('click', stopGeneration);
    document.getElementById('dropdown-api-key')?.addEventListener('click', () => {
        document.getElementById('apikey-modal').style.display = 'flex';
        document.getElementById('apikey-input').value = userApiKey || '';
    });
}

// ========== ИНИЦИАЛИЗАЦИЯ ==========
(async function() {
    log('Загрузка...');
    loadFolders();
    const storedChats = localStorage.getItem('diamondChats');
    if (storedChats) chats = JSON.parse(storedChats);
    chats.forEach(c => { if (!c.messages) c.messages = []; if (!c.createdAt) c.createdAt = Date.now(); c.lastActivity = c.messages.length ? c.messages[c.messages.length - 1].timestamp : c.createdAt; });
    chats.sort((a, b) => b.lastActivity - a.lastActivity);
    if (chats.length) currentChatId = chats[0].id;

    await showLoadingScreen();

    const ticketProcessed = await processDiamkeyReturn();
    const savedUser = localStorage.getItem('diamond_user');
    if (!currentUser && savedUser) {
        currentUser = JSON.parse(savedUser);
        userApiKey = loadUserApiKey(currentUser.login);
    }
    if (currentUser && (ticketProcessed || !window.location.search.includes('ticket'))) {
        afterLogin();
    } else if (!currentUser) {
        document.getElementById('choiceScreen').style.display = 'flex';
        setupDiamkeyButton();
    }

    setupEventListeners();
    setupApiKeyModal();
    updateUserPanel();
    updateSendButtonState();
    if (chats.length) renderHistory();
    log('Готово');
})();

function afterLogin() {
    document.getElementById('choiceScreen').style.display = 'none';
    document.getElementById('mainUI').style.display = 'flex';
    setTimeout(() => document.getElementById('mainUI').classList.add('visible'), 50);
    updateUserPanel();
    if (chats.length === 0) renderEmptyState(); else renderChat();
    if (!userApiKey) {
        showToast('Введите API-ключ', 'OpenRouter ключ нужен для работы AI', 'warning', 5000);
    }
}
