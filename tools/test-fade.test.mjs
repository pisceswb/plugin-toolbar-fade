/*!
 * 工具条淡出插件的离线测试（不连思源、不改思源文件）
 *
 * 做法：用最小化的 DOM 桩件，按思源的真实协议加载**打包产物** index.js 跑一遍，
 * 模拟「选中文字 → 弹出工具条 → 鼠标移远 → 逐渐变淡 → 越过距离立即关闭」的完整过程。
 * 桩件里的 MutationObserver 是「会真的触发」的：工具条 class/style 一变就通知插件，
 * 所以这里跑的是插件的真实代码路径，而不是绕过去。
 *
 * 运行：
 *   node tools/test-fade.test.mjs                          （工具与插件同目录）
 *   node tools/test-fade.test.mjs ../../plugin-toolbar-fade （工具放在仓库外）
 */

import {strict as assert} from "node:assert";
import {dirname, join} from "node:path";
import {fileURLToPath} from "node:url";
import {loadPluginModule} from "./load-built.mjs";
import {findPluginDir} from "./find-plugin-dir.mjs";

/*────────────────────────── 最小 DOM 桩件 ──────────────────────────*/

const allElements = [];
const activeToolbars = [];
/** 注入过 <style> 的元素（当前仍在页面里的），卸载时应被移出 */
const styleElements = [];
/** 历史上注入过的所有 <style>，只增不减，用于卸载后断言「确实被移除过」 */
const allStyleElements = [];

/** 注册过的 MutationObserver，便于测试结束前断言 */
const observers = [];

function makeClassList() {
    const set = new Set();
    return {
        add(...names) {
            names.forEach((name) => set.add(name));
        },
        remove(...names) {
            names.forEach((name) => set.delete(name));
        },
        contains(name) {
            return set.has(name);
        },
        toggle(name, force) {
            const next = force === undefined ? !set.has(name) : force;
            if (next) {
                set.add(name);
            } else {
                set.delete(name);
            }
            return next;
        }
    };
}

function createElement(tag) {
    const element = {
        nodeType: 1,
        tagName: String(tag).toUpperCase(),
        children: [],
        parentElement: null,
        isConnected: true,
        removed: false,
        dataset: {},
        rect: {left: 100, right: 320, top: 200, bottom: 229, width: 220, height: 29},
        getBoundingClientRect() {
            return this.rect;
        },
        append(child) {
            child.parentElement = this;
            this.children.push(child);
            allElements.push(child);
            if (child.classList.contains("protyle-toolbar")) {
                activeToolbars.push(child);
            }
        },
        remove() {
            this.isConnected = false;
            this.removed = true;
            const index = allElements.indexOf(this);
            if (index >= 0) {
                allElements.splice(index, 1);
            }
            const toolbarIndex = activeToolbars.indexOf(this);
            if (toolbarIndex >= 0) {
                activeToolbars.splice(toolbarIndex, 1);
            }
            const styleIndex = styleElements.indexOf(this);
            if (styleIndex >= 0) {
                styleElements.splice(styleIndex, 1);
            }
        },
        addEventListener(type, handler) {
            (this._listeners ||= {})[type] = handler;
        },
        removeEventListener(type) {
            if (this._listeners) {
                delete this._listeners[type];
            }
        },
        querySelectorAll(selector) {
            return allElements.filter((item) => matches(item, selector));
        },
        querySelector() {
            return null;
        },
        setAttribute() {
        },
        getAttribute() {
            return null;
        },
        toggleAttribute() {
        },
        _listeners: {}
    };

    element.classList = makeClassList();

    // style 与 classList 都做成「可观察」的：一改变就通知 MutationObserver，
    // 这样插件里 observer 驱动的逻辑能被真实地触发。
    const style = {
        _display: "",
        _opacity: "1",
        _pointerEvents: "",
        setProperty() {
        },
        removeProperty() {
        }
    };
    for (const key of ["display", "opacity", "pointerEvents"]) {
        const field = `_${key}`;
        Object.defineProperty(style, key, {
            get() {
                return style[field];
            },
            set(value) {
                const next = String(value);
                if (style[field] === next) {
                    return;
                }
                style[field] = next;
                notifyAttribute(element, key === "display" ? "style" : "style");
            }
        });
    }
    element.style = style;

    const rawClassList = element.classList;
    element.classList = {
        add(...names) {
            rawClassList.add(...names);
            notifyAttribute(element, "class");
        },
        remove(...names) {
            rawClassList.remove(...names);
            notifyAttribute(element, "class");
        },
        toggle(name, force) {
            const result = rawClassList.toggle(name, force);
            notifyAttribute(element, "class");
            return result;
        },
        contains(name) {
            return rawClassList.contains(name);
        }
    };

    allElements.push(element);
    return element;
}

