// ==UserScript==
// @name         Gemini Automator Bridge (V0.24 - Master Switch)
// @namespace    http://tampermonkey.net/
// @version      0.24
// @description  引入“Loop Mode”主开关，一键进入/退出全自动模式。修复了状态同步逻辑。
// @author       Su (via Gemini)
// @match        https://gemini.google.com/*
// @grant        GM_log
// ==/UserScript==

(function() {
    'use strict';

    // --- 配置常量 ---
    const CONFIG = {
        inputSelectors: [
            'div.ql-editor[contenteditable="true"]',
            'div[role="textbox"][contenteditable="true"]',
            'div[data-placeholder="Ask Gemini"]'
        ],
        sendButtonSelectors: [
            'button[aria-label="Send message"]',
            'button.send-button'
        ],
        // 关键：检测正在生成的标志
        stopButtonSelector: 'button[aria-label="Stop response"]',
        // 关键：复制按钮
        copyButtonSelector: 'button[data-test-id="copy-button"]',
        wsUrl: 'ws://localhost:3456',
        panelId: 'tm-vscode-panel',
        defaultCmd: "ls: -R\nread: CLAUDE.md"
    };

    // --- 状态管理 ---
    const State = {
        ws: null,
        isConnected: false,
        isWaitingResponse: false, // UI 按钮状态
        isGenerating: false,      // AI 是否正在生成
        
        // 错误追踪
        consecutiveErrors: 0,
        
        // 随机延迟配置 (毫秒)
        delays: {
            min: 1500,
            max: 4500
        },

        // 开关
        loopMode: false,    // 主开关
        autoPaste: false,
        autoSend: false,
        autoCapture: false,
    };

    // --- 样式注入 ---
    function injectStyles() {
        if (document.getElementById('tm-vscode-styles')) return;
        const style = document.createElement('style');
        style.id = 'tm-vscode-styles';
        style.innerHTML = `
            #${CONFIG.panelId} {
                position: fixed; bottom: 80px; right: 20px; /* 向上移动，给浮标留位置 */
                display: flex; flex-direction: column; gap: 8px; align-items: flex-end;
                z-index: 9999; font-family: 'Segoe UI', sans-serif; font-size: 12px;
                transition: opacity 0.3s, transform 0.3s;
                transform-origin: bottom right;
            }
            #${CONFIG.panelId}.hidden {
                opacity: 0; pointer-events: none; transform: scale(0.9);
            }

            /* Buoy Styles */
            #tm-buoy {
                position: fixed; bottom: 20px; right: 20px;
                width: 50px; height: 50px; border-radius: 25px;
                background: #252526; border: 2px solid #555;
                box-shadow: 0 4px 10px rgba(0,0,0,0.5);
                display: flex; align-items: center; justify-content: center;
                cursor: pointer; z-index: 10000;
                font-weight: bold; font-size: 10px; color: #fff;
                transition: all 0.3s; user-select: none;
                flex-direction: column; gap: 2px;
            }
            #tm-buoy:hover { transform: scale(1.1); }
            
            /* Status Colors */
            #tm-buoy.status-offline { border-color: #e74c3c; color: #e74c3c; } /* Red */
            #tm-buoy.status-idle { border-color: #4cd964; color: #4cd964; } /* Green */
            #tm-buoy.status-ai { border-color: #f39c12; color: #f39c12; box-shadow: 0 0 15px rgba(243, 156, 18, 0.4); } /* Yellow */
            #tm-buoy.status-busy { border-color: #3498db; color: #3498db; animation: tm-pulse 1s infinite; } /* Blue */
            
            @keyframes tm-pulse { 0% { box-shadow: 0 0 0 0 rgba(52, 152, 219, 0.4); } 70% { box-shadow: 0 0 0 10px rgba(52, 152, 219, 0); } 100% { box-shadow: 0 0 0 0 rgba(52, 152, 219, 0); } }

            .tm-card {
                background: rgba(30, 30, 30, 0.98); border: 1px solid #444;
                border-radius: 8px; padding: 12px; box-shadow: 0 4px 20px rgba(0,0,0,0.5);
                backdrop-filter: blur(10px); color: #ccc; width: 240px;
            }
            .tm-row { display: flex; gap: 6px; align-items: center; margin-bottom: 8px; }
            .tm-row:last-child { margin-bottom: 0; }
            
            .tm-textarea {
                background: #111; border: 1px solid #555; color: #eee;
                padding: 6px; border-radius: 4px; width: 100%; height: 50px;
                resize: vertical; font-family: monospace; font-size: 11px;
            }
            .tm-textarea:focus { border-color: #3498db; outline: none; }

            .tm-btn {
                background: #3c3c3c; color: #ccc; border: 1px solid #555; border-radius: 4px;
                padding: 5px 10px; cursor: pointer; flex: 1; font-weight: 600;
                transition: all 0.2s; display: flex; align-items: center; justify-content: center;
            }
            .tm-btn:hover { background: #505050; }
            .tm-btn.primary { background: #0e639c; color: white; border: none; }
            .tm-btn.primary:hover { background: #1177bb; }
            
            .tm-btn.loop-active { background: #5a3696; color: white; border-color: #7a56b6; box-shadow: 0 0 8px rgba(90, 54, 150, 0.6); }
            .tm-btn.loop-active:hover { background: #6a46a6; }

            .tm-btn:disabled { background: #333; cursor: not-allowed; opacity: 0.5; }
            
            /* Toggles Grid */
            .tm-toggles {
                display: grid; grid-template-columns: 1fr 1fr; gap: 8px;
                background: rgba(255,255,255,0.05); padding: 8px; border-radius: 6px;
                margin-top: 8px;
            }
            .tm-toggle {
                display: flex; align-items: center; cursor: pointer; gap: 6px;
                user-select: none;
            }
            .tm-toggle input { cursor: pointer; accent-color: #4cd964; }
            .tm-toggle span { font-size: 11px; color: #aaa; }
            .tm-toggle input:checked + span { color: #4cd964; font-weight: bold; }

            /* Status Bar */
            .tm-status {
                font-size: 10px; color: #888; text-align: center; margin-top: 8px;
                padding-top: 6px; border-top: 1px solid #444; display: flex; justify-content: space-between;
            }
            .tm-dot {
                display: inline-block; width: 8px; height: 8px; border-radius: 50%;
                background: #555; margin-right: 4px;
            }
            .tm-dot.on { background: #4cd964; box-shadow: 0 0 5px #4cd964; }
            .tm-dot.off { background: #e74c3c; }
            .tm-dot.busy { background: #f39c12; animation: pulse 1s infinite; }
            
            @keyframes pulse { 0% { opacity: 1; } 50% { opacity: 0.5; } 100% { opacity: 1; } }

            /* Bubbles */
            .tm-bubble-container {
                position: fixed; top: 20px; right: 20px; z-index: 10000;
                display: flex; flex-direction: column; gap: 10px; align-items: flex-end;
                pointer-events: none; /* 让鼠标能穿透空白区域 */
            }
            .tm-bubble {
                pointer-events: auto;
                background: #252526; color: #d4d4d4; padding: 12px; border-radius: 6px;
                border-left: 4px solid #0e639c; width: 320px; font-size: 12px;
                box-shadow: 0 4px 12px rgba(0,0,0,0.3); animation: slideIn 0.3s;
            }
            @keyframes slideIn { from { transform: translateX(50px); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
        `;
        document.head.appendChild(style);
    }

    // --- UI 构建 ---
    function initUI() {
        if (document.getElementById(CONFIG.panelId)) return;

        // 1. Create Buoy
        const buoy = document.createElement('div');
        buoy.id = 'tm-buoy';
        buoy.className = 'status-offline';
        buoy.innerHTML = `<span>OFF</span>`;
        buoy.title = 'Click to toggle panel';
        buoy.onclick = togglePanel;
        document.body.appendChild(buoy);
        
        // 2. Create Panel
        const panel = document.createElement('div');
        panel.id = CONFIG.panelId;

        panel.innerHTML = `
            <div class="tm-card">
                <div style="font-size:10px; color:#666; margin-bottom:5px; display:flex; justify-content:space-between">
                    <span>GEMINI AUTOMATOR</span>
                    <span style="cursor:pointer" onclick="document.getElementById('${CONFIG.panelId}').classList.add('hidden')">_</span>
                </div>
                <div class="tm-row">
                    <textarea id="tm-cmd-input" class="tm-textarea" placeholder="Send manual command...">${CONFIG.defaultCmd}</textarea>
                </div>
                <div class="tm-row">
                    <button id="tm-run-btn" class="tm-btn primary" title="Send command (Kickstart)">RUN</button>
                    <button id="tm-loop-btn" class="tm-btn" title="Toggle Automation Loop">♾️ Loop Mode</button>
                </div>
                
                <div class="tm-toggles">
                    <label class="tm-toggle">
                        <input type="checkbox" id="tm-auto-paste"> <span>Paste</span>
                    </label>
                    <label class="tm-toggle">
                        <input type="checkbox" id="tm-auto-send"> <span>Send</span>
                    </label>
                    <label class="tm-toggle">
                        <input type="checkbox" id="tm-auto-capture"> <span>Copy</span>
                    </label>
                </div>

                <div class="tm-status" id="tm-status-bar">
                    <div>
                        <span class="tm-dot" id="tm-status-dot"></span>
                        <span id="tm-status-text">Disconnected</span>
                    </div>
                    <div id="tm-ai-status" style="opacity:0.5">AI: Idle</div>
                </div>
            </div>
            <div id="tm-bubbles" class="tm-bubble-container"></div>
        `;

        document.body.appendChild(panel);

        // Bind Events
        document.getElementById('tm-run-btn').onclick = manualSend;
        document.getElementById('tm-cmd-input').addEventListener('keydown', (e) => {
            if(e.ctrlKey && e.key === 'Enter') manualSend();
        });
        
        // Loop Switch Logic
        document.getElementById('tm-loop-btn').onclick = toggleLoopMode;

        // Bind Toggles (Individual clicks update state)
        const bindToggle = (id, prop) => {
            const el = document.getElementById(id);
            el.onchange = (e) => { 
                State[prop] = e.target.checked;
                checkLoopState(); // Check if manual toggling matches loop state
            };
        };
        bindToggle('tm-auto-paste', 'autoPaste');
        bindToggle('tm-auto-send', 'autoSend');
        bindToggle('tm-auto-capture', 'autoCapture');
        
        document.getElementById('tm-status-bar').onclick = toggleConnection;
    }

    function togglePanel() {
        const p = document.getElementById(CONFIG.panelId);
        p.classList.toggle('hidden');
    }

    function updateBuoy(state) {
        const buoy = document.getElementById('tm-buoy');
        if(!buoy) return;
        
        // Reset classes
        buoy.className = '';
        
        switch(state) {
            case 'offline':
                buoy.classList.add('status-offline');
                buoy.innerHTML = '<span>OFF</span>';
                break;
            case 'idle':
                buoy.classList.add('status-idle');
                buoy.innerHTML = '<span>IDLE</span>';
                break;
            case 'ai_gen':
                buoy.classList.add('status-ai');
                buoy.innerHTML = '<span style="font-size:8px">AI GEN</span>';
                break;
            case 'busy':
                buoy.classList.add('status-busy');
                buoy.innerHTML = '<span>BUSY</span>';
                break;
        }
    }

    function updateStatus(text, type) {
        const dot = document.getElementById('tm-status-dot');
        const txt = document.getElementById('tm-status-text');
        if(dot && txt) {
            txt.textContent = text;
            dot.className = 'tm-dot ' + (type === 'on' ? 'on' : type === 'off' ? 'off' : 'busy');
        }

        // Mapping to Buoy State
        if (type === 'off') updateBuoy('offline');
        else if (type === 'busy') updateBuoy('busy');
        else if (State.isGenerating) updateBuoy('ai_gen');
        else updateBuoy('idle');
    }

    // --- Loop Mode Logic ---
    
    function toggleLoopMode() {
        State.loopMode = !State.loopMode;
        
        // UI Update
        const btn = document.getElementById('tm-loop-btn');
        const toggles = ['tm-auto-paste', 'tm-auto-send', 'tm-auto-capture'];
        
        if (State.loopMode) {
            // Enable All
            btn.classList.add('loop-active');
            btn.innerHTML = '♾️ ON';
            toggles.forEach(id => {
                document.getElementById(id).checked = true;
                State[id.replace('tm-','').replace(/-([a-z])/g, (g) => g[1].toUpperCase())] = true;
            });
            showNotification('♾️ Loop Mode ARMED. Click RUN to start.', 'info');
        } else {
            // Disable Auto-Pilot (Keep Paste for convenience)
            btn.classList.remove('loop-active');
            btn.innerHTML = '♾️ Loop Mode';
            
            // Only uncheck active automation, keep paste? No, let's stop Send/Capture
            document.getElementById('tm-auto-send').checked = false;
            document.getElementById('tm-auto-capture').checked = false;
            State.autoSend = false;
            State.autoCapture = false;
            showNotification('⏸ Loop Mode PAUSED.', 'info');
        }
    }

    // Check if individual toggles broke the loop mode
    function checkLoopState() {
        const allOn = State.autoPaste && State.autoSend && State.autoCapture;
        const btn = document.getElementById('tm-loop-btn');
        if (allOn) {
            State.loopMode = true;
            btn.classList.add('loop-active');
            btn.innerHTML = '♾️ ON';
        } else {
            State.loopMode = false;
            btn.classList.remove('loop-active');
            btn.innerHTML = '♾️ Loop Mode';
        }
    }

    // --- 核心逻辑 1: AI 状态监听 (Generation Observer) ---

    function initObserver() {
        // 观察整个 body，因为 Stop 按钮是动态插入的
        const observer = new MutationObserver(() => {
            checkAIState();
        });
        observer.observe(document.body, { childList: true, subtree: true });
    }

    function checkAIState() {
        const stopBtn = document.querySelector(CONFIG.stopButtonSelector);
        const isNowGenerating = !!stopBtn;

        if (State.isGenerating !== isNowGenerating) {
            State.isGenerating = isNowGenerating;
            const statusEl = document.getElementById('tm-ai-status');
            
            if (isNowGenerating) {
                if(statusEl) { statusEl.textContent = 'AI: Generating...'; statusEl.style.color = '#f39c12'; }
                updateBuoy('ai_gen');
            } else {
                if(statusEl) { statusEl.textContent = 'AI: Finished'; statusEl.style.color = '#4cd964'; }
                updateBuoy('idle'); // Back to idle (unless captured immediately)

                if (State.autoCapture) {
                    // Visual feedback
                    updateBuoy('busy'); 
                    setTimeout(performAutoCapture, 1500);
                }
            }
        }
    }

    function performAutoCapture() {
        if (!State.autoCapture) return;
        
        // 再次检查防止误触（比如用户手动又发了一条）
        if (State.isGenerating) return;

        const copyBtns = document.querySelectorAll(CONFIG.copyButtonSelector);
        if (copyBtns.length === 0) {
            console.warn('[GeminiBridge] No copy buttons found.');
            return;
        }

        const lastBtn = copyBtns[copyBtns.length - 1];
        lastBtn.click();
        
        // 给个视觉反馈
        showNotification('📋 Auto-Captured!', 'info');
    }


    // --- 核心逻辑 2: 输入与发送 ---
    
    function findInputEditor() {
        for (const sel of CONFIG.inputSelectors) {
            const el = document.querySelector(sel);
            if (el) return el;
        }
        return null;
    }

    function simulateEnter() {
        // 优先点击发送按钮
        for (const sel of CONFIG.sendButtonSelectors) {
            const btn = document.querySelector(sel);
            if (btn && !btn.disabled && !btn.classList.contains('hidden')) { // 确保不是隐藏的 stop 按钮
                btn.click();
                return true;
            }
        }
        // 回退到 Enter 键
        const editor = findInputEditor();
        if(editor) {
            editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', which: 13, bubbles: true }));
            return true;
        }
        return false;
    }

    // --- 辅助：随机延迟 ---
    function getRandomDelay() {
        const { min, max } = State.delays;
        return Math.floor(Math.random() * (max - min + 1)) + min;
    }

    function pasteToChat(content, isSuccess) {
        const editor = findInputEditor();
        if (!editor) {
            showNotification('❌ No input box found', 'error');
            return;
        }

        editor.focus();
        
        // 检查当前内容，如果非空则先添加换行
        const currentText = editor.innerText || editor.textContent || "";
        const needsNewline = currentText.trim().length > 0;
        const textToInsert = needsNewline ? ("\n" + content) : content;

        if (editor.innerHTML === '<p><br></p>') editor.innerHTML = '';
        
        const success = document.execCommand('insertText', false, textToInsert);
        if (!success) editor.textContent += textToInsert;
        
        // 触发 input 事件
        editor.dispatchEvent(new Event('input', { bubbles: true }));

        // 4. Auto-Send 逻辑 (带随机延迟)
        if (State.autoSend) {
            if (isSuccess || (State.loopMode && State.consecutiveErrors <= 3)) {
                const delay = getRandomDelay();
                showNotification(`⏳ Sending in ${(delay/1000).toFixed(1)}s...`, 'info');
                setTimeout(() => {
                    simulateEnter();
                }, delay);
            } else {
                if (!isSuccess) showNotification('⚠️ Error received (Auto-send skipped)', 'error');
            }
        }
    }

    function emergencyStop() {
        State.loopMode = false;
        State.autoSend = false;
        State.autoCapture = false;
        
        document.getElementById('tm-auto-send').checked = false;
        document.getElementById('tm-auto-capture').checked = false;
        
        checkLoopState(); // Update Button UI
    }

    // --- WebSocket ---

    function toggleConnection() {
        if(State.isConnected) State.ws.close();
        else connect();
    }

    function setBtnState(loading) {
        const btn = document.getElementById('tm-run-btn');
        if(!btn) return;
        if (loading) {
            btn.disabled = true;
            btn.textContent = 'Wait...';
        } else {
            btn.disabled = false;
            btn.textContent = 'RUN';
        }
        State.isWaitingResponse = loading;
    }

    function connect() {
        updateStatus('Connecting...', '');
        State.ws = new WebSocket(CONFIG.wsUrl);

        State.ws.onopen = () => {
            State.isConnected = true;
            updateStatus('Connected', 'on');
        };

        State.ws.onclose = () => {
            State.isConnected = false;
            setBtnState(false);
            updateStatus('Disconnected', 'off');
        };

        State.ws.onerror = () => {
            State.isConnected = false;
            setBtnState(false);
            updateStatus('Error', 'off');
        };

        State.ws.onmessage = (e) => {
            setBtnState(false);
            const msg = e.data;
            if (typeof msg !== 'string') return;

            // 严谨的批量判定逻辑：只有完全没有失败标识，才视作整体成功
            // 只要包含 "Task failed:" 或以 "Error:" 开头，立即判定为失败
            const hasFailure = msg.includes('Task failed:') || msg.startsWith('Error:');
            const isSuccess = !hasFailure;

            showBubble(msg, isSuccess);

            if (State.autoPaste) {
                pasteToChat(msg, isSuccess);
            }
        };
    }

    function manualSend() {
        if (!State.isConnected) {
            alert('WebSocket disconnected.');
            return;
        }
        if (State.isWaitingResponse) return;

        const cmd = document.getElementById('tm-cmd-input').value.trim();
        if (cmd) {
            setBtnState(true);
            State.ws.send(cmd);
        }
    }

    // --- UI 辅助 ---

    function showBubble(content, isSuccess = true) {
        const container = document.getElementById('tm-bubbles');
        const bubble = document.createElement('div');
        bubble.className = 'tm-bubble';
        if (!isSuccess) bubble.style.borderLeftColor = '#e74c3c';

        const title = isSuccess ? 'VS Code Response' : '⚠️ Execution Issue';
        const preview = content.length > 200 ? content.substring(0, 200) + '...' : content;
        
        bubble.innerHTML = `
            <div style="font-weight:bold; margin-bottom:4px; display:flex; justify-content:space-between; color: ${isSuccess?'#eee':'#ff9999'}">
                <span>${title}</span>
                <span style="cursor:pointer" onclick="this.parentElement.parentElement.remove()">✕</span>
            </div>
            <div style="font-family:monospace; white-space:pre-wrap; color:#aaa; margin-bottom:8px; max-height:150px; overflow-y:auto">${preview.replace(/</g, '&lt;')}</div>
            ${!State.autoPaste ? '<button class="tm-btn" id="paste-btn">Paste</button>' : '<div style="font-size:10px;color:#666">Auto-pasted</div>'}
        `;

        if (!State.autoPaste) {
            const btn = bubble.querySelector('#paste-btn');
            if(btn) btn.onclick = () => { pasteToChat(content, isSuccess); bubble.remove(); };
        }

        container.appendChild(bubble);
        setTimeout(() => bubble.remove(), 8000);
    }

    function showNotification(text, type) {
        const container = document.getElementById('tm-bubbles');
        const bubble = document.createElement('div');
        bubble.className = 'tm-bubble';
        bubble.style.borderLeftColor = type === 'error' ? '#e74c3c' : '#3498db';
        bubble.innerHTML = `<div style="font-weight:bold; color:${type==='error'?'#ff9999':'#eee'}">${text}</div>`;
        container.appendChild(bubble);
        setTimeout(() => bubble.remove(), 4000);
    }

    // --- 剪贴板监听 (智能轮询 + 兜底重发版) ---
    document.body.addEventListener('click', async (e) => {
        const copyBtn = e.target.closest(CONFIG.copyButtonSelector);
        if (copyBtn && State.isConnected) {
            
            // 1. 获取旧内容
            let oldText = '';
            try { oldText = await navigator.clipboard.readText(); } catch(err) {}

            // 2. 启动轮询
            let attempts = 0;
            // 策略：快速检查10次(1秒内)，如果一直没变，认为是“重发相同内容”
            const fastCheckLimit = 8; // 8 * 100ms = 800ms
            
            if (!State.autoCapture) showNotification('⏳ Waiting for clipboard...', 'info');

            const pollInterval = setInterval(async () => {
                attempts++;
                let newText = '';
                try { newText = await navigator.clipboard.readText(); } catch(err) {}

                // 情况 A: 内容变了 -> 立即发送 (New Content)
                if (newText && newText !== oldText) {
                    clearInterval(pollInterval);
                    sendToVSCode(newText, '📋 Sent new content!');
                } 
                // 情况 B: 内容没变，但时间够久了 -> 强制发送 (Re-copy Same Content)
                else if (newText && attempts >= fastCheckLimit) {
                    clearInterval(pollInterval);
                    if (!State.autoCapture) {
                        sendToVSCode(newText, '📋 Sent (Same Content)');
                    } else {
                        // 自动模式下，如果内容没变，可能是 AI 回复了一模一样的话？
                        // 为了防止死循环，这里可以加个判断，但手动点击时应该允许发送
                        sendToVSCode(newText, null);
                    }
                }
            }, 100); 
        }
    }, true);

    function sendToVSCode(text, toastMsg) {
        State.ws.send(text);
        if (toastMsg && !State.autoCapture) {
            showNotification(toastMsg, 'info');
        } else if (State.autoCapture) {
            console.log('[GeminiBridge] Auto-captured.');
        }
    }

    // --- 启动 ---
    injectStyles();
    initUI();
    connect();
    initObserver(); // 启动 AI 状态监听

})();