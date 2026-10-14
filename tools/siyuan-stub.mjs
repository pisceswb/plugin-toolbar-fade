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

export class Setting {
    constructor(options = {}) {
        this.options = options;
        this.items = [];
        this.element = null;
        this.opened = false;
    }

    addItem(item) {
        this.items.push(item);
    }

    open(title) {
        this.opened = true;
        this.openedTitle = title;
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
