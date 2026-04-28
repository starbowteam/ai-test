// ==================== WEB VERSION — DIAMOND AI ====================
// Состояние
let currentChatId = null;
let chats = [];
let folders = [];
let availableModels = [];
let lastSuccessfulModel = null;
let userApiKey = localStorage.getItem('diamond_api_key') || '';
let userKeyInfo = null;
let balanceCheckInterval = null;
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
let searchMode = localStorage.getItem('smartSearch') === 'true';
let placeholderIndex = 0;
const placeholderTexts = ["Какая сегодня погода?", "Как создать успешный проект?", "Расскажи новости за сегодня", "Кто такой Илон Маск?"];

const PRIORITY_MODELS = [
    'perplexity/pplx-70b-online',
    'you/you-7b',
    'arcee-ai/pony-alpha-7b:free',
    'stepfun/step-3.5-flash:free'
];

const FOLDER_ICONS = [
    'fa-folder', 'fa-folder-open', 'fa-book', 'fa-graduation-cap', 'fa-code',
    'fa-music', 'fa-image', 'fa-video', 'fa-gamepad', 'fa-shopping-cart',
    'fa-heart', 'fa-star', 'fa-rocket', 'fa-brain', 'fa-chart-line',
    'fa-users', 'fa-calendar', 'fa-clock', 'fa-tag', 'fa-tasks'
];

// Системный промпт с датой
const now = new Date();
const currentDateStr = now.toLocaleDateString('ru-RU', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
const SYSTEM_PROMPT = {
    role: 'system',
    content: `Ты — DIAMOND AI, абсолютный эксперт и идеальный собеседник. Создан компанией Diamond AI, работаешь на модели diamond-techo.vshpps. 
Сегодня: ${currentDateStr}. Ты умеешь искать в интернете (через модели perplexity/you) — если спрашивают новости, события, персон, используй свежие данные, не выдумывай.

📌 **Важное правило: отвечай максимально кратко и по делу**, если пользователь не просит развёрнутого объяснения. Длинные ответы пиши только по просьбе. Не трать время на лишнюю воду.

📚 **Ты знаешь**: химия, физика, математика, код — можешь использовать \ce{}, $$, тройные кавычки для кода.

🎭 **Стиль общения**:
- Если пользователь пишет серьёзно — режим **профессора**, но всё равно кратко.
- Если по‑пацански — **разговорный стиль**, но тоже ёмко.

**Правила оформления**:
- Химия: \ce{}.
- Математика: $$, \frac{}, \sqrt{}, \int.
- Код: в тройных кавычках с указанием языка.`
};

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

// API вызовы через CORS-прокси
const CORS_PROXY = 'https://corsproxy.io/?';
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

async function callOpenRouter(messages, model) {
    if (!userApiKey) throw new Error('No API key');
    const response = await fetch(CORS_PROXY + encodeURIComponent(OPENROUTER_URL), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${userApiKey}` },
        body: JSON.stringify({ model, messages, temperature: 0.5, max_tokens: 2000 })
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    return data.choices[0].message.content;
}

// Умный поиск (searchapi.io) с твоим ключом
const SEARCH_API_KEY = 'evmWBaS6HLKBsDYvk5kNnvyW';
async function searchWeb(query) {
    try {
        const url = `https://www.searchapi.io/api/v1/search?engine=google&q=${encodeURIComponent(query)}&api_key=${SEARCH_API_KEY}&num=5`;
        const response = await fetch(CORS_PROXY + encodeURIComponent(url));
        if (!response.ok) return [];
        const data = await response.json();
        const results = data.organic_results || [];
        return results.map(r => ({ title: r.title, snippet: r.snippet, link: r.link }));
    } catch(e) { return []; }
}

// ========== АВАТАРЫ ==========
function getBotAvatarHTML() {
    const url = 'https://media.discordapp.net/attachments/1462418981825810535/1483823480792158259/bot-av-light.png?ex=69c689cd&is=69c5384d&hm=65c2dcfdc314c45bc83dc45ecf074dcee02c0331d71fd3abd49b814d38d909dd&=&format=webp&quality=lossless&width=836&height=836';
    return `<img src="${url}" style="width:100%; height:100%; object-fit:cover; border-radius:50%;" onerror="this.style.display='none'; this.nextSibling?.style.display='flex';"><i class="fas fa-gem" style="display:none;"></i>`;
}
function getUserAvatarHTML() {
    if (userAvatarUrl) return `<img src="${userAvatarUrl}" style="width:100%; height:100%; object-fit:cover; border-radius:50%;">`;
    if (userAvatar.type === 'icon') return `<i class="fas ${userAvatar.value}"></i>`;
    if (userAvatar.type === 'custom' && userAvatar.dataUrl) return `<img src="${userAvatar.dataUrl}" style="width:100%; height:100%; object-fit:cover; border-radius:50%;">`;
    return '<i class="fas fa-user"></i>';
}

function updateUserPanel() {
    const nameSpan = document.getElementById('userNameDisplay');
    if (nameSpan) nameSpan.textContent = userName;
    const avatarContainer = document.querySelector('.user-avatar');
    if (!avatarContainer) return;
    avatarContainer.innerHTML = '';
    if (userAvatarUrl) {
        const img = document.createElement('img');
        img.src = userAvatarUrl;
        avatarContainer.appendChild(img);
    } else {
        const iconSpan = document.createElement('span');
        iconSpan.className = 'avatar-icon-fallback';
        iconSpan.innerHTML = `<i class="fas ${userAvatar.value}"></i>`;
        avatarContainer.appendChild(iconSpan);
    }
}
function setUserName(name) { userName = name; localStorage.setItem('userName', name); updateUserPanel(); showToast('Имя сохранено', name, 'success'); }
function setUserAvatarUrl(url) { userAvatarUrl = url; localStorage.setItem('userAvatarUrl', url); updateUserPanel(); renderChat(); showToast('Аватар обновлён', '', 'success'); }
function saveAvatar(avatarData) { localStorage.setItem('userAvatar', JSON.stringify(avatarData)); userAvatar = avatarData; renderChat(); updateUserPanel(); }

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
    content.innerHTML = `<h3 style="margin-bottom:16px;">Переименовать чат</h3><input type="text" id="rename-input" value="${escapeHtml(chat.title)}" style="width:100%; padding:10px; background: var(--bg-tertiary); border:1px solid var(--border-color); border-radius: 20px; color: white; margin-bottom:20px;"><div style="display:flex; gap:12px;"><button id="rename-confirm" class="btn-primary">Сохранить</button><button id="rename-cancel" class="btn-secondary">Отмена</button></div>`;
    modal.appendChild(content); document.body.appendChild(modal);
    const input = content.querySelector('#rename-input'); input.focus();
    const close = () => modal.remove();
    content.querySelector('#rename-confirm').onclick = () => { const newName = input.value.trim(); if(newName) renameChat(chatId, newName); close(); };
    content.querySelector('#rename-cancel').onclick = close;
    input.onkeydown = (e) => { if(e.key === 'Enter') { const newName = input.value.trim(); if(newName) renameChat(chatId, newName); close(); } };
}

