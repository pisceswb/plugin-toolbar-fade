/*!
 * 定位插件仓库目录。
 *
 * 正常情况下工具就在仓库里（`<repo>/tools/`），取脚本上一级即可。
 * 兼容一种历史布局：工具与仓库分开放（`<repo>-dev/tools/`），
 * 这时再多探一层同级的 `<name>/` 目录。
 *
 * 也可以用参数显式指定：node tools/pack.mjs <插件目录>
 */

import {existsSync} from "node:fs";
import {resolve} from "node:path";

export function findPluginDir(arg, here) {
    if (arg) {
        return resolve(arg);
    }
    const parent = resolve(here, "..");
    if (existsSync(resolve(parent, "plugin.json"))) {
        return parent;
    }
    const sibling = resolve(parent, "..", "plugin-toolbar-fade");
    if (existsSync(resolve(sibling, "plugin.json"))) {
        return sibling;
    }
    return parent;
}
