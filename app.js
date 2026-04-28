// ==================== ГЛОБАЛЬНЫЕ ПЕРЕМЕННЫЕ ====================
let currentChatId = null;
let chats = [];
let folders = [];
let userApiKey = localStorage.getItem('openrouter_key') || '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';
let userAvatarUrl = localStorage.getItem('userAvatarUrl') || '';
let userName = localStorage.getItem('userName') || 'Пользователь';
let searchMode = localStorage.getItem('smartSearchEnabled') === 'true';
let currentLanguage = localStorage.getItem('appLanguage') || 'ru';
let isWaitingResponse = false;
let currentController = null;

// DOM элементы
const loginOverlay = document.getElementById('loginOverlay');
const appContainer = document.getElementById('app');
const messagesDiv = document.getElementById('messages');
const userInput = document.getElementById('userInput');
const sendBtn = document.getElementById('sendBtn');
const historyList = document.getElementById('historyList');
const searchHistoryInput = document.getElementById('searchHistory');
const userNameSpan = document.getElementById('userName');
const userAvatarDiv = document.getElementById('userAvatar');
const settingsModal = document.getElementById('settingsModal');
const foldersModal = document.getElementById('foldersModal');
const renameChatModal = document.getElementById('renameChatModal');
const folderEditModal = document.getElementById('folderEditModal');
const moveChatModal = document.getElementById('moveChatModal');
const toastContainer = document.getElementById('toastContainer');
const smartSearchToggle = document.getElementById('smartSearchToggle');
const languageSelect = document.getElementById('languageSelect');
const settingsApiKey = document.getElementById('settingsApiKey');
const saveApiKeyBtn = document.getElementById('saveApiKeyBtn');
const logoutBtn = document.getElementById('logoutBtn');
const foldersListDiv = document.getElementById('foldersList');
const createFolderBtn = document.getElementById('createFolderBtn');
const folderNameInput = document.getElementById('folderNameInput');
const folderDescInput = document.getElementById('folderDescInput');
const saveFolderBtn = document.getElementById('saveFolderBtn');
const folderEditTitle = document.getElementById('folderEditTitle');
const colorPalette = document.getElementById('colorPalette');
const renameChatInput = document.getElementById('renameChatInput');
const confirmRenameBtn = document.getElementById('confirmRenameBtn');
const folderSelectList = document.getElementById('folderSelectList');

let editingFolderId = null;
let pendingChatIdForMove = null;

// ==================== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ====================
function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerText = message;
    toastContainer.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
}

function saveAll() {
    localStorage.setItem('diamond_chats', JSON.stringify(chats));
    localStorage.setItem('diamond_folders', JSON.stringify(folders));
    localStorage.setItem('userName', userName);
    localStorage.setItem('userAvatarUrl', userAvatarUrl);
    localStorage.setItem('smartSearchEnabled', searchMode);
    localStorage.setItem('appLanguage', currentLanguage);
    if (userApiKey && userApiKey !== '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') {
        localStorage.setItem('openrouter_key', userApiKey);
    }
}

function loadData() {
    const storedChats = localStorage.getItem('diamond_chats');
    if (storedChats) chats = JSON.parse(storedChats);
    const storedFolders = localStorage.getItem('diamond_folders');
    if (storedFolders) folders = JSON.parse(storedFolders);
    const storedName = localStorage.getItem('userName');
    if (storedName) userName = storedName;
    const storedAvatar = localStorage.getItem('userAvatarUrl');
    if (storedAvatar) userAvatarUrl = storedAvatar;
    const storedSearch = localStorage.getItem('smartSearchEnabled');
    if (storedSearch !== null) searchMode = storedSearch === 'true';
    const storedLang = localStorage.getItem('appLanguage');
    if (storedLang) currentLanguage = storedLang;
    const storedKey = localStorage.getItem('openrouter_key');
    if (storedKey) userApiKey = storedKey;
    updateUserPanel();
    applyLanguage();
    if (smartSearchToggle) smartSearchToggle.checked = searchMode;
    if (languageSelect) languageSelect.value = currentLanguage;
    if (settingsApiKey) settingsApiKey.value = userApiKey === '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' ? '' : userApiKey;
}

