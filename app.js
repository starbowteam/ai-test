// ==================== WEB VERSION — DIAMOND AI ====================
const SUPABASE_URL = 'https://pqgwrokpizeelfrjmgoc.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBxZ3dyb2twaXplZWxmcmptZ29jIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcxNTAyMDksImV4cCI6MjA5MjcyNjIwOX0.qtFCGBnpwdQbtmpwSZxI_hH3arq4HBAw62vs5h8WmAk';

// Состояние
let currentChatId = null;
let chats = [];
let folders = [];
let currentUser = null;
let mistralApiKey = '';
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
    "Что расскажешь о себе?",
    "Напиши формулу воды",
    "Кто такой viktorshopa?",
    "Реши уравнение x^2 - 5x + 6 = 0",
    "Что такое квантовая запутанность?"
];

const AI_MODEL = 'mistral-small-2506';
const now = new Date();
const currentDateStr = now.toLocaleDateString('ru-RU', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
const SYSTEM_PROMPT = {
    role: 'system',
    content: `Ты — Diamond AI, интеллектуальный помощник. Твой создатель — viktorshopa. Отвечай кратко и по делу, используй KaTeX-формат для формул: для выключных формул используй $$...$$, для встроенных \\(...\\). Химические формулы пиши через \\ce{}. Например: \\ce{NaOH + HCl -> NaCl + H2O}. Для корней используй \\sqrt{x}. Для дробей \\frac{a}{b}. Всегда оформляй код в тройные кавычки с указанием языка. Сегодня: ${currentDateStr}.`
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
    toast.innerHTML = `<div class="toast-content"><div class="toast-title">${escapeHtml(title)}</div><div class="toast-message">${escapeHtml(message)}</div></div><button class="toast-close"><i class="fas fa-times"></i></button>`;
    container.appendChild(toast);
    toast.querySelector('.toast-close').addEventListener('click', () => toast.remove());
    setTimeout(() => toast.remove(), duration);
}
function scrollToBottom() {
    const container = document.getElementById('messages-container');
    if (container) container.scrollTop = container.scrollHeight;
}

// ========== РЕНДЕР МАТЕМАТИКИ ==========
function renderMathInElement(element) {
    if (!element || typeof renderMathInElement === 'undefined') return;
    try {
        renderMathInElement(element, {
            delimiters: [
                {left: '$$', right: '$$', display: true},
                {left: '\\(', right: '\\)', display: false},
                {left: '\\[', right: '\\]', display: true}
            ],
            throwOnError: false,
            macros: { "\\ce": "\\ce" }
        });
    } catch(e) { console.warn('Math render error:', e); }
}

// ========== ОБРАБОТКА БЛОКОВ КОДА (копирование, скачивание, запуск) ==========
function enhanceCodeBlocks(container) {
    if (!container) return;
    const preBlocks = container.querySelectorAll('pre');
    preBlocks.forEach(pre => {
        if (pre.parentElement.classList.contains('code-block-wrapper')) return;
        const code = pre.querySelector('code');
        let language = '';
        if (code && code.className) {
            const match = code.className.match(/language-(\w+)/);
            if (match) language = match[1];
        }
        const wrapper = document.createElement('div');
        wrapper.className = 'code-block-wrapper';
        const header = document.createElement('div');
        header.className = 'code-block-header';
        header.innerHTML = `
            <span><i class="fas fa-code"></i> ${language || 'Скрипт'}</span>
            <div class="code-block-actions">
                <button class="copy-code-btn" title="Копировать"><i class="fas fa-copy"></i> Копировать</button>
                <button class="download-code-btn" title="Скачать"><i class="fas fa-download"></i> Скачать</button>
                <button class="run-code-btn" title="Запустить"><i class="fas fa-play"></i> Запустить</button>
            </div>
        `;
        pre.parentNode.insertBefore(wrapper, pre);
        wrapper.appendChild(header);
        wrapper.appendChild(pre);
        
        const copyBtn = wrapper.querySelector('.copy-code-btn');
        copyBtn.addEventListener('click', () => {
            const text = pre.textContent;
            navigator.clipboard.writeText(text).then(() => {
                copyBtn.innerHTML = '<i class="fas fa-check"></i> Скопировано';
                setTimeout(() => copyBtn.innerHTML = '<i class="fas fa-copy"></i> Копировать', 2000);
            });
        });
        
        const downloadBtn = wrapper.querySelector('.download-code-btn');
        downloadBtn.addEventListener('click', () => {
            const text = pre.textContent;
            const blob = new Blob([text], { type: 'text/plain' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${language || 'script'}.txt`;
            a.click();
            URL.revokeObjectURL(url);
        });
        
        const runBtn = wrapper.querySelector('.run-code-btn');
        runBtn.addEventListener('click', () => {
            const codeContent = pre.textContent;
            showCodeRunnerModal(codeContent, language);
        });
    });
}

// ========== МОДАЛКА ДЛЯ ЗАПУСКА КОДА ==========
function showCodeRunnerModal(code, language) {
    const modal = document.createElement('div');
    modal.className = 'code-runner-modal';
    modal.innerHTML = `
        <div class="modal-content" style="resize: both; overflow: auto; max-width: 90vw; max-height: 85vh;">
            <div class="modal-header">
                <h3><i class="fas fa-play"></i> Выполнить код (${language || 'текст'})</h3>
                <button class="close-modal"><i class="fas fa-times"></i></button>
            </div>
            <div class="modal-body">
                <textarea class="code-editor" rows="10" spellcheck="false">${escapeHtml(code)}</textarea>
                <div class="runner-output" style="margin-top: 16px;">
                    <iframe class="runner-iframe" style="width:100%; height:400px; border:1px solid var(--border-color); border-radius:16px; background:#fff;"></iframe>
                </div>
            </div>
            <div class="modal-footer">
                <button class="btn btn-primary run-execute"><i class="fas fa-play"></i> Выполнить</button>
                <button class="btn btn-secondary close-modal">Закрыть</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
    
    const editor = modal.querySelector('.code-editor');
    const iframe = modal.querySelector('.runner-iframe');
    const runExecute = modal.querySelector('.run-execute');
    
    function executeCode() {
        const newCode = editor.value;
        let htmlContent = newCode;
        if (!htmlContent.trim().toLowerCase().includes('<html')) {
            htmlContent = `<html><head><meta charset="UTF-8"><title>Run</title></head><body><pre>${escapeHtml(newCode)}</pre><script>${newCode}<\/script></body></html>`;
        }
        const blob = new Blob([htmlContent], { type: 'text/html' });
        const url = URL.createObjectURL(blob);
        iframe.src = url;
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
    
    runExecute.addEventListener('click', executeCode);
    modal.querySelectorAll('.close-modal').forEach(btn => btn.addEventListener('click', () => modal.remove()));
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
    executeCode(); // сразу запускаем
}

// ========== ИЗОЛИРОВАННОЕ ХРАНЕНИЕ ==========
function storageKey(base) {
    return currentUser ? `${base}_${currentUser.login}` : base;
}
function saveChats() {
    localStorage.setItem(storageKey('diamondChats'), JSON.stringify(chats));
    renderHistory();
}
function saveFolders() {
    localStorage.setItem(storageKey('diamondFolders'), JSON.stringify(folders));
}
function loadChatsForUser() {
    const stored = localStorage.getItem(storageKey('diamondChats'));
    if (stored) {
        chats = JSON.parse(stored);
        chats.forEach(c => {
            if (!c.messages) c.messages = [];
            if (!c.createdAt) c.createdAt = Date.now();
            c.lastActivity = c.messages.length ? c.messages[c.messages.length - 1].timestamp : c.createdAt;
        });
        chats.sort((a, b) => b.lastActivity - a.lastActivity);
        currentChatId = chats.length ? chats[0].id : null;
    } else {
        chats = [];
        currentChatId = null;
    }
    renderHistory();
}
function loadFoldersForUser() {
    const stored = localStorage.getItem(storageKey('diamondFolders'));
    folders = stored ? JSON.parse(stored) : [];
}

// ========== DIAMKEY AUTH ==========
async function exchangeTicket(ticket) {
    const headers = { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${SUPABASE_ANON_KEY}` };
    try {
        let resp = await fetch(`${SUPABASE_URL}/rest/v1/oauth_tickets?ticket=eq.${ticket}&used=eq.false`, { headers });
        if (!resp.ok) throw new Error('Ошибка поиска тикета');
        const tickets = await resp.json();
        if (!tickets.length) throw new Error('Тикет не найден');
        const ticketData = tickets[0];
        await fetch(`${SUPABASE_URL}/rest/v1/oauth_tickets?id=eq.${ticketData.id}`, {
            method: 'PATCH',
            headers: { ...headers, 'Content-Type': 'application/json' },
            body: JSON.stringify({ used: true })
        });
        const login = ticketData.login;
        resp = await fetch(`${SUPABASE_URL}/rest/v1/users?login=eq.${login}`, { headers });
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
    } catch (e) { throw e; }
}
async function fetchMistralKey() {
    try {
        const resp = await fetch(`${SUPABASE_URL}/rest/v1/service_config?id=eq.1`, {
            headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${SUPABASE_ANON_KEY}` }
        });
        if (!resp.ok) return false;
        const data = await resp.json();
        if (data && data.length > 0) {
            mistralApiKey = data[0].mistral_api_key;
            return true;
        }
        return false;
    } catch (e) { return false; }
}
async function processDiamkeyReturn() {
    const urlParams = new URLSearchParams(window.location.search);
    const ticket = urlParams.get('ticket');
    if (!ticket) return false;
    try {
        const user = await exchangeTicket(ticket);
        currentUser = user;
        localStorage.setItem('diamond_user', JSON.stringify(user));
        loadChatsForUser();
        loadFoldersForUser();
        window.history.replaceState({}, document.title, window.location.pathname);
        return true;
    } catch (e) { showToast('Ошибка входа', e.message, 'error'); return false; }
}
function logout() {
    currentUser = null;
    mistralApiKey = '';
    localStorage.removeItem('diamond_user');
    document.getElementById('mainUI').style.display = 'none';
    document.getElementById('choiceScreen').style.display = 'flex';
    setupDiamkeyButton();
}

// ========== АВАТАРЫ ==========
function getBotAvatarHTML() {
    return `<img src="fulco.ico" style="width:100%; height:100%; object-fit:cover; border-radius:50%;">`;
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
        nameSpan.innerHTML = `${currentUser.name || currentUser.login}`;
        avatarImg.src = currentUser.avatar || '';
    } else {
        nameSpan.textContent = 'Пользователь';
        avatarImg.src = '';
    }
}

// ========== ЧАТЫ ==========
function generateChatTitle(msg) { return msg.length > 50 ? msg.slice(0,47)+'...' : msg; }
function createNewChat() { renderEmptyState(); currentChatId = null; showToast('Новый диалог', '', 'info'); }
function deleteChat(id) {
    chats = chats.filter(c => c.id !== id);
    if (currentChatId === id) currentChatId = chats.length ? chats[0].id : null;
    saveChats(); renderHistory(); renderChat();
    if (chats.length === 0) renderEmptyState();
}
function switchChat(id) { currentChatId = id; renderChat(); renderHistory(); }
function togglePin(id) {
    const chat = chats.find(c => c.id === id);
    if (chat) { chat.pinned = !chat.pinned; saveChats(); renderHistory(); }
}
function renameChat(id, newTitle) {
    const chat = chats.find(c => c.id === id);
    if (chat) { chat.title = newTitle; saveChats(); renderHistory(); }
}
function showRenameModal(chatId) { /* стандартная модалка, опущена для краткости */ }

// ========== ПАПКИ (минимальная реализация) ==========
function showFolderSelectModal(chatId) { /* опущено */ }
function moveChatToFolder(chatId, folderId) { /* опущено */ }
function renderFoldersPage() { /* опущено */ }

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
}

// ========== РЕНДЕР ЧАТА С ПОДДЕРЖКОЙ LATEX ==========
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
        let contentHtml = msg.role === 'assistant' ? marked.parse(msg.content) : escapeHtml(msg.content);
        messageDiv.innerHTML = `
            <div class="avatar">${avatarHTML}</div>
            <div class="message-content-wrapper">
                <div class="message-content">${msg.isTyping ? 'Думает...' : contentHtml}</div>
                <div class="message-time">${formatTime(msg.timestamp || Date.now())}</div>
            </div>`;
        container.appendChild(messageDiv);
    });
    // Применяем LaTeX
    renderMathInElement(container);
    enhanceCodeBlocks(container);
    scrollToBottom();
}
function formatDateHeader(ts) {
    const d = new Date(ts);
    const t = new Date();
    if (d.toDateString() === t.toDateString()) return 'Сегодня';
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
            chat.messages.push({ id: messageId, role, content, timestamp, isTyping: false });
            chat.lastActivity = timestamp;
            if (role === 'user' && chat.messages.filter(m => m.role === 'user').length === 1) chat.title = generateChatTitle(content);
            saveChats();
        }
    }
    renderChat();
    return messageId;
}

