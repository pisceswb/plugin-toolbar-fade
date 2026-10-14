/*!
 * 离线测试用的 "siyuan" 桩件（只实现被插件用到的那几个 API）。
 * 思源运行时用的是真的 siyuan 模块，这个文件只在离线测试时生效。
 */

export class Plugin {
    constructor(options = {}) {
        this.options = options;
        this.name = options.name || "plugin";
        this.i18n = options.i18n || {};
        this.displayName = options.displayName;
    }

    /** 真身会检查 this.setting 后调用 setting.open() */
    openSetting() {
        if (!this.setting) {
            return;
        }
        this.setting.open(this.displayName || this.name);
        this.settingOpened = true;
    }
}

/**
 * 模拟思源真实的 Setting：
 *   - open() 每次都「新建」一个对话框，并记录到 this.dialog（这正是重复弹面板的根源）
 *   - open() 会把对话框内容节点挂到 this.element 上，插件的 syncInputs() 要从这里查输入框
 *   - dialog 上有 destroy()，销毁时把次数记到插件实例上，便于断言
 */
export class Setting {
    constructor(options = {}) {
        this.options = options;
        this.items = [];
        this.element = null;
        this.opened = false;
        this.dialog = null;
        this.openCount = 0;
    }

    addItem(item) {
        this.items.push(item);
    }

    open(title) {
        this.opened = true;
        this.openedTitle = title;
        this.openCount += 1;
        // 真身这里 new Dialog 并把 .b3-dialog__content 存进 this.element；
        // 桩件用同样的 DOM 建一个容器，好让按数据键刷新输入框的逻辑可测。
        const content = document.createElement("div");
        content.className = "b3-dialog__content";
        this.element = content;

        const plugin = this.plugin;
        const handle = {
            title,
            live: true,
            destroy() {
                if (!this.live) {
                    return;
                }
                this.live = false;
                if (plugin) {
                    plugin.settingDestroyed = (plugin.settingDestroyed || 0) + 1;
                }
            }
        };
        this.dialog = handle;
        return handle;
    }
}

/** 记录所有界面提示，便于测试断言 */
export const messages = [];

export function showMessage(message, timeout, type) {
    messages.push({message, timeout, type});
}

export function getAllEditor() {
    return [];
}

/** 标记：本桩件是「Setting 可用」的版本 */
export const HAS_SETTING = true;