function updateUserPanel() {
    userNameSpan.innerText = userName;
    if (userAvatarUrl) {
        userAvatarDiv.innerHTML = `<img src="${userAvatarUrl}" alt="avatar" style="width:100%; height:100%; object-fit:cover;">`;
    } else {
        userAvatarDiv.innerHTML = '<i class="fas fa-user"></i>';
    }
}

function applyLanguage() {
    // простейшая локализация для демо
    const t = {
        ru: { newChat: 'Новый чат', folders: 'Папки', settings: 'Настройки', search: 'Поиск...', send: 'Отправить' },
        en: { newChat: 'New chat', folders: 'Folders', settings: 'Settings', search: 'Search...', send: 'Send' }
    };
    const lang = currentLanguage;
    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        if (t[lang][key]) el.innerText = t[lang][key];
    });
}

// ==================== РАБОТА С ЧАТАМИ ====================
function renderHistory() {
    const searchTerm = searchHistoryInput.value.toLowerCase();
    let filtered = chats.filter(c => c.title.toLowerCase().includes(searchTerm));
    const groups = { today: [], yesterday: [], older: [] };
    const now = new Date();
    const todayStart = new Date(now.setHours(0,0,0,0)).getTime();
    const yesterdayStart = todayStart - 86400000;
    filtered.forEach(chat => {
        if (chat.lastActivity >= todayStart) groups.today.push(chat);
        else if (chat.lastActivity >= yesterdayStart) groups.yesterday.push(chat);
        else groups.older.push(chat);
    });
    let html = '';
    for (const [group, arr] of Object.entries(groups)) {
        if (arr.length === 0) continue;
        html += `<div class="history-group"><div class="history-group-title">${group}</div>`;
        arr.forEach(chat => {
            const active = chat.id === currentChatId ? 'active' : '';
            html += `
                <div class="history-item ${active}" data-id="${chat.id}">
                    <span class="chat-title">${escapeHtml(chat.title)}</span>
                    <div class="chat-actions">
                        <button class="rename-chat" data-id="${chat.id}"><i class="fas fa-pencil-alt"></i></button>
                        <button class="move-chat" data-id="${chat.id}"><i class="fas fa-folder-open"></i></button>
                        <button class="delete-chat" data-id="${chat.id}"><i class="fas fa-trash"></i></button>
                    </div>
                </div>
            `;
        });
        html += `</div>`;
    }
    historyList.innerHTML = html || '<div style="padding:20px;text-align:center;">Нет чатов</div>';
    document.querySelectorAll('.history-item').forEach(el => {
        el.addEventListener('click', (e) => {
            if (!e.target.closest('.chat-actions')) switchChat(el.dataset.id);
        });
    });
    document.querySelectorAll('.rename-chat').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const id = btn.dataset.id;
            const chat = chats.find(c => c.id === id);
            if (chat) {
                renameChatInput.value = chat.title;
                renameChatModal.style.display = 'flex';
                confirmRenameBtn.onclick = () => {
                    const newTitle = renameChatInput.value.trim();
                    if (newTitle) {
                        chat.title = newTitle;
                        saveAll();
                        renderHistory();
                        if (currentChatId === id) document.querySelector('.chat-header .chat-title').innerText = newTitle;
                    }
                    renameChatModal.style.display = 'none';
                };
            }
        });
    });
    document.querySelectorAll('.move-chat').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            pendingChatIdForMove = btn.dataset.id;
            renderFolderSelectList();
            moveChatModal.style.display = 'flex';
        });
    });
    document.querySelectorAll('.delete-chat').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (confirm('Удалить чат?')) {
                deleteChat(btn.dataset.id);
            }
        });
    });
}

