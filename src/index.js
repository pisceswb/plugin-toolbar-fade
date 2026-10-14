/*!
 * 工具条淡出 (Toolbar Fade) —— 思源笔记插件
 *
 * 让「选中文字后弹出的工具条」像 Word 的浮动工具栏那样：鼠标离开一定距离后开始变淡，
 * 离得越远越淡，超过设定距离后自动关闭（收起）。
 *
 * ── 实现要点（为什么这样做）─────────────────────────────────────────────
 * 1. 思源的工具条就是普通 DOM：每个编辑器面板有一个 div.protyle-toolbar，
 *    position: fixed / z-index: 7，显示与隐藏只靠切换类名 fn__none
 *    （fn__none 的定义是 display:none !important，没有过渡效果）。
 *    所以纯 CSS 做不到「按鼠标距离淡出」——CSS 无法知道鼠标在哪。
 *
 * 2. 本插件的做法分三步：
 *      ① 用 MutationObserver 盯着工具条的 class / style，判断它「刚弹出来」；
 *      ② 在 document 上以捕获阶段监听 mousemove / scroll / mouseup（passive，不阻塞），
 *         用 requestAnimationFrame 节流，算出鼠标到「工具条 + 选区」外扩矩形的距离；
 *      ③ 把距离线性映射成不透明度（近距离 = 1，远距离 = 0），写进工具条的内联
 *         opacity；降到 0 并保持一小段时间后，手动补上 fn__none 真正关闭它
 *         —— 这正是思源核心自己用来隐藏工具条的同一个类名，不涉及任何私有 API。
 *
 * 3. 两个关键细节：
 *      · 淡出结束后要写元素.style.display = "" 再补 fn__none。因为思源核心在
 *        「选区滚出视野」时会写内联 display:none，此时再加 fn__none 不会移除内联样式，
 *        鼠标回来时工具条就再也显示不出来了。
 *      · 鼠标「一开始就在很远的地方」时不参与淡出（armed 标志），
 *        否则用键盘 Shift+方向键选字、或鼠标停在远处再选字时，工具条会立刻消失。
 *
 * 4. 不修改编辑器内容、不碰内核数据，卸载后完全恢复思源原生行为。
 *
 * 5. 排错：启动时会往控制台打 [toolbar-fade] 日志，任何失败都会同时
 *    用 showMessage 弹出可见提示（不会静默失效）；控制台里 __toolbarFade 是插件实例。
 */

import * as siyuan from "siyuan";

/**
 * 从 siyuan 模块取一个 API。
 *
 * 注意：思源是用 eval + CommonJS 加载插件的（打包脚本 build.mjs 顶部有说明），
 * 所以这里虽然写的是 `import * as`，打包后会被换成 `require("siyuan")`；
 * 用命名空间取值而不是具名解构，是为了在某个 API 缺失时能优雅报错，
 * 而不是让整个模块在链接阶段就挂掉。
 *
 * window.__toolbarFadeApi 是给离线测试用的注入点，思源运行时不会设置它。
 */
function api(name) {
    if (typeof window !== "undefined" && window.__toolbarFadeApi && name in window.__toolbarFadeApi) {
        return window.__toolbarFadeApi[name];
    }
    return siyuan[name];
}

/** 设置存储文件名 */
const STORAGE_NAME = "settings";

const DEFAULTS = {
    enabled: true,
    /** 这个距离以内完全清晰（像素）；超出后越远越淡 */
    nearDistance: 20,
    /** 超过这个距离立即关闭工具条（像素） */
    farDistance: 200
};

/** 加载时用于清洗非法配置的边界 */
const LIMITS = {
    nearDistance: [0, 400],
    farDistance: [1, 1200]
};

/** 加在工具条上的类名（样式见同目录 index.css） */
const FADE_CLASS = "sy-toolbar-fade";
/** 版本号，仅用于日志排查 */
const VERSION = "0.3.0";
/** 工具条矩形向外扩张的距离（像素）：工具条是主要操作对象，扩得多一点 */
const PAD_TOOLBAR = 10;
/** 选区矩形向外扩张的距离（像素） */
const PAD_SELECTION = 6;
/**
 * 到达「完全消失的距离」之前，工具条最多淡到多透明。
 * 保持一个下限，这样在 farDistance 处工具条仍然看得见（只是较淡），
 * 越过 farDistance 才由插件直接关闭。
 */