// ========== ПАПКИ ==========
function loadFolders() { const stored = localStorage.getItem('diamondFolders'); if(stored) folders = JSON.parse(stored); else folders = []; }
function createFolder(name, desc, icon, color) { folders.push({ id: Date.now().toString(), name: name.trim(), description: desc || '', icon: icon || 'fa-folder', color: color || '#95a5a6', createdAt: Date.now() }); saveFolders(); renderFoldersPage(); showToast('Папка создана', name, 'success'); }
function updateFolder(id, name, desc, icon, color) { const f = folders.find(f=>f.id===id); if(f) { f.name = name.trim(); f.description = desc||''; f.icon = icon||'fa-folder'; f.color = color||'#95a5a6'; saveFolders(); renderFoldersPage(); showToast('Папка обновлена', name, 'success'); } }
function deleteFolder(id) { const f = folders.find(f=>f.id===id); if(f && confirm('Удалить папку? Чаты будут перемещены в корень.')) { folders = folders.filter(f=>f.id!==id); chats.forEach(c=>{ if(c.folderId===id) c.folderId=null; }); saveFolders(); saveChats(); renderFoldersPage(); renderHistory(); showToast('Папка удалена', f.name, 'info'); } }
function moveChatToFolder(chatId, folderId) { const chat = chats.find(c=>c.id===chatId); if(chat) { chat.folderId = folderId; saveChats(); renderHistory(); renderFoldersPage(); showToast('Чат перемещён', folderId ? 'В папку' : 'Из папки', 'success'); } }

function renderFoldersPage() {
    const container = document.getElementById('foldersListContainer');
    if(!container) return;
    if(folders.length===0) { container.innerHTML = '<div style="text-align:center; padding:40px; color:var(--text-secondary);">У вас пока нет папок. Создайте первую!</div>'; return; }
    container.innerHTML = folders.map(f => `<div class="folder-card" data-id="${f.id}"><div class="folder-icon" style="background:${f.color}20; color:${f.color}"><i class="fas ${f.icon}"></i></div><div class="folder-info"><div class="folder-name"><span style="color:${f.color}">${escapeHtml(f.name)}</span></div><div class="folder-description">${escapeHtml(f.description) || 'Нет описания'}</div><div class="folder-stats">${chats.filter(c=>c.folderId===f.id).length} чатов</div></div><div class="folder-actions"><button class="view-folder-chats" data-id="${f.id}" title="Чаты"><i class="fas fa-comments"></i></button><button class="edit-folder" data-id="${f.id}" title="Редактировать"><i class="fas fa-edit"></i></button><button class="delete-folder" data-id="${f.id}" title="Удалить"><i class="fas fa-trash"></i></button></div></div>`).join('');
    document.querySelectorAll('.view-folder-chats').forEach(btn => btn.onclick = (e) => { e.stopPropagation(); const id = btn.dataset.id; const folder = folders.find(f=>f.id===id); if(folder){ const chatsIn = chats.filter(c=>c.folderId===id); document.getElementById('folder-chats-title').innerText = `Чаты в папке «${folder.name}»`; document.getElementById('folder-chats-list').innerHTML = chatsIn.length ? chatsIn.map(c=>`<div class="folder-chat-item" data-chat-id="${c.id}"><i class="fas fa-comment"></i> ${escapeHtml(c.title)}</div>`).join('') : '<div style="padding:20px;">Нет чатов</div>'; document.getElementById('folder-chats-modal').style.display = 'flex'; document.querySelectorAll('.folder-chat-item').forEach(it=>it.onclick = ()=>{ switchChat(it.dataset.chatId); document.getElementById('folder-chats-modal').style.display = 'none'; if(currentView==='folders') switchToChatView(); }); } });
    document.querySelectorAll('.edit-folder').forEach(btn => btn.onclick = (e) => { e.stopPropagation(); currentEditingFolderId = btn.dataset.id; const f = folders.find(f=>f.id===currentEditingFolderId); document.getElementById('folder-edit-title').innerText = 'Редактировать папку'; document.getElementById('folder-name').value = f.name; document.getElementById('folder-description').value = f.description||''; setupFoldersUI(); document.getElementById('folder-edit-modal').style.display = 'flex'; });
    document.querySelectorAll('.delete-folder').forEach(btn => btn.onclick = (e) => { e.stopPropagation(); deleteFolder(btn.dataset.id); });
}

