// ==================== DIAMOND AI — СИНХРОНИЗАЦИЯ ЧЕРЕЗ SUPABASE (ИСПРАВЛЕННЫЙ) ====================
(function() {
    const SUPABASE_URL = 'https://pqgwrokpizeelfrjmgoc.supabase.co';
    const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBxZ3dyb2twaXplZWxmcmptZ29jIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcxNTAyMDksImV4cCI6MjA5MjcyNjIwOX0.qtFCGBnpwdQbtmpwSZxI_hH3arq4HBAw62vs5h8WmAk';

    let currentChatId = null;
    let chats = [];
    let folders = [];
    let currentUser = null;
    let mistralApiKey = '';
    let isWaitingForResponse = false;
    let currentAbortController = null;
    let lastNotificationTime = 0;
    const NOTIFICATION_DEBOUNCE = 1000;
    let sidebarCollapsed = false;
    let currentEditingFolderId = null;
    let currentView = 'chat';
    let placeholderInterval = null;
    let thinkingTimer = null;
    let thinkingDots = 0;

    const placeholderTexts = [
        "Что расскажешь о себе?",
        "Напиши формулу воды",
        "Кто такой viktorshopa?",
        "Реши уравнение x^2 - 5x + 6 = 0",
        "Что такое квантовая запутанность?",
        "Расскажи про теорему Пифагора",
        "Напиши код на Python"
    ];

    const AI_MODEL = 'mistral-small-2506';
    const now = new Date();
    const currentDateStr = now.toLocaleDateString('ru-RU', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    const SYSTEM_PROMPT = {
        role: 'system',
        content: `Ты — Diamond AI, интеллектуальный помощник. Твой создатель — viktorshopa, основатель сервера Diamond. Отвечай кратко и по делу, используй KaTeX-формат для формул. Для выключных формул используй $$...$$, для встроенных \\(...\\). Химические формулы пиши через \\ce{}. Например: \\ce{NaOH + HCl -> NaCl + H2O}. Для корней используй \\sqrt{x}. Для дробей \\frac{a}{b}. Код оформляй в тройные кавычки с указанием языка. Будь вежливым и полезным. Сегодня: ${currentDateStr}.`
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

    function scrollToBottom() {
        const container = document.getElementById('messages-container');
        if (container) container.scrollTop = container.scrollHeight;
    }

    // ========== АНИМАЦИЯ "ДУМАЕТ" ==========
    function startThinkingAnimation() {
        if (thinkingTimer) clearInterval(thinkingTimer);
        thinkingDots = 1;
        const typingEl = document.querySelector('.message.assistant.typing .message-content');
        if (typingEl) {
            typingEl.innerHTML = 'Думает';
            thinkingTimer = setInterval(() => {
                thinkingDots = thinkingDots === 3 ? 1 : thinkingDots + 1;
                if (typingEl) typingEl.innerHTML = 'Думает' + '.'.repeat(thinkingDots);
            }, 500);
        }
    }

    function stopThinkingAnimation() {
        if (thinkingTimer) {
            clearInterval(thinkingTimer);
            thinkingTimer = null;
        }
    }

    // ========== LaTeX РЕНДЕР ==========
    function renderMathInElementWithMhchem(element) {
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

    // ========== КНОПКА ЗАПУСКА КОДА ==========
    function showCodeRunnerModal(code, language) {
        const modal = document.createElement('div');
        modal.className = 'modal-overlay';
        modal.innerHTML = `
            <div class="modal-container" style="resize: both; overflow: auto;">
                <div class="modal-header">
                    <h3><i class="fas fa-play"></i> Выполнить код (${language || 'текст'})</h3>
                    <button class="close-modal"><i class="fas fa-times"></i></button>
                </div>
                <div class="modal-body">
                    <textarea class="code-editor" rows="10" spellcheck="false">${escapeHtml(code)}</textarea>
                    <iframe class="runner-iframe" style="width:100%; height:400px; border:1px solid var(--border-color); border-radius:16px; background:#fff;"></iframe>
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
                htmlContent = `<html><head><meta charset="UTF-8"><title>Run</title><style>body{background:#1e1e1e;color:#f0f0f0;font-family:monospace;padding:16px;}</style></head><body><pre>${escapeHtml(newCode)}</pre><script>try{${newCode}}catch(e){document.body.innerHTML+='<div style="color:red">Ошибка: '+e.message+'</div>';}<\/script></body></html>`;
            }
            const blob = new Blob([htmlContent], { type: 'text/html' });
            const url = URL.createObjectURL(blob);
            iframe.src = url;
            setTimeout(() => URL.revokeObjectURL(url), 1000);
        }
        
        runExecute.addEventListener('click', executeCode);
        modal.querySelectorAll('.close-modal').forEach(btn => btn.addEventListener('click', () => modal.remove()));
        modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
        executeCode();
    }

    // ========== ОБРАБОТКА БЛОКОВ КОДА ==========
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
                showCodeRunnerModal(pre.textContent, language);
            });
        });
    }

    // ========== SUPABASE КЛИЕНТ (переименован) ==========
    const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

    // ========== РАБОТА С ЧАТАМИ И ПАПКАМИ В БД ==========
    async function loadChatsAndFolders() {
        if (!currentUser) return;
        try {
            const [chatsRes, foldersRes] = await Promise.all([
                supabaseClient.from('diamond_chats').select('*').eq('user_login', currentUser.login),
                supabaseClient.from('diamond_folders').select('*').eq('user_login', currentUser.login)
            ]);
            if (chatsRes.error) throw chatsRes.error;
            if (foldersRes.error) throw foldersRes.error;
            chats = chatsRes.data.map(c => ({
                ...c,
                messages: c.messages || [],
                pinned: c.pinned || false
            }));
            folders = foldersRes.data;
            chats.sort((a, b) => b.last_activity - a.last_activity);
            currentChatId = chats.length ? chats[0].id : null;
            renderHistory();
            renderChat();
        } catch (e) {
            console.error('Ошибка загрузки чатов/папок:', e);
            showToast('Ошибка', 'Не удалось загрузить чаты', 'error');
        }
    }

    async function saveChatToSupabase(chat) {
        if (!currentUser) return;
        const { id, title, created_at, last_activity, pinned, folder_id, messages } = chat;
        const { error } = await supabaseClient.from('diamond_chats').upsert({
            id,
            user_login: currentUser.login,
            title,
            created_at,
            last_activity,
            pinned,
            folder_id,
            messages
        });
        if (error) {
            console.error('Ошибка сохранения чата:', error);
            showToast('Ошибка', 'Не удалось сохранить чат', 'error');
        }
    }

    async function saveFolderToSupabase(folder) {
        if (!currentUser) return;
        const { error } = await supabaseClient.from('diamond_folders').upsert({
            id: folder.id,
            user_login: currentUser.login,
            name: folder.name,
            description: folder.description,
            icon: folder.icon,
            color: folder.color,
            created_at: folder.createdAt || folder.created_at || Date.now()
        });
        if (error) {
            console.error('Ошибка сохранения папки:', error);
            showToast('Ошибка', 'Не удалось сохранить папку', 'error');
        }
    }

    async function deleteChatFromSupabase(chatId) {
        if (!currentUser) return;
        const { error } = await supabaseClient.from('diamond_chats').delete().eq('id', chatId).eq('user_login', currentUser.login);
        if (error) {
            console.error('Ошибка удаления чата:', error);
            showToast('Ошибка', 'Не удалось удалить чат', 'error');
        }
    }

    async function deleteFolderFromSupabase(folderId) {
        if (!currentUser) return;
        const { error } = await supabaseClient.from('diamond_folders').delete().eq('id', folderId).eq('user_login', currentUser.login);
        if (error) {
            console.error('Ошибка удаления папки:', error);
            showToast('Ошибка', 'Не удалось удалить папку', 'error');
        }
    }

    // ========== ЧАТЫ ==========
    function generateChatTitle(msg) {
        return msg.length > 50 ? msg.slice(0, 47) + '...' : msg;
    }

    async function createNewChat() {
        renderEmptyState();
        currentChatId = null;
        showToast('Новый диалог', 'Напишите сообщение', 'info');
    }

    async function deleteChat(id) {
        const chat = chats.find(c => c.id === id);
        if (chat && confirm('Удалить чат?')) {
            await deleteChatFromSupabase(id);
            chats = chats.filter(c => c.id !== id);
            if (currentChatId === id) currentChatId = chats.length ? chats[0].id : null;
            renderHistory();
            renderChat();
            if (chats.length === 0) renderEmptyState();
            showToast('Чат удалён', '', 'success');
        }
    }

    async function switchChat(id) {
        currentChatId = id;
        renderChat();
        renderHistory();
    }

    async function togglePin(id) {
        const chat = chats.find(c => c.id === id);
        if (chat) {
            chat.pinned = !chat.pinned;
            await saveChatToSupabase(chat);
            renderHistory();
            showToast(chat.pinned ? 'Закреплён' : 'Откреплён', '', 'success');
        }
    }

    async function renameChat(id, newTitle) {
        const chat = chats.find(c => c.id === id);
        if (chat) {
            chat.title = newTitle;
            await saveChatToSupabase(chat);
            renderHistory();
            showToast('Чат переименован', newTitle, 'success');
        }
    }

    function showRenameModal(chatId) {
        const chat = chats.find(c => c.id === chatId);
        if (!chat) return;
        const modal = document.createElement('div');
        modal.className = 'modal-overlay';
        modal.innerHTML = `
            <div class="modal-container" style="max-width: 400px;">
                <div class="modal-header">
                    <h3>Переименовать чат</h3>
                    <button class="close-modal"><i class="fas fa-times"></i></button>
                </div>
                <div class="modal-body">
                    <input type="text" id="rename-input" value="${escapeHtml(chat.title)}" style="width:100%; padding:12px; background: var(--bg-tertiary); border:1px solid var(--border-color); border-radius: 20px; color: white;">
                </div>
                <div class="modal-footer">
                    <button id="rename-confirm" class="btn btn-primary">Сохранить</button>
                    <button class="btn btn-secondary close-modal">Отмена</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
        const input = modal.querySelector('#rename-input');
        input.focus();
        const close = () => modal.remove();
        modal.querySelectorAll('.close-modal').forEach(btn => btn.addEventListener('click', close));
        modal.querySelector('#rename-confirm').onclick = async () => {
            const newName = input.value.trim();
            if (newName) await renameChat(chatId, newName);
            close();
        };
        input.onkeydown = (e) => {
            if (e.key === 'Enter') {
                const newName = input.value.trim();
                if (newName) renameChat(chatId, newName);
                close();
            }
        };
        modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
    }

    // ========== ПАПКИ ==========
    async function createFolder(name, desc, icon, color) {
        const id = Date.now().toString();
        const folder = {
            id,
            name: name.trim(),
            description: desc || '',
            icon: icon || 'fa-folder',
            color: color || '#95a5a6',
            createdAt: Date.now()
        };
        folders.push(folder);
        await saveFolderToSupabase(folder);
        renderFoldersPage();
        showToast('Папка создана', name, 'success');
    }

    async function updateFolder(id, name, desc, icon, color) {
        const f = folders.find(f => f.id === id);
        if (f) {
            f.name = name.trim();
            f.description = desc || '';
            f.icon = icon || 'fa-folder';
            f.color = color || '#95a5a6';
            await saveFolderToSupabase(f);
            renderFoldersPage();
            showToast('Папка обновлена', name, 'success');
        }
    }

    async function deleteFolder(id) {
        const f = folders.find(f => f.id === id);
        if (f && confirm('Удалить папку? Чаты будут перемещены в корень.')) {
            await deleteFolderFromSupabase(id);
            folders = folders.filter(f => f.id !== id);
            for (const chat of chats) {
                if (chat.folder_id === id) {
                    chat.folder_id = null;
                    await saveChatToSupabase(chat);
                }
            }
            renderFoldersPage();
            renderHistory();
            showToast('Папка удалена', f.name, 'info');
        }
    }

    async function moveChatToFolder(chatId, folderId) {
        const chat = chats.find(c => c.id === chatId);
        if (chat) {
            chat.folder_id = folderId || null;
            await saveChatToSupabase(chat);
            renderHistory();
            renderFoldersPage();
            showToast('Чат перемещён', folderId ? 'В папку' : 'Из папки', 'success');
        }
    }

    function showFolderEditModal(folder = null) {
        const isEdit = folder !== null;
        const modal = document.createElement('div');
        modal.className = 'modal-overlay';
        modal.innerHTML = `
            <div class="modal-container" style="max-width: 500px;">
                <div class="modal-header">
                    <h3>${isEdit ? 'Редактировать папку' : 'Создать папку'}</h3>
                    <button class="close-modal"><i class="fas fa-times"></i></button>
                </div>
                <div class="modal-body">
                    <div class="form-group" style="margin-bottom: 16px;">
                        <label style="display:block; margin-bottom:6px;">Название</label>
                        <input type="text" id="folder-name" placeholder="Название папки" value="${isEdit ? escapeHtml(folder.name) : ''}" style="width:100%; padding:12px; background:var(--bg-tertiary); border:1px solid var(--border-color); border-radius:16px; color:white;">
                    </div>
                    <div class="form-group" style="margin-bottom: 16px;">
                        <label style="display:block; margin-bottom:6px;">Описание</label>
                        <textarea id="folder-description" rows="2" placeholder="Описание папки" style="width:100%; padding:12px; background:var(--bg-tertiary); border:1px solid var(--border-color); border-radius:16px; color:white;">${isEdit ? escapeHtml(folder.description || '') : ''}</textarea>
                    </div>
                    <div class="form-group" style="margin-bottom: 16px;">
                        <label style="display:block; margin-bottom:6px;">Иконка</label>
                        <div class="icon-selector" id="icon-selector" style="display:grid; grid-template-columns:repeat(6,1fr); gap:8px; background:var(--bg-tertiary); padding:12px; border-radius:16px;"></div>
                    </div>
                    <div class="form-group">
                        <label style="display:block; margin-bottom:6px;">Цвет</label>
                        <div class="color-selector" id="color-selector" style="display:flex; gap:12px; flex-wrap:wrap;">
                            <div class="color-option" data-color="#e74c3c" style="background:#e74c3c; width:36px; height:36px; border-radius:50%; cursor:pointer;"></div>
                            <div class="color-option" data-color="#f39c12" style="background:#f39c12; width:36px; height:36px; border-radius:50%; cursor:pointer;"></div>
                            <div class="color-option" data-color="#2ecc71" style="background:#2ecc71; width:36px; height:36px; border-radius:50%; cursor:pointer;"></div>
                            <div class="color-option" data-color="#3498db" style="background:#3498db; width:36px; height:36px; border-radius:50%; cursor:pointer;"></div>
                            <div class="color-option" data-color="#9b59b6" style="background:#9b59b6; width:36px; height:36px; border-radius:50%; cursor:pointer;"></div>
                            <div class="color-option" data-color="#1abc9c" style="background:#1abc9c; width:36px; height:36px; border-radius:50%; cursor:pointer;"></div>
                            <div class="color-option" data-color="#e67e22" style="background:#e67e22; width:36px; height:36px; border-radius:50%; cursor:pointer;"></div>
                            <div class="color-option" data-color="#95a5a6" style="background:#95a5a6; width:36px; height:36px; border-radius:50%; cursor:pointer;"></div>
                        </div>
                    </div>
                </div>
                <div class="modal-footer">
                    <button id="save-folder-btn" class="btn btn-primary">Сохранить</button>
                    <button class="btn btn-secondary close-modal">Отмена</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
        
        const icons = ['fa-folder', 'fa-folder-open', 'fa-book', 'fa-graduation-cap', 'fa-code', 'fa-music', 'fa-image', 'fa-video', 'fa-gamepad', 'fa-heart', 'fa-star', 'fa-rocket', 'fa-brain', 'fa-chart-line', 'fa-users', 'fa-calendar'];
        const iconSelector = modal.querySelector('#icon-selector');
        iconSelector.innerHTML = icons.map(icon => `<div class="icon-option" data-icon="${icon}" style="display:flex; align-items:center; justify-content:center; width:40px; height:40px; border-radius:12px; cursor:pointer; background:var(--bg-secondary);"><i class="fas ${icon}"></i></div>`).join('');
        
        let selectedIcon = isEdit ? folder.icon : 'fa-folder';
        let selectedColor = isEdit ? folder.color : '#95a5a6';
        
        iconSelector.querySelectorAll('.icon-option').forEach(opt => {
            if (opt.dataset.icon === selectedIcon) opt.style.background = 'var(--bg-hover)';
            opt.onclick = () => {
                iconSelector.querySelectorAll('.icon-option').forEach(o => o.style.background = 'var(--bg-secondary)');
                opt.style.background = 'var(--bg-hover)';
                selectedIcon = opt.dataset.icon;
            };
        });
        
        modal.querySelectorAll('.color-option').forEach(opt => {
            if (opt.dataset.color === selectedColor) opt.style.border = '2px solid white';
            opt.onclick = () => {
                modal.querySelectorAll('.color-option').forEach(o => o.style.border = 'none');
                opt.style.border = '2px solid white';
                selectedColor = opt.dataset.color;
            };
        });
        
        const close = () => modal.remove();
        modal.querySelectorAll('.close-modal').forEach(btn => btn.addEventListener('click', close));
        modal.querySelector('#save-folder-btn').onclick = async () => {
            const name = modal.querySelector('#folder-name').value.trim();
            if (!name) {
                showToast('Ошибка', 'Введите название', 'warning');
                return;
            }
            const desc = modal.querySelector('#folder-description').value;
            if (isEdit) await updateFolder(folder.id, name, desc, selectedIcon, selectedColor);
            else await createFolder(name, desc, selectedIcon, selectedColor);
            close();
        };
        modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
    }

    function showFolderSelectModal(chatId) {
        const modal = document.createElement('div');
        modal.className = 'modal-overlay';
        modal.innerHTML = `
            <div class="modal-container" style="max-width: 400px;">
                <div class="modal-header">
                    <h3><i class="fas fa-folder"></i> Выбрать папку</h3>
                    <button class="close-modal"><i class="fas fa-times"></i></button>
                </div>
                <div class="modal-body">
                    <div class="folder-chats-list" id="folder-options-list">
                        <div class="folder-chat-item" data-id="" style="padding:12px; background:var(--bg-tertiary); border-radius:16px; margin-bottom:8px; cursor:pointer; display:flex; align-items:center; gap:10px;">
                            <i class="fas fa-times-circle"></i>
                            <span>Без папки</span>
                        </div>
                        ${folders.map(f => `
                            <div class="folder-chat-item" data-id="${f.id}" style="padding:12px; background:var(--bg-tertiary); border-radius:16px; margin-bottom:8px; cursor:pointer; display:flex; align-items:center; gap:10px;">
                                <i class="fas ${f.icon}" style="color:${f.color}"></i>
                                <span>${escapeHtml(f.name)}</span>
                            </div>
                        `).join('')}
                    </div>
                </div>
                <div class="modal-footer">
                    <button class="btn btn-secondary close-modal">Отмена</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
        const close = () => modal.remove();
        modal.querySelectorAll('.close-modal').forEach(btn => btn.addEventListener('click', close));
        modal.querySelectorAll('.folder-chat-item').forEach(item => {
            item.onclick = () => {
                moveChatToFolder(chatId, item.dataset.id || null);
                close();
            };
        });
        modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
    }

    function renderFoldersPage() {
        const container = document.getElementById('foldersPage');
        if (!container) return;
        container.innerHTML = `
            <div class="folders-page-header">
                <h1><i class="fas fa-folder"></i> Папки</h1>
                <p>Организуйте чаты по папкам</p>
            </div>
            <div class="folders-list-container" id="foldersListContainer"></div>
            <div class="folders-page-footer">
                <button id="create-folder-page-btn" class="btn btn-primary"><i class="fas fa-plus"></i> Создать папку</button>
                <button id="back-to-chat-from-folders" class="btn btn-secondary"><i class="fas fa-arrow-left"></i> Назад к чату</button>
            </div>
        `;
        
        document.getElementById('create-folder-page-btn').addEventListener('click', () => {
            currentEditingFolderId = null;
            showFolderEditModal(null);
        });
        document.getElementById('back-to-chat-from-folders').addEventListener('click', switchToChatView);
        
        const listContainer = document.getElementById('foldersListContainer');
        if (folders.length === 0) {
            listContainer.innerHTML = '<div class="folder-empty">У вас пока нет папок. Создайте первую!</div>';
            return;
        }
        
        listContainer.innerHTML = folders.map(f => `
            <div class="folder-card" data-id="${f.id}">
                <div class="folder-icon" style="background:${f.color}20; color:${f.color}"><i class="fas ${f.icon}"></i></div>
                <div class="folder-info">
                    <div class="folder-name"><span style="color:${f.color}">${escapeHtml(f.name)}</span></div>
                    <div class="folder-description">${escapeHtml(f.description) || 'Нет описания'}</div>
                    <div class="folder-stats">${chats.filter(c => c.folder_id === f.id).length} чатов</div>
                </div>
                <div class="folder-actions">
                    <button class="view-folder-chats" data-id="${f.id}" title="Чаты"><i class="fas fa-comments"></i></button>
                    <button class="edit-folder" data-id="${f.id}" title="Редактировать"><i class="fas fa-edit"></i></button>
                    <button class="delete-folder" data-id="${f.id}" title="Удалить"><i class="fas fa-trash"></i></button>
                </div>
            </div>
        `).join('');
        
        document.querySelectorAll('.view-folder-chats').forEach(btn => {
            btn.onclick = (e) => {
                e.stopPropagation();
                const folderId = btn.dataset.id;
                const folder = folders.find(f => f.id === folderId);
                if (folder) showFolderChatsModal(folder);
            };
        });
        document.querySelectorAll('.edit-folder').forEach(btn => {
            btn.onclick = (e) => {
                e.stopPropagation();
                currentEditingFolderId = btn.dataset.id;
                const f = folders.find(f => f.id === currentEditingFolderId);
                showFolderEditModal(f);
            };
        });
        document.querySelectorAll('.delete-folder').forEach(btn => {
            btn.onclick = (e) => {
                e.stopPropagation();
                deleteFolder(btn.dataset.id);
            };
        });
    }

    function showFolderChatsModal(folder) {
        const chatsInFolder = chats.filter(c => c.folder_id === folder.id);
        const modal = document.createElement('div');
        modal.className = 'modal-overlay';
        modal.innerHTML = `
            <div class="modal-container" style="max-width: 500px;">
                <div class="modal-header">
                    <h3><i class="fas ${folder.icon}" style="color:${folder.color}"></i> Чаты в папке «${escapeHtml(folder.name)}»</h3>
                    <button class="close-modal"><i class="fas fa-times"></i></button>
                </div>
                <div class="modal-body">
                    <div class="folder-chats-list">
                        ${chatsInFolder.length ? chatsInFolder.map(c => `
                            <div class="folder-chat-item" data-chat-id="${c.id}" style="padding:12px; background:var(--bg-tertiary); border-radius:16px; margin-bottom:8px; cursor:pointer; display:flex; align-items:center; gap:10px;">
                                <i class="fas fa-comment"></i>
                                <span style="flex:1;">${escapeHtml(c.title)}</span>
                                <i class="fas fa-arrow-right"></i>
                            </div>
                        `).join('') : '<div style="text-align:center; padding:20px; color:var(--text-secondary);">Нет чатов в этой папке</div>'}
                    </div>
                </div>
                <div class="modal-footer">
                    <button class="btn btn-secondary close-modal">Закрыть</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
        const close = () => modal.remove();
        modal.querySelectorAll('.close-modal').forEach(btn => btn.addEventListener('click', close));
        modal.querySelectorAll('.folder-chat-item').forEach(item => {
            item.onclick = () => {
                switchChat(item.dataset.chatId);
                switchToChatView();
                close();
            };
        });
        modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
    }

    // ========== ИСТОРИЯ ==========
    function getDateGroup(ts) {
        const d = new Date(ts).setHours(0, 0, 0, 0);
        const t = new Date().setHours(0, 0, 0, 0);
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
        filtered.forEach(c => groups[getDateGroup(c.last_activity || c.created_at)].push(c));
        for (const g in groups) {
            groups[g].sort((a, b) => (a.pinned === b.pinned ? 0 : a.pinned ? -1 : 1) || (b.last_activity - a.last_activity));
        }
        
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
                        <button class="chat-action-btn move-to-folder-hover" data-id="${c.id}" title="Переместить в папку"><i class="fas fa-folder-open"></i></button>
                        <button class="chat-action-btn delete-chat-hover" data-id="${c.id}" title="Удалить"><i class="fas fa-trash"></i></button>
                    </div>
                </div>
            `);
            html += '</div>';
        }
        list.innerHTML = html || '<div style="text-align:center; padding:20px;">Нет чатов</div>';
        
        document.querySelectorAll('.history-item').forEach(el => {
            el.addEventListener('click', (e) => {
                if (!e.target.closest('.chat-actions-hover')) switchChat(el.dataset.id);
            });
        });
        document.querySelectorAll('.rename-chat-hover').forEach(btn => {
            btn.onclick = (e) => { e.stopPropagation(); showRenameModal(btn.dataset.id); };
        });
        document.querySelectorAll('.pin-chat-hover').forEach(btn => {
            btn.onclick = (e) => { e.stopPropagation(); togglePin(btn.dataset.id); };
        });
        document.querySelectorAll('.delete-chat-hover').forEach(btn => {
            btn.onclick = (e) => { e.stopPropagation(); deleteChat(btn.dataset.id); };
        });
        document.querySelectorAll('.move-to-folder-hover').forEach(btn => {
            btn.onclick = (e) => { e.stopPropagation(); showFolderSelectModal(btn.dataset.id); };
        });
    }
        // ========== РЕНДЕР ЧАТА ==========
    function renderChat() {
        const chat = chats.find(c => c.id === currentChatId);
        if (!chat || !chat.messages || chat.messages.length === 0) {
            renderEmptyState();
            document.getElementById('inputArea').style.display = 'none';
            return;
        }
        document.getElementById('inputArea').style.display = 'flex';
        const container = document.getElementById('messages-container');
        container.innerHTML = '';
        let lastDate = null;
        
        chat.messages.forEach((msg, idx) => {
            const date = new Date(msg.timestamp || chat.created_at).toDateString();
            if (date !== lastDate) {
                container.innerHTML += `<div class="date-divider"><span>${formatDateHeader(msg.timestamp || chat.created_at)}</span></div>`;
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
                </div>
            `;
            if (msg.role === 'assistant' && !msg.isTyping) {
                const actionsDiv = document.createElement('div');
                actionsDiv.className = 'message-actions';
                actionsDiv.innerHTML = `<button class="action-btn copy-msg-btn" data-msg-idx="${idx}"><i class="fas fa-copy"></i></button><button class="action-btn regen-msg-btn" data-msg-idx="${idx}"><i class="fas fa-sync-alt"></i></button>`;
                messageDiv.appendChild(actionsDiv);
            }
            container.appendChild(messageDiv);
        });
        
        container.querySelectorAll('.copy-msg-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const idx = parseInt(btn.dataset.msgIdx);
                const msg = chat.messages[idx];
                if (msg && msg.content) {
                    navigator.clipboard.writeText(msg.content);
                    showToast('Скопировано', '', 'success', 1500);
                }
            });
        });
        container.querySelectorAll('.regen-msg-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const idx = parseInt(btn.dataset.msgIdx);
                const msg = chat.messages[idx];
                if (msg && msg.role === 'assistant') regenerateResponse(msg);
            });
        });
        
        setTimeout(() => {
            renderMathInElementWithMhchem(container);
            enhanceCodeBlocks(container);
        }, 10);
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

    function formatTime(ts) {
        return new Date(ts).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    }

    async function addMessageToDOM(role, content, save = true) {
        const timestamp = Date.now();
        const messageId = timestamp + Math.random();
        if (save) {
            const chat = chats.find(c => c.id === currentChatId);
            if (chat) {
                if (!chat.messages) chat.messages = [];
                chat.messages.push({ id: messageId, role, content, timestamp, isTyping: false });
                chat.last_activity = timestamp;
                if (role === 'user' && chat.messages.filter(m => m.role === 'user').length === 1) {
                    chat.title = generateChatTitle(content);
                }
                await saveChatToSupabase(chat);
            }
        }
        renderChat();
        return messageId;
    }

    // ========== ОТПРАВКА СООБЩЕНИЯ ==========
    async function sendMessage() {
        const text = document.getElementById('user-input').value.trim();
        if (!text || isWaitingForResponse) return;
        if (!mistralApiKey) {
            showToast('Ошибка', 'API-ключ не загружен', 'error');
            return;
        }
        
        let chat = chats.find(c => c.id === currentChatId);
        if (!chat || chat.messages.length === 0) {
            const now = Date.now();
            chat = {
                id: now.toString(),
                title: generateChatTitle(text),
                messages: [],
                created_at: now,
                last_activity: now,
                pinned: false,
                folder_id: null
            };
            chats.unshift(chat);
            currentChatId = chat.id;
            await saveChatToSupabase(chat);
            renderHistory();
            document.getElementById('inputArea').style.display = 'flex';
        }
        
        await addMessageToDOM('user', text, true);
        document.getElementById('user-input').value = '';
        const emptyInput = document.getElementById('empty-input');
        if (emptyInput) emptyInput.value = '';
        updateSendButtonState();
        
        isWaitingForResponse = true;
        updateSendButtonState();
        
        const typingId = Date.now().toString();
        const typingMsg = { id: typingId, role: 'assistant', content: '', isTyping: true, timestamp: Date.now() };
        chat.messages.push(typingMsg);
        renderChat();
        scrollToBottom();
        startThinkingAnimation();
        
        const contextMessages = chat.messages.filter(m => !m.isTyping).slice(-15).map(m => ({ role: m.role, content: m.content }));
        const messages = [SYSTEM_PROMPT, ...contextMessages];
        const controller = new AbortController();
        currentAbortController = controller;
        let success = false;
        let assistantMessage = '';
        
        try {
            const resp = await fetch('https://api.mistral.ai/v1/chat/completions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${mistralApiKey}` },
                body: JSON.stringify({ model: AI_MODEL, messages, temperature: 0.5, max_tokens: 2000 }),
                signal: controller.signal
            });
            if (resp.ok) {
                const data = await resp.json();
                assistantMessage = data.choices[0].message.content;
                success = true;
            } else {
                console.error('Mistral API error:', resp.status);
            }
        } catch (e) {
            if (e.name === 'AbortError') {
                console.log('Request aborted');
            } else {
                console.warn('Mistral error:', e);
            }
        }
        
        stopThinkingAnimation();
        const msgIndex = chat.messages.findIndex(m => m.id === typingId);
        if (msgIndex !== -1) chat.messages.splice(msgIndex, 1);
        
        if (success && assistantMessage) {
            await addMessageToDOM('assistant', assistantMessage, true);
        } else {
            await addMessageToDOM('assistant', '❌ Не удалось получить ответ. Попробуйте позже.', true);
        }
        
        isWaitingForResponse = false;
        currentAbortController = null;
        updateSendButtonState();
        renderChat();
        scrollToBottom();
    }

    function stopGeneration() {
        if (currentAbortController) {
            currentAbortController.abort();
            stopThinkingAnimation();
            showToast('Генерация остановлена', '', 'info');
        }
    }

    async function regenerateResponse(msg) {
        const chat = chats.find(c => c.id === currentChatId);
        if (!chat) return;
        const idx = chat.messages.findIndex(m => m === msg);
        if (idx !== -1) {
            chat.messages.splice(idx, 1);
            await saveChatToSupabase(chat);
            renderChat();
        }
        const lastUser = [...chat.messages].reverse().find(m => m.role === 'user');
        if (lastUser) {
            document.getElementById('user-input').value = lastUser.content;
            sendMessage();
        }
    }

    // ========== АВАТАРЫ ==========
    function getBotAvatarHTML() {
        return `<img src="bots.png" style="width:100%; height:100%; object-fit:cover; border-radius:50%;">`;
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
            const icon = currentUser.fa_icon ? `<i class="${currentUser.fa_icon}" style="margin-right:6px;"></i>` : '';
            if (nameSpan) nameSpan.innerHTML = `${icon}${currentUser.name || currentUser.login}`;
            if (avatarImg) avatarImg.src = currentUser.avatar || '';
        } else {
            if (nameSpan) nameSpan.textContent = 'Пользователь';
            if (avatarImg) avatarImg.src = '';
        }
    }

    // ========== DIAMKEY AUTH (исправленная) ==========
    async function exchangeTicket(ticket) {
        const headers = { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${SUPABASE_ANON_KEY}` };
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
        } catch (e) {
            console.error('Ошибка загрузки API-ключа:', e);
            return false;
        }
    }

    async function processDiamkeyReturn() {
        const urlParams = new URLSearchParams(window.location.search);
        const ticket = urlParams.get('ticket');
        console.log('[Diamkey] ticket from URL:', ticket);
        if (!ticket) return false;
        try {
            const user = await exchangeTicket(ticket);
            console.log('[Diamkey] user received:', user);
            currentUser = user;
            localStorage.setItem('diamond_user', JSON.stringify(user));
            await loadChatsAndFolders();
            window.history.replaceState({}, document.title, window.location.pathname);
            return true;
        } catch (e) {
            console.error('[Diamkey] exchange error:', e);
            showToast('Ошибка входа', e.message, 'error');
            return false;
        }
    }

    function logout() {
        currentUser = null;
        mistralApiKey = '';
        localStorage.removeItem('diamond_user');
        document.getElementById('mainUI').style.display = 'none';
        document.getElementById('choiceScreen').style.display = 'flex';
        setupDiamkeyButton();
        showToast('Вы вышли', '', 'info');
    }

    function setupDiamkeyButton() {
        const btn = document.getElementById('diamkeyLoginBtn');
        if (!btn) return;

        // Удаляем старый обработчик, чтобы не навешивать несколько раз
        const newBtn = btn.cloneNode(true);
        btn.parentNode.replaceChild(newBtn, btn);
        const freshBtn = document.getElementById('diamkeyLoginBtn');
        if (!freshBtn) return;

        freshBtn.onclick = async (e) => {
            e.preventDefault();
            freshBtn.disabled = true;
            freshBtn.style.opacity = '0.6';
            freshBtn.style.cursor = 'wait';

            const redirect = encodeURIComponent(window.location.origin + window.location.pathname);
            const appName = encodeURIComponent('Diamond AI');
            const oauthUrl = `https://diamkey.ru/oauth.html?redirect=${redirect}&app=${appName}`;

            try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 5000);
                await fetch('https://diamkey.ru', { method: 'HEAD', signal: controller.signal });
                clearTimeout(timeoutId);
            } catch (err) {
                console.warn('DiamKey недоступен:', err);
                showToast('Ошибка соединения', 'Сервер DiamKey не отвечает. Проверьте интернет.', 'error');
                freshBtn.disabled = false;
                freshBtn.style.opacity = '';
                freshBtn.style.cursor = '';
                return;
            }

            try {
                window.location.href = oauthUrl;
            } catch (e) {
                console.warn('location.href failed, trying window.open', e);
                window.open(oauthUrl, '_blank');
            }

            setTimeout(() => {
                freshBtn.disabled = false;
                freshBtn.style.opacity = '';
                freshBtn.style.cursor = '';
            }, 2000);
        };
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
            document.body.style.overflow = sidebar.classList.contains('open') ? 'hidden' : '';
        } else {
            sidebarCollapsed = !sidebarCollapsed;
            sidebar.classList.toggle('collapsed', sidebarCollapsed);
            if (titleBar) titleBar.classList.toggle('collapsed', sidebarCollapsed);
            if (collapsedActions) collapsedActions.classList.toggle('show', sidebarCollapsed);
        }
    }

    document.addEventListener('click', (e) => {
        if (window.innerWidth <= 768) {
            const sidebar = document.getElementById('sidebar');
            const toggleBtn = document.getElementById('sidebarToggleBtn');
            if (sidebar && sidebar.classList.contains('open') && !sidebar.contains(e.target) && !toggleBtn.contains(e.target)) {
                sidebar.classList.remove('open');
                document.body.style.overflow = '';
            }
        }
    });

    window.addEventListener('resize', () => {
        const sidebar = document.getElementById('sidebar');
        const titleBar = document.getElementById('titleBar');
        const collapsedActions = document.getElementById('collapsedActions');
        if (window.innerWidth > 768) {
            sidebar.classList.remove('open');
            document.body.style.overflow = '';
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

    // ========== ПУСТОЕ СОСТОЯНИЕ ==========
    function renderEmptyState() {
        const container = document.getElementById('messages-container');
        container.innerHTML = `
            <div class="empty-state">
                <img src="logo.png" class="empty-logo" alt="Diamond AI">
                <div class="empty-text">Чем могу помочь?</div>
                <div class="empty-input-area">
                    <div class="input-wrapper">
                        <textarea id="empty-input" placeholder="${placeholderTexts[0]}" rows="1"></textarea>
                        <button class="send-btn" id="empty-send-btn" disabled><i class="fas fa-arrow-up"></i></button>
                    </div>
                </div>
            </div>
        `;
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
                this.style.height = Math.min(this.scrollHeight, 160) + 'px';
            };
            emptyInput.onkeydown = e => {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    if (emptySendBtn && !emptySendBtn.disabled) sendMessageFromEmpty(emptyInput.value);
                }
            };
            emptySendBtn.onclick = () => {
                if (emptyInput.value.trim()) sendMessageFromEmpty(emptyInput.value);
            };
        }
    }

    function sendMessageFromEmpty(text) {
        document.getElementById('user-input').value = text;
        sendMessage();
        const emptyInput = document.getElementById('empty-input');
        if (emptyInput) emptyInput.value = '';
    }

    // ========== ЗАГРУЗОЧНЫЙ ЭКРАН ==========
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
        document.getElementById('sidebarToggleBtn')?.addEventListener('click', toggleSidebar);
        document.getElementById('new-chat-btn')?.addEventListener('click', createNewChat);
        document.getElementById('folders-page-btn')?.addEventListener('click', switchToFoldersView);
        document.getElementById('genhab-page-btn')?.addEventListener('click', () => {
            showToast('🔮 В разработке', 'ГенХаб появится в следующем обновлении', 'info', 4000);
        });
        document.getElementById('collapsedNewChat')?.addEventListener('click', createNewChat);
        document.getElementById('collapsedFolders')?.addEventListener('click', switchToFoldersView);
        document.getElementById('collapsedGenhab')?.addEventListener('click', () => {
            showToast('🔮 В разработке', 'ГенХаб появится в следующем обновлении', 'info', 4000);
        });
        
        document.getElementById('user-input')?.addEventListener('input', function() {
            this.style.height = 'auto';
            this.style.height = Math.min(this.scrollHeight, 120) + 'px';
            updateSendButtonState();
        });
        document.getElementById('user-input')?.addEventListener('keydown', e => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
            }
        });
        document.getElementById('send-btn')?.addEventListener('click', sendMessage);
        document.getElementById('history-search')?.addEventListener('input', renderHistory);
        
        document.getElementById('dropdown-discord')?.addEventListener('click', () => {
            window.open('https://discord.gg/diamondshop', '_blank');
        });
        document.getElementById('dropdown-diamkey')?.addEventListener('click', () => {
            window.open('https://diamkey.ru', '_blank');
        });
        document.getElementById('dropdown-logout')?.addEventListener('click', logout);
        
        document.getElementById('userMenuBtn')?.addEventListener('click', (e) => {
            e.stopPropagation();
            document.getElementById('userDropdown').classList.toggle('show');
        });
        document.addEventListener('click', (e) => {
            if (!document.getElementById('userPanel')?.contains(e.target)) {
                document.getElementById('userDropdown')?.classList.remove('show');
            }
        });
    }

    // ========== ИНИЦИАЛИЗАЦИЯ ==========
    (async function() {
        log('Загрузка...');
        
        await fetchMistralKey();
        
        const savedUser = localStorage.getItem('diamond_user');
        if (savedUser) {
            currentUser = JSON.parse(savedUser);
        }
        
        await showLoadingScreen();
        
        const ticketProcessed = await processDiamkeyReturn();
        if (currentUser && (ticketProcessed || !window.location.search.includes('ticket'))) {
            document.getElementById('choiceScreen').style.display = 'none';
            document.getElementById('mainUI').style.display = 'flex';
            setTimeout(() => document.getElementById('mainUI').classList.add('visible'), 50);
            updateUserPanel();
            if (chats.length === 0) renderEmptyState(); else renderChat();
        } else if (!currentUser) {
            document.getElementById('choiceScreen').style.display = 'flex';
            setupDiamkeyButton();
        }
        
        setupEventListeners();
        updateUserPanel();
        updateSendButtonState();
        if (chats.length) renderHistory();
        
        document.documentElement.style.setProperty('--collapsed-left-offset', '85px');
        log('Готово');
    })();
})();