const MIN_VISIBLE_ALPHA = 0.4;
/** 距离采样与透明度插值的节流间隔（毫秒） */
const STEP_MS = 60;
/** 透明度变化速度（1 / 秒）：越大越快贴近目标值 */
const SMOOTH_SPEED = 6;

/** 注入的 <style> 元素 id */
const STYLE_ID = "plugin-toolbar-fade-style";

/*──────────────────────────────── 工具函数 ────────────────────────────────*/

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

/** 点到矩形的最短距离；点在矩形内返回 0 */
function distanceToRect(x, y, rect) {
    const dx = Math.max(rect.left - x, 0, x - rect.right);
    const dy = Math.max(rect.top - y, 0, y - rect.bottom);
    return Math.hypot(dx, dy);
}

/** 把若干矩形按「扩张后合并」聚成几块，避免相邻行的判定区域互相切割 */
function clusterRects(rects, gap) {
    const clusters = [];
    const source = rects.map((rect) => ({
        left: rect.left - gap,
        right: rect.right + gap,
        top: rect.top - gap,
        bottom: rect.bottom + gap
    }));
    for (const rect of source) {
        let merged = false;
        for (const cluster of clusters) {
            if (rect.left <= cluster.right + gap && rect.right >= cluster.left - gap &&
                rect.top <= cluster.bottom + gap && rect.bottom >= cluster.top - gap) {
                cluster.left = Math.min(cluster.left, rect.left);
                cluster.right = Math.max(cluster.right, rect.right);
                cluster.top = Math.min(cluster.top, rect.top);
                cluster.bottom = Math.max(cluster.bottom, rect.bottom);
                merged = true;
                break;
            }
        }
        if (!merged) {
            clusters.push({...rect});
        }
    }
    return clusters;
}

/** 鼠标到「当前选区」的距离；没有可用选区时返回 Infinity */
function distanceToSelection(x, y) {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) {
        return Infinity;
    }
    const range = selection.getRangeAt(0);
    let rects = [];
    try {
        rects = Array.from(range.getClientRects()).filter((rect) => rect.width > 0 || rect.height > 0);
    } catch (error) {
        rects = [];
    }
    if (rects.length === 0) {
        const rect = range.getBoundingClientRect();
        if (rect && (rect.width > 0 || rect.height > 0)) {
            rects = [rect];
        }
    }
    if (rects.length === 0) {
        return Infinity;
    }
    let best = Infinity;
    for (const rect of clusterRects(rects, PAD_SELECTION)) {
        best = Math.min(best, distanceToRect(x, y, rect));
        if (best === 0) {
            break;
        }
    }
    return best;
}

/*────────────────────────── 单个编辑器面板的工具条 ──────────────────────────*/

class ToolbarFader {

    /**
     * @param {HTMLElement} element div.protyle-toolbar
     * @param {Function} getConfig 返回当前配置的函数
     * @param {Function} [onError] 出错回调（由插件转成可见提示）
     */
    constructor(element, getConfig, onError) {
        this.element = element;
        this.getConfig = getConfig;
        this.onError = onError;
        this.visible = false;
        /** 鼠标是否「来过」工具条/选区附近；没来过就不参与淡出判定 */
        this.armed = false;
        /**
         * 是否已放弃本次跟踪（鼠标从远处离开过）。
         * 重要：设为 true 之后循环会停止，工具条不会再自行变淡；
         * 想再用工具条请重新选一次字——与 Word 的体验一致，也避免反复淡出。
         */
        this.disarmed = false;
        this.alpha = 1;
        this.lastX = 0;
        this.lastY = 0;
        this.pointerKnown = false;
        this.raf = 0;
        this.lastStep = 0;
        this.lastDistance = Infinity;

        this.observer = new MutationObserver(() => {
            try {
                this.sync();
            } catch (error) {
                if (this.onError) {
                    this.onError(error);
                } else {
                    console.error("[toolbar-fade] 可见性处理出错:", error);
                }
            }
        });
        this.observer.observe(this.element, {attributes: true, attributeFilter: ["class", "style"]});
        this.sync();
    }

    /*─ 可见性跟踪 ─*/

    /** 元素当前是否真的显示（类名 fn__none 和内联 display:none 都要看） */
    isShown() {
        if (!this.element.isConnected) {
            return false;
        }
        if (this.element.classList.contains("fn__none")) {
            return false;
        }
        return this.element.style.display !== "none";
    }

    sync() {
        const shown = this.isShown();
        if (shown === this.visible) {
            return;
        }
        this.visible = shown;
        if (shown) {
            this.onShow();
        } else {
            this.onHide();
        }
    }

