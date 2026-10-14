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
 * 模拟思源真实的 Setting（结构按 3.8.7 的 common/main bundle 对齐）：
 *   - open() 每次都「新建」一个对话框，并记录到 this.dialog（这正是重复弹面板的根源）；
 *   - **没有 element 成员**：思源把内容节点存在 open() 的局部变量里，
 *     类上只留下 dialog。所以插件不能靠 setting.element 去查输入框
 *     （早期版本就是这么写的，导致「恢复默认」刷新输入框静默失效）；
 *   - dialog 上有 destroy()，销毁时把次数记到插件实例上，便于断言。
 */
export class Setting {
    constructor(options = {}) {
        this.options = options;
        this.items = [];
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
        const setting = this;
        const handle = {
            title,
            live: true,
            destroy() {
                if (!this.live) {
                    return;
                }
                this.live = false;
                if (setting.plugin) {
                    setting.plugin.settingDestroyed = (setting.plugin.settingDestroyed || 0) + 1;
                }
                // 真身：思源关闭对话框时会调用 Setting 的 destroyCallback
                if (typeof setting.options.destroyCallback === "function") {
                    setting.options.destroyCallback();
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