/** 支持 ".cls" / "tag" / "[data-key]" / "tag[data-key]" / ".cls[data-key]" 这些测试里用到的选择器 */
function matches(element, selector) {
    const classMatch = selector.match(/\.([\w-]+)/);
    const tagMatch = selector.match(/^([a-zA-Z]+)/);
    const attrMatch = selector.match(/\[([\w-]+)(?:=([^\]]+))?\]/);

    if (classMatch && !element.classList.contains(classMatch[1])) {
        return false;
    }
    if (tagMatch && element.tagName !== tagMatch[1].toUpperCase()) {
        return false;
    }
    if (attrMatch) {
        const key = attrMatch[1].replace(/^data-/, "").replace(/-([a-z])/g, (m, c) => c.toUpperCase());
        if (!Object.prototype.hasOwnProperty.call(element.dataset, key)) {
            return false;
        }
    }
    return Boolean(classMatch || tagMatch || attrMatch);
}

/** 通知所有观察了该元素的 observer */
function notifyAttribute(element, attributeName) {
    for (const observer of observers) {
        if (!observer.targets.has(element)) {
            continue;
        }
        if (observer.filter && !observer.filter.includes(attributeName)) {
            continue;
        }
        observer.callback([
            {type: "attributes", target: element, attributeName}
        ], observer);
    }
}

/** 造一个「已经弹出来的工具条」 */
function createToolbar() {
    const toolbar = createElement("div");
    toolbar.classList.add("protyle-toolbar");
    activeToolbars.push(toolbar);
    return toolbar;
}

const documentStub = {
    head: createElement("head"),
    body: createElement("body"),
    documentElement: createElement("html"),
    listeners: {},
    getElementById(id) {
        return allElements.find((item) => item.id === id) || null;
    },
    createElement,
    querySelectorAll(selector) {
        if (selector === ".protyle-toolbar") {
            return activeToolbars.filter((toolbar) => toolbar.isConnected);
        }
        return allElements.filter((item) => matches(item, selector));
    },
    addEventListener(type, handler) {
        (this.listeners[type] ||= []).push(handler);
    },
    removeEventListener(type, handler) {
        const list = this.listeners[type] || [];
        const index = list.indexOf(handler);
        if (index >= 0) {
            list.splice(index, 1);
        }
    },
    dispatch(type, event) {
        (this.listeners[type] || []).forEach((handler) => handler(event));
    }
};

documentStub.head.append = function (child) {
    this.children.push(child);
    allElements.push(child);
    styleElements.push(child);
    allStyleElements.push(child);
};

const selectionStub = {
    rangeCount: 1,
    getAt() {
        return null;
    },
    getRangeAt() {
        return {
            getClientRects: () => [
                {left: 120, right: 300, top: 300, bottom: 330, width: 180, height: 30}
            ],
            getBoundingClientRect: () => ({left: 120, right: 300, top: 300, bottom: 330, width: 180, height: 30})
        };
    }
};

const windowStub = {
    innerWidth: 1600,
    innerHeight: 900,
    listeners: {},
    setTimeout: (...args) => setTimeout(...args),
    clearTimeout: (...args) => clearTimeout(...args),
    addEventListener(type, handler) {
        (this.listeners[type] ||= []).push(handler);
    },
    removeEventListener(type, handler) {
        const list = this.listeners[type] || [];
        const index = list.indexOf(handler);
        if (index >= 0) {
            list.splice(index, 1);
        }
    },
    getSelection() {
        return selectionStub;
    }
};