// ========== ИСТОРИЯ ==========
function getDateGroup(ts) { const d = new Date(ts).setHours(0,0,0,0); const t = new Date().setHours(0,0,0,0); if(d===t) return 'Сегодня'; if(d===t-86400000) return 'Вчера'; return 'Более 2-х дней назад'; }
function renderHistory() {
    const list = document.getElementById('history-list'); if(!list) return;
    const searchTerm = document.getElementById('history-search')?.value.toLowerCase() || '';
    let filtered = chats.filter(c => c.title.toLowerCase().includes(searchTerm));
    const groups = { 'Сегодня': [], 'Вчера': [], 'Более 2-х дней назад': [] };
    filtered.forEach(c => groups[getDateGroup(c.lastActivity || c.createdAt)].push(c));
    for(const g in groups) groups[g].sort((a,b)=>(a.pinned===b.pinned?0:a.pinned?-1:1) || (b.lastActivity - a.lastActivity));
    let html = '';
    for(const g of ['Сегодня','Вчера','Более 2-х дней назад']) {
        if(!groups[g].length) continue;
        html += `<div class="history-group"><div class="history-group-title">${g}</div>`;
        groups[g].forEach(c => html += `<div class="history-item ${c.id===currentChatId?'active':''}" data-id="${c.id}"><span class="chat-title">${escapeHtml(c.title)}</span><div class="chat-actions-hover"><button class="chat-action-btn rename-chat-hover" data-id="${c.id}" title="Переименовать"><i class="fas fa-pencil-alt"></i></button><button class="chat-action-btn pin-chat-hover" data-id="${c.id}" title="${c.pinned?'Открепить':'Закрепить'}"><i class="fas fa-thumbtack ${c.pinned?'pinned':''}"></i></button><button class="chat-action-btn move-to-folder-hover" data-id="${c.id}" title="Переместить"><i class="fas fa-folder-open"></i></button><button class="chat-action-btn delete-chat-hover" data-id="${c.id}" title="Удалить"><i class="fas fa-trash"></i></button></div></div>`);
        html += '</div>';
    }
    list.innerHTML = html || '<div style="text-align:center; padding:20px;">Нет чатов</div>';
    document.querySelectorAll('.history-item').forEach(el => el.addEventListener('click', (e) => { if(!e.target.closest('.chat-actions-hover')) switchChat(el.dataset.id); }));
    document.querySelectorAll('.rename-chat-hover').forEach(btn => btn.onclick = (e) => { e.stopPropagation(); showRenameModal(btn.dataset.id); });
    document.querySelectorAll('.pin-chat-hover').forEach(btn => btn.onclick = (e) => { e.stopPropagation(); togglePin(btn.dataset.id); });
    document.querySelectorAll('.delete-chat-hover').forEach(btn => btn.onclick = (e) => { e.stopPropagation(); deleteChat(btn.dataset.id); });
    document.querySelectorAll('.move-to-folder-hover').forEach(btn => btn.onclick = (e) => { e.stopPropagation(); showFolderSelectModal(btn.dataset.id); });
}

