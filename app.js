// ==================== WEB VERSION — DIAMOND AI ====================
// Состояние
let currentChatId = null;
let chats = [];
let folders = [];
let userApiKey = localStorage.getItem('diamond_api_key') || '';
let isWaitingForResponse = false;
let currentAbortController = null;
let currentStreamingMessageId = null;
let lastNotificationTime = 0;
const NOTIFICATION_DEBOUNCE = 1000;
let userAvatar = { type: 'icon', value: 'fa-user' };
let userAvatarUrl = localStorage.getItem('userAvatarUrl') || '';
let userName = localStorage.getItem('userName') || 'Пользователь';
let sidebarCollapsed = false;
let currentEditingFolderId = null;
let currentView = 'chat';
let placeholderInterval = null;
let placeholderIndex = 0;
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

// Системный промпт (без поиска, только дата)
const now = new Date();
const currentDateStr = now.toLocaleDateString('ru-RU', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
const SYSTEM_PROMPT = {
    role: 'system',
    content: `Ты — DIAMOND AI, абсолютный эксперт и идеальный собеседник. Сегодня: ${currentDateStr}. Отвечай максимально кратко и по делу, если пользователь не просит подробностей. Ты знаешь химию, физику, математику, программирование. Используй \ce{}, $$, тройные кавычки для кода.`
};

// Модели для попыток (можно менять)
const PRIORITY_MODELS = [
    'openai/gpt-3.5-turbo',
    'anthropic/claude-3-haiku',
    'google/gemini-flash-1.5'
];

// Вспомогательные функции
function log(msg) { console.log(`[DIAMOND] ${msg}`); }

function escapeHtml(str) {
    return str.replace(/[&<>]/g, function(m) {
        if (m === '&') return '&amp;';
        if (m === '<') return '&lt;';
        if (m === '>') return '&gt;';
        return m;
    });
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

function saveChats() {
    localStorage.setItem('diamondChats', JSON.stringify(chats));
    renderHistory();
}
function saveFolders() { localStorage.setItem('diamondFolders', JSON.stringify(folders)); }

function scrollToBottom() {
    const container = document.getElementById('messages-container');
    if (container) container.scrollTop = container.scrollHeight;
}

// API вызов (прямой, без прокси)
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

async function callOpenRouter(messages, model) {
    if (!userApiKey) throw new Error('No API key');
    const response = await fetch(OPENROUTER_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${userApiKey}`
        },
        body: JSON.stringify({ model, messages, temperature: 0.5, max_tokens: 2000 })
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    return data.choices[0].message.content;
}

// ========== АВАТАРЫ ==========
function getBotAvatarHTML() {
    const url = 'assets/bot-av-light.png'; // замени на свой URL
    return `<img src="${url}" style="width:100%; height:100%; object-fit:cover; border-radius:50%;" onerror="this.style.display='none'; this.nextSibling?.style.display='flex';"><i class="fas fa-gem" style="display:none;"></i>`;
}
function getUserAvatarHTML() {
    if (userAvatarUrl) return `<img src="${userAvatarUrl}" style="width:100%; height:100%; object-fit:cover; border-radius:50%;">`;
    if (userAvatar.type === 'icon') return `<i class="fas ${userAvatar.value}"></i>`;
    if (userAvatar.type === 'custom' && userAvatar.dataUrl) return `<img src="${userAvatar.dataUrl}" style="width:100%; height:100%; object-fit:cover; border-radius:50%;">`;
    return '<i class="fas fa-user"></i>';
}
function updateUserPanel() { /* без изменений */ }
function setUserName(name) { userName = name; localStorage.setItem('userName', name); updateUserPanel(); showToast('Имя сохранено', name, 'success'); }
function setUserAvatarUrl(url) { userAvatarUrl = url; localStorage.setItem('userAvatarUrl', url); updateUserPanel(); renderChat(); showToast('Аватар обновлён', '', 'success'); }
function saveAvatar(avatarData) { localStorage.setItem('userAvatar', JSON.stringify(avatarData)); userAvatar = avatarData; renderChat(); updateUserPanel(); }

// ========== ЧАТЫ ==========
function generateChatTitle(msg) { return msg.length > 50 ? msg.slice(0,47)+'...' : msg; }
function createNewChat() { renderEmptyState(); currentChatId = null; showToast('Новый диалог', 'Напишите сообщение', 'info'); }
function deleteChat(id) { /* без изменений */ }
function switchChat(id) { currentChatId = id; renderChat(); renderHistory(); }
function togglePin(id) { /* без изменений */ }
function renameChat(id, newTitle) { /* без изменений */ }
function showRenameModal(chatId) { /* без изменений */ }

// ========== ПАПКИ ==========
function loadFolders() { /* без изменений */ }
function createFolder(name, desc, icon, color) { /* без изменений */ }
// ... остальные функции папок (полные версии из предыдущего кода)

// ========== ИСТОРИЯ ==========
function getDateGroup(ts) { /* без изменений */ }
function renderHistory() { /* без изменений */ }
function showFolderSelectModal(chatId) { /* без изменений */ }

// ========== РЕНДЕР ЧАТА ==========
function renderChat() {
    const chat = chats.find(c => c.id === currentChatId);
    if(!chat || !chat.messages || chat.messages.length===0) { renderEmptyState(); return; }
    document.getElementById('inputArea').style.display = 'flex';
    const container = document.getElementById('messages-container');
    container.innerHTML = '';
    let lastDate = null;
    chat.messages.forEach((msg, idx) => {
        const date = new Date(msg.timestamp || chat.createdAt).toDateString();
        if(date !== lastDate) {
            container.innerHTML += `<div class="date-divider"><span>${formatDateHeader(msg.timestamp || chat.createdAt)}</span></div>`;
            lastDate = date;
        }
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${msg.role}`;
        if(msg.isTyping) messageDiv.classList.add('typing');
        const avatarHTML = msg.role === 'user' ? getUserAvatarHTML() : getBotAvatarHTML();
        const contentHtml = msg.role === 'assistant' ? DOMPurify.sanitize(marked.parse(msg.content)) : escapeHtml(msg.content);
        messageDiv.innerHTML = `
            <div class="avatar">${avatarHTML}</div>
            <div class="message-content-wrapper">
                <div class="message-content">${contentHtml}</div>
                <div class="message-time">${formatTime(msg.timestamp || Date.now())}</div>
            </div>`;
        if(msg.role === 'assistant' && msg.id !== currentStreamingMessageId && !msg.isTyping) {
            const actions = document.createElement('div');
            actions.className = 'message-actions';
            const copyBtn = document.createElement('button');
            copyBtn.className = 'action-btn';
            copyBtn.innerHTML = '<i class="fas fa-copy"></i>';
            copyBtn.title = 'Копировать';
            copyBtn.onclick = () => {
                navigator.clipboard.writeText(msg.content);
                copyBtn.innerHTML = '<i class="fas fa-check"></i>';
                setTimeout(() => copyBtn.innerHTML='<i class="fas fa-copy"></i>', 1000);
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

function formatDateHeader(ts) { /* без изменений */ }
function formatTime(ts) { /* без изменений */ }

function addMessageToDOM(role, content, save=true) {
    const timestamp = Date.now();
    const messageId = timestamp+Math.random();
    if(save) {
        const chat = chats.find(c=>c.id===currentChatId);
        if(chat) {
            if(!chat.messages) chat.messages=[];
            chat.messages.push({id:messageId, role, content, timestamp});
            chat.lastActivity = timestamp;
            if(role==='user' && chat.messages.filter(m=>m.role==='user').length===1) chat.title = generateChatTitle(content);
            saveChats();
        }
    }
    if(role==='assistant' && save) currentStreamingMessageId = messageId;
    renderChat();
    return messageId;
}

// ========== БАЛАНС ==========
async function checkKeyBalance(key) {
    try {
        const resp = await fetch('https://openrouter.ai/api/v1/auth/key', {
            headers: { 'Authorization': `Bearer ${key}` }
        });
        if(!resp.ok) return false;
        const data = await resp.json();
        if(data.limit && data.usage) {
            const remaining = data.limit - data.usage;
            if(remaining <= 0) {
                showToast('Баланс исчерпан', 'Нужен новый ключ', 'error');
                return false;
            }
            if(remaining < 1) showToast('Низкий баланс', `Осталось $${remaining.toFixed(2)}`, 'warning');
        }
        return true;
    } catch(e) {
        return false;
    }
}

// ========== ОТПРАВКА СООБЩЕНИЯ ==========
async function sendMessage() {
    const text = document.getElementById('user-input').value.trim();
    if(!text || isWaitingForResponse) return;
    if(!userApiKey) {
        showToast('Ошибка', 'Введите API-ключ в настройках', 'warning');
        return;
    }
    let chat = chats.find(c=>c.id===currentChatId);
    if(!chat || chat.messages.length===0) {
        const now = Date.now();
        chat = {
            id: now.toString(),
            title: generateChatTitle(text),
            messages: [],
            createdAt: now,
            lastActivity: now,
            pinned: false,
            folderId: null
        };
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

    const contextMessages = chat.messages.filter(m=>!m.isTyping).slice(-15).map(m=>({role:m.role, content:m.content}));
    const messages = [SYSTEM_PROMPT, ...contextMessages];

    const controller = new AbortController();
    currentAbortController = controller;

    let assistantMessage = '';
    let success = false;
    const modelsToTry = [...PRIORITY_MODELS];

    for(const model of modelsToTry) {
        if(success) break;
        try {
            const resp = await fetch(OPENROUTER_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${userApiKey}`
                },
                body: JSON.stringify({ model, messages, temperature: 0.5, max_tokens: 2000 }),
                signal: controller.signal
            });
            if(!resp.ok) continue;
            const data = await resp.json();
            assistantMessage = data.choices[0].message.content;
            success = true;
        } catch(e) {
            if(e.name === 'AbortError') break;
            console.warn('Model fail:', model, e);
        }
    }

    const msgIndex = chat.messages.findIndex(m=>m.id===typingId);
    if(msgIndex !== -1) chat.messages.splice(msgIndex, 1);

    if(success) {
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
    if(currentAbortController) {
        currentAbortController.abort();
        showToast('Генерация остановлена', '', 'info');
    }
}

async function regenerateResponse(msg) {
    const chat = chats.find(c=>c.id===currentChatId);
    if(!chat) return;
    const idx = chat.messages.findIndex(m=>m===msg);
    if(idx!==-1) { chat.messages.splice(idx,1); saveChats(); renderChat(); }
    const lastUser = [...chat.messages].reverse().find(m=>m.role==='user');
    if(lastUser) {
        document.getElementById('user-input').value = lastUser.content;
        sendMessage();
    }
}

// ========== ЭКРАН ВХОДА ==========
function handleLogin(key) {
    userApiKey = key;
    localStorage.setItem('diamond_api_key', key);
    document.getElementById('choiceScreen').style.display = 'none';
    document.getElementById('mainUI').style.display = 'flex';
    setTimeout(()=>document.getElementById('mainUI').classList.add('visible'), 50);
    if(chats.length===0) renderEmptyState(); else renderChat();
    showToast('Вход выполнен', 'Добро пожаловать!', 'success');
}

function setupChoiceScreen() {
    const apiInput = document.getElementById('apiKeyInput');
    const submitBtn = document.getElementById('submitApiKeyBtn');
    submitBtn.onclick = async () => {
        const key = apiInput.value.trim();
        if(!key) { showToast('Ошибка', 'Введите ключ', 'warning'); return; }
        const valid = await checkKeyBalance(key);
        if(valid) handleLogin(key);
        else showToast('Неверный ключ', 'Проверьте ключ или баланс', 'error');
    };
    apiInput.onkeydown = e => { if(e.key === 'Enter') submitBtn.click(); };
}

// ========== ПУСТОЕ СОСТОЯНИЕ (с анимированным placeholder) ==========
function renderEmptyState() {
    const container = document.getElementById('messages-container');
    container.innerHTML = `
        <div class="empty-state">
            <img src="assets/photo_2026-03-10_13-52-33-Photoroom.png" class="empty-logo">
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
    if(emptyInput) {
        if(placeholderInterval) clearInterval(placeholderInterval);
        let idx = 0;
        emptyInput.placeholder = placeholderTexts[0];
        placeholderInterval = setInterval(() => {
            if(document.activeElement !== emptyInput) {
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
            if(e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                if(emptySendBtn && !emptySendBtn.disabled) sendMessageFromEmpty(emptyInput.value);
            }
        };
        emptySendBtn.onclick = () => { if(emptyInput.value.trim()) sendMessageFromEmpty(emptyInput.value); };
    }
}

function sendMessageFromEmpty(text) {
    document.getElementById('user-input').value = text;
    sendMessage();
}

// ========== ВСПОМОГАТЕЛЬНЫЕ UI ==========
function updateSendButtonState() {
    const btn = document.getElementById('send-btn');
    const input = document.getElementById('user-input');
    if(btn) btn.disabled = !input.value.trim() || isWaitingForResponse;
}

function switchToFoldersView() { /* без изменений */ }
function switchToChatView() {
    if(placeholderInterval) clearInterval(placeholderInterval);
    currentView='chat';
    document.getElementById('chatView').style.display='flex';
    document.getElementById('foldersPage').style.display='none';
    document.getElementById('genhabPage').style.display='none';
    renderChat();
}

function toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    const isMobile = window.innerWidth <= 768;
    if(isMobile) {
        sidebar.classList.toggle('open');
    } else {
        sidebarCollapsed = !sidebarCollapsed;
        sidebar.classList.toggle('collapsed', sidebarCollapsed);
    }
}

// Обработчик ресайза для авто-закрытия мобильного сайдбара
window.addEventListener('resize', () => {
    const sidebar = document.getElementById('sidebar');
    if(window.innerWidth > 768) {
        sidebar.classList.remove('open');
    } else {
        sidebar.classList.remove('collapsed'); // на мобильных убираем collapsed
    }
});

// ========== ИНИЦИАЛИЗАЦИЯ ==========
(async function() {
    log('Загрузка...');
    loadFolders();
    const storedChats = localStorage.getItem('diamondChats');
    if(storedChats) chats = JSON.parse(storedChats);
    chats.forEach(c => {
        if(!c.messages) c.messages=[];
        if(!c.createdAt) c.createdAt=Date.now();
        c.lastActivity = c.messages.length ? c.messages[c.messages.length-1].timestamp : c.createdAt;
    });
    chats.sort((a,b)=>b.lastActivity - a.lastActivity);
    if(chats.length) currentChatId = chats[0].id;
    const savedAvatar = localStorage.getItem('userAvatar');
    if(savedAvatar) userAvatar = JSON.parse(savedAvatar);
    userAvatarUrl = localStorage.getItem('userAvatarUrl') || '';
    userName = localStorage.getItem('userName') || 'Пользователь';
    await showLoadingScreen();
    if(userApiKey) {
        const valid = await checkKeyBalance(userApiKey);
        if(valid) {
            document.getElementById('choiceScreen').style.display='none';
            document.getElementById('mainUI').style.display='flex';
            setTimeout(()=>document.getElementById('mainUI').classList.add('visible'),50);
            if(chats.length===0) renderEmptyState(); else renderChat();
        } else {
            userApiKey='';
            document.getElementById('choiceScreen').style.display='flex';
            setupChoiceScreen();
        }
    } else {
        document.getElementById('choiceScreen').style.display='flex';
        setupChoiceScreen();
    }
    updateUserPanel();
    setupEventListeners();
    updateSendButtonState();
    if(chats.length) renderHistory();
    // Привязка кнопки Стоп
    document.getElementById('stop-btn').addEventListener('click', stopGeneration);
    log('Готово');
})();

function setupEventListeners() {
    // Все обработчики из оригинального кода (кнопки нового чата, папок, модалок и т.д.)
    // ... (вставляй полный набор из предыдущего app.js, но без search-mode-btn)
    // Кнопка Стоп уже добавлена выше
}

// Заглушка загрузочного экрана (без изменений)
async function showLoadingScreen() {
    // ... полный код как раньше
}