/* rAF / 定时器桩件：手动驱动，测试才能确定性推进 */
let clock = 1000;
const rafQueue = [];
/**
 * 零延时定时器（插件在 mouseup 后用它补一次可见性判定）。
 * 必须由 tick() 一并执行：否则它们会异步落到后面的测试里，
 * 用旧的鼠标位置把工具条的状态改掉（这正是之前一个用例诡异失败的原因）。
 */
const timerQueue = [];

globalThis.document = documentStub;
globalThis.window = windowStub;
globalThis.getSelection = () => selectionStub;
globalThis.requestAnimationFrame = (callback) => {
    rafQueue.push(callback);
    return rafQueue.length;
};
globalThis.cancelAnimationFrame = (handle) => {
    if (handle > 0 && handle <= rafQueue.length) {
        rafQueue[handle - 1] = null;
    }
};
windowStub.setTimeout = (callback, delay) => {
    if (!delay) {
        timerQueue.push(callback);
        return -1;
    }
    // 长延时只用于测试里的等待，交回真实定时器
    return setTimeout(callback, delay);
};
windowStub.clearTimeout = (handle) => {
    if (handle > 0) {
        clearTimeout(handle);
    }
};
globalThis.MutationObserver = class {
    constructor(callback) {
        this.callback = callback;
        this.targets = new Set();
        this.filter = null;
        observers.push(this);
    }

    observe(target, options = {}) {
        this.targets.add(target);
        if (options.attributeFilter) {
            this.filter = options.attributeFilter;
        }
    }

    disconnect() {
        this.targets.clear();
        const index = observers.indexOf(this);
        if (index >= 0) {
            observers.splice(index, 1);
        }
    }
};

/** 推进 n 帧，每帧 16ms；每帧前先把零延时回调跑掉 */
function tick(frames = 1) {
    for (let i = 0; i < frames; i += 1) {
        timerQueue.splice(0, timerQueue.length).forEach((callback) => callback());
        clock += 16;
        const queued = rafQueue.splice(0, rafQueue.length).filter(Boolean);
        queued.forEach((callback) => callback(clock));
    }
}

/*────────────────────────── 载入插件 ──────────────────────────*/

const siyuanStub = await import("./siyuan-stub.mjs");

/**
 * 按思源的真实协议加载打包产物 index.js（CJS + module.exports）。
 * 这里顺便验证产物形态：如果源码里混进 import/export、或忘了 module.exports，
 * loadPluginModule 会直接抛错，测试立刻失败——这正是之前线上失败的原因。
 * Setting 用 getter，方便测试「siyuan 没导出 Setting」的降级路径。
 */
let settingClassOverride = siyuanStub.Setting;
const siyuanApi = {
    Plugin: siyuanStub.Plugin,
    showMessage: siyuanStub.showMessage,
    getAllEditor: siyuanStub.getAllEditor
};
Object.defineProperty(siyuanApi, "Setting", {
    get: () => settingClassOverride,
    enumerable: true
});

/**
 * 被测的打包产物位置：默认自动探测插件仓库目录；也可用参数指定：
 *   node tools/test-fade.test.mjs ../../plugin-toolbar-fade
 */
const pluginDir = findPluginDir(process.argv[2], dirname(fileURLToPath(import.meta.url)));

const PluginClass = loadPluginModule(
    join(pluginDir, "index.js"),
    siyuanApi,
    siyuanStub.Plugin
);

const toolbar = createToolbar();

const plugin = new PluginClass({name: "plugin-toolbar-fade", i18n: {}});
plugin.name = "plugin-toolbar-fade";
// 用属性访问直接返回 key，测试里不关心文案
plugin.i18n = new Proxy({}, {get: (target, key) => String(key)});
const savedPayloads = [];
plugin.loadData = async () => null;
plugin.saveData = async (name, data) => {
    savedPayloads.push(JSON.parse(JSON.stringify(data)));
};
plugin.removeData = async () => {
};
plugin.eventBus = {on() {}, off() {}};

