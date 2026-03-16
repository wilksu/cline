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

    // --- 配置与持久化 (URL/Session 感知存储) ---
    const GLOBAL_KEY = 'tm_bridge_config_global';
    const DOMAIN_KEY = `tm_bridge_config_${location.hostname}`;
    // 获取当前 Session 的唯一标识 (去掉搜索参数，保留路径中的 ID)
    const SESSION_KEY = `tm_bridge_session_${location.origin}${location.pathname}`;
    
    const getConfig = () => {
        const defaultConfig = {
            host: 'localhost',
            port: '3456',
            defaultCmd: "ls: -R\nread: CLAUDE.md",
            delayMin: 1500,
            delayMax: 4500
        };
        // 优先级：当前 Session > 当前域名 > 全局备份 > 默认
        return GM_getValue(SESSION_KEY, 
               GM_getValue(DOMAIN_KEY, 
               GM_getValue(GLOBAL_KEY, defaultConfig)));
    };
    let savedConfig = getConfig();

    // --- platform adapter defines ---
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
                // 异步触发，防止阻塞当前执行栈
                setTimeout(() => el.dispatchEvent(pasteEvent), 0);
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
                // 修正：不再手动清空 innerHTML，而是全选内容让 insertText 覆盖，防止浏览器自动补段落
                if (el.innerHTML === '<p><br></p>') {
                    const range = document.createRange();
                    range.selectNodeContents(el);
                    const sel = window.getSelection();
                    sel.removeAllRanges();
                    sel.addRange(range);
                }

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
        consecutiveErrors: 0,
        minimapItems: [], // 存储对话条目信息: { id, text, element }
        minimapLastSig: '', // 用于检测内容变化的签名
        isConnecting: false // 连接锁
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

        #tm-panel { position: fixed; bottom: 80px; right: 20px; width: 250px; background: var(--br-bg); color: var(--br-text); border: 1px solid var(--br-border); border-radius: 8px; padding: 12px; z-index: 10005; box-shadow: 0 8px 24px rgba(0,0,0,0.5); font-family: 'Segoe UI', sans-serif; }
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
        .tm-bubbles-container { position: fixed; top: 20px; right: 20px; z-index: 10020; pointer-events: none; display: flex; flex-direction: column; align-items: flex-end; }
        .tm-bubble { 
            background: var(--br-bg); color: var(--br-text); border: 1px solid var(--br-border); 
            padding: 5px 10px; border-radius: 8px; border-left: 3px solid var(--br-primary); 
            width: 180px; font-size: 11px; margin-bottom: 6px; box-shadow: 0 4px 15px rgba(0,0,0,0.4); 
            pointer-events: auto; cursor: pointer; position: relative; overflow: hidden;
            transition: 0.2s;
        }
        .tm-bubble:hover { transform: scale(1.02); }
        .tm-bubble-watermark {
            position: absolute; right: -5px; bottom: -5px; font-size: 22px; font-weight: 900;
            color: var(--br-text); opacity: 0.04; pointer-events: none; user-select: none;
        }

        /* Minimap 独立悬浮样式 */
        #tm-minimap {
            position: fixed; right: 15px; top: 50%; transform: translateY(-50%);
            width: 110px; height: 65vh; z-index: 9995;
            background: rgba(128, 128, 128, 0.03); backdrop-filter: blur(12px);
            padding: 10px 5px; overflow-y: auto; overflow-x: hidden;
            display: flex; flex-direction: column; gap: 4px;
            scrollbar-width: none; border-radius: 12px; border: none;
            transition: 0.3s;
        }
        /* 导出按钮作为 Minimap 的左侧“挂件” */
        #tm-mini-exp {
            position: fixed; right: 125px; top: 50%; transform: translateY(-50%);
            width: 28px; height: 28px; border-radius: 14px;
            background: var(--br-bg); border: 1px solid rgba(128,128,128,0.2);
            display: flex; align-items: center; justify-content: center;
            cursor: pointer; z-index: 9996; font-size: 14px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.15); opacity: 0.8; transition: 0.2s;
        }
        #tm-mini-exp:hover { opacity: 1; transform: translateY(-50%) scale(1.1); background: var(--br-primary); color: white; }
        @media (max-width: 1200px) { #tm-minimap { right: 10px; width: 60px; } .minimap-text { display: none; } }
        #tm-minimap::-webkit-scrollbar { display: none; }
        
        .minimap-item {
            display: flex; align-items: center; justify-content: space-between;
            padding: 4px 6px; font-size: 9px; color: var(--br-text);
            border-radius: 4px; cursor: pointer; transition: all 0.2s ease;
            background: rgba(128,128,128,0.1); border-right: 3px solid transparent;
            opacity: 0.35;
        }
        /* 鼠标进入容器时，非聚焦项整体压暗 */
        #tm-minimap:hover .minimap-item { opacity: 0.5; }
        
        /* 聚焦项与激活项：突出显示 */
        .minimap-item:hover, .minimap-item.active { 
            opacity: 1 !important; 
            background: rgba(var(--br-primary), 0.25); 
            border-right-color: var(--br-primary);
            transform: translateX(-2px) scale(1.02);
            z-index: 5;
        }
        /* 相邻项微亮效果 */
        .minimap-item:hover + .minimap-item { opacity: 0.8 !important; }
        .minimap-item:hover { 
            background: rgba(var(--br-primary), 0.15); 
            border-left-color: var(--br-primary);
            transform: translateX(-2px);
        }
        .minimap-text {
            white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex: 1; opacity: 0.7;
            font-family: 'Segoe UI', system-ui;
        }
        .minimap-copy-btn {
            display: none; padding: 2px 5px; background: var(--br-primary);
            color: white; border-radius: 3px; font-size: 8px; font-weight: bold;
        }
        .minimap-item:hover .minimap-copy-btn { display: block; }
        .highlight-flash { animation: flash-green 1.5s; }
        @keyframes flash-green { 0% { box-shadow: 0 0 0 4px #4cd964; } 100% { box-shadow: 0 0 0 0 transparent; } }
    `);

    // --- 核心工具函数 ---
    const Utils = {
        // 核心：深度提取 Markdown 内容 (模拟原生复制效果)
        extractMarkdown(node) {
            // 1. 尝试寻找各平台通用的 Markdown 源码容器
            const mdSelectors = [
                '.markdown', // ChatGPT, Claude
                'ms-cmark-node', // AI Studio
                '.model-response-text', // Gemini
                '.message-content' // General
            ];
            
            for (const sel of mdSelectors) {
                const target = node.querySelector(sel);
                if (target) {
                    // 关键：textContent 往往比 innerText 更能保留原始 Markdown 的换行和代码块结构
                    return target.textContent.trim();
                }
            }
            
            // 2. 降级方案：如果找不到专用容器，手动处理代码块
            const clone = node.cloneNode(true);
            clone.querySelectorAll('pre, code-block').forEach(cb => {
                const code = cb.querySelector('code')?.textContent || cb.textContent;
                const lang = cb.getAttribute('data-lang') || '';
                cb.replaceWith(`\n\`\`\`${lang}\n${code.trim()}\n\`\`\`\n`);
            });
            return clone.innerText.trim();
        },

        // 获取或为元素生成 ID 用于跳转锚点
        getAnchorId(el) {
            if (el.id) return el.id;
            const id = 'tm-msg-' + Math.random().toString(36).substr(2, 9);
            el.setAttribute('id', id);
            return id;
        },

        // 防抖函数
        debounce(fn, delay) {
            let timer = null;
            return function() {
                if (timer) clearTimeout(timer);
                timer = setTimeout(() => fn.apply(this, arguments), delay);
            };
        },

        getRandomDelay() {
            return Math.floor(Math.random() * (savedConfig.delayMax - savedConfig.delayMin + 1)) + savedConfig.delayMin;
        },

        async smartPaste(content) {
            const el = document.querySelector(Active.input);
            if (!el) return;

            const existingText = (Active.getContent(el) || "").trimEnd();
            const textToInsert = (existingText ? "\n" : "") + content;

            // 优化：使用 requestAnimationFrame 确保在下一帧处理，减少阻塞感
            requestAnimationFrame(() => {
                Active.fixInput(el, textToInsert);
                
                if (State.autoSend) {
                    const delay = this.getRandomDelay();
                    this.notify(`⏳ Sending in ${(delay/1000).toFixed(1)}s...`);
                    setTimeout(() => {
                        const btn = document.querySelector(Active.sendBtn);
                        if (btn && !btn.disabled) {
                            btn.click();
                            // 修正：发送后 UI 可能需要重置，且 Minimap 应刷新
                            setTimeout(() => updateMinimap(true), 500);
                        }
                    }, delay);
                }
            });
        },

        notify(msg, isError = false) {
            const container = document.getElementById('tm-bubbles');
            if(!container) return;
            const b = document.createElement('div');
            b.className = 'tm-bubble';
            if(isError) b.style.borderLeftColor = '#e74c3c';

            const icon = isError ? '⚠️' : '🚀';
            const preview = msg.length > 40 ? msg.substring(0, 40) + '...' : msg;
            
            b.innerHTML = `
                <div style="display:flex; align-items:center; gap:8px">
                    <span style="font-size:14px">${icon}</span>
                    <div style="flex:1; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; opacity:0.85">${preview.replace(/</g, '&lt;')}</div>
                </div>
                <div class="tm-bubble-watermark">COPY</div>
            `;
            
            b.onclick = () => {
                GM_setClipboard(msg);
                this.notify('📋 Copied', false);
            };

            container.appendChild(b);
            setTimeout(() => { if(b.parentNode) b.remove(); }, 3000);
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
        if (State.isConnecting || (State.ws && State.ws.readyState === WebSocket.OPEN)) return;
        State.isConnecting = true;

        const hostEl = document.getElementById('tm-host');
        const portEl = document.getElementById('tm-port');
        const cmdEl = document.getElementById('tm-cmd-box');
        
        const host = (hostEl && hostEl.value) ? hostEl.value : savedConfig.host;
        const port = (portEl && portEl.value) ? portEl.value : savedConfig.port;
        const defaultCmd = (cmdEl && cmdEl.value) ? cmdEl.value : savedConfig.defaultCmd;
        
        // 更新内存中的配置
        savedConfig = { ...savedConfig, host, port, defaultCmd };
        
        // 三级持久化存储：
        GM_setValue(SESSION_KEY, savedConfig); // 1. 记住当前对话的特殊配置
        GM_setValue(DOMAIN_KEY, savedConfig);  // 2. 更新该平台的默认值
        GM_setValue(GLOBAL_KEY, savedConfig);  // 3. 更新全局默认值

        try {
            State.ws = new WebSocket(`ws://${host}:${port}`);
            
            State.ws.onopen = () => {
                State.isConnected = true;
                State.isConnecting = false;
                State.consecutiveErrors = 0;
                updateStatus('Connected', 'idle');
            };

            State.ws.onmessage = (e) => {
                const msg = e.data;
                console.log('[Bridge] WebSocket Received:', msg);
                if (!msg || typeof msg !== 'string') return;

                let parsedData;
                try {
                    parsedData = JSON.parse(msg);
                } catch (err) {
                    const isErr = msg.includes('Error:') || msg.includes('Task failed:');
                    Utils.notify(msg, isErr);
                    if (State.autoPaste && !isErr) Utils.smartPaste(msg);
                    return;
                }

                if (parsedData.type === 'batch_result' || parsedData.type === 'fatal_error') {
                    let hasError = false;
                    let llmMarkdown = "";

                    if (parsedData.type === 'fatal_error') {
                        hasError = true;
                        Utils.notify(parsedData.error, true);
                        llmMarkdown = `[FATAL ERROR]\n${parsedData.error}`;
                    } else if (parsedData.results && Array.isArray(parsedData.results)) {
                        const formattedResults = parsedData.results.map(r => {
                            const isSuccess = r.status === 'success';
                            if (!isSuccess) hasError = true;
                            const shortCmd = r.command.length > 50 ? r.command.substring(0, 50) + '...' : r.command;
                            Utils.notify(`[${isSuccess ? 'OK' : 'FAIL'}] ${shortCmd}\n${r.output || ''}`, !isSuccess);
                            const header = `[${isSuccess ? 'OK' : 'FAIL'}] ${r.command}`;
                            return r.output ? `${header}\n${r.output}` : header;
                        });
                        llmMarkdown = formattedResults.join("\n\n");
                        if (hasError) {
                            llmMarkdown += "\n\n**SYSTEM NOTE:** Execution stopped due to the error above. Please correct the command and try again.";
                        }
                    }

                    if (State.autoPaste) {
                        if (hasError && State.loopMode) {
                            Utils.notify('⚠️ Error detected. Exiting Loop Mode for safety.', true);
                            if (window._tmSetLoopMode) window._tmSetLoopMode(false);
                        }
                        Utils.smartPaste(llmMarkdown);
                    }
                } else {
                    Utils.notify('Received generic JSON payload', false);
                }
            };

            State.ws.onclose = () => {
                State.isConnected = false;
                State.isConnecting = false;
                updateStatus('Disconnected', 'offline');
                setTimeout(connect, 10000);
            };

            State.ws.onerror = () => {
                State.isConnecting = false;
                State.consecutiveErrors++;
            };
        } catch (e) {
            State.isConnecting = false;
            console.error('[Bridge] WebSocket initialization failed:', e);
        }
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
            <div id="tm-export" style="display:none"></div>
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

        // 全文导出逻辑 (独立扫描，抓取原始源码，增强稳定性)
        document.getElementById('tm-export').onclick = () => {
            const selectors = [
                '.conversation-container',
                'model-response',
                'article[data-testid*="turn"]',
                '.claude-message',
                'ms-chat-turn'
            ];

            const nodes = document.querySelectorAll(selectors.join(', '));
            if (nodes.length === 0) {
                Utils.notify('❌ No content found. Try scrolling.', true);
                return;
            }

            const rawTitle = document.title.replace(/[\\/:*?"<>|]/g, '_');
            const title = rawTitle.split('-')[0].trim() || 'Chat_Export';
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);
            
            let mdContent = `# ${title}\n> **Exported**: ${new Date().toLocaleString()}\n\n---\n\n`;
            
            nodes.forEach((node, idx) => {
                const content = Utils.extractMarkdown(node);
                if (content) {
                    const isUser = node.querySelector('user-query, [data-testid*="user"]') || node.innerText.length < 350;
                    mdContent += `### ${isUser ? '👤 User' : '🤖 Assistant'}\n\n${content}\n\n---\n\n`;
                }
            });

            const blob = new Blob([mdContent], { type: 'text/markdown;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${title}_${timestamp}.md`;
            a.click();
            URL.revokeObjectURL(url);
            Utils.notify('💾 Exported as Markdown');
        };

        // 抽取为独立函数，方便在错误时触发降级
        window._tmSetLoopMode = function(enable) {
            State.loopMode = enable;
            const btn = document.getElementById('tm-loop');
            if (btn) btn.classList.toggle('active', enable);
            State.autoSend = enable;
            State.autoCapture = enable;
            const cSend = document.getElementById('c-send');
            const cCopy = document.getElementById('c-copy');
            if (cSend) cSend.checked = enable;
            if (cCopy) cCopy.checked = enable;
        };

        document.getElementById('tm-loop').onclick = function() {
            window._tmSetLoopMode(!State.loopMode);
        };

        ['c-paste','c-send','c-copy'].forEach(id => {
            document.getElementById(id).onchange = (e) => {
                const prop = id === 'c-paste' ? 'autoPaste' : id === 'c-send' ? 'autoSend' : 'autoCapture';
                State[prop] = e.target.checked;
            };
        });

        // 注入 Minimap 容器 (改为 body 直属，实现悬浮)
        if (!document.getElementById('tm-minimap')) {
            const minimap = document.createElement('div');
            minimap.id = 'tm-minimap';
            document.body.appendChild(minimap);
        }
    }

    // --- Minimap 逻辑核心 ---
    const Minimap = {
        lastActiveIdx: -1,

        update(force = false) {
            const container = document.getElementById('tm-minimap');
            const nodes = this.getNodes();
            if (!container || nodes.length === 0) return;

            const sig = nodes.map(n => n.innerText.length).join('|');
            if (!force && State.minimapLastSig === sig) return this.syncActive(nodes);
            
            State.minimapLastSig = sig;
            // 保持背景纯净，按钮移出到外部
            container.innerHTML = '';
            if (!document.getElementById('tm-mini-exp')) {
                const btn = document.createElement('div');
                btn.id = 'tm-mini-exp'; btn.innerHTML = '💾'; btn.title = 'Export Markdown';
                document.body.appendChild(btn);
            }
            
            nodes.forEach((node, idx) => {
                const summary = (node.innerText || "").trim().substring(0, 18).replace(/\n/g, ' ') || '...';
                const item = document.createElement('div');
                item.className = 'minimap-item';
                item.innerHTML = `<span class="minimap-text">${idx+1}. ${summary}</span><span class="minimap-copy-btn">SEND</span>`;
                item.onclick = (e) => e.target.classList.contains('minimap-copy-btn') ? 
                    (State.isConnected && State.ws.send(Utils.extractMarkdown(node))) : 
                    node.scrollIntoView({ behavior: 'smooth', block: 'center' });
                container.appendChild(item);
            });
            this.syncActive(nodes);
        },

        getNodes() {
            const sel = {
                'gemini.google.com': '.conversation-container, model-response, [id^="conversation-turn-"]',
                'chatgpt.com': 'article[data-testid*="turn"]',
                'claude.ai': '.claude-message, [data-testid="user-message"]'
            }[domain] || '.conversation-container';
            return Array.from(document.querySelectorAll(sel));
        },

        syncActive(nodes) {
            const items = document.querySelectorAll('.minimap-item');
            const vCenter = window.innerHeight / 2;
            let current = nodes.findIndex(n => {
                const r = n.getBoundingClientRect();
                return r.top < vCenter && r.bottom > vCenter;
            });
            if (current === -1) current = nodes.findIndex(n => n.getBoundingClientRect().top > 0);

            if (current !== this.lastActiveIdx && items[current]) {
                if (items[this.lastActiveIdx]) items[this.lastActiveIdx].classList.remove('active');
                items[current].classList.add('active');
                // 解决回弹：仅在索引变化且非 AI 生成时平滑滚动
                if (!State.isGenerating) {
                    items[current].parentElement.scrollTo({ top: items[current].offsetTop - 80, behavior: 'smooth' });
                }
                this.lastActiveIdx = current;
            }
        }
    };

    // --- 状态监听与剪贴板 (核心增强) ---
    function initObserver() {
        // 0. 滚动监听：更新 Minimap 光标位置
        const handleScroll = Utils.debounce(() => {
            const containers = {
                'gemini.google.com': '.conversation-container, model-response, [id^="conversation-turn-"], .chat-scrollable-container',
                'chatgpt.com': 'article[data-testid*="turn"]',
                'claude.ai': '.claude-message, [data-testid="user-message"]',
                'chat.qwen.ai': '.message-item'
            }[domain] || '.conversation-container';
            const nodes = Array.from(document.querySelectorAll(containers));
            if (nodes.length > 0) updateActiveItem(nodes);
        }, 100);

        window.addEventListener('scroll', handleScroll, { passive: true });
        // 针对某些局部滚动的容器
        document.addEventListener('scroll', handleScroll, { capture: true, passive: true });

        // 针对新位置的导出按钮绑定事件 (重构成独立的导出逻辑，不再依赖隐藏按钮)
        document.addEventListener('click', (e) => {
            if (e.target.closest('#tm-mini-exp')) {
                const selectors = [
                    '.conversation-container',
                    'model-response',
                    'article[data-testid*="turn"]',
                    '.claude-message',
                    'ms-chat-turn'
                ];

                const nodes = document.querySelectorAll(selectors.join(', '));
                if (nodes.length === 0) {
                    Utils.notify('❌ No content found.', true);
                    return;
                }

                const rawTitle = document.title.replace(/[\\/:*?"<>|]/g, '_');
                const title = rawTitle.split('-')[0].trim() || 'Chat_Export';
                // 精确到秒的时间戳
                const now = new Date();
                const timestamp = `${now.getFullYear()}${(now.getMonth()+1).toString().padStart(2,'0')}${now.getDate().toString().padStart(2,'0')}_${now.getHours().toString().padStart(2,'0')}${now.getMinutes().toString().padStart(2,'0')}${now.getSeconds().toString().padStart(2,'0')}`;
                
                let mdContent = `# ${title}\n> **Exported**: ${now.toLocaleString()}\n\n---\n\n`;
                
                nodes.forEach((node) => {
                    const content = Utils.extractMarkdown(node);
                    if (content) {
                        const isUser = node.querySelector('user-query, [data-testid*="user"]') || node.innerText.length < 350;
                        mdContent += `### ${isUser ? '👤 User' : '🤖 Assistant'}\n\n${content}\n\n---\n\n`;
                    }
                });

                const blob = new Blob([mdContent], { type: 'text/markdown;charset=utf-8' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `${title}_${timestamp}.md`;
                a.click();
                URL.revokeObjectURL(url);
                Utils.notify('💾 Exported with seconds!');
            }
        });

        // 1. 生成状态轮询
        setInterval(async () => {
            const currentlyGenerating = !!document.querySelector(Active.stopBtn);

            if (State.isGenerating !== currentlyGenerating) {
                State.isGenerating = currentlyGenerating;
                document.getElementById('tm-ai-info').innerText = currentlyGenerating ? 'AI: Thinking' : 'AI: Finished';
                updateStatus(State.isConnected ? 'Connected' : 'Disconnected', currentlyGenerating ? 'ai_gen' : 'idle');

                if (!currentlyGenerating && State.autoCapture) {
                    setTimeout(() => {
                        const btns = document.querySelectorAll(Active.copyBtn);
                        if (btns.length > 0) btns[btns.length-1].click();
                    }, 1000);
                }
                // 生成结束后刷新 Minimap
                if (!currentlyGenerating) Minimap.update(true);
            }
        }, 1000);

        // 2. 动态加载监听 (MutationObserver) 处理 Infinite Scroll
        const observer = new MutationObserver(Utils.debounce(() => {
            Minimap.update();
        }, 800));

        observer.observe(document.body, { childList: true, subtree: true });
        
        // 初始执行一次
        Minimap.update();
    }

    // --- 核心优化：混合捕获机制 (拦截 + 轮询保底) ---
    const originalWriteText = navigator.clipboard.writeText;
    navigator.clipboard.writeText = async function(text) {
        if (State.isConnected) {
            console.log('[Bridge] Clipboard API Intercepted:', text.substring(0, 30) + "...");
            State.ws.send(text);
            Utils.notify('🚀 Content sent (API)');
        }
        return originalWriteText.apply(this, arguments);
    };

    document.addEventListener('click', async (e) => {
        const btn = e.target.closest(Active.copyBtn);
        if (btn && State.isConnected) {
            Utils.notify('⏳ Capturing...');

            let oldText = "";
            try { oldText = await navigator.clipboard.readText(); } catch(e) {}
            
            // 轮询检查剪贴板是否更新
            let attempts = 0;
            const check = setInterval(async () => {
                attempts++;
                try {
                    const newText = await navigator.clipboard.readText();
                    // 如果内容变了，或者虽然没变但已经确认点击了复制按钮且重试多次
                    if (newText && (newText !== oldText || attempts > 8)) {
                        clearInterval(check);
                        // 强制更新并发送，不再判断内容是否一致，以响应用户的手动点击
                        State.lastCapturedText = newText;
                        State.ws.send(newText);
                        Utils.notify('📋 Content sent (Polling)');
                    } else if (attempts >= 15) {
                        clearInterval(check);
                    }
                } catch (err) {
                    if (attempts >= 15) clearInterval(check);
                }
            }, 100);
        }
    }, true);

    initUI();
    connect();
    initObserver();
})();