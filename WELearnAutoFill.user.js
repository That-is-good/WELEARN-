// ==UserScript==
// @name         WELearn Auto Fill
// @namespace    http://tampermonkey.net/
// @version      2026-06-15
// @description  WELearn自动答题
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

var isDebug = false; // 是否开启调试日志
function WriteConsole(...message) {
    if (isDebug){
        console.log(`[WELearn Auto Fill]`, ...message);
    }
}
async function solveRecordingTasksPersistent() {
const selectors = ['et-recorder', 'et-follow-me', 'et-talk'];
const doc = document.querySelector('iframe') ? document.querySelector('iframe').contentDocument : document;
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
                await sleep(100); // 避免点击过快导致平台卡顿
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
    const doc = document.querySelector('iframe') ? document.querySelector('iframe').contentDocument : document;
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

        console.log(`[判断题完成] ID:${id}, 答案:${learnerResponse}`);

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

        console.log(`[下拉题完成] ID:${id}, 答案:${choiceVal}`);

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
    const doc = document.querySelector('iframe') ? document.querySelector('iframe').contentDocument : document;
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
    const doc = document.querySelector('iframe') ? document.querySelector('iframe').contentDocument : document;
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
    const doc = document.querySelector('iframe') ? document.querySelector('iframe').contentDocument : document;
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
                console.log(`[连线题内存提取] ID:${id}, 答案序列:${responseStr}`);

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

async function sleep(ms) {  
    return new Promise(resolve => setTimeout(resolve, ms));
}

// 入口函数，依次执行各个题型的解题函数
function main() {
    WriteConsole("WELearn Auto Fill 已启动");
    //et-word-practice比较特殊每个页面都有所以需要检测et-wordbank
    const allType = ["et-recorder", "et-follow-me", "et-talk", "et-mark", "et-wordbank", "et-blank", "et-select", "et-choice", "et-tof","et-matching"];
    const doc = document.querySelector('iframe') ? document.querySelector('iframe').contentDocument : document;
    const foundTypes = allType.filter(type => doc.querySelectorAll(type).length > 0);
    WriteConsole("检测到以下题型:", foundTypes);
    for (const type of foundTypes) {
        WriteConsole(`正在处理题型: ${type}...`);
        switch(type) {
            case 'et-recorder':
            case 'et-follow-me':
            case 'et-talk':
                solveRecordingTasksPersistent();
                break;
            case 'et-mark':
                solveMarkTasks();
                break;
            case 'et-wordbank':
                solveWordPractice();
                break;
            case 'et-choice':
                solveChoice();
                break;
            case 'et-blank':
                solveBlank();
                break;
            case 'et-select':
            case 'et-tof':
                solveTofAndSelectTasks();
                break;
            case 'et-matching':
                solveMatchingTasks();
                break;
            default:
                WriteConsole(`未找到处理函数，跳过题型: ${type}`);
        }
    }
    WriteConsole("所有自动答题任务已完成");
}
(function() {
    function initDetection(callback) {
        const isCoursePage = location.href.includes('centercourseware.sflep.com');
        const isTestPage = location.href.includes('.sflep.com/test/') ||
                        location.href.includes('wetest.sflep.com/Test');

        if (isCoursePage) {
            // 课程页面：等待 DOM 包含题目容器，然后监听 URL 变化
            waitForCourseContent().then(() => {
                // 首次触发（页面刚加载完）
                callback();

                // 监听 URL 变化（SPA 导航）
                let lastUrl = location.href;
                const observer = new MutationObserver(() => {
                    const currentUrl = location.href;
                    if (currentUrl !== lastUrl) {
                        lastUrl = currentUrl;
                        // 等新页面内容稳定后再触发
                        waitForCourseContent().then(() => callback());
                    }
                });
                observer.observe(document.body, { subtree: true, childList: true });
            });
        }
        else if (isTestPage) {
            // 考试页面：等待 #spTimer 出现，然后添加手动按钮
            waitForTestPageReady().then(() => {
                addManualButton(callback);
            });
        }
    }

    // 等待课程页面的题目容器出现（常见选择器：.itemDiv, et-item 等）
    function waitForCourseContent() {
        return new Promise((resolve) => {
            const selectors = ['.itemDiv', 'et-item', '.et-item', '.question-item'];
            let timeout = 10000; // 最多等10秒
            const start = Date.now();

            const check = setInterval(() => {
                const found = selectors.some(sel => document.querySelector(sel));
                if (found || Date.now() - start > timeout) {
                    clearInterval(check);
                    resolve();
                }
            }, 200);
        });
    }

    // 等待考试页面就绪（#spTimer 出现）
    function waitForTestPageReady() {
        return new Promise((resolve) => {
            const start = Date.now();
            const check = setInterval(() => {
                if (document.querySelector('#spTimer') || Date.now() - start > 10000) {
                    clearInterval(check);
                    resolve();
                }
            }, 200);
        });
    }

    // 在考试页面上添加一个手动触发按钮
    function addManualButton(callback) {
        if (document.getElementById('eocs-trigger-btn')) return;
        const btn = document.createElement('button');
        btn.id = 'eocs-trigger-btn';
        btn.textContent = '检测题目';
        btn.style.cssText = `
            position: fixed;
            bottom: 20px;
            right: 20px;
            z-index: 9999;
            padding: 8px 16px;
            background: #2196f3;
            color: white;
            border: none;
            border-radius: 4px;
            cursor: pointer;
        `;
        btn.onclick = () => {
            callback();
            btn.disabled = true;
            setTimeout(() => btn.disabled = false, 3000);
        };
        document.body.appendChild(btn);
    }

    // ==================== 使用示例 ====================
    initDetection(() => {
        main();
    });
})();