// 让桩件的 Setting 能拿到插件实例（真身由思源在构造 Setting 时建立这层关系）
siyuanStub.Setting.prototype.plugin = plugin;

const results = [];
function check(title, fn) {
    try {
        fn();
        results.push(`  ✓ ${title}`);
    } catch (error) {
        results.push(`  ✗ ${title}\n      ${error.message}`);
        process.exitCode = 1;
    }
}

function moveMouse(x, y) {
    documentStub.dispatch("mousemove", {clientX: x, clientY: y});
}

/** 模拟「选中文字后工具条弹出」：核心会去掉 fn__none */
function toolbarPopupAt(x, y) {
    moveMouse(x, y);
    toolbar.classList.remove("fn__none");
    documentStub.dispatch("mouseup", {clientX: x, clientY: y, detail: 1});
}

async function waitFor(predicate, timeoutMs = 3000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        tick(10);
        if (predicate()) {
            return true;
        }
        await new Promise((resolve) => setTimeout(resolve, 60));
    }
    return predicate();
}

/*────────────────────────── 测试 ──────────────────────────*/

console.log("工具条淡出插件 —— 逻辑测试\n");

await plugin.onload();
console.log(`已接管工具条: ${plugin.faders.size} 个；注入样式: ${styleElements.length} 个\n`);

// 测试里反复用到的默认距离（后面有用例会临时改设置，最后会恢复）
const nearDistance = plugin.settings.nearDistance;
const farDistance = plugin.settings.farDistance;

check("插件接管了页面里已存在的工具条", () => {
    assert.equal(plugin.faders.size, 1);
});

check("读取默认设置（已去掉「停留时间」与「动画时长」两项）", () => {
    assert.equal(plugin.settings.enabled, true);
    assert.equal(plugin.settings.nearDistance, 20);
    assert.equal(plugin.settings.farDistance, 200);
    assert.ok(!("delay" in plugin.settings), "不应再有 delay 设置");
    assert.ok(!("fadeDuration" in plugin.settings), "不应再有 fadeDuration 设置");
});

check("设置面板已创建（思源的「插件菜单 → 设置」入口依赖这个实例）", () => {
    assert.ok(plugin.setting, "this.setting 必须存在，否则思源不会显示设置入口");
    assert.ok(plugin.setting instanceof siyuanStub.Setting, "应是 Setting 实例");
    // 开关 + 2 个距离项 + 恢复默认 + 说明文字
    assert.equal(plugin.setting.items.length, 5, `设置项数量应为 5，实际 ${plugin.setting.items.length}`);
    const titles = plugin.setting.items.map((item) => item.title);
    assert.ok(!titles.includes("delay") && !titles.includes("fadeDuration"), "面板里不应再有这两项");
});

check("openSetting() 能正常打开面板", () => {
    plugin.openSetting();
    assert.equal(plugin.setting.opened, true, "设置对话框应被打开");
    assert.equal(plugin.settingOpened, true, "应走到基类的 openSetting");
});

function findNumberInput(key) {
    const item = plugin.setting.items.find((entry) => entry.title === key);
    assert.ok(item && typeof item.createActionElement === "function", `应存在设置项 ${key}`);
    return item.createActionElement();
}

check("点「恢复默认」是就地刷新两个文本框，不会弹出新面板", () => {
    // 先改掉设置，并让面板里的文本框处于「已被改动」的状态
    plugin.settings.nearDistance = 111;
    plugin.settings.farDistance = 999;
    const nearInput = findNumberInput("nearDistance");
    const farInput = findNumberInput("farDistance");
    nearInput.value = "111";
    farInput.value = "999";
    const openCountBefore = plugin.setting.openCount;

    const resetItem = plugin.setting.items.find((item) => item.title === "resetDefaults");
    assert.ok(resetItem && typeof resetItem.createActionElement === "function", "应存在「恢复默认」按钮");
    resetItem.createActionElement()._listeners.click();

    assert.equal(plugin.settings.nearDistance, 20, "重置后应是新默认值 20");
    assert.equal(plugin.settings.farDistance, 200, "重置后应是默认值 200");
    assert.equal(nearInput.value, "20", `文本框应就地更新为 20，实际 ${nearInput.value}`);
    assert.equal(farInput.value, "200", `文本框应就地更新为 200，实际 ${farInput.value}`);
    assert.equal(plugin.setting.openCount, openCountBefore,
        "不应重新调用 open()（那会新建一个面板，旧面板就变成孤儿）");
    assert.equal(plugin.settingDestroyed || 0, 0, "也不需要销毁任何对话框");
});

