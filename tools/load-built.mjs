/*!
 * 按思源的真实加载协议加载打包产物 index.js。
 *
 * 思源的做法（见 `stage/build/app/common.*.js` 里的 Pe 函数，文件名带构建哈希）：
 *
 *   const fn = window.eval("(function anonymous(require, module, exports){" + 源码 + "\n})")
 *   fn(require, {exports:{}}, {})            // require("siyuan") 由宿主提供
 *   const ct = (module.exports || {}).default || module.exports
 *   if (typeof ct != "function")             → "has no export"
 *   if (!(ct.prototype instanceof Plugin))   → "does not extends Plugin"
 *
 * 本模块用同样的方式加载，所以离线测试验证的就是思源真正执行的路径：
 * 一旦源码里混进 import/export，或者忘了 module.exports，测试会立刻失败。
 */

import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";

/**
 * @param {string|URL} file 打包产物路径
 * @param {object} siyuanApi 传给 require("siyuan") 的对象
 * @param {Function} PluginBase 用于校验「必须继承 Plugin」
 * @returns {Function} 插件类
 */
export function loadPluginModule(file, siyuanApi, PluginBase) {
    const path = file instanceof URL ? fileURLToPath(file) : file;
    const source = readFileSync(path, "utf8");

    // 思源 eval 时提供的 (require, module, exports) 就是这三个参数。
    // 正常产物是顶层 CJS（直接执行），若被包在函数里也按同样参数调用。
    const open = "(function anonymous(require, module, exports){";
    const start = source.indexOf(open);
    const body = start < 0 ? source : source.slice(start + open.length, source.lastIndexOf("\n})"));

    const module = {exports: {}};
    const exports = {};
    const requireFn = (name) => {
        if (name === "siyuan") {
            return siyuanApi;
        }
        throw new Error(`打包产物引用了未提供的外部模块: ${name}（打包器应把它标为 external）`);
    };

    // eslint-disable-next-line no-new-func
    const factory = new Function("require", "module", "exports", body);
    factory(requireFn, module, exports);

    const exported = (module.exports || exports).default || module.exports || exports;
    if (typeof exported !== "function") {
        throw new Error("打包产物没有导出插件类（思源会报 has no export）");
    }
    if (PluginBase && !(exported.prototype instanceof PluginBase)) {
        throw new Error("打包产物导出的类没有继承 Plugin（思源会报 does not extends Plugin）");
    }
    return exported;
}