    onShow() {
        this.element.classList.add(FADE_CLASS);
        // 思源弹出工具条时会重新写 left/top，这时清掉上一次的淡化痕迹
        this.element.style.opacity = "1";
        this.element.style.pointerEvents = "";
        this.alpha = 1;
        this.disarmed = false;
        // 关键：此时鼠标通常就在刚选中的文字附近，能立刻判定出初始「武装」状态
        this.armed = this.pointerKnown && this.distanceAt(this.lastX, this.lastY) <= this.far();
        this.ensureLoop();
    }

    onHide() {
        this.armed = false;
        this.disarmed = false;
        this.alpha = 1;
        this.stopLoop();
        this.element.classList.remove(FADE_CLASS);
        this.element.style.opacity = "1";
        this.element.style.pointerEvents = "";
    }

    /*─ 配置 ─*/

    near() {
        const config = this.getConfig();
        return Math.min(config.nearDistance, config.farDistance - 1);
    }

    far() {
        const config = this.getConfig();
        return Math.max(config.farDistance, config.nearDistance + 1);
    }

    /*─ 距离与透明度 ─*/

    distanceAt(x, y) {
        const rect = this.element.getBoundingClientRect();
        const toolbarDistance = distanceToRect(
            x, y,
            {
                left: rect.left - PAD_TOOLBAR,
                right: rect.right + PAD_TOOLBAR,
                top: rect.top - PAD_TOOLBAR,
                bottom: rect.bottom + PAD_TOOLBAR
            }
        );
        return Math.min(toolbarDistance, distanceToSelection(x, y));
    }

    /**
     * 距离 → 目标不透明度。
     *
     * 分两段：
     *   near 以内          → 1（完全清晰）
     *   near ~ far 之间     → 由 1 平滑降到 MIN_VISIBLE_ALPHA（越远越淡，但始终看得见）
     *   到达 far            → 仍是 MIN_VISIBLE_ALPHA（此时还可见，只是较淡）
     * 越过 far 由 recompute 直接关闭，不靠透明度。
     */
    targetAlpha(distance) {
        const near = this.near();
        const far = this.far();
        if (distance <= near) {
            return 1;
        }
        const ratio = Math.min(1, (distance - near) / Math.max(1, far - near));
        return 1 - (1 - MIN_VISIBLE_ALPHA) * ratio;
    }

    applyAlpha(alpha) {
        const rounded = Number(alpha.toFixed(3));
        this.element.style.opacity = rounded === 1 ? "1" : String(rounded);
    }

    /*─ 主循环 ─*/

    onPointer(x, y) {
        this.lastX = x;
        this.lastY = y;
        this.pointerKnown = true;
        this.ensureLoop();
    }

    ensureLoop() {
        if (this.raf || !this.visible || this.element.style.display === "none") {
            return;
        }
        this.raf = requestAnimationFrame((now) => this.step(now));
    }

    stopLoop() {
        if (this.raf) {
            cancelAnimationFrame(this.raf);
            this.raf = 0;
        }
    }

    step(now) {
        this.raf = 0;
        try {
            this.recompute(now);
        } catch (error) {
            // 单帧计算失败不应该让透明度卡死或循环失控
            this.stopLoop();
            if (this.onError) {
                this.onError(error);
            } else {
                console.error("[toolbar-fade] 淡出计算出错:", error);
            }
            return;
        }
        // 可见且已武装时持续跟踪；工具条被关闭后自然停止
        if (this.visible && this.armed) {
            this.raf = requestAnimationFrame((next) => this.step(next));
        }
    }