// 把设置恢复到默认，避免影响后续用例
plugin.settings.nearDistance = nearDistance;
plugin.settings.farDistance = farDistance;

// ① 选字后工具条弹出
toolbarPopupAt(200, 315);
tick(4);

check("工具条弹出后加上淡出类名，且鼠标就在选区上时保持不透明", () => {
    assert.ok(toolbar.classList.contains("sy-toolbar-fade"), "应加上 sy-toolbar-fade");
    assert.equal(toolbar.style.opacity, "1", `不透明度应仍为 1，实际 ${toolbar.style.opacity}`);
});

check("工具条保持可点击（不能禁用指针事件，否则按钮全部失效、点击穿透到正文）", () => {
    assert.notEqual(toolbar.style.pointerEvents, "none", "内联 pointer-events 不应为 none");
    const injected = plugin.styleElement.textContent;
    assert.ok(injected.includes("opacity"), "应注入透明度过渡");
    assert.ok(!/pointer-events\s*:\s*none/.test(injected),
        "注入的样式里不应出现 pointer-events: none");
});

check("距离→不透明度映射符合要求（单调变淡、有可见下限）", () => {
    const fader = [...plugin.faders.values()][0];
    assert.equal(fader.targetAlpha(0), 1, "距离 0 应完全清晰");
    assert.equal(fader.targetAlpha(nearDistance), 1, `距离 ${nearDistance}px 应完全清晰`);

    let previous = 1;
    for (let d = nearDistance; d <= farDistance; d += 5) {
        const alpha = fader.targetAlpha(d);
        assert.ok(alpha <= previous + 1e-9, `应随距离单调变淡：${d}px 时 ${alpha} > ${previous}`);
        previous = alpha;
    }
    const atFar = fader.targetAlpha(farDistance);
    assert.ok(atFar < 0.6 && atFar >= 0.4,
        `到达关闭距离时应当「较淡但仍然可见」（0.4~0.6），实际 ${atFar}`);
});

// ② 距离在 near ~ far 之间：越远越淡，但始终可见
console.log(`  默认距离：${nearDistance}px 内清晰，${farDistance}px 处立即关闭`);

function distanceFrom(x, y) {
    return [...plugin.faders.values()][0].distanceAt(x, y);
}

/**
 * 把鼠标放到「距离 = d 像素」的位置（沿工具条下方垂直方向）。
 * 选区的上边缘离工具条下边缘较近，若只用固定 y 很容易同时贴近选区，
 * 所以这里用与插件同一套距离函数反推出目标位置，保证测的就是想测的距离。
 */
function moveMouseAtDistance(d) {
    for (let y = toolbar.rect.bottom; y < 1200; y += 1) {
        if (distanceFrom(200, y) >= d) {
            moveMouse(200, y);
            return distanceFrom(200, y);
        }
    }
    throw new Error(`找不到距离约等于 ${d} 的位置`);
}

/** 推进 rAF 循环直到透明度稳定（或工具条被关闭） */
function settle(frames = 120) {
    let previous = null;
    for (let i = 0; i < frames; i += 1) {
        tick(1);
        const now = toolbar.style.opacity;
        if (toolbar.classList.contains("fn__none")) {
            return;
        }
        if (now === previous) {
            return;
        }
        previous = now;
    }
}

const actualMid = moveMouseAtDistance((nearDistance + farDistance) / 2);
settle();
const midAlpha = Number(toolbar.style.opacity);