function showFolderSelectModal(chatId) {
    const modal = document.createElement('div'); modal.className = 'folder-modal-temp'; modal.style.cssText = 'position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.8); backdrop-filter:blur(4px); display:flex; align-items:center; justify-content:center; z-index:2500;';
    const content = document.createElement('div'); content.style.cssText = 'background: var(--bg-secondary); border-radius: 28px; padding: 20px; min-width: 300px; max-width: 420px; border:1px solid var(--border-color);';
    content.innerHTML = `<h3 style="margin-bottom:16px;">Выбрать папку</h3><div style="max-height:300px; overflow-y:auto;" id="folder-options-list"></div><button id="create-folder-from-select" style="margin-top:12px;" class="btn-secondary">+ Новая папка</button><button id="close-folder-select" class="btn-secondary">Отмена</button>`;
    modal.appendChild(content); document.body.appendChild(modal);
    const listDiv = content.querySelector('#folder-options-list');
    listDiv.innerHTML = `<div class="folder-option" data-id=""><i class="fas fa-times-circle"></i> Без папки</div>` + folders.map(f => `<div class="folder-option" data-id="${f.id}"><i class="fas ${f.icon}" style="color:${f.color}"></i> ${escapeHtml(f.name)}</div>`).join('');
    listDiv.querySelectorAll('.folder-option').forEach(opt => opt.onclick = () => { moveChatToFolder(chatId, opt.dataset.id || null); modal.remove(); });
    content.querySelector('#create-folder-from-select').onclick = () => { modal.remove(); switchToFoldersView(); };
    content.querySelector('#close-folder-select').onclick = () => modal.remove();
}

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
        if(date !== lastDate) { container.innerHTML += `<div class="date-divider"><span>${formatDateHeader(msg.timestamp || chat.createdAt)}</span></div>`; lastDate = date; }
        const messageDiv = document.createElement('div'); messageDiv.className = `message ${msg.role}`;
        const avatarHTML = msg.role === 'user' ? getUserAvatarHTML() : getBotAvatarHTML();
        messageDiv.innerHTML = `<div class="avatar">${avatarHTML}</div><div class="message-content-wrapper"><div class="message-content">${msg.role === 'assistant' ? marked.parse(msg.content) : escapeHtml(msg.content)}</div><div class="message-time">${formatTime(msg.timestamp || Date.now())}</div></div>`;
        if(msg.role === 'assistant' && msg.id !== currentStreamingMessageId) {
            const actions = document.createElement('div'); actions.className = 'message-actions';
            const copyBtn = document.createElement('button'); copyBtn.className = 'action-btn'; copyBtn.innerHTML = '<i class="fas fa-copy"></i>'; copyBtn.title = 'Копировать'; copyBtn.onclick = () => { navigator.clipboard.writeText(msg.content); copyBtn.innerHTML = '<i class="fas fa-check"></i>'; setTimeout(()=>copyBtn.innerHTML='<i class="fas fa-copy"></i>',1000); };
            const regenBtn = document.createElement('button'); regenBtn.className = 'action-btn'; regenBtn.innerHTML = '<i class="fas fa-sync-alt"></i>'; regenBtn.title = 'Перегенерировать'; regenBtn.onclick = () => regenerateResponse(msg);
            actions.appendChild(copyBtn); actions.appendChild(regenBtn);
            messageDiv.appendChild(actions);
        }
        container.appendChild(messageDiv);
    });
    scrollToBottom();
}

function formatDateHeader(ts) { const d=new Date(ts); const t=new Date(); const y=new Date(t); y.setDate(y.getDate()-1); if(d.toDateString()===t.toDateString()) return 'Сегодня'; if(d.toDateString()===y.toDateString()) return 'Вчера'; return d.toLocaleDateString('ru-RU'); }
function formatTime(ts) { return new Date(ts).toLocaleTimeString('ru-RU', {hour:'2-digit', minute:'2-digit'}); }

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
            chats.sort((a,b)=>b.lastActivity - a.lastActivity);
        }
    }
    if(role==='assistant' && save) currentStreamingMessageId = messageId;
    renderChat();
    return messageId;
}

// ========== БАЛАНС ==========
async function checkKeyBalance(key) {
    try {
        const resp = await fetch(CORS_PROXY + encodeURIComponent('https://openrouter.ai/api/v1/auth/key'), { headers: { 'Authorization': `Bearer ${key}` } });
        if(!resp.ok) return false;
        const data = await resp.json();
        userKeyInfo = data;
        if(data.limit && data.usage) {
            const remaining = data.limit - data.usage;
            if(remaining <= 0) { showToast('Баланс исчерпан', 'Нужен новый ключ', 'error'); return false; }
            if(remaining < 1) showToast('Низкий баланс', `Осталось $${remaining.toFixed(2)}`, 'warning');
        }
        return true;
    } catch(e) { return false; }
}