    recompute(now) {
        const config = this.getConfig();

        if (!this.visible) {
            this.stopLoop();
            return;
        }

        // 功能关闭：立刻恢复原样并停止跟踪（循环不能空转，否则会一直占着 CPU）
        if (!config.enabled) {
            if (this.alpha !== 1) {
                this.alpha = 1;
                this.applyAlpha(1);
            }
            this.armed = false;
            this.stopLoop();
            return;
        }

        if (!this.armed) {
            if (this.disarmed || !this.pointerKnown) {
                // 已放弃跟踪 / 还不知道鼠标在哪：停下，等下一次 mousemove 再被唤醒
                this.stopLoop();
                return;
            }
            // 每帧都重新判定「鼠标是否来过附近」：
            // 不能只在工具条弹出那一刻判定，否则插件加载时就已存在的工具条永远不会被武装。
            const distance = this.distanceAt(this.lastX, this.lastY);
            this.lastDistance = distance;
            if (distance > this.far()) {
                // 鼠标从未靠近过（例如用键盘选字，鼠标停在别处）：不接管，也不再空转
                this.disarmed = true;
                this.stopLoop();
                return;
            }
            this.armed = true;
        }

        const distance = this.distanceAt(this.lastX, this.lastY);
        this.lastDistance = distance;

        // 越过设定距离：立即关闭，不等动画、不留计时器
        if (distance > this.far()) {
            this.close();
            return;
        }

        // 还在范围内：越远越淡（下限 MIN_VISIBLE_ALPHA，保证 farDistance 处仍然看得见）
        const target = this.targetAlpha(distance);
        if (now - this.lastStep < STEP_MS) {
            // 节流：两次采样之间只推进透明度，不重新测几何
            this.advance(target, Math.min((now - this.lastStep) / 1000, 0.2));
            return;
        }
        this.lastStep = now;
        this.advance(target, STEP_MS / 1000);
    }

    /** 指数插值：越接近目标越慢，视觉上更柔和 */
    advance(target, dt) {
        const next = this.alpha + (target - this.alpha) * Math.min(1, SMOOTH_SPEED * dt);
        if (Math.abs(next - this.alpha) < 0.002) {
            this.alpha = target;
        } else {
            this.alpha = next;
        }
        this.applyAlpha(this.alpha);
    }

    /**
     * 关闭工具条。
     *
     * 关掉之后不再跟踪（disarmed），所以鼠标再移动也不会把它「变」回来——
     * 想再用工具条就重新选一次字。这样也避免了反复淡出/重复显示。
     * 关闭本身不走计时器：调用者判定「超出距离」后立即执行。
     */
    close() {
        this.stopLoop();
        this.armed = false;
        this.disarmed = true;
        this.element.style.display = "";
        this.element.classList.add("fn__none");
        this.element.style.opacity = "1";
        this.element.style.pointerEvents = "";
        this.alpha = 1;
        this.visible = false;
    }

    destroy() {
        this.observer.disconnect();
        this.stopLoop();
        this.element.classList.remove(FADE_CLASS);
        this.element.style.opacity = "1";
        this.element.style.pointerEvents = "";
    }
}

/*────────────────────────────────── 插件 ──────────────────────────────────*/

export default class ToolbarFadePlugin extends api("Plugin") {

    constructor(options) {
        super(options);
        this.settings = Object.assign({}, DEFAULTS);
        /** element -> ToolbarFader */
        this.faders = new Map();
        /** 接管失败的工具条（按类名去重），便于排查 */
        this.attachFailures = new Map();
        this.bodyObserver = null;
        /** 绑定的全局鼠标监听（用普通函数绑定 this，卸载时才能移除） */
        this.onMouseMoveBindThis = this.onMouseMove.bind(this);
        this.onMouseUpBindThis = this.onMouseUp.bind(this);
        this.onScrollBindThis = this.onScroll.bind(this);
        this.onProtyleLoadedBindThis = this.onProtyleLoaded.bind(this);
        this.getConfigBindThis = this.getConfig.bind(this);
        this.onFaderErrorBindThis = this.onFaderError.bind(this);
        /** 已经提示过的错误信息，避免每帧弹一次提示 */
        this.reportedErrors = new Set();
        /** 设置面板里的数字输入框：key -> input（思源不保存内容节点，只能自己记） */
        this.numberInputs = new Map();
        this.styleElement = null;
        this.setting = null;
    }

    async onload() {
        // 启动日志：出问题时便于对照。可用 window.__toolbarFade.debug() 查看更完整的状态。
        console.log(`[toolbar-fade] 开始加载 v${VERSION}`);
        try {
            await this.loadSettings();
        } catch (error) {
            console.error("[toolbar-fade] 读取设置失败，使用默认值:", error);
            this.settings = Object.assign({}, DEFAULTS);
        }
        try {
            this.injectStyle();
        } catch (error) {
            console.error("[toolbar-fade] 注入样式失败（不影响功能）:", error);
        }
        // 核心功能：整体包一层，任何一步失败都不至于让插件看起来「什么都没做」
        try {
            this.startCore();
        } catch (error) {
            this.reportError("启动淡出逻辑失败", error);
        }
        // 设置面板：单独一层，失败也不影响上面的核心功能
        try {
            this.ensureSetting();
        } catch (error) {
            this.reportError("创建设置面板失败", error);
        }
        this.debugInfo();
        // 方便随时排查：控制台里 __toolbarFade 就是本插件实例
        try {
            window.__toolbarFade = this;
        } catch (error) {
            void error;
        }
        console.log(`[toolbar-fade] 加载完成：已接管 ${this.faders.size} 个工具条`);
    }