// ========== СТРИМИНГ ОТВЕТОВ ==========
async function sendMessage() {
    const text = document.getElementById('user-input').value.trim();
    if (!text || isWaitingForResponse) return;
    if (!mistralApiKey) { showToast('Ошибка', 'API-ключ не загружен', 'error'); return; }
    
    let chat = chats.find(c => c.id === currentChatId);
    if (!chat || chat.messages.length === 0) {
        const now = Date.now();
        chat = { id: now.toString(), title: generateChatTitle(text), messages: [], createdAt: now, lastActivity: now, pinned: false };
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
    
    // Добавляем временное сообщение "Думает...")
    const thinkingId = Date.now().toString();
    chat.messages.push({ id: thinkingId, role: 'assistant', content: '', isTyping: true, timestamp: Date.now() });
    renderChat();
    scrollToBottom();
    
    const contextMessages = chat.messages.filter(m => !m.isTyping && m.role !== 'system').slice(-15).map(m => ({ role: m.role, content: m.content }));
    const messages = [SYSTEM_PROMPT, ...contextMessages];
    const controller = new AbortController();
    currentAbortController = controller;
    
    try {
        const response = await fetch('https://api.mistral.ai/v1/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${mistralApiKey}` },
            body: JSON.stringify({ model: AI_MODEL, messages, temperature: 0.5, max_tokens: 2000, stream: true }),
            signal: controller.signal
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let fullContent = '';
        let streamMessageId = null;
        let firstChunk = true;
        
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const chunk = decoder.decode(value);
            const lines = chunk.split('\n').filter(line => line.startsWith('data: '));
            for (const line of lines) {
                const data = line.slice(6);
                if (data === '[DONE]') continue;
                try {
                    const parsed = JSON.parse(data);
                    const token = parsed.choices[0].delta.content;
                    if (token) {
                        if (firstChunk) {
                            // Удаляем сообщение "Думает..."
                            const idx = chat.messages.findIndex(m => m.id === thinkingId);
                            if (idx !== -1) chat.messages.splice(idx, 1);
                            streamMessageId = Date.now().toString();
                            chat.messages.push({ id: streamMessageId, role: 'assistant', content: '', timestamp: Date.now(), isTyping: false });
                            firstChunk = false;
                        }
                        fullContent += token;
                        const msgObj = chat.messages.find(m => m.id === streamMessageId);
                        if (msgObj) msgObj.content = fullContent;
                        renderChat();
                        scrollToBottom();
                    }
                } catch(e) {}
            }
        }
        if (fullContent) {
            // финальное сохранение
            const finalIdx = chat.messages.findIndex(m => m.id === streamMessageId);
            if (finalIdx !== -1) chat.messages[finalIdx].content = fullContent;
            saveChats();
        } else {
            // если не пришло ни токена
            const idx = chat.messages.findIndex(m => m.id === thinkingId);
            if (idx !== -1) chat.messages.splice(idx, 1);
            addMessageToDOM('assistant', '❌ Пустой ответ от API', true);
        }
    } catch (e) {
        if (e.name !== 'AbortError') {
            const idx = chat.messages.findIndex(m => m.id === thinkingId);
            if (idx !== -1) chat.messages.splice(idx, 1);
            addMessageToDOM('assistant', '❌ Ошибка соединения с Mistral AI', true);
        }
    }
    isWaitingForResponse = false;
    currentAbortController = null;
    updateSendButtonState();
    renderChat();
}
function updateSendButtonState() {
    const btn = document.getElementById('send-btn');
    const input = document.getElementById('user-input');
    if (btn) btn.disabled = !input.value.trim() || isWaitingForResponse;
}

// ========== ЭКРАН ВХОДА ==========
function setupDiamkeyButton() {
    const btn = document.getElementById('diamkeyLoginBtn');
    if (!btn) return;
    btn.onclick = () => {
        const redirect = encodeURIComponent(window.location.origin + window.location.pathname);
        window.location.href = `https://diamkey.ru/oauth.html?redirect=${redirect}&app=Diamond%20AI`;
    };
}

// ========== ПУСТОЕ СОСТОЯНИЕ ==========
function renderEmptyState() {
    const container = document.getElementById('messages-container');
    container.innerHTML = `<div class="empty-state"><img src="fulco.ico" class="empty-logo"><div class="empty-text">Чем могу помочь?</div><div class="empty-input-area"><div class="input-wrapper"><textarea id="empty-input" placeholder="${placeholderTexts[0]}" rows="1"></textarea><button class="send-btn" id="empty-send-btn" disabled><i class="fas fa-arrow-up"></i></button></div></div></div>`;
    document.getElementById('inputArea').style.display = 'none';
    const emptyInput = document.getElementById('empty-input');
    const emptySendBtn = document.getElementById('empty-send-btn');
    if (emptyInput) {
        let idx = 0;
        setInterval(() => { if (document.activeElement !== emptyInput) { idx = (idx+1)%placeholderTexts.length; emptyInput.placeholder = placeholderTexts[idx]; } }, 3000);
        emptyInput.oninput = () => emptySendBtn.disabled = !emptyInput.value.trim();
        emptyInput.onkeydown = e => { if(e.key === 'Enter' && !e.shiftKey && emptyInput.value.trim()) { sendMessageFromEmpty(emptyInput.value); } };
        emptySendBtn.onclick = () => { if(emptyInput.value.trim()) sendMessageFromEmpty(emptyInput.value); };
    }
}
function sendMessageFromEmpty(text) { document.getElementById('user-input').value = text; sendMessage(); }

// ========== ЗАГРУЗКА И ИНИЦИАЛИЗАЦИЯ ==========
async function showLoadingScreen() {
    const ws = document.getElementById('welcomeScreen');
    ws.style.display = 'flex';
    await new Promise(r => setTimeout(r, 2000));
    ws.classList.add('fade-out');
    await new Promise(r => setTimeout(r, 300));
    ws.style.display = 'none';
}
function toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    const titleBar = document.getElementById('titleBar');
    const actions = document.getElementById('collapsedActions');
    if (window.innerWidth <= 768) {
        sidebar.classList.toggle('open');
    } else {
        sidebarCollapsed = !sidebarCollapsed;
        sidebar.classList.toggle('collapsed', sidebarCollapsed);
        titleBar.classList.toggle('collapsed', sidebarCollapsed);
        actions.classList.toggle('show', sidebarCollapsed);
    }
}
function switchToFoldersView() { /* заглушка */ }
function switchToChatView() { /* заглушка */ }