check("距离取中时工具条已变淡，但仍然可见（未关闭）", () => {
    assert.ok(!toolbar.classList.contains("fn__none"), "不应被关闭");
    assert.ok(midAlpha > 0.5 && midAlpha < 1,
        `应处于「较淡」区间（0.5~1），实际 ${midAlpha}（距离 ${actualMid.toFixed(0)}px）`);
});

const actualEdge = moveMouseAtDistance(farDistance - 15);
settle();
const barelyAlpha = Number(toolbar.style.opacity);

check("接近关闭距离时更淡，但依然可见（有「还看得见」的下限）", () => {
    assert.ok(!toolbar.classList.contains("fn__none"), "达到关闭距离之前不应被关闭");
    assert.ok(barelyAlpha < midAlpha, `应比中点更淡：${midAlpha} → ${barelyAlpha}`);
    assert.ok(barelyAlpha > 0.3, `应保留「还看得见」的下限，实际 ${barelyAlpha}`);
});
console.log(`  透明度：清晰 1 → 中点(${actualMid.toFixed(0)}px) ${midAlpha} → 距关闭 15px(${actualEdge.toFixed(0)}px) ${barelyAlpha}`);

// ③ 鼠标回来：恢复清晰
moveMouse(200, 315);
settle();

check("鼠标移回工具条附近后恢复为完全不透明", () => {
    assert.equal(toolbar.style.opacity, "1", `实际 ${toolbar.style.opacity}`);
});

// ④ 越过关闭距离：立即关闭（不延时）
const overDistance = moveMouseAtDistance(farDistance + 15);
tick(1);

check("越过关闭距离后立即关闭（不延时、不等待动画）", () => {
    assert.ok(overDistance > farDistance, `前置条件：应真的越过 ${farDistance}px，实际 ${overDistance.toFixed(0)}px`);
    assert.ok(toolbar.classList.contains("fn__none"), "应立即补上 fn__none");
    assert.equal(toolbar.style.display, "", "关闭时不应残留内联 display");
});

// ⑤ 关闭后鼠标乱动 / 回到附近，都不应把工具条「变」回来
moveMouse(200, 315);
tick(20);
moveMouse(200, 315);
tick(20);

check("关闭后鼠标移动不会再把它显示出来（不重复显示）", () => {
    assert.ok(toolbar.classList.contains("fn__none"), "应保持关闭状态");
    assert.equal(toolbar.style.opacity, "1", "透明度应已复位");
});

// ⑥ 重新选字：工具条应重新可见且不受上次影响
toolbarPopupAt(200, 315);
tick(4);

check("重新选字后工具条恢复不透明并重新武装", () => {
    assert.ok(!toolbar.classList.contains("fn__none"), "不应仍处于关闭状态");
    assert.equal(toolbar.style.opacity, "1");
    assert.equal(toolbar.style.pointerEvents, "");
});

// ⑦ 关掉开关：先让工具条变淡，再关开关并把鼠标移回来
moveMouseAtDistance((nearDistance + farDistance) / 2);
settle();
const fadedBeforeToggle = Number(toolbar.style.opacity);
plugin.settings.enabled = false;
moveMouse(200, 315);
tick(4);

check("关闭「启用距离淡出」后不再改变透明度", () => {
    assert.ok(fadedBeforeToggle < 1, `前置条件失败：关开关前应先变淡，实际 ${fadedBeforeToggle}`);
    assert.equal(toolbar.style.opacity, "1", `实际 ${toolbar.style.opacity}`);
    moveMouse(1200, 800);
    tick(60);
    assert.equal(toolbar.style.opacity, "1", "关掉开关后移远也不应变淡或关闭");
    assert.ok(!toolbar.classList.contains("fn__none"), "关掉开关后不应再关闭工具条");
});
plugin.settings.enabled = true;

// ⑦ 思源核心自己隐藏工具条（点空白处 / 按 Esc）时，插件不应残留状态
toolbar.classList.add("fn__none");
tick(4);