    /** 核心行为：监听鼠标、接管工具条 */
    startCore() {
        if (!this.eventBus || typeof this.eventBus.on !== "function") {
            throw new Error("this.eventBus 不可用（思源版本不兼容？）");
        }
        document.addEventListener("mousemove", this.onMouseMoveBindThis, {passive: true, capture: true});
        document.addEventListener("mouseup", this.onMouseUpBindThis, {passive: true, capture: true});
        window.addEventListener("scroll", this.onScrollBindThis, {passive: true, capture: true});
        this.eventBus.on("loaded-protyle-static", this.onProtyleLoadedBindThis);
        // 1) 插件启用时编辑器可能已经打开了，先扫一遍现有工具条
        this.scan();
        // 2) 新打开的面板靠事件补上；3) 首次创建的工具条靠 body 观察兜底
        this.observeBody();
    }

    /** 把真实的失败原因暴露出来（控制台 + 界面提示），避免「静默无效」 */
    reportError(message, error) {
        const detail = error && error.message ? error.message : String(error);
        const text = `${message}: ${detail}`;
        console.error(`[toolbar-fade] ${text}`, error);
        if (this.reportedErrors.has(text)) {
            return;
        }
        this.reportedErrors.add(text);
        try {
            // 思源签名：showMessage(message, timeout, type, messageId)
            // 参数必须是字面量，否则思源会当成变量名而丢弃提示
            const show = api("showMessage");
            if (typeof show === "function") {
                show(`[工具条淡出] ${text}`, 8000, "error");
            }
        } catch (inner) {
            void inner;
        }
    }

    /** 单个工具条在运行期出错（每帧都会经过这里，做去重） */
    onFaderError(error) {
        this.reportError("淡出过程出错", error);
    }

    /** 打印/返回一份自检信息，用于快速判断插件是否真的在运行 */
    debugInfo() {
        const info = {
            version: VERSION,
            settingClass: typeof api("Setting"),
            eventBus: typeof this.eventBus,
            hasLoadData: typeof this.loadData,
            toolbarsFound: document.querySelectorAll(".protyle-toolbar").length,
            fadersAttached: this.faders.size,
            attachFailures: this.attachFailures.size,
            settings: this.settings,
            settingPanelReady: Boolean(this.setting)
        };
        console.log("[toolbar-fade] 自检:", info);
        return info;
    }

    onunload() {
        document.removeEventListener("mousemove", this.onMouseMoveBindThis, {capture: true});
        document.removeEventListener("mouseup", this.onMouseUpBindThis, {capture: true});
        window.removeEventListener("scroll", this.onScrollBindThis, {capture: true});
        if (this.eventBus && typeof this.eventBus.off === "function") {
            this.eventBus.off("loaded-protyle-static", this.onProtyleLoadedBindThis);
        }
        if (this.bodyObserver) {
            this.bodyObserver.disconnect();
            this.bodyObserver = null;
        }
        for (const fader of this.faders.values()) {
            fader.destroy();
        }
        this.faders.clear();
        this.removeStyle();
        try {
            if (window.__toolbarFade === this) {
                delete window.__toolbarFade;
            }
        } catch (error) {
            void error;
        }
    }

    /*─ 接管工具条 ─*/

    scan() {
        document.querySelectorAll(".protyle-toolbar").forEach((element) => this.attach(element));
    }

    attach(element) {
        if (this.faders.has(element)) {
            return;
        }
        try {
            // 清掉旧版本可能留在工具条上的内联 pointer-events（会让按钮全部点不动）
            element.style.pointerEvents = "";
            this.faders.set(element, new ToolbarFader(element, this.getConfigBindThis, this.onFaderErrorBindThis));
        } catch (error) {
            // 个别工具条接管失败不应该拖垮整体；记录一次，真正的报错留给 reportError
            const name = element.className || "(unknown)";
            if (!this.attachFailures.has(name)) {
                this.attachFailures.set(name, error);
                console.error(`[toolbar-fade] 接管工具条失败: ${name}`, error);
            }
        }
    }