function setupEventListeners() {
    document.getElementById('sidebarToggleBtn')?.addEventListener('click', toggleSidebar);
    document.getElementById('new-chat-btn')?.addEventListener('click', createNewChat);
    document.getElementById('folders-page-btn')?.addEventListener('click', switchToFoldersView);
    document.getElementById('collapsedNewChat')?.addEventListener('click', createNewChat);
    document.getElementById('collapsedFolders')?.addEventListener('click', switchToFoldersView);
    document.getElementById('user-input')?.addEventListener('input', function() { this.style.height = 'auto'; this.style.height = Math.min(this.scrollHeight, 120) + 'px'; updateSendButtonState(); });
    document.getElementById('user-input')?.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } });
    document.getElementById('send-btn')?.addEventListener('click', sendMessage);
    document.getElementById('history-search')?.addEventListener('input', renderHistory);
    document.getElementById('dropdown-discord')?.addEventListener('click', () => window.open('https://discord.gg/diamondshop', '_blank'));
    document.getElementById('dropdown-logout')?.addEventListener('click', logout);
    document.getElementById('userMenuBtn')?.addEventListener('click', (e) => { e.stopPropagation(); document.getElementById('userDropdown').classList.toggle('show'); });
    document.addEventListener('click', (e) => { if (!document.getElementById('userPanel')?.contains(e.target)) document.getElementById('userDropdown')?.classList.remove('show'); });
    window.addEventListener('resize', () => {
        if (window.innerWidth > 768) document.getElementById('sidebar')?.classList.remove('open');
    });
}

(async function() {
    log('Загрузка...');
    await fetchMistralKey();
    const savedUser = localStorage.getItem('diamond_user');
    if (savedUser) { currentUser = JSON.parse(savedUser); loadChatsForUser(); loadFoldersForUser(); }
    await showLoadingScreen();
    const ticketProcessed = await processDiamkeyReturn();
    if (currentUser && (ticketProcessed || !window.location.search.includes('ticket'))) {
        document.getElementById('choiceScreen').style.display = 'none';
        document.getElementById('mainUI').style.display = 'flex';
        setTimeout(() => document.getElementById('mainUI').classList.add('visible'), 50);
        updateUserPanel();
        if (chats.length === 0) renderEmptyState(); else renderChat();
    } else {
        document.getElementById('choiceScreen').style.display = 'flex';
        setupDiamkeyButton();
    }
    setupEventListeners();
    updateSendButtonState();
    log('Готово');
})();
