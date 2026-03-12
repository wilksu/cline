// ==UserScript==
// @name         Universal Automator Bridge (V0.50 - Hybrid Pro)
// @namespace    http://tampermonkey.net/
// @version      0.50
// @description  融合版：支持多平台适配、读取已有内容追加、智能剪贴板轮询及随机延迟发送。
// @author       Su (via Gemini)
// @match        https://gemini.google.com/*
// @match        https://chatgpt.com/*
// @match        https://claude.ai/*
// @match        https://chat.deepseek.com/*
// @match        https://chat.qwen.ai/*
// @match        https://copilot.microsoft.com/*
// @grant        GM_log
// @grant        GM_addStyle
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_setClipboard
// ==/UserScript==

(function() {
    'use strict';

    // --- 配置与持久化 ---
    const STORAGE_KEY = 'tm_bridge_config';
    const savedConfig = GM_getValue(STORAGE_KEY, {
        host: 'localhost',
        port: '3456',
        defaultCmd: "ls: -R\nread: CLAUDE.md",
        delayMin: 1500,
        delayMax: 4500
    });

    // --- 平台适配器定义 ---
    const ADAPTERS = {
        'chatgpt.com': {
            name: 'ChatGPT',
            input: '#prompt-textarea',
            sendBtn: '[data-testid="send-button"]',
            stopBtn: '[data-testid="stop-button"]',
            copyBtn: 'button[data-testid="copy-turn-action-button"]',
            // 获取内容：ChatGPT 使用 textarea
            getContent: (el) => el.value,
            // 写入内容：使用 DataTransfer 模拟原生粘贴以保持高性能
            fixInput: (el, text) => {
                el.focus();
                const dataTransfer = new DataTransfer();
                dataTransfer.setData('text/plain', text);
                const pasteEvent = new ClipboardEvent('paste', {
                    clipboardData: dataTransfer,
                    bubbles: true,
                    cancelable: true
                });
                el.dispatchEvent(pasteEvent);
            }
        },
        'gemini.google.com': {
            name: 'Gemini',
            input: 'div.ql-editor[contenteditable="true"]',
            sendBtn: 'button[aria-label="Send message"]',
            stopBtn: 'button[aria-label="Stop response"]',
            copyBtn: 'button[data-test-id="copy-button"]',
            getContent: (el) => el.innerText || el.textContent,
            fixInput: (el, text) => {
                el.focus();
                const inserted = document.execCommand('insertText', false, text);
                if (!inserted) el.innerText = (el.innerText || "") + text;
                ['input', 'change', 'compositionend'].forEach(t => el.dispatchEvent(new Event(t, { bubbles: true })));
            }
        },
        'chat.qwen.ai': {
            name: 'Qwen',
            input: 'textarea.message-input-textarea',
            sendBtn: 'button.send-button, .omni-button-content-btn',
            stopBtn: 'button:has(.icon-stop)',
            copyBtn: '.qwen-icon-copy',
            getContent: (el) => el.value,
            fixInput: (el, text) => {
                el.focus();
                const existing = el.value || "";
                const target = existing + text;
                // 注入技术：通过原型链强制修改 React 受控组件的 value
                const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
                setter.call(el, target);
                el.dispatchEvent(new Event('input', { bubbles: true }));
            }
        },
        'copilot.microsoft.com': {
            name: 'Copilot',
            input: 'textarea#userInput',
            sendBtn: 'button[data-testid="submit-button"]',
            stopBtn: 'button[aria-label="停止响应"]',
            copyBtn: 'button[data-testid="copy-ai-message-button"]',
            getContent: (el) => el.value,
            fixInput: (el, text) => {
                el.focus();
                const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
                setter.call(el, (el.value || "") + text);
                el.dispatchEvent(new Event('input', { bubbles: true }));
            }
        },
        'claude.ai': {
            name: 'Claude',
            input: 'div[contenteditable="true"]',
            sendBtn: 'button[aria-label="Send Message"]',
            stopBtn: 'button[aria-label="Stop Response"]',
            copyBtn: 'button:has(svg[class*="lucide-copy"])',
            getContent: (el) => el.innerText,
            fixInput: (el, text) => {
                el.focus();
                if (!document.execCommand('insertText', false, text)) {
                    el.innerText = (el.innerText || "") + text;
                }
                el.dispatchEvent(new Event('input', { bubbles: true }));
            }
        }
    };

    // --- 运行环境识别 ---
    const domain = Object.keys(ADAPTERS).find(d => location.hostname.includes(d));
    const Active = ADAPTERS[domain] || ADAPTERS['chatgpt.com'];

    // --- 状态管理 ---
    const State = {
        ws: null,
        isConnected: false,
        isGenerating: false,
        loopMode: false,
        autoPaste: true,
        autoSend: false,
        autoCapture: false,
        lastCapturedText: '',
        consecutiveErrors: 0
    };

    // --- 样式注入 ---
    GM_addStyle(`
        :root { 
            --br-bg: #ffffff; 
            --br-text: #1a1a1a; 
            --br-border: #cccccc; 
            --br-primary: #0078d4; 
            --br-buoy-bg: #ffffff; 
            --br-input-bg: #f5f5f5;
        }
        @media (prefers-color-scheme: dark) { 
            :root { 
                --br-bg: #1e1e1e; 
                --br-text: #eeeeee; 
                --br-border: #444444; 
                --br-primary: #0e639c; 
                --br-buoy-bg: #252526; 
                --br-input-bg: #111111;
            } 
        }

        #tm-buoy { 
            position: fixed; bottom: 20px; right: 20px; width: 50px; height: 50px; border-radius: 25px; 
            background: var(--br-buoy-bg); border: 2px solid #666; display: flex; align-items: center; 
            justify-content: center; cursor: pointer; z-index: 10000; font-size: 10px; font-weight: bold; 
            color: var(--br-text); transition: 0.3s; flex-direction: column; 
        }
        #tm-buoy.status-offline { border-color: #e74c3c; color: #e74c3c; }
        #tm-buoy.status-idle { border-color: #4cd964; color: #4cd964; }
        #tm-buoy.status-ai_gen { border-color: #f39c12; color: #f39c12; box-shadow: 0 0 15px rgba(243, 156, 18, 0.4); }
        
        #tm-panel { position: fixed; bottom: 80px; right: 20px; width: 250px; background: var(--br-bg); color: var(--br-text); border: 1px solid var(--br-border); border-radius: 8px; padding: 12px; z-index: 9999; box-shadow: 0 8px 24px rgba(0,0,0,0.5); font-family: 'Segoe UI', sans-serif; }
        #tm-panel.hidden { display: none; }
        
        .tm-row { margin-bottom: 8px; }
        .tm-input { background: var(--br-input-bg); border: 1px solid var(--br-border); color: var(--br-text); padding: 4px 6px; border-radius: 4px; font-size: 11px; width: 100%; }
        .tm-textarea { height: 50px; resize: vertical; font-family: monospace; }
        
        .tm-btn-group { display: flex; gap: 5px; }
        .tm-btn { flex: 1; background: var(--br-border); color: var(--br-text); border: 1px solid var(--br-border); padding: 5px; border-radius: 4px; cursor: pointer; font-size: 11px; font-weight: bold; }
        .tm-btn.primary { background: var(--br-primary); color: white; border: none; }
        .tm-btn.active { background: #5a3696; border-color: #7a56b6; color: white; }
        
        .tm-toggles { display: grid; grid-template-columns: repeat(3, 1fr); gap: 5px; background: rgba(255,255,255,0.05); padding: 8px; border-radius: 6px; }
        .tm-label { display: flex; align-items: center; gap: 3px; font-size: 10px; color: #aaa; cursor: pointer; }
        .tm-label input:checked + span { color: #4cd964; font-weight: bold; }
        .tm-status-bar { margin-top: 8px; padding-top: 8px; border-top: 1px solid #444; display: flex; justify-content: space-between; font-size: 10px; color: #888; }
        .tm-bubbles-container { position: fixed; top: 20px; right: 20px; z-index: 10001; pointer-events: none; display: flex; flex-direction: column; align-items: flex-end; }
        .tm-bubble { background: var(--br-bg); color: var(--br-text); border: 1px solid var(--br-border); padding: 10px; border-radius: 4px; border-left: 4px solid var(--br-primary); width: 280px; font-size: 12px; margin-bottom: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.3); pointer-events: auto; }
    `);

    // --- 核心工具函数 ---
    const Utils = {
        getRandomDelay() {
            return Math.floor(Math.random() * (savedConfig.delayMax - savedConfig.delayMin + 1)) + savedConfig.delayMin;
        },

        async smartPaste(content) {
            const el = document.querySelector(Active.input);
            if (!el) return;

            // 1. 读取已有内容
            const existingText = Active.getContent(el) || "";
            const needsNewline = existingText.trim().length > 0;

            // 2. 构造追加内容
            const textToInsert = needsNewline ? ("\n" + content) : content;

            // 3. 执行写入
            Active.fixInput(el, textToInsert);
            el.dispatchEvent(new Event('input', { bubbles: true }));

            // 4. 自动发送逻辑 (带随机延迟)
            if (State.autoSend) {
                const delay = this.getRandomDelay();
                this.notify(`⏳ Sending in ${(delay/1000).toFixed(1)}s...`);
                setTimeout(() => {
                    const btn = document.querySelector(Active.sendBtn);
                    if (btn && !btn.disabled) btn.click();
                }, delay);
            }
        },

        notify(msg, isError = false) {
            const container = document.getElementById('tm-bubbles');
            if(!container) return;
            const b = document.createElement('div');
            b.className = 'tm-bubble';
            if(isError) b.style.borderLeftColor = '#e74c3c';
            
            // 增强回显：显示前 100 字符预览，并支持点击复制
            const preview = msg.length > 100 ? msg.substring(0, 100) + '...' : msg;
            b.innerHTML = `
                <div style="display:flex; flex-direction:column; gap:4px; width:100%">
                    <div style="font-weight:bold; color:var(--br-primary); font-size:10px">${isError ? '⚠️ ERROR' : '📩 RECEIVED'}</div>
                    <div style="font-family:monospace; font-size:11px; word-break:break-all; opacity:0.9">${preview.replace(/</g, '&lt;')}</div>
                    <div style="font-size:9px; color:#888; text-align:right">Click to Copy</div>
                </div>
            `;
            b.style.cursor = 'pointer';
            b.onclick = () => {
                GM_setClipboard(msg);
                this.notify('📋 Copied to clipboard');
            };

            container.appendChild(b);
            setTimeout(() => { if(b.parentNode) b.remove(); }, 6000);
        }
    };

    // --- WebSocket 逻辑 ---
    function toggleConnection() {
        if (State.isConnected) {
            State.ws.close();
        } else {
            connect();
        }
    }

    function connect() {
        if (State.ws) {
            State.ws.onclose = null;
            State.ws.close();
        }
        const host = document.getElementById('tm-host').value;
        const port = document.getElementById('tm-port').value;
        GM_setValue(STORAGE_KEY, { ...savedConfig, host, port });

        State.ws = new WebSocket(`ws://${host}:${port}`);

        State.ws.onopen = () => {
            State.isConnected = true;
            updateStatus('Connected', 'idle');
        };

        State.ws.onmessage = (e) => {
            const msg = e.data;
            console.log('[Bridge] WebSocket Received:', msg);
            if (!msg || typeof msg !== 'string') return;

            // 无论如何先弹出回显通知
            const isError = msg.includes('Task failed:') || msg.startsWith('Error:');
            Utils.notify(msg, isError);

            if (State.autoPaste && !isError) {
                Utils.smartPaste(msg);
            }
        };

        State.ws.onclose = () => {
            State.isConnected = false;
            updateStatus('Disconnected', 'offline');
            setTimeout(connect, 5000); // 自动重连
        };
    }

    // --- UI 更新 ---
    function updateStatus(text, status) {
        const dot = document.getElementById('tm-status-dot');
        const txt = document.getElementById('tm-status-text');
        const buoy = document.getElementById('tm-buoy');
        if (dot) dot.style.background = {idle:'#4cd964', offline:'#e74c3c', ai_gen:'#f39c12'}[status] || '#555';
        if (txt) txt.innerText = text;
        if (buoy) {
            buoy.className = `status-${status}`;
            buoy.innerHTML = `<span>${{offline:'OFF', idle:'IDLE', ai_gen:'AI...', busy:'BUSY'}[status] || '???'}</span>`;
        }
    }

    // --- 界面初始化 ---
    function initUI() {
        const buoy = document.createElement('div');
        buoy.id = 'tm-buoy'; buoy.onclick = () => document.getElementById('tm-panel').classList.toggle('hidden');
        document.body.appendChild(buoy);

        const container = document.createElement('div');
        container.id = 'tm-bubbles'; container.className = 'tm-bubbles-container';
        document.body.appendChild(container);

        const panel = document.createElement('div');
        panel.id = 'tm-panel'; panel.className = 'hidden';
        panel.innerHTML = `
            <div style="font-size:9px; color:#666; margin-bottom:5px; font-weight:bold">UNIVERSAL BRIDGE V0.50</div>
            <div class="tm-row tm-btn-group">
                <input type="text" id="tm-host" class="tm-input" value="${savedConfig.host}" style="flex:2">
                <input type="text" id="tm-port" class="tm-input" value="${savedConfig.port}" style="flex:1">
            </div>
            <div class="tm-row">
                <textarea id="tm-cmd-box" class="tm-input tm-textarea">${savedConfig.defaultCmd}</textarea>
            </div>
            <div class="tm-row tm-btn-group">
                <button id="tm-run" class="tm-btn primary">RUN</button>
                <button id="tm-loop" class="tm-btn">♾️ Loop</button>
            </div>
            <div class="tm-toggles">
                <label class="tm-label"><input type="checkbox" id="c-paste" checked><span>Paste</span></label>
                <label class="tm-label"><input type="checkbox" id="c-send"><span>Send</span></label>
                <label class="tm-label"><input type="checkbox" id="c-copy"><span>Copy</span></label>
            </div>
            <div class="tm-status-bar">
                <div><span id="tm-status-dot" style="display:inline-block;width:7px;height:7px;border-radius:50%;margin-right:4px"></span><span id="tm-status-text">Connecting...</span></div>
                <div id="tm-ai-info">AI: Idle</div>
            </div>
        `;
        document.body.appendChild(panel);

        // 事件绑定
        document.querySelector('.tm-status-bar').style.cursor = 'pointer';
        document.querySelector('.tm-status-bar').onclick = toggleConnection;

        document.getElementById('tm-run').onclick = () => {
            if (State.isConnected) State.ws.send(document.getElementById('tm-cmd-box').value);
        };

        document.getElementById('tm-loop').onclick = function() {
            State.loopMode = !State.loopMode;
            this.classList.toggle('active', State.loopMode);
            State.autoSend = State.loopMode;
            State.autoCapture = State.loopMode;
            document.getElementById('c-send').checked = State.loopMode;
            document.getElementById('c-copy').checked = State.loopMode;
        };

        ['c-paste','c-send','c-copy'].forEach(id => {
            document.getElementById(id).onchange = (e) => {
                const prop = id === 'c-paste' ? 'autoPaste' : id === 'c-send' ? 'autoSend' : 'autoCapture';
                State[prop] = e.target.checked;
            };
        });
    }

    // --- 状态监听与剪贴板 (核心增强) ---
    function initObserver() {
        setInterval(async () => {
            const currentlyGenerating = !!document.querySelector(Active.stopBtn);

            if (State.isGenerating !== currentlyGenerating) {
                State.isGenerating = currentlyGenerating;
                document.getElementById('tm-ai-info').innerText = currentlyGenerating ? 'AI: Thinking' : 'AI: Finished';
                updateStatus(State.isConnected ? 'Connected' : 'Disconnected', currentlyGenerating ? 'ai_gen' : 'idle');

                // 自动化逻辑：当生成结束且开启自动捕获时
                if (!currentlyGenerating && State.autoCapture) {
                    setTimeout(() => {
                        const btns = document.querySelectorAll(Active.copyBtn);
                        if (btns.length > 0) btns[btns.length-1].click();
                    }, 1000);
                }
            }
        }, 1000);
    }

    // --- 全局拦截：监听所有点击事件，处理复制按钮转发 ---
    document.addEventListener('click', async (e) => {
        const btn = e.target.closest(Active.copyBtn);
        if (btn && State.isConnected) {
            console.log('[Bridge] Copy button clicked, starting capture...');
            Utils.notify('⏳ Capturing clipboard...');

            const oldText = State.lastCapturedText;
            let attempts = 0;
            const maxAttempts = 15; // 延长到 1.5 秒

            const check = setInterval(async () => {
                attempts++;
                try {
                    const newText = await navigator.clipboard.readText();
                    // 满足以下任一条件即发送：
                    // 1. 内容变了
                    // 2. 轮询超过 1 秒且内容不为空（处理手动重发相同内容）
                    if (newText && (newText !== oldText || attempts > 10)) {
                        clearInterval(check);
                        State.lastCapturedText = newText;
                        State.ws.send(newText);
                        Utils.notify('📋 Content sent to VS Code');
                        console.log('[Bridge] Content sent successfully.');
                    } else if (attempts >= maxAttempts) {
                        clearInterval(check);
                        console.warn('[Bridge] Capture timeout or no new content.');
                    }
                } catch (err) {
                    clearInterval(check);
                    Utils.notify('❌ Clipboard access denied. Please click on the page first.', true);
                }
            }, 100);
        }
    }, true);

    initUI();
    connect();
    initObserver();
})();