    observeBody() {
        const root = document.body || document.documentElement;
        if (!root) {
            throw new Error("document.body 与 documentElement 都不存在，无法观察工具条");
        }
        this.bodyObserver = new MutationObserver((records) => {
            for (const record of records) {
                for (const node of record.addedNodes) {
                    if (node.nodeType !== 1) {
                        continue;
                    }
                    if (node.classList && node.classList.contains("protyle-toolbar")) {
                        this.attach(node);
                    }
                    if (node.querySelectorAll) {
                        node.querySelectorAll(".protyle-toolbar").forEach((element) => this.attach(element));
                    }
                }
            }
        });
        this.bodyObserver.observe(root, {childList: true, subtree: true});
    }

    onProtyleLoaded({detail}) {
        const element = detail && detail.protyle && detail.protyle.toolbar && detail.protyle.toolbar.element;
        if (element) {
            this.attach(element);
        }
    }

    /*─ 全局鼠标事件：只负责记录位置，计算放在 rAF 里 ─*/

    onMouseMove(event) {
        const x = event.clientX;
        const y = event.clientY;
        for (const fader of this.faders.values()) {
            fader.onPointer(x, y);
        }
    }

    /** 鼠标松开是思源弹出工具条的时机，延后一拍再做一次可见性判定 */
    onMouseUp() {
        window.setTimeout(() => {
            for (const fader of this.faders.values()) {
                fader.sync();
            }
        }, 0);
    }

    onScroll() {
        for (const fader of this.faders.values()) {
            fader.sync();
        }
    }

    /*─ 配置 ─*/

    getConfig() {
        return this.settings;
    }

    /**
     * 清洗单个数值：非数字回退默认值、四舍五入并夹到允许范围。
     * 注意：这里**不做**「距离填反就自动帮用户改」这类跨字段纠正——
     * 那属于替用户改数字，容易让人困惑；改由 validateSettings() 报错让用户自己改。
     */
    normalize() {
        const settings = this.settings;
        settings.enabled = settings.enabled !== false;
        for (const key of ["nearDistance", "farDistance"]) {
            let value = Number(settings[key]);
            if (!Number.isFinite(value)) {
                value = DEFAULTS[key];
            }
            settings[key] = Math.round(clamp(value, LIMITS[key][0], LIMITS[key][1]));
        }
        return settings;
    }

    async loadSettings() {
        const stored = await this.loadData(STORAGE_NAME) || {};
        this.settings = Object.assign({}, DEFAULTS, stored);
        this.normalize();
        // 面板可能存在（比如重载后再打开），把归一化后的值同步回输入框
        this.syncInputs();
    }

    async saveSettings() {
        // 到这里为止 settings 已经过校验与清洗（readAndValidateSettings 负责）
        this.syncInputs();
        await this.saveData(STORAGE_NAME, this.settings);
        // 让已经打开的工具条立刻用上新参数
        for (const fader of this.faders.values()) {
            fader.sync();
        }
    }

    /** 按语言取文案并填充 ${...} 占位符 */
    fillTemplate(key, values) {
        let text = String(this.i18n[key] || key);
        // 用 split/join：String.replace 的替换串会解释 $ 特殊序列，
        // 而 "${name}" 这种写法在 JS 里又容易被当成模板插值，容易出错。
        Object.keys(values || {}).forEach((name) => {
            text = text.split("${" + name + "}").join(String(values[name]));
        });
        return text;
    }

    /**
     * 读取面板里的输入框值，校验合法性；通过后把 settings 更新为清洗过的值。
     *
     * 校验规则（任何一条不通过都会给出提示并拒绝保存，绝不悄悄改用户的数字）：
     *   1. 必须是数字；
     *   2. 必须落在允许范围内（超出范围时明确告诉用户允许范围）；
     *   3. 「开始变淡的距离」必须小于「立即关闭的距离」。
     */
    readAndValidateSettings() {
        const raw = {};
        this.numberInputs.forEach((input, key) => {
            raw[key] = Number(input.value);
        });
        if (raw.nearDistance === undefined && raw.farDistance === undefined) {
            // 面板从来没被打开过（没有输入框可读）：沿用当前设置
            return this.validateSettings();
        }

        const keys = ["nearDistance", "farDistance"];
        for (const key of keys) {
            if (raw[key] === undefined) {
                continue;
            }
            if (!Number.isFinite(raw[key])) {
                this.showError(this.fillTemplate("invalidDistanceNumber", {
                    field: this.i18n[key],
                    value: String(this.numberInputs.get(key) ? this.numberInputs.get(key).value : "")
                }));
                return false;
            }
            const min = LIMITS[key][0];
            const max = LIMITS[key][1];
            if (raw[key] < min || raw[key] > max) {
                this.showError(this.fillTemplate("invalidDistanceRange", {
                    field: this.i18n[key],
                    value: String(raw[key]),
                    min: String(min),
                    max: String(max)
                }));
                return false;
            }
        }

        // 校验通过：写入并按范围取整（四舍五入不会越界，因为上面已经确认在范围内）
        keys.forEach((key) => {
            if (raw[key] !== undefined) {
                this.settings[key] = raw[key];
            }
        });
        this.normalize();
        return this.validateSettings();
    }