check("工具条被思源核心隐藏后，插件清理掉自己的类名与内联透明度", () => {
    assert.ok(!toolbar.classList.contains("sy-toolbar-fade"), "淡出类名应被移除");
    assert.equal(toolbar.style.opacity, "1");
});

// ⑧ 距离设反时自动纠正
plugin.settings.nearDistance = 400;
plugin.settings.farDistance = 10;
plugin.normalize();

check("距离参数设反时自动纠正", () => {
    assert.ok(plugin.settings.farDistance > plugin.settings.nearDistance,
        `far=${plugin.settings.farDistance} 应大于 near=${plugin.settings.nearDistance}`);
});

// ⑧b 设置面板的保存回调
const savedBefore = savedPayloads.length;
plugin.setting.options.confirmCallback();
await new Promise((resolve) => setTimeout(resolve, 20));

check("设置面板保存回调会落盘并提示", () => {
    assert.ok(savedPayloads.length > savedBefore, "应调用 saveData 落盘");
    const last = savedPayloads.at(-1);
    assert.ok(last && Number.isFinite(last.nearDistance) && Number.isFinite(last.farDistance),
        `落盘内容应包含两个距离设置，实际 ${JSON.stringify(last)}`);
    assert.ok(!("delay" in last) && !("fadeDuration" in last),
        `落盘内容不应再含已删除的设置项，实际 ${JSON.stringify(last)}`);
    assert.ok(siyuanStub.messages.some((item) => item.message === "saved"), "应提示已保存");
});

// ⑧c 万一 siyuan 模块没导出 Setting，必须报错而不是静默失效
const settingsBeforeFail = siyuanStub.messages.length;
plugin.setting = null;
const savedSettingClass = settingClassOverride;
settingClassOverride = undefined;

check("siyuan 未导出 Setting 时给出可见错误，而不是静默无反应", () => {
    plugin.openSetting();
    const errors = siyuanStub.messages.slice(settingsBeforeFail).filter((item) => item.type === "error");
    assert.ok(errors.length > 0, "应弹出 error 类型提示");
    assert.ok(errors.at(-1).message.includes("Setting"), `提示应说明原因，实际：${errors.at(-1).message}`);
});

check("报错之后核心功能不受影响（设置面板坏了也不影响淡出）", () => {
    plugin.setting = null;
    // 上一个用例把距离改成了 400/450（测试「设反自动纠正」），这里恢复默认再做几何判定
    plugin.settings.nearDistance = nearDistance;
    plugin.settings.farDistance = farDistance;
    plugin.settings.enabled = true;
    toolbarPopupAt(200, 315);
    settle();
    const moved = moveMouseAtDistance((nearDistance + farDistance) / 2);
    settle();
    assert.ok(Number(toolbar.style.opacity) < 1,
        `淡出应仍在工作，实际透明度 ${toolbar.style.opacity}（鼠标距离 ${moved.toFixed(0)}px）`);
    toolbar.classList.add("fn__none");
    tick(2);
});

settingClassOverride = savedSettingClass;

// ⑨ 卸载：清理干净
const injectedStyles = allStyleElements.slice();
plugin.onunload();
check("卸载后移除注入样式、断开接管", () => {
    assert.equal(plugin.faders.size, 0);
    assert.ok(injectedStyles.length > 0, "前置条件失败：应当注入过样式");
    assert.ok(injectedStyles.every((element) => element.removed === true && !element.isConnected),
        "注入的 <style> 应被从页面移除");
    assert.equal(styleElements.length, 0, "页面里不应还留着注入的样式");
    assert.equal(documentStub.listeners.mousemove.length, 0, "mousemove 监听应被移除");
    assert.equal(windowStub.listeners.scroll.length, 0, "scroll 监听应被移除");
    assert.equal(observers.length, 0, "所有 MutationObserver 应被 disconnect");
    assert.ok(!toolbar.classList.contains("sy-toolbar-fade"), "淡出类名应被清理");
    assert.equal(toolbar.style.opacity, "1");
});

console.log(`\n${results.join("\n")}`);
console.log(process.exitCode ? "\n存在失败用例。" : "\n全部通过。");