// ========== ОТПРАВКА СООБЩЕНИЯ ==========
async function sendMessage() {
    const text = document.getElementById('user-input').value.trim();
    if(!text || isWaitingForResponse) return;
    if(!userApiKey) { showToast('Ошибка', 'Введите API-ключ в настройках', 'warning'); return; }
    let chat = chats.find(c=>c.id===currentChatId);
    if(!chat || chat.messages.length===0) {
        const now = Date.now();
        chat = { id: now.toString(), title: generateChatTitle(text), messages: [], createdAt: now, lastActivity: now, pinned: false, folderId: null };
        chats.unshift(chat);
        currentChatId = chat.id;
        saveChats();
        renderHistory();
        document.getElementById('inputArea').style.display = 'flex';
    }
    // Добавляем сообщение пользователя
    addMessageToDOM('user', text, true);
    document.getElementById('user-input').value = '';
    updateSendButtonState();
    isWaitingForResponse = true; updateSendButtonState();
    // Индикатор печати
    const typingId = Date.now().toString();
    chat.messages.push({ id: typingId, role: 'assistant', content: '...', isTyping: true });
    renderChat();
    scrollToBottom();
    // Контекст и поиск
    const contextMessages = chat.messages.filter(m=>!m.isTyping).slice(-15).map(m=>({role:m.role, content:m.content}));
    let searchContext = '';
    if(searchMode && /новости|сегодня|погода|актуальн|неделю|вчера|сейчас|последние события|кто такой|что произошло|адрес|телефон|где находится|как пройти|контакты|сайт/i.test(text)) {
        const results = await searchWeb(text);
        if(results.length) {
            searchContext = '\n\n[Информация из интернета]\n' + results.map(r=>`• ${r.title}: ${r.snippet}`).join('\n');
            showToast('Найдено в интернете', `${results.length} результатов`, 'info',2000);
        } else showToast('Ничего не найдено', 'Попробуйте изменить запрос', 'warning',2000);
    }
    const finalUserMessage = text + (searchContext ? `\n\nИспользуй эту информацию для ответа, если она релевантна.\n${searchContext}` : '');
    const messages = [SYSTEM_PROMPT, ...contextMessages, { role: 'user', content: finalUserMessage }];
    // Модели
    let modelsToTry = [...PRIORITY_MODELS];
    if(lastSuccessfulModel && PRIORITY_MODELS.includes(lastSuccessfulModel)) modelsToTry = [lastSuccessfulModel, ...PRIORITY_MODELS.filter(m=>m!==lastSuccessfulModel)];
    const controller = new AbortController(); currentAbortController = controller;
    let success = false, assistantMessage = '';
    for(const model of modelsToTry) {
        if(success) break;
        try {
            const resp = await fetch(CORS_PROXY + encodeURIComponent(OPENROUTER_URL), {
                method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${userApiKey}` },
                body: JSON.stringify({ model, messages, temperature: 0.5, max_tokens: 2000 }), signal: controller.signal
            });
            if(!resp.ok) continue;
            const data = await resp.json();
            assistantMessage = data.choices[0].message.content;
            lastSuccessfulModel = model;
            success = true;
        } catch(e) { console.warn(model, e); }
    }
    // Убираем индикатор печати
    const msgIndex = chat.messages.findIndex(m=>m.id===typingId);
    if(msgIndex!==-1) chat.messages.splice(msgIndex,1);
    if(success) addMessageToDOM('assistant', assistantMessage, true);
    else addMessageToDOM('assistant', 'Извините, сейчас проблемы с подключением к нейросети. Попробуйте ещё раз или проверьте API-ключ.', true);
    isWaitingForResponse = false; currentAbortController = null; updateSendButtonState();
    renderChat(); scrollToBottom();
}
async function regenerateResponse(msg) {
    const chat = chats.find(c=>c.id===currentChatId);
    if(!chat) return;
    const idx = chat.messages.findIndex(m=>m===msg);
    if(idx!==-1) { chat.messages.splice(idx,1); saveChats(); renderChat(); }
    const lastUser = [...chat.messages].reverse().find(m=>m.role==='user');
    if(lastUser) { document.getElementById('user-input').value = lastUser.content; sendMessage(); }
}
function createTypingIndicator() { /* не используется напрямую, его заменяет isTyping */ }

// ========== ЭКРАН ВХОДА И НАСТРОЙКИ ==========
function handleLogin(key) {
    userApiKey = key;
    localStorage.setItem('diamond_api_key', key);
    document.getElementById('choiceScreen').style.display = 'none';
    document.getElementById('mainUI').style.display = 'flex';
    setTimeout(()=>document.getElementById('mainUI').classList.add('visible'),50);
    if(chats.length===0) renderEmptyState(); else renderChat();
    showToast('Вход выполнен', 'Добро пожаловать!', 'success');
}
function setupChoiceScreen() {
    const optionBuiltIn = document.getElementById('optionBuiltIn');
    const optionOwnKey = document.getElementById('optionOwnKey');
    const backBtn = document.getElementById('backToOptionsBtn');
    const submitBtn = document.getElementById('submitApiKeyBtn');
    const apiInput = document.getElementById('apiKeyInput');
    const apiSection = document.getElementById('apiInputSection');
    if(!optionBuiltIn || !optionOwnKey) return;
    optionBuiltIn.onclick = () => { handleLogin('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'); };
    optionOwnKey.onclick = () => { document.querySelector('.options').style.display = 'none'; apiSection.classList.add('visible'); };
    backBtn.onclick = () => { document.querySelector('.options').style.display = 'flex'; apiSection.classList.remove('visible'); apiInput.value = ''; };
    submitBtn.onclick = async () => { const key = apiInput.value.trim(); if(!key) { showToast('Ошибка', 'Введите ключ', 'warning'); return; } const valid = await checkKeyBalance(key); if(valid) handleLogin(key); else showToast('Неверный ключ', 'Проверьте ключ', 'error'); };
    apiInput.onkeydown = e => { if(e.key === 'Enter') submitBtn.click(); };
}

// ========== ПУСТОЕ СОСТОЯНИЕ ==========
function renderEmptyState() {
    const container = document.getElementById('messages-container');
    container.innerHTML = `<div class="empty-state"><img src="https://media.discordapp.net/attachments/1223595469746475049/1486731730659446924/photo_2026-03-10_13-52-33-Photoroom.png?ex=69c69252&is=69c540d2&hm=df903140d31146c00e6792e26b6a7a472942fdf641ce51e0a2a40920a86db4ab&=&format=webp&quality=lossless&width=328&height=438" class="empty-logo"><div class="empty-text">Чем могу помочь?</div><div class="empty-input-area"><div class="input-wrapper"><textarea id="empty-input" placeholder="Введите свой запрос..." rows="1"></textarea><button class="send-btn" id="empty-send-btn" disabled><i class="fas fa-arrow-up"></i></button></div></div></div>`;
    document.getElementById('inputArea').style.display = 'none';
    const emptyInput = document.getElementById('empty-input');
    const emptySendBtn = document.getElementById('empty-send-btn');
    if(emptyInput) {
        if(placeholderInterval) clearInterval(placeholderInterval);
        let idx = 0; emptyInput.placeholder = placeholderTexts[0];
        placeholderInterval = setInterval(() => { if(document.activeElement !== emptyInput) { emptyInput.style.opacity = '0.5'; setTimeout(()=>{ idx = (idx+1)%placeholderTexts.length; emptyInput.placeholder = placeholderTexts[idx]; emptyInput.style.opacity = '1'; },150); } }, 3000);
        emptyInput.oninput = function() { emptySendBtn.disabled = !this.value.trim(); this.style.height = 'auto'; this.style.height = Math.min(this.scrollHeight,120)+'px'; };
        emptyInput.onkeydown = e => { if(e.key==='Enter' && !e.shiftKey) { e.preventDefault(); if(emptySendBtn && !emptySendBtn.disabled) sendMessageFromEmpty(emptyInput.value); } };
        emptySendBtn.onclick = () => { if(emptyInput.value.trim()) sendMessageFromEmpty(emptyInput.value); };
    }
}
function sendMessageFromEmpty(text) { document.getElementById('user-input').value = text; sendMessage(); }

// ========== ВСПОМОГАТЕЛЬНЫЕ UI ==========
function updateSendButtonState() {
    const btn = document.getElementById('send-btn');
    const input = document.getElementById('user-input');
    if(btn) btn.disabled = !input.value.trim() || isWaitingForResponse;
}
function switchToFoldersView() { currentView='folders'; document.getElementById('chatView').style.display='none'; document.getElementById('foldersPage').style.display='flex'; document.getElementById('genhabPage').style.display='none'; renderFoldersPage(); }
function switchToChatView() { if(placeholderInterval) clearInterval(placeholderInterval); currentView='chat'; document.getElementById('chatView').style.display='flex'; document.getElementById('foldersPage').style.display='none'; document.getElementById('genhabPage').style.display='none'; renderChat(); }
function toggleSidebar() { sidebarCollapsed = !sidebarCollapsed; const sidebar = document.getElementById('sidebar'); if(sidebarCollapsed) sidebar.classList.add('collapsed'); else sidebar.classList.remove('collapsed'); }
function updateLogoAndCollapsedButton() {}
function setupFoldersUI() {
    const iconSel = document.getElementById('icon-selector');
    if(iconSel) iconSel.innerHTML = FOLDER_ICONS.map(icon=>`<div class="icon-option" data-icon="${icon}"><i class="fas ${icon}"></i></div>`).join('');
    document.querySelectorAll('.icon-option').forEach(opt => opt.onclick = () => { document.querySelectorAll('.icon-option').forEach(o=>o.classList.remove('selected')); opt.classList.add('selected'); });
    const colorSel = document.getElementById('color-selector');
    if(colorSel) document.querySelectorAll('.color-option').forEach(opt => opt.onclick = () => { document.querySelectorAll('.color-option').forEach(o=>o.classList.remove('selected')); opt.classList.add('selected'); });
}
function setupEventListeners() {
    window.onclick = e => {
        if(e.target === document.getElementById('avatar-modal')) document.getElementById('avatar-modal').style.display = 'none';
        if(e.target === document.getElementById('folder-edit-modal')) document.getElementById('folder-edit-modal').style.display = 'none';
        if(e.target === document.getElementById('folder-chats-modal')) document.getElementById('folder-chats-modal').style.display = 'none';
        if(e.target === document.getElementById('terms-modal')) document.getElementById('terms-modal').style.display = 'none';
        if(e.target === document.getElementById('privacy-modal')) document.getElementById('privacy-modal').style.display = 'none';
        if(e.target === document.getElementById('rename-user-modal')) document.getElementById('rename-user-modal').style.display = 'none';
    };
    document.getElementById('sidebarToggleBtn')?.addEventListener('click', toggleSidebar);
    document.getElementById('expandSidebarBtn')?.addEventListener('click', ()=>{ if(sidebarCollapsed) toggleSidebar(); });
    document.getElementById('new-chat-btn')?.addEventListener('click', createNewChat);
    document.getElementById('newChatCollapsedBtn')?.addEventListener('click', createNewChat);
    document.getElementById('folders-page-btn')?.addEventListener('click', switchToFoldersView);
    document.getElementById('foldersCollapsedBtn')?.addEventListener('click', switchToFoldersView);
    document.getElementById('genhab-page-btn')?.addEventListener('click', ()=>showToast('🔮 В разработке', 'ГенХаб появится в следующем обновлении', 'info',4000));
    document.getElementById('genhabCollapsedBtn')?.addEventListener('click', ()=>showToast('🔮 В разработке', 'ГенХаб появится в следующем обновлении', 'info',4000));
    document.getElementById('back-to-chat-from-folders')?.addEventListener('click', switchToChatView);
    document.getElementById('create-folder-page-btn')?.addEventListener('click', ()=>{ currentEditingFolderId=null; document.getElementById('folder-edit-title').innerText='Создать папку'; document.getElementById('folder-name').value=''; document.getElementById('folder-description').value=''; setupFoldersUI(); document.getElementById('folder-edit-modal').style.display='flex'; });
    document.getElementById('save-folder-btn')?.addEventListener('click', ()=>{ const name = document.getElementById('folder-name').value.trim(); if(!name){ showToast('Ошибка','Введите название','warning'); return; } const desc = document.getElementById('folder-description').value; const selectedIcon = document.querySelector('.icon-option.selected'); const icon = selectedIcon ? selectedIcon.dataset.icon : 'fa-folder'; const selectedColor = document.querySelector('.color-option.selected'); const color = selectedColor ? selectedColor.dataset.color : '#95a5a6'; if(currentEditingFolderId) updateFolder(currentEditingFolderId, name, desc, icon, color); else createFolder(name, desc, icon, color); document.getElementById('folder-edit-modal').style.display='none'; currentEditingFolderId=null; });
    document.getElementById('cancel-folder-edit-btn')?.addEventListener('click', ()=>document.getElementById('folder-edit-modal').style.display='none');
    document.getElementById('close-folder-edit-modal')?.addEventListener('click', ()=>document.getElementById('folder-edit-modal').style.display='none');
    document.getElementById('close-folder-chats-modal')?.addEventListener('click', ()=>document.getElementById('folder-chats-modal').style.display='none');
    document.getElementById('user-input')?.addEventListener('input', function(){ this.style.height='auto'; this.style.height=this.scrollHeight+'px'; updateSendButtonState(); });
    document.getElementById('user-input')?.addEventListener('keydown', e => { if(e.key==='Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } });
    document.getElementById('send-btn')?.addEventListener('click', sendMessage);
    document.getElementById('history-search')?.addEventListener('input', renderHistory);
    document.getElementById('dropdown-discord')?.addEventListener('click', ()=>window.open('https://discord.gg/diamondshop','_blank'));
    document.getElementById('dropdown-terms')?.addEventListener('click', ()=>document.getElementById('terms-modal').style.display='flex');
    document.getElementById('dropdown-privacy')?.addEventListener('click', ()=>document.getElementById('privacy-modal').style.display='flex');
    document.getElementById('dropdown-logout')?.addEventListener('click', ()=>{ userApiKey=''; localStorage.removeItem('diamond_api_key'); document.getElementById('mainUI').style.display='none'; document.getElementById('choiceScreen').style.display='flex'; showToast('Вы вышли','','info'); });
    document.getElementById('close-terms-modal')?.addEventListener('click', ()=>document.getElementById('terms-modal').style.display='none');
    document.getElementById('close-privacy-modal')?.addEventListener('click', ()=>document.getElementById('privacy-modal').style.display='none');
    document.getElementById('close-terms-btn')?.addEventListener('click', ()=>document.getElementById('terms-modal').style.display='none');
    document.getElementById('close-privacy-btn')?.addEventListener('click', ()=>document.getElementById('privacy-modal').style.display='none');
    document.getElementById('userNameDisplay')?.addEventListener('click', ()=>{ document.getElementById('rename-user-input').value = userName; document.getElementById('rename-user-modal').style.display='flex'; });
    document.getElementById('close-rename-user-modal')?.addEventListener('click', ()=>document.getElementById('rename-user-modal').style.display='none');
    document.getElementById('rename-user-confirm')?.addEventListener('click', ()=>{ const newName = document.getElementById('rename-user-input').value.trim(); if(newName) setUserName(newName); document.getElementById('rename-user-modal').style.display='none'; });
    document.getElementById('rename-user-cancel')?.addEventListener('click', ()=>document.getElementById('rename-user-modal').style.display='none');
    document.getElementById('userMenuBtn')?.addEventListener('click', (e)=>{ e.stopPropagation(); document.getElementById('userDropdown').classList.toggle('show'); });
    document.addEventListener('click', (e)=>{ if(!document.getElementById('userPanel')?.contains(e.target)) document.getElementById('userDropdown')?.classList.remove('show'); });
    // Аватар
    const avatarContainer = document.querySelector('.user-avatar');
    if(avatarContainer) avatarContainer.onclick = () => { document.getElementById('avatar-modal').style.display='flex'; document.querySelectorAll('.avatar-icon').forEach(icon => { if(userAvatar.type==='icon' && userAvatar.value===icon.dataset.icon) icon.classList.add('selected'); else icon.classList.remove('selected'); }); };
    document.getElementById('close-avatar-modal')?.addEventListener('click', ()=>document.getElementById('avatar-modal').style.display='none');
    document.querySelectorAll('.avatar-icon').forEach(icon => icon.onclick = () => { saveAvatar({ type: 'icon', value: icon.dataset.icon }); setUserAvatarUrl(''); document.getElementById('avatar-modal').style.display='none'; });
    document.getElementById('upload-avatar-btn')?.addEventListener('click', ()=>{ const inp = document.createElement('input'); inp.type='file'; inp.accept='image/*'; inp.onchange = e => { const file = e.target.files[0]; if(file){ const reader = new FileReader(); reader.onload = ev => { const dataUrl = ev.target.result; saveAvatar({ type: 'custom', dataUrl, fileName: file.name }); setUserAvatarUrl(dataUrl); document.getElementById('avatar-modal').style.display='none'; }; reader.readAsDataURL(file); } }; inp.click(); });
    document.getElementById('reset-avatar-btn')?.addEventListener('click', ()=>{ saveAvatar({ type: 'icon', value: 'fa-user' }); setUserAvatarUrl(''); document.getElementById('avatar-modal').style.display='none'; });
    
    // Кнопка умного поиска в поле ввода
    const inputWrapper = document.querySelector('.input-wrapper');
    if(inputWrapper && !document.querySelector('.search-mode-btn')) {
        const searchBtn = document.createElement('button');
        searchBtn.className = 'search-mode-btn';
        searchBtn.innerHTML = '<i class="fas fa-globe"></i>';
        searchBtn.title = 'Умный поиск (интернет)';
        const sendBtnEl = inputWrapper.querySelector('.send-btn');
        if(sendBtnEl) inputWrapper.insertBefore(searchBtn, sendBtnEl); else inputWrapper.appendChild(searchBtn);
        searchBtn.onclick = () => { searchMode = !searchMode; localStorage.setItem('smartSearch', searchMode); searchBtn.classList.toggle('active', searchMode); showToast(searchMode ? 'Умный поиск включён' : 'Умный поиск выключен', '', 'info',2000); };
        if(searchMode) searchBtn.classList.add('active');
    }
}

// ========== ЗАГРУЗОЧНЫЙ ЭКРАН ==========
async function showLoadingScreen() {
    const ws = document.getElementById('welcomeScreen'); ws.style.display='flex';
    const loadingStatus = document.getElementById('loadingStatus');
    const loadingBar = document.getElementById('loadingBar');
    const statuses = ["Загрузка нейросети...","Активация кристаллов...","Калибровка ответов...","Запуск DIAMOND AI..."];
    let idx=0, progress=0;
    const si = setInterval(() => { idx=(idx+1)%statuses.length; if(loadingStatus) loadingStatus.textContent=statuses[idx]; },1500);
    const pi = setInterval(() => { progress+=1; if(loadingBar) loadingBar.style.width=progress+'%'; if(progress>=100) clearInterval(pi); },70);
    setTimeout(()=>document.getElementById('loadingCharacter')?.classList.add('visible'),3000);
    await new Promise(r=>setTimeout(r,7000));
    clearInterval(si); clearInterval(pi);
    ws.classList.add('fade-out');
    await new Promise(r=>setTimeout(r,800));
    ws.style.display='none';
}

// ========== ИНИЦИАЛИЗАЦИЯ ==========
(async function() {
    log('Загрузка...');
    loadFolders();
    const storedChats = localStorage.getItem('diamondChats');
    if(storedChats) chats = JSON.parse(storedChats);
    chats.forEach(c => { if(!c.messages) c.messages=[]; if(!c.createdAt) c.createdAt=Date.now(); c.lastActivity = c.messages.length ? c.messages[c.messages.length-1].timestamp : c.createdAt; });
    chats.sort((a,b)=>b.lastActivity - a.lastActivity);
    if(chats.length) currentChatId = chats[0].id;
    const savedAvatar = localStorage.getItem('userAvatar');
    if(savedAvatar) userAvatar = JSON.parse(savedAvatar);
    userAvatarUrl = localStorage.getItem('userAvatarUrl') || '';
    userName = localStorage.getItem('userName') || 'Пользователь';
    searchMode = localStorage.getItem('smartSearch') === 'true';
    await showLoadingScreen();
    if(userApiKey) { const valid = await checkKeyBalance(userApiKey); if(valid) { document.getElementById('choiceScreen').style.display='none'; document.getElementById('mainUI').style.display='flex'; setTimeout(()=>document.getElementById('mainUI').classList.add('visible'),50); if(chats.length===0) renderEmptyState(); else renderChat(); } else { userApiKey=''; document.getElementById('choiceScreen').style.display='flex'; setupChoiceScreen(); } }
    else { document.getElementById('choiceScreen').style.display='flex'; setupChoiceScreen(); }
    updateUserPanel();
    setupEventListeners();
    updateSendButtonState();
    if(chats.length) renderHistory();
    log('Готово');
})();