    /**
     * 校验设置面板里的距离。
     * 不满足「开始变淡的距离 < 立即关闭的距离」时给出错误提示并拒绝保存，
     * 让用户自己改数字——而不是悄悄替他改掉（那样很容易让人困惑）。
     */
    validateSettings() {
        const near = this.settings.nearDistance;
        const far = this.settings.farDistance;
        if (!Number.isFinite(near) || !Number.isFinite(far)) {
            this.showError(this.i18n.invalidDistance);
            return false;
        }
        if (near >= far) {
            this.showError(this.fillTemplate("invalidDistanceOrder", {near, far}));
            return false;
        }
        return true;
    }

    /** 弹出错误提示；若由于样式问题弹不出来，至少把原因写进控制台 */
    showError(message) {
        const text = message || "设置不合法";
        try {
            const show = api("showMessage");
            if (typeof show === "function") {
                show(text, 6000, "error");
                return;
            }
        } catch (error) {
            void error;
        }
        console.error(`[toolbar-fade] ${text}`);
    }

    /**
     * 让设置面板保持打开。
     * 思源的「保存」按钮点完会自动关闭对话框（它的处理器是 confirmCallback(); destroy()），
     * 所以在校验失败时先置标记，等关闭回调里再重新打开一个。
     */
    async reopenSetting() {
        if (!this.setting) {
            return;
        }
        try {
            this.setting.open(this.displayName || this.name);
            this.settingsOpened = (this.settingsOpened || 0) + 1;
        } catch (error) {
            this.reportError("重新打开设置面板失败", error);
        }
    }

    async uninstall() {
        await this.removeData(STORAGE_NAME).catch((error) => {
            console.error("[toolbar-fade] remove data failed:", error);
        });
    }

    /*─ 设置面板 ─*/

    /**
     * 创建设置面板（只创建一次）。
     * 思源的「插件菜单 → 插件名 → 设置」入口在插件带有 setting 实例时才出现，
     * 所以必须真的 new 一个 Setting，openSetting() 才有东西可打开。
     */
    ensureSetting() {
        if (this.setting) {
            return this.setting;
        }
        const SettingClass = api("Setting");
        if (typeof SettingClass !== "function") {
            throw new Error(`siyuan 模块没有导出 Setting（实际类型 ${typeof SettingClass}）`);
        }
        this.setting = new SettingClass({
            confirmCallback: () => {
                // 校验失败时：提示错误、不保存，并让面板保持打开（见 reopenSetting 注释）
                if (!this.readAndValidateSettings()) {
                    this.reopenAfterClose = true;
                    return;
                }
                this.saveSettings().then(() => {
                    const show = api("showMessage");
                    if (typeof show === "function") {
                        show(this.i18n.saved || "已保存");
                    }
                }).catch((error) => {
                    this.reportError("保存设置失败", error);
                });
            },
            destroyCallback: () => {
                // 思源的保存按钮会强制关闭对话框，这里把校验失败时的面板补回来
                if (this.reopenAfterClose) {
                    this.reopenAfterClose = false;
                    this.reopenSetting();
                }
            }
        });
        this.fillSetting();
        return this.setting;
    }

    /** 兼容旧调用名 */
    buildSetting() {
        return this.ensureSetting();
    }

    /**
     * 思源会调用它打开设置对话框（基类的实现见 Plugin.openSetting）。
     * 这里补一层「按需创建」：万一启动时创建失败，点设置也能重试并弹出可见的错误提示。
     */
    openSetting() {
        try {
            this.ensureSetting();
        } catch (error) {
            this.reportError("打开设置面板失败", error);            return;
        }
        super.openSetting();
    }