function renderFolderSelectList() {
    const noFolder = { id: null, name: 'Без папки', icon: 'fa-times-circle', color: '#95a5a6' };
    const all = [noFolder, ...folders];
    folderSelectList.innerHTML = all.map(f => `
        <div class="folder-option" data-id="${f.id || ''}" style="display:flex; align-items:center; gap:12px; padding:8px; background:#0e121c; border-radius:20px; margin-bottom:8px; cursor:pointer;">
            <i class="fas ${f.icon}" style="color:${f.color}"></i> ${escapeHtml(f.name)}
        </div>
    `).join('');
    document.querySelectorAll('.folder-option').forEach(opt => {
        opt.addEventListener('click', () => {
            const folderId = opt.dataset.id === '' ? null : opt.dataset.id;
            const chat = chats.find(c => c.id === pendingChatIdForMove);
            if (chat) chat.folderId = folderId;
            saveAll();
            renderHistory();
            moveChatModal.style.display = 'none';
        });
    });
}

function switchChat(id) {
    currentChatId = id;
    renderChat();
    renderHistory();
    document.querySelector('.chat-header .chat-title').innerText = chats.find(c => c.id === id)?.title || 'DIAMOND AI';
}

function deleteChat(id) {
    chats = chats.filter(c => c.id !== id);
    if (currentChatId === id) {
        if (chats.length) currentChatId = chats[0].id;
        else currentChatId = null;
    }
    saveAll();
    if (currentChatId) renderChat();
    else renderEmptyChat();
    renderHistory();
}

function renderEmptyChat() {
    messagesDiv.innerHTML = `
        <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; height:100%; gap:20px;">
            <img src="https://media.discordapp.net/attachments/1457843805687648522/1487509991274319952/image.png?ex=69c96722&is=69c815a2&hm=848e7f70b25fdfae28b20afd32b117ba1e04bbb20cdb683fa32dfe47e5074626&=&format=webp&quality=lossless&width=836&height=836" style="width:80px;">
            <div>Начните диалог</div>
            <div class="input-wrapper" style="width:80%; max-width:400px;"><textarea id="emptyInput" placeholder="Введите запрос..." rows="1"></textarea><button id="emptySendBtn" class="send-btn"><i class="fas fa-arrow-up"></i></button></div>
        </div>
    `;
    const emptyInput = document.getElementById('emptyInput');
    const emptySend = document.getElementById('emptySendBtn');
    if (emptyInput && emptySend) {
        emptyInput.addEventListener('input', () => emptySend.disabled = !emptyInput.value.trim());
        emptySend.addEventListener('click', () => sendMessageFromEmpty(emptyInput.value));
    }
}

function sendMessageFromEmpty(text) {
    userInput.value = text;
    sendMessage();
}

