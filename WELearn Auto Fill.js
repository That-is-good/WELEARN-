// ==UserScript==
// @name         WELearn Auto Fill
// @namespace    http://tampermonkey.net/
// @version      2026-06-25-v4
// @description  WELearn自动答题 + 控制面板 + 显示答案（修复多窗口及翻页检测）
// @author       櫻羽若俳
// @icon         https://www.google.com/s2/favicons?sz=64&domain=google.com
// @homepage     https://www.github.com/
// @match        *://course.sflep.com/*
// @match        *://welearn.sflep.com/*
// @match        *://wetest.sflep.com/*
// @match        *://courseappserver.sflep.com/*
// @match        *://centercourseware.sflep.com/*
// @run-at       document-end
// ==/UserScript==

// ========== 1. 只在包含课程内容的窗口执行 ==========
var debugMode = false; // 设置为 true 可在控制台输出调试信息
function WriteConsole(...msg) {
    if (debugMode)
        console.log('[WELearn Auto Fill]', ...msg);
}
(function() {
    if (window == window.top) {
        WriteConsole('[WELearn Auto Fill] 在 iframe 中，跳过执行');
        return;
    }
    // ========== 2. 防重复初始化 ==========
    if (window.__WELEARN_AUTO_FILL_INIT__) {
        WriteConsole('[WELearn Auto Fill] 脚本已初始化，跳过重复执行');
        return;
    }
    window.__WELEARN_AUTO_FILL_INIT__ = true;

    // ========== 3. 设置管理 ==========
    const DEFAULT_SETTINGS = {
        autoFill: {
            choice: true, blank: true, tof: true, select: true,
            matching: true, recording: true, wordPractice: true
        },
        showAnswer: {
            choice: true, blank: true, tof: true, select: true,
            matching: true, recording: false, wordPractice: false
        },
        delay: 200
    };

    let settings = { ...DEFAULT_SETTINGS };
    let uiVisible = false;

    function loadSettings() {
        try {
            const saved = localStorage.getItem('welearn_auto_fill_settings');
            if (saved) {
                const parsed = JSON.parse(saved);
                settings = mergeDeep(DEFAULT_SETTINGS, parsed);
            }
        } catch (e) {}
    }

    function saveSettings() {
        try {
            localStorage.setItem('welearn_auto_fill_settings', JSON.stringify(settings));
        } catch (e) {}
    }

    function mergeDeep(target, source) {
        const result = { ...target };
        for (const key in source) {
            if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
                result[key] = mergeDeep(target[key] || {}, source[key]);
            } else {
                result[key] = source[key];
            }
        }
        return result;
    }

    // ========== 4. 辅助函数 ==========
    function getDoc() {
        const iframe = document.querySelector('iframe#contentFrame');
        if (iframe && iframe.contentDocument) {
            return iframe.contentDocument;
        }
        return document; // fallback
    }

    function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

    // ========== 5. 显示答案函数 ==========
    function showChoiceAnswers(doc, angular, type) {
        const choices = doc.querySelectorAll('et-choice');
        choices.forEach(el => {
            const ctrl = angular.element(el).controller('etChoice');
            if (ctrl && ctrl.hasKey && ctrl.key) {
                const indices = ctrl.key;
                // 使用更通用的选择器：li, et-item-option, .choice-item, .option-item
                const items = el.querySelectorAll('li, et-item-option, .choice-item, .option-item, [role="option"]');
                items.forEach((item, idx) => {
                    if (indices.includes(idx)) {
                        item.classList.add(`welearn-answer-${type}`);
                        item.style.backgroundColor = '#90ee90';
                        item.style.border = '2px solid #2e7d32';
                        item.style.borderRadius = '4px';
                    }
                });
            }
        });
    }

    function showBlankAnswers(doc, angular, type) {
    const blanks = doc.querySelectorAll('et-blank');
    blanks.forEach(el => {
        const keyEl = el.querySelector('.key');
        if (keyEl) {
            const answer = keyEl.textContent.trim();
            const input = el.querySelector('input, textarea, .blank-input, .fill-input');
            if (input) {
                const span = document.createElement('span');
                span.className = `welearn-answer-text-${type}`;
                span.textContent = ' ' + answer;
                span.style.cssText = 'color: #999; font-style: italic; font-size: 0.9em; pointer-events: none;';
                input.parentNode.insertBefore(span, input.nextSibling);
            } else {
                const hint = document.createElement('div');
                hint.className = `welearn-answer-text-${type}`;
                hint.textContent = '答案: ' + answer;
                hint.style.cssText = 'color: #999; font-size: 0.8em; margin-top: 2px;';
                el.appendChild(hint);
            }
        }
    });
    }

    function showTofAnswers(doc, angular, type) {
        const tofs = doc.querySelectorAll('et-tof');
        tofs.forEach(el => {
            const ctrl = angular.element(el).controller('etTof');
            let key = el.getAttribute('key');
            if (!key && ctrl && ctrl.key) key = ctrl.key[0];
            if (!key) return;
            const isTrue = key.toLowerCase() === 't';
            const labels = el.querySelectorAll('label, .option, .choice-item');
            labels.forEach(label => {
                const text = label.textContent.trim().toLowerCase();
                if ((isTrue && (text.includes('true') || text.includes('对') || text.includes('正确'))) ||
                    (!isTrue && (text.includes('false') || text.includes('错') || text.includes('错误')))) {
                    label.classList.add(`welearn-answer-${type}`);
                    label.style.backgroundColor = '#90ee90';
                    label.style.border = '2px solid #2e7d32';
                }
            });
        });
    }

    function showSelectAnswers(doc, angular, type) {
        const selects = doc.querySelectorAll('et-select');
        selects.forEach(el => {
            const ctrl = angular.element(el).controller('etSelect');
            let key = el.getAttribute('key');
            if (!key && ctrl && ctrl.key) key = ctrl.key;
            if (!key) return;
            const choiceVal = 'choice' + key;
            const options = el.querySelectorAll('option');
            options.forEach(opt => {
                if (opt.value === choiceVal) {
                    opt.classList.add(`welearn-answer-${type}`);
                    opt.style.backgroundColor = '#90ee90';
                    opt.style.fontWeight = 'bold';
                }
            });
        });
    }

    function showMatchingAnswers(doc, angular, type) {
        const matchings = doc.querySelectorAll('et-matching');
        matchings.forEach(el => {
            const ctrl = angular.element(el).controller('etMatching');
            if (!ctrl || !ctrl.keys) return;
            const leftItems = el.querySelectorAll('.left-column .item, .left .item, .left-item');
            const rightItems = el.querySelectorAll('.right-column .item, .right .item, .right-item');
            if (leftItems.length === 0 || rightItems.length === 0) return;
            ctrl.keys.forEach((targets, leftIdx) => {
                if (!Array.isArray(targets)) return;
                targets.forEach(rightIdx => {
                    const leftEl = leftItems[leftIdx];
                    const rightEl = rightItems[rightIdx];
                    if (leftEl && rightEl) {
                        leftEl.classList.add(`welearn-answer-${type}`);
                        rightEl.classList.add(`welearn-answer-${type}`);
                        leftEl.style.border = '2px dashed #f44336';
                        rightEl.style.border = '2px dashed #f44336';
                    }
                });
            });
        });
    }

    function showAnswersForType(type) {
        const doc = getDoc();
        const win = doc.defaultView || window;
        const angular = win.angular;
        if (!angular) return;
        clearAnswersForType(type);
        switch (type) {
            case 'choice': showChoiceAnswers(doc, angular, type); break;
            case 'blank': showBlankAnswers(doc, angular, type); break;
            case 'tof': showTofAnswers(doc, angular, type); break;
            case 'select': showSelectAnswers(doc, angular, type); break;
            case 'matching': showMatchingAnswers(doc, angular, type); break;
            default: break;
        }
    }

    function showAllAnswers() {
        const types = ['choice', 'blank', 'tof', 'select', 'matching'];
        types.forEach(t => { if (settings.showAnswer[t]) showAnswersForType(t); });
    }

    function clearAllAnswers() {
        const types = ['choice', 'blank', 'tof', 'select', 'matching'];
        types.forEach(t => clearAnswersForType(t));
    }

    function clearAnswersForType(type) {
        const doc = getDoc();
        doc.querySelectorAll(`.welearn-answer-${type}`).forEach(el => {
            el.classList.remove(`welearn-answer-${type}`);
            el.style.removeProperty('background-color');
            el.style.removeProperty('border');
            el.style.removeProperty('color');
            el.style.removeProperty('text-decoration');
            el.style.removeProperty('font-weight');
        });
        doc.querySelectorAll(`.welearn-answer-text-${type}`).forEach(el => el.remove());
    }

    // ========== 6. 控制面板 UI（单例） ==========
    function createUI() {
        // 移除可能残留的旧按钮
        document.querySelectorAll('#welearn-control-panel').forEach(el => el.remove());

        // 移除旧版“检测题目”按钮
        const oldBtn = document.getElementById('eocs-trigger-btn');
        if (oldBtn) oldBtn.remove();

        // 如果已经存在（但上面已经移除，所以不会出现），但以防万一
        if (document.getElementById('welearn-control-panel')) return;

        const container = document.createElement('div');
        container.id = 'welearn-control-panel';
        container.style.cssText = `
            position: fixed;
            bottom: 20px;
            right: 20px;
            z-index: 99999;
            font-family: Arial, sans-serif;
            font-size: 13px;
            color: #333;
            user-select: none;
            display: flex;
            flex-direction: column;
            align-items: flex-end;
        `;

        const toggleBtn = document.createElement('div');
        toggleBtn.id = 'welearn-toggle-btn';
        toggleBtn.textContent = '⚙️';
        toggleBtn.style.cssText = `
            width: 40px;
            height: 40px;
            background: #2196f3;
            color: white;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 24px;
            cursor: pointer;
            box-shadow: 0 2px 10px rgba(0,0,0,0.3);
            transition: transform 0.2s;
            margin-bottom: 8px;
        `;
        toggleBtn.onmouseenter = () => toggleBtn.style.transform = 'scale(1.05)';
        toggleBtn.onmouseleave = () => toggleBtn.style.transform = 'scale(1)';
        toggleBtn.onclick = () => togglePanel();

        const panel = document.createElement('div');
        panel.id = 'welearn-panel';
        panel.style.cssText = `
            background: #fff;
            border-radius: 8px;
            padding: 16px 20px;
            width: 280px;
            box-shadow: 0 4px 20px rgba(0,0,0,0.2);
            display: none;
            max-height: 80vh;
            overflow-y: auto;
            border: 1px solid #ddd;
            transition: all 0.3s;
        `;

        const title = document.createElement('div');
        title.textContent = 'WELearn 控制面板';
        title.style.cssText = 'font-weight: bold; font-size: 16px; margin-bottom: 12px; border-bottom: 1px solid #eee; padding-bottom: 8px;';

        const groups = [
            { key: 'choice', label: '选择题', canShow: true },
            { key: 'blank', label: '填空题', canShow: true },
            { key: 'tof', label: '判断题', canShow: true },
            { key: 'select', label: '下拉选择', canShow: true },
            { key: 'matching', label: '连线题', canShow: true },
            { key: 'recording', label: '口语题', canShow: false },
            { key: 'wordPractice', label: '单词练习', canShow: false }
        ];

        const groupContainer = document.createElement('div');

        groups.forEach(g => {
            const row = document.createElement('div');
            row.style.cssText = 'display: flex; align-items: center; margin: 6px 0; gap: 10px;';

            const autoLabel = document.createElement('label');
            autoLabel.style.cssText = 'display: flex; align-items: center; gap: 4px; flex: 1;';
            const autoChk = document.createElement('input');
            autoChk.type = 'checkbox';
            autoChk.checked = settings.autoFill[g.key];
            autoChk.dataset.type = g.key;
            autoChk.dataset.mode = 'auto';
            autoChk.onchange = (e) => {
                settings.autoFill[g.key] = e.target.checked;
                saveSettings();
            };
            autoLabel.appendChild(autoChk);
            autoLabel.appendChild(document.createTextNode('自动'));

            const showLabel = document.createElement('label');
            showLabel.style.cssText = 'display: flex; align-items: center; gap: 4px; flex: 1;';
            const showChk = document.createElement('input');
            showChk.type = 'checkbox';
            showChk.checked = settings.showAnswer[g.key] && g.canShow;
            showChk.disabled = !g.canShow;
            if (!g.canShow) {
                showLabel.style.opacity = '0.5';
                showLabel.title = '该题型无文本答案可显示';
            }
            showChk.dataset.type = g.key;
            showChk.dataset.mode = 'show';
            showChk.onchange = (e) => {
                if (!g.canShow) return;
                settings.showAnswer[g.key] = e.target.checked;
                saveSettings();
                if (e.target.checked) {
                    showAnswersForType(g.key);
                } else {
                    clearAnswersForType(g.key);
                }
            };
            showLabel.appendChild(showChk);
            showLabel.appendChild(document.createTextNode('显示'));

            const nameSpan = document.createElement('span');
            nameSpan.textContent = g.label;
            nameSpan.style.cssText = 'min-width: 60px; font-weight: 500;';

            row.appendChild(nameSpan);
            row.appendChild(autoLabel);
            row.appendChild(showLabel);
            groupContainer.appendChild(row);
        });

        // 延迟控制
        const delayRow = document.createElement('div');
        delayRow.style.cssText = 'display: flex; align-items: center; margin-top: 12px; gap: 8px; border-top: 1px solid #eee; padding-top: 12px;';
        const delayLabel = document.createElement('span');
        delayLabel.textContent = '间隔(ms):';
        const delayInput = document.createElement('input');
        delayInput.type = 'range';
        delayInput.min = 200;
        delayInput.max = 3000;
        delayInput.step = 50;
        delayInput.value = settings.delay;
        delayInput.style.cssText = 'flex: 1;';
        const delayValue = document.createElement('span');
        delayValue.textContent = settings.delay;
        delayInput.oninput = () => {
            const val = parseInt(delayInput.value);
            delayValue.textContent = val;
            settings.delay = val;
            window.delayFill = val;
            saveSettings();
        };
        delayRow.appendChild(delayLabel);
        delayRow.appendChild(delayInput);
        delayRow.appendChild(delayValue);

        const btnRow = document.createElement('div');
        btnRow.style.cssText = 'display: flex; justify-content: space-between; margin-top: 12px; gap: 6px;';
        const runBtn = document.createElement('button');
        runBtn.textContent = '立即答题';
        runBtn.style.cssText = 'flex:1; padding: 6px 12px; background: #4caf50; color: white; border: none; border-radius: 4px; cursor: pointer;';
        runBtn.onclick = () => { main(); };
        const showAllBtn = document.createElement('button');
        showAllBtn.textContent = '显示所有答案';
        showAllBtn.style.cssText = 'flex:1; padding: 6px 12px; background: #ff9800; color: white; border: none; border-radius: 4px; cursor: pointer;';
        showAllBtn.onclick = () => { showAllAnswers(); };
        const clearBtn = document.createElement('button');
        clearBtn.textContent = '清除显示';
        clearBtn.style.cssText = 'flex:1; padding: 6px 12px; background: #f44336; color: white; border: none; border-radius: 4px; cursor: pointer;';
        clearBtn.onclick = () => { clearAllAnswers(); };
        btnRow.appendChild(runBtn);
        btnRow.appendChild(showAllBtn);
        btnRow.appendChild(clearBtn);

        panel.appendChild(title);
        panel.appendChild(groupContainer);
        panel.appendChild(delayRow);
        panel.appendChild(btnRow);
        container.appendChild(panel);
        container.appendChild(toggleBtn);
        document.body.appendChild(container);

        const timeRow = document.createElement('div');
        timeRow.style.cssText = 'display: flex; align-items: center; margin-top: 12px; gap: 8px; border-top: 1px solid #eee; padding-top: 12px;';
        const timeLabel = document.createElement('span');
        timeLabel.textContent = '学习时长(分钟):';
        const timeInput = document.createElement('input');
        timeInput.type = 'number';
        timeInput.min = 1;
        timeInput.max = 999;
        timeInput.value = 10; // 默认10分钟
        timeInput.style.cssText = 'width: 60px;';
        const timeSetBtn = document.createElement('button');
        timeSetBtn.textContent = '应用(无效)';
        timeSetBtn.style.cssText = 'padding: 4px 12px; background: #3f51b5; color: white; border: none; border-radius: 4px; cursor: pointer;';
        timeSetBtn.disabled = true; // 暂时禁用，因为无法真正设置学习时长
        timeSetBtn.onclick = function() {
            const minutes = parseInt(timeInput.value, 10) || 10;
            setStudyTime(minutes * 60);
        };
        timeRow.appendChild(timeLabel);
        timeRow.appendChild(timeInput);
        timeRow.appendChild(timeSetBtn);
        panel.appendChild(timeRow);

        function togglePanel() {
            uiVisible = !uiVisible;
            panel.style.display = uiVisible ? 'block' : 'none';
            toggleBtn.textContent = uiVisible ? '✖' : '⚙️';
        }

        document.addEventListener('click', (e) => {
            if (uiVisible && !container.contains(e.target)) {
                togglePanel();
            }
        });

        panel.style.display = 'none';
    }

    // ========== 7. 所有解题函数 ==========
    async function solveRecordingTasksPersistent() {
        const selectors = ['et-recorder', 'et-follow-me', 'et-talk'];
        const doc = getDoc();
        const win = doc.defaultView || window;
        const angular = win.angular;

        // 1. 获取答题卡主控制器 (et-item)
        const itemEl = doc.querySelector('et-item');
        if (!itemEl) return;
        const itemCtrl = angular.element(itemEl).controller('etItem');
        if (!itemCtrl) {
            console.error("未能获取到 et-item 控制器，无法持久化数据");
            return;
        }

        for (const tag of selectors) {
            const elements = doc.querySelectorAll(tag);
            for (const el of elements) {
                const id = el.id;
                if (!id) continue;

                // 2. 根据题型构造符合 Commit 要求的交互数据 (Interaction)
                let interaction = {
                    id: id,
                    record_count: 1,
                    isshared: false,
                    isdifficult: false,
                    result: "100", // 默认满分
                    learner_response: "mock_audio_" + id + ".mp3"
                };

                if (tag === 'et-recorder') {
                    interaction.type = "performance";
                } 
                else if (tag === 'et-follow-me') {
                    interaction.type = "performance";
                    const count = el.querySelectorAll('.sentence').length || 1;
                    interaction.learner_response = Array(count).fill("follow.mp3").join("[,]");
                    interaction.result = Array(count).fill("100").join("[,]");
                }
                else if (tag === 'et-talk') {
                    interaction.type = "performance";
                    const count = el.querySelectorAll('flow[record]').length || 1;
                    interaction.learner_response = "ROLE_0[,]" + Array(count).fill("talk.mp3").join("[,]");
                    interaction.result = Array(count).fill("100").join("[,]");
                }

                // 3. 【核心关键】调用父组件的 handleStatusChange
                // 这会把数据压入 itemCtrl.E 队列，并标记 isDirty = true
                itemCtrl.handleStatusChange({
                    id: id,
                    isCompleted: true,
                    isScored: false,
                    noProgress: false,
                    isDirty: true, // 必须为 true，否则 Commit 会跳过
                    interaction: interaction
                });
            }
        }

        // 4. 强制触发保存
        // 调用此方法后，你会看到网络面板发送了 savescoinfo160928 请求
        WriteConsole("正在同步录音进度到服务器...");
        await itemCtrl.submit(); 
        
        // 5. 广播 UI 更新，让界面上的“未完成”红点消失
        const rootScope = angular.element(doc.querySelector('.app, body')).injector().get('$rootScope');
        if (rootScope) {
            rootScope.$broadcast("toggleKey", true);
            if (!rootScope.$$phase) rootScope.$apply();
        }
    }

    async function solveMarkTasks() {
        // 1. 查找页面中所有的标记题组件
        const markContainers = document.querySelectorAll('et-mark');
        if (markContainers.length === 0) return;

        for (const container of markContainers) {
            const win = container.ownerDocument.defaultView || window;
            const angular = win.angular;
            
            // 2. 获取组件的 Angular 作用域 (处理真填入)
            const el = angular.element(container);
            const scope = el.scope() || el.isolateScope();

            // 3. 查找所有标记点（<span>标签）
            const allMarkers = container.querySelectorAll('span.m');
            
            if (scope && scope.mark) {
                // --- 方案 A：作用域存在（真填入最高效方案） ---
                scope.$apply(() => {
                    allMarkers.forEach((span, index) => {
                        // 如果该点是正确答案（带有 key 类），且当前未被选中
                        const isCorrect = span.classList.contains('key');
                        const isChosen = scope.mark.isChosen(index);
                        
                        if (isCorrect !== isChosen) {
                            // 调用组件内置的 select 方法，这会自动触发进度更新
                            scope.mark.select(index);
                        }
                    });
                });
            } else {
                // --- 方案 B：Scope 失效（通过物理点击模拟） ---
                for (let i = 0; i < allMarkers.length; i++) {
                    const span = allMarkers[i];
                    // 仅点击那些带有 'key' 类（正确答案）且没被选中的元素
                    // 注意：et-mark 的选中状态通常表现为含有 'chosen' 类
                    if (span.classList.contains('key') && !span.classList.contains('chosen')) {
                        span.click();
                        await sleep(Math.max(delayFill, 200)); // 避免点击过快导致平台卡顿
                    }
                }
            }
            WriteConsole(`已处理标记题: ${container.id}`);
        }
    }

    async function solveWordPractice() {
        let practiceEl = document.querySelector('et-word-practice');
        
        // 1. 如果窗口没打开，先尝试点击页面上的 Practice 按钮
        if (!practiceEl || !practiceEl.classList.contains('visible')) {
            const startPracticeBtn = document.querySelector('et-button[action="wordbank.practice()"] button');
            if (startPracticeBtn) {
                startPracticeBtn.click();
                await new Promise(r => setTimeout(r, 1000)); // 等待弹窗动画
                practiceEl = document.querySelector('et-word-practice');
            }
        }

        if (!practiceEl) return;

        const win = practiceEl.ownerDocument.defaultView || window;
        const angular = win.angular;
        const pCtrl = angular.element(practiceEl).controller('etWordPractice');
        const rootScope = angular.element(practiceEl.closest('.app') || win.document.body).injector().get('$rootScope');

        if (pCtrl) {
            // 2. 如果还在选择模式首页，强行启动“根据单词选释义”模式
            if (pCtrl.current === 0) {
                WriteConsole("正在初始化练习列表...");
                rootScope.$apply(() => {
                    pCtrl.startPractice('choose-exp'); 
                });
                await new Promise(r => setTimeout(r, 500)); // 给列表生成留一点时间
            }

            // 3. 核心：修改数据模型并触发结算逻辑
            rootScope.$apply(() => {
                if (pCtrl.shuffledWords && pCtrl.shuffledWords.length > 0) {
                    pCtrl.shuffledWords.forEach(word => {
                        word.done = true;
                        word.correct = true;
                        // 根据模式填充正确答案的索引或字符串
                        word.answer = (word.type === 'type-in') ? word.name : word.key;
                    });

                    // 将当前题号指向最后一题
                    pCtrl.current = pCtrl.total;

                    // 【最关键】向 rootScope 广播一个 'done' 信号
                    // main.js 第 1204 行监听了这个信号，它会触发 A() 函数统计分数
                    // 并将 current 推进到 total + 1，从而显示结算界面
                    rootScope.$broadcast('done', true);
                }
            });
            
            WriteConsole("词汇练习已完成，结算界面已弹出。");
        }
    }

    async function solveTofAndSelectTasks() {
        const doc = getDoc();
        const win = doc.defaultView || window;
        const angular = win.angular;

        // 1. 获取主答题卡控制器 (用于持久化进度)
        const itemEl = doc.querySelector('et-item');
        if (!itemEl) return;
        const itemCtrl = angular.element(itemEl).controller('etItem');
        const rootScope = angular.element(doc.querySelector('.app, body') || doc.body).injector().get('$rootScope');

        // --- 处理 et-tof (判断题) ---
        const tofElements = doc.querySelectorAll('et-tof');
        for (const el of tofElements) {
            const id = el.id;
            const ctrl = angular.element(el).controller('etTof');
            if (!ctrl || !id) continue;

            // 提取答案：优先从 HTML 属性提取，其次从控制器内存提取
            let answerKey = el.getAttribute('key');
            if (!answerKey && ctrl.key) answerKey = ctrl.key[0];
            if (!answerKey) continue;

            const finalVal = answerKey.toLowerCase() === 't' ? 't' : 'f';
            const learnerResponse = finalVal === 't' ? 'true' : 'false';

            WriteConsole(`[判断题完成] ID:${id}, 答案:${learnerResponse}`);

            // 核心：强制修改控制器模型并同步进度
            rootScope.$apply(() => {
                ctrl.value = [finalVal]; // 修改内部模型 (main.js 1039行)
                itemCtrl.handleStatusChange({
                    id: id,
                    isCompleted: true,
                    isScored: true,
                    isDirty: true,
                    score: 1,
                    interaction: { id: id, type: "true_false", learner_response: learnerResponse, result: "correct" }
                });
            });
        }

        // --- 处理 et-select (下拉选择题) ---
        const selectElements = doc.querySelectorAll('et-select');
        for (const el of selectElements) {
            const id = el.id;
            const ctrl = angular.element(el).controller('etSelect');
            if (!ctrl || !id) continue;

            // 提取答案
            let answerKey = el.getAttribute('key');
            if (!answerKey) {
                const keyOpt = el.querySelector('option.key');
                answerKey = keyOpt ? keyOpt.value.replace('choice', '') : null;
            }
            if (!answerKey) continue;

            const choiceVal = "choice" + answerKey;

            WriteConsole(`[下拉题完成] ID:${id}, 答案:${choiceVal}`);

            // 核心：强制修改控制器模型并同步进度
            rootScope.$apply(() => {
                ctrl.value = choiceVal; // 修改内部模型 (main.js 998行)
                itemCtrl.handleStatusChange({
                    id: id,
                    isCompleted: true,
                    isScored: true,
                    isDirty: true,
                    score: 1,
                    interaction: { id: id, type: "multiple_choice", learner_response: choiceVal, result: "correct" }
                });
            });
        }

        // 刷新 UI
        if (!rootScope.$$phase) rootScope.$apply();
    }

    async function solveBlank() {
        const doc = getDoc();
        const win = doc.defaultView || window;
        const angular = win.angular;

        // 1. 获取主控制器用于持久化
        const itemEl = doc.querySelector('et-item');
        if (!itemEl) return;
        const itemCtrl = angular.element(itemEl).controller('etItem');
        const rootScope = angular.element(doc.querySelector('.app, body')).injector().get('$rootScope');

        // 2. 遍历所有可答题组件
        const questions = doc.querySelectorAll('et-blank');
        
        for (const el of questions) {
            const id = el.id;
            const tag = el.tagName.toLowerCase();
            let answer = null;
            let interactionType = "fill_in";

            // --- 提取答案逻辑 ---
            // 答案就在 class="key" 的 span 里
            const keyEl = el.querySelector('.key');
            if (keyEl) answer = keyEl.textContent.trim();

            // --- 执行“真填入”与数据同步 ---
            if (answer !== null && id) {
                WriteConsole(`[自动填入] 题型:${tag}, ID:${id}, 答案:${answer}`);

                // A. 修改 Angular 内部模型（让 UI 显示答案）
                if (tag === 'et-blank') {
                    rootScope.$broadcast("optionIn." + id, answer);
                }

                // B. 同步数据到提交队列（最关键，解决持久化和 g() 函数拦截）
                itemCtrl.handleStatusChange({
                    id: id,
                    isCompleted: true,
                    isScored: true,
                    isDirty: true, // 标记为脏数据，强制 savescoinfo 请求发送
                    score: 1,      // 设为满分
                    interaction: {
                        id: id,
                        type: interactionType,
                        learner_response: answer,
                        result: "correct"
                    }
                });
            }
        }

        // 3. 触发脏检查更新 UI
        if (!rootScope.$$phase) rootScope.$apply();

        // 4. 【可选】自动点击一次提交，确保数据发送到服务器
        // WriteConsole("所有题目已处理，准备自动提交保存进度...");
        // await itemCtrl.submit();
    }

    async function solveChoice(){
        const doc = getDoc();
        const win = doc.defaultView || window;
        const angular = win.angular;
        const $ = win.jQuery || win.$;

        // 获取 Angular 根工具
        const appRoot = doc.querySelector('.app, [ng-app], body');
        if (!appRoot) return;
        const injector = angular.element(appRoot).injector();
        const rootScope = injector.get('$rootScope');
        const choiceElements = doc.querySelectorAll('et-choice');
        for (const el of choiceElements) {
            const id = el.id;
            if (!id) continue;

            const cCtrl = angular.element(el).controller('etChoice');
            // 从控制器内存直接提取正确答案数组 (o.key)
            if (cCtrl && cCtrl.hasKey && cCtrl.key) {
                const correctIndices = cCtrl.key; // 例如 [0, 2]
                const answerStr = correctIndices.map(idx => "choice" + (idx + 1)).join("[,]");
                
                WriteConsole(`[内存提取] 选择题ID:${id}, 正确索引:${correctIndices}`);

                // 同步到父组件 et-item 以确保刷新有效
                const itemEl = doc.querySelector('et-item');
                const itemCtrl = angular.element(itemEl).controller('etItem');
                if (itemCtrl) {
                    itemCtrl.handleStatusChange({
                        id: id,
                        isCompleted: true,
                        isScored: true,
                        isDirty: true,
                        score: correctIndices.length, // 权重分
                        interaction: {
                            id: id,
                            type: "multiple_choice",
                            learner_response: answerStr,
                            result: "correct"
                        }
                    });
                }
                
                // 广播信号让 UI 变色（显示已勾选）
                rootScope.$broadcast("answerRestore." + id, { learner_response: answerStr });
            }
        }

        if (!rootScope.$$phase) rootScope.$apply();
    }

    async function solveMatchingTasks() {
        const doc = getDoc();
        const win = doc.defaultView || window;
        const angular = win.angular;

        const itemEl = doc.querySelector('et-item');
        if (!itemEl) return;
        const itemCtrl = angular.element(itemEl).controller('etItem');
        const rootScope = angular.element(doc.querySelector('.app, body') || doc.body).injector().get('$rootScope');

        const matchingElements = doc.querySelectorAll('et-matching');
        
        for (const el of matchingElements) {
            const id = el.id;
            const ctrl = angular.element(el).controller('etMatching');
            
            if (ctrl && id) {
                // 1. 从内存提取正确答案
                // ctrl.keys 的格式通常是 [[0], [1], [2]]，表示 A栏第0项连B栏第0项
                let answersList = [];
                if (ctrl.keys && ctrl.keys.length > 0) {
                    ctrl.keys.forEach((targets, leftIndex) => {
                        if (Array.isArray(targets)) {
                            targets.forEach(rightIndex => {
                                // 按照 main.js 要求的格式拼接：左索引[.]右索引
                                answersList.push(`${leftIndex}[.]${rightIndex}`);
                            });
                        }
                    });
                }

                const responseStr = answersList.join("[,]");

                if (responseStr) {
                    WriteConsole(`[连线题内存提取] ID:${id}, 答案序列:${responseStr}`);

                    // 2. 核心：通过 handleStatusChange 同步到父组件 et-item (确保进度 1.0)
                    // 这样 g() 函数检查进度时会通过
                    itemCtrl.handleStatusChange({
                        id: id,
                        isCompleted: true,
                        isScored: true,
                        isDirty: true,
                        score: ctrl.keys.length, 
                        interaction: {
                            id: id,
                            type: "matching",
                            learner_response: responseStr,
                            result: "correct"
                        }
                    });

                    // 3. 核心：利用广播信号让 UI 渲染出连线
                    // main.js 第 1157 行监听了 answerRestore.[id]
                    rootScope.$broadcast("answerRestore." + id, { 
                        learner_response: responseStr 
                    });
                }
            }
        }

        // 4. 强制脏检查，刷新页面布局和进度条
        if (!rootScope.$$phase) rootScope.$apply();
        
        // 触发连线题特有的视图更新信号
        rootScope.$broadcast("viewChange");
    }

    function setStudyTime(seconds) {
        const doc = getDoc();
        const win = doc.defaultView || window;
        const angular = win.angular;
        if (!angular) {
            WriteConsole('[设置时长] 未检测到 Angular');
            return;
        }
        try {
            // 获取 Angular 的 injector
            const appRoot = doc.querySelector('[ng-app]') || doc.body;
            const injector = angular.element(appRoot).injector();
            const apiService = injector.get('apiService');

            // 格式化 HH:MM:SS
            const pad = (num) => String(num).padStart(2, '0');
            const hours = Math.floor(seconds / 3600);
            const minutes = Math.floor((seconds % 3600) / 60);
            const secs = seconds % 60;
            const timeStr = `${pad(hours)}:${pad(minutes)}:${pad(secs)}`;

            // 写入 session_time 和 total_time（部分平台会同时检查）
            apiService.set('cmi.session_time', timeStr);
            apiService.set('cmi.total_time', timeStr);
            apiService.commit();
            WriteConsole(`[设置时长] 已设置为 ${timeStr}`);
            alert(`已设置学习时长为 ${minutes} 分钟 (${timeStr})`);
        } catch (e) {
            WriteConsole('[设置时长] 失败:', e);
            alert('设置失败，请检查页面是否已加载完毕。');
        }
    }

    // ========== 8. 主答题函数 ==========
    function main() {
        WriteConsole("WELearn Auto Fill 开始执行答题");

        // 重新加载最新设置
        loadSettings();
        window.delayFill = settings.delay;

        const doc = getDoc();
        const win = doc.defaultView || window;
        const angular = win.angular;
        if (!angular) {
            WriteConsole("未检测到 Angular，可能不是 WELearn 页面");
            return;
        }

        // 任务列表（按顺序执行）
        const tasks = [
            { key: 'recording', fn: solveRecordingTasksPersistent },
            { key: 'choice', fn: solveChoice },
            { key: 'blank', fn: solveBlank },
            { key: 'tof', fn: () => solveTofAndSelectTasks() },
            { key: 'select', fn: () => solveTofAndSelectTasks() },
            { key: 'matching', fn: solveMatchingTasks },
            { key: 'wordPractice', fn: solveWordPractice }
        ];

        tasks.forEach(task => {
            if (settings.autoFill[task.key]) {
                WriteConsole(`自动答题: ${task.key}`);
                try { task.fn(); } catch (e) { WriteConsole(`执行 ${task.key} 出错:`, e); }
            } else {
                WriteConsole(`跳过 ${task.key} (自动关闭)`);
            }
        });

        // 显示答案（仅对已开启的题型）
        const showTypes = ['choice', 'blank', 'tof', 'select', 'matching'];
        showTypes.forEach(type => {
            if (settings.showAnswer[type]) {
                setTimeout(() => showAnswersForType(type), 300);
            }
        });

        WriteConsole("所有任务执行完毕");
    }

    // ========== 9. 翻页检测与自动触发 ==========
    let lastUrl = location.href;
    let checkTimer = null;

    function startUrlWatcher() {
        // 清除已有定时器
        if (checkTimer) clearInterval(checkTimer);
        // 每 500ms 检查 URL 是否变化
        checkTimer = setInterval(() => {
            const currentUrl = location.href;
            if (currentUrl !== lastUrl) {
                lastUrl = currentUrl;
                WriteConsole(`检测到 URL 变化: ${currentUrl}`);
                // 等待页面内容加载稳定后执行答题
                setTimeout(main, 1000);
            }
        }, 500);
    }

    // ========== 10. 初始化 ==========
    (function init() {
        loadSettings();
        createUI();

        setTimeout(main, 1000);

        // 启动 URL 监控
        startUrlWatcher();
    })();

})(); // 结束外层自执行函数