    fillSetting() {
        const hint = document.createElement("div");
        hint.className = "b3-label__text";
        hint.style.padding = "8px 0";
        hint.textContent = this.i18n.restartHint || "";

        this.setting.addItem({
            title: this.i18n.enabled,
            description: this.i18n.enabledTip,
            createActionElement: () => {
                const input = document.createElement("input");
                input.type = "checkbox";
                input.className = "b3-switch fn__flex-center";
                input.checked = this.settings.enabled;
                input.addEventListener("change", () => {
                    this.settings.enabled = input.checked;
                });
                return input;
            }
        });

        this.addNumberItem("nearDistance", 0, 400, 10);
        this.addNumberItem("farDistance", 1, 1200, 10);

        this.setting.addItem({
            title: this.i18n.resetDefaults,
            description: "",
            createActionElement: () => {
                const button = document.createElement("button");
                button.className = "b3-button b3-button--outline";
                button.textContent = this.i18n.resetDefaults;
                button.addEventListener("click", () => {
                    // 直接就地刷新面板里的输入框即可，不必重建对话框：
                    // 重新 open() 会 new 出一个新面板（旧的不销毁就变成孤儿面板，
                    // 销毁了又会闪烁、丢失滚动位置与焦点）。
                    this.settings = Object.assign({}, DEFAULTS);
                    this.syncInputs();
                });
                return button;
            }
        });
        this.setting.addItem({
            title: "",
            description: "",
            actionElement: hint
        });
    }

    addNumberItem(key, min, max, step) {
        this.setting.addItem({
            title: this.i18n[key],
            description: this.i18n[key + "Tip"],
            createActionElement: () => {
                const input = document.createElement("input");
                input.type = "number";
                input.className = "b3-text-field fn__size200";
                input.min = String(min);
                input.max = String(max);
                input.step = String(step);
                input.dataset.key = key;
                input.value = String(this.settings[key]);
                // 自己登记输入框：思源的 Setting 不保存内容节点（类里没有 element 成员，
                // 内容被存在 open() 的局部变量里），所以不能靠查 DOM 来刷新它们。
                this.numberInputs.set(key, input);
                // 刻意不监听 change：
                //   · 边输入边归一化会在用户输入过程中改写数字（点「恢复默认」时更是会先
                //     写回旧值、再被重置覆盖，出现「先变成其它数字再跳回默认值」的闪烁）；
                //   · 约束（near < far）只要在保存时成立即可，saveSettings() 会做归一化。
                return input;
            }
        });
    }

    /**
     * 把面板里的数字输入框刷新成当前设置值。用于两处：
     *   ① 用户手改数值后归一化（例如把距离设反）可能顺带修正了另一个距离；
     *   ② 点「恢复默认」时就地更新文本框——不必重建对话框。
     *
     * 注意：这里用自己登记的输入框，不去查 setting.element —— 思源没有这个属性，
     * 查它会静默失效（表现为点了「恢复默认」界面上的数值不变，保存后重开才更新）。
     */
    syncInputs() {
        this.numberInputs.forEach((input, key) => {
            const value = this.settings[key];
            if (value !== undefined && value !== null) {
                input.value = String(value);
            }
        });
    }

    /*─ 样式注入（不依赖 addStyle，卸载时可靠移除）─*/

    injectStyle() {
        // 每次都刷新内容：插件重载（不重启思源）时，旧的 <style> 可能还留在页面里，
        // 若不刷新，修正后的样式不会生效。
        let element = document.getElementById(STYLE_ID);
        if (!element) {
            element = document.createElement("style");
            element.id = STYLE_ID;
            document.head.append(element);
        }
        element.textContent = STYLE_TEXT;
        this.styleElement = element;
    }

    removeStyle() {
        const element = document.getElementById(STYLE_ID);
        if (element) {
            element.remove();
        }
        this.styleElement = null;
    }
}

/**
 * 与 index.css 内容保持一致；内联注入是为了不依赖外部资源加载时序。
 *
 * 只做透明度过渡，**不能**给 .protyle-toolbar 加 pointer-events:none：
 * 那会让整条工具条的按钮全部失效（光标变成编辑框的 I 型、点击穿透到正文）。
 * 淡化过程中鼠标就在附近，工具条必须保持可点击。
 *
 * 0.18s 的过渡只用来让「逐渐变淡」看起来平滑，不是可配置项；
 * 关闭工具条本身不经过这里的过渡（由 JS 直接加 fn__none）。
 */
const STYLE_TEXT = `
.protyle-toolbar.sy-toolbar-fade {
    transition-property: opacity;
    transition-duration: 0.18s;
    transition-timing-function: ease-out;
}
`;