function renderChat() {
    const chat = chats.find(c => c.id === currentChatId);
    if (!chat || !chat.messages?.length) {
        renderEmptyChat();
        return;
    }
    messagesDiv.innerHTML = '';
    let lastDate = null;
    chat.messages.forEach(msg => {
        const date = new Date(msg.timestamp).toDateString();
        if (date !== lastDate) {
            const divider = document.createElement('div');
            divider.className = 'date-divider';
            divider.innerText = date;
            messagesDiv.appendChild(divider);
            lastDate = date;
        }
        const msgDiv = document.createElement('div');
        msgDiv.className = `message ${msg.role}`;
        const avatar = document.createElement('div');
        avatar.className = 'avatar-message';
        avatar.innerHTML = msg.role === 'user' ? (userAvatarUrl ? `<img src="${userAvatarUrl}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">` : '<i class="fas fa-user"></i>') : '<i class="fas fa-gem"></i>';
        const bubble = document.createElement('div');
        bubble.className = 'bubble';
        if (msg.role === 'assistant' && typeof marked !== 'undefined') {
            bubble.innerHTML = marked.parse(msg.content);
        } else {
            bubble.innerText = msg.content;
        }
        msgDiv.appendChild(avatar);
        msgDiv.appendChild(bubble);
        messagesDiv.appendChild(msgDiv);
    });
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

async function sendMessage() {
    const text = userInput.value.trim();
    if (!text || isWaitingResponse) return;
    let chat = chats.find(c => c.id === currentChatId);
    if (!chat) {
        const newId = Date.now().toString();
        chat = { id: newId, title: text.slice(0,30), messages: [], createdAt: Date.now(), lastActivity: Date.now(), folderId: null };
        chats.unshift(chat);
        currentChatId = newId;
        saveAll();
        renderHistory();
    }
    const userMsg = { role: 'user', content: text, timestamp: Date.now() };
    chat.messages.push(userMsg);
    chat.lastActivity = Date.now();
    saveAll();
    renderChat();
    userInput.value = '';
    userInput.style.height = 'auto';
    isWaitingResponse = true;
    sendBtn.disabled = true;

    // Индикатор
    const typingDiv = document.createElement('div');
    typingDiv.className = 'message assistant';
    typingDiv.innerHTML = `<div class="avatar-message"><i class="fas fa-gem"></i></div><div class="bubble thinking">Думает <span class="dots"></span></div>`;
    messagesDiv.appendChild(typingDiv);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;

    let searchContext = '';
    if (searchMode && /новости|погода|сегодня|кто такой|что такое|address|weather|news|who is/i.test(text)) {
        try {
            const proxy = 'https://cors-anywhere.herokuapp.com/';
            const duckUrl = `https://api.duckduckgo.com/?q=${encodeURIComponent(text)}&format=json&no_html=1`;
            const res = await fetch(proxy + duckUrl);
            const data = await res.json();
            if (data.AbstractText) {
                searchContext = `\n\n[Информация из DuckDuckGo]: ${data.AbstractText}`;
            }
        } catch(e) { console.warn(e); }
    }

    const messagesForAPI = [
        { role: 'system', content: `Ты — Diamond AI, полезный ассистент. Отвечай кратко. Сегодня ${new Date().toLocaleDateString()}.` },
        ...chat.messages.slice(-10).map(m => ({ role: m.role, content: m.content })),
        { role: 'user', content: text + searchContext }
    ];

    currentController = new AbortController();
    try {
        const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${userApiKey}`,
                'Content-Type': 'application/json',
                'HTTP-Referer': window.location.origin,
                'X-Title': 'Diamond AI Web'
            },
            body: JSON.stringify({
                model: 'openai/gpt-3.5-turbo',
                messages: messagesForAPI,
                stream: false,
                temperature: 0.7
            }),
            signal: currentController.signal
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        const assistantMsg = data.choices[0]?.message?.content || 'Ошибка ответа';
        typingDiv.remove();
        chat.messages.push({ role: 'assistant', content: assistantMsg, timestamp: Date.now() });
        chat.lastActivity = Date.now();
        saveChats();
        renderChat();
    } catch (err) {
        typingDiv.remove();
        chat.messages.push({ role: 'assistant', content: 'Извините, произошла ошибка. Попробуйте позже.', timestamp: Date.now() });
        saveChats();
        renderChat();
        showToast('Ошибка соединения', 'error');
    }
    isWaitingResponse = false;
    sendBtn.disabled = false;
    currentController = null;
}

function saveChats() {
    localStorage.setItem('diamond_chats', JSON.stringify(chats));
}

// ==================== ПАПКИ ====================
function renderFoldersList() {
    foldersListDiv.innerHTML = folders.map(f => `
        <div class="folder-item" data-id="${f.id}">
            <span><i class="fas ${f.icon}" style="color:${f.color}"></i> ${escapeHtml(f.name)}</span>
            <div>
                <button class="edit-folder" data-id="${f.id}"><i class="fas fa-edit"></i></button>
                <button class="delete-folder" data-id="${f.id}"><i class="fas fa-trash"></i></button>
            </div>
        </div>
    `).join('');
    document.querySelectorAll('.edit-folder').forEach(btn => {
        btn.addEventListener('click', () => editFolder(btn.dataset.id));
    });
    document.querySelectorAll('.delete-folder').forEach(btn => {
        btn.addEventListener('click', () => {
            if (confirm('Удалить папку?')) {
                folders = folders.filter(f => f.id !== btn.dataset.id);
                chats.forEach(c => { if (c.folderId === btn.dataset.id) c.folderId = null; });
                saveAll();
                renderFoldersList();
                renderHistory();
            }
        });
    });
}

function editFolder(id) {
    const folder = folders.find(f => f.id === id);
    if (folder) {
        editingFolderId = id;
        folderEditTitle.innerText = 'Редактировать папку';
        folderNameInput.value = folder.name;
        folderDescInput.value = folder.description || '';
        document.querySelectorAll('.color-opt').forEach(opt => {
            if (opt.style.backgroundColor === folder.color) opt.classList.add('selected');
            else opt.classList.remove('selected');
        });
        folderEditModal.style.display = 'flex';
    }
}

createFolderBtn.onclick = () => {
    editingFolderId = null;
    folderEditTitle.innerText = 'Создать папку';
    folderNameInput.value = '';
    folderDescInput.value = '';
    document.querySelectorAll('.color-opt').forEach(opt => opt.classList.remove('selected'));
    folderEditModal.style.display = 'flex';
};

saveFolderBtn.onclick = () => {
    const name = folderNameInput.value.trim();
    if (!name) return showToast('Введите название', 'warning');
    const description = folderDescInput.value.trim();
    const selectedColor = document.querySelector('.color-opt.selected')?.style.backgroundColor || '#95a5a6';
    const icon = 'fa-folder';
    if (editingFolderId) {
        const f = folders.find(f => f.id === editingFolderId);
        if (f) {
            f.name = name;
            f.description = description;
            f.color = selectedColor;
        }
    } else {
        folders.push({ id: Date.now().toString(), name, description, icon, color: selectedColor, createdAt: Date.now() });
    }
    saveAll();
    renderFoldersList();
    renderHistory();
    folderEditModal.style.display = 'none';
};

// ==================== АВАТАР / ИМЯ ====================
userAvatarDiv.addEventListener('click', () => {
    const newName = prompt('Введите новое имя:', userName);
    if (newName && newName.trim()) {
        userName = newName.trim();
        saveAll();
        updateUserPanel();
    }
});
userNameSpan.addEventListener('click', () => {
    const newName = prompt('Введите новое имя:', userName);
    if (newName && newName.trim()) {
        userName = newName.trim();
        saveAll();
        updateUserPanel();
    }
});
// загрузка своей аватарки (через скрытый input)
const avatarFileInput = document.createElement('input');
avatarFileInput.type = 'file';
avatarFileInput.accept = 'image/*';
avatarFileInput.onchange = (e) => {
    const file = e.target.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = (ev) => {
            userAvatarUrl = ev.target.result;
            saveAll();
            updateUserPanel();
            renderChat();
        };
        reader.readAsDataURL(file);
    }
};
userAvatarDiv.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    avatarFileInput.click();
});

// ==================== НАСТРОЙКИ ====================
document.getElementById('settingsBtn').addEventListener('click', () => {
    settingsApiKey.value = userApiKey === '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' ? '' : userApiKey;
    smartSearchToggle.checked = searchMode;
    languageSelect.value = currentLanguage;
    settingsModal.style.display = 'flex';
});
saveApiKeyBtn.onclick = () => {
    const newKey = settingsApiKey.value.trim();
    if (newKey) userApiKey = newKey;
    else userApiKey = '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';
    saveAll();
    showToast('API-ключ сохранён', 'success');
};
smartSearchToggle.addEventListener('change', (e) => {
    searchMode = e.target.checked;
    saveAll();
});
languageSelect.addEventListener('change', (e) => {
    currentLanguage = e.target.value;
    saveAll();
    applyLanguage();
    renderHistory();
    renderChat();
});
logoutBtn.onclick = () => {
    localStorage.clear();
    location.reload();
};

// ==================== ОСТАЛЬНЫЕ ОБРАБОТЧИКИ ====================
document.getElementById('foldersBtn').addEventListener('click', () => {
    renderFoldersList();
    foldersModal.style.display = 'flex';
});
document.getElementById('newChatSidebarBtn').addEventListener('click', () => {
    currentChatId = null;
    renderEmptyChat();
    renderHistory();
});
document.getElementById('newChatMobileBtn').addEventListener('click', () => {
    currentChatId = null;
    renderEmptyChat();
    renderHistory();
});
sendBtn.addEventListener('click', sendMessage);
userInput.addEventListener('input', function() {
    this.style.height = 'auto';
    this.style.height = Math.min(this.scrollHeight, 120) + 'px';
    sendBtn.disabled = !this.value.trim() || isWaitingResponse;
});
userInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
    }
});
searchHistoryInput.addEventListener('input', renderHistory);
// модалки закрытие
document.querySelectorAll('.close-modal').forEach(btn => {
    btn.addEventListener('click', () => {
        settingsModal.style.display = 'none';
        foldersModal.style.display = 'none';
        renameChatModal.style.display = 'none';
        folderEditModal.style.display = 'none';
        moveChatModal.style.display = 'none';
    });
});
// цвет в палитре
document.querySelectorAll('.color-opt').forEach(opt => {
    opt.addEventListener('click', () => {
        document.querySelectorAll('.color-opt').forEach(o => o.classList.remove('selected'));
        opt.classList.add('selected');
    });
});
// бургер
const sidebar = document.getElementById('sidebar');
const burgerBtn = document.getElementById('burgerBtn');
const burgerMobile = document.getElementById('burgerMobileBtn');
function toggleSidebar() {
    sidebar.classList.toggle('open');
}
burgerBtn?.addEventListener('click', toggleSidebar);
burgerMobile?.addEventListener('click', toggleSidebar);
document.addEventListener('click', (e) => {
    if (window.innerWidth <= 768 && sidebar.classList.contains('open') && !sidebar.contains(e.target) && !burgerBtn.contains(e.target) && !burgerMobile.contains(e.target)) {
        sidebar.classList.remove('open');
    }
});

// ==================== ВХОД ====================
function initApp() {
    loadData();
    if (chats.length) {
        currentChatId = chats[0].id;
        renderChat();
    } else {
        renderEmptyChat();
    }
    renderHistory();
    loginOverlay.style.display = 'none';
    appContainer.style.display = 'flex';
    applyLanguage();
    if (smartSearchToggle) smartSearchToggle.checked = searchMode;
}

// события входа
document.getElementById('loginDefaultBtn').onclick = () => {
    // уже есть ключ, просто входим
    initApp();
};
document.getElementById('loginCustomBtn').onclick = () => {
    const group = document.getElementById('customKeyGroup');
    group.style.display = group.style.display === 'none' ? 'flex' : 'none';
};
document.getElementById('submitCustomKey').onclick = () => {
    const key = document.getElementById('apiKeyInput').value.trim();
    if (key && key.startsWith('sk-or-v1-')) {
        userApiKey = key;
        saveAll();
        initApp();
    } else {
        showToast('Неверный формат ключа', 'error');
    }
};
document.getElementById('loginTryLuckBtn').onclick = async () => {
    showToast('Пробуем тестовый ключ...', 'info');
    // используем твой тестовый ключ
    userApiKey = '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';
    saveAll();
    initApp();
};

// если ключ уже сохранён, можно сразу войти без клика
if (userApiKey && userApiKey !== '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') {
    initApp();
} else {
    // остаёмся на логине
    loginOverlay.style.display = 'flex';
}
