/*!
 * 极简打包器：把 src/index.js（原生 ESM，便于维护）
 * 转成思源能加载的 index.js（CJS 包装，模块导出插件类）。
 *
 * 为什么必须打包：思源这样加载插件（见 common.a58ae25b007fb0c9dc6b.js 的 Pe 函数）：
 *
 *   window.eval("(function anonymous(require, module, exports){" + 源码 + "\n})")(require, module, exports)
 *   const ct = (module.exports || {}).default || module.exports
 *   if (typeof ct != "function")        → 报 "has no export"
 *   if (!(ct.prototype instanceof Plugin)) → 报 "does not extends Plugin"
 *
 * 所以插件源码里不能出现 import/export（eval 里会 SyntaxError），
 * 必须用 CommonJS 的 module.exports 交出插件类。
 *
 * 本打包器不做通用依赖解析：插件只有 "siyuan" 一个外部依赖，
 * 直接替换成 require("siyuan") 即可，其余代码原样放行。
 *
 * 用法：
 *   node tools/build.mjs                            # 插件目录 = 本脚本上一级（工具与插件同目录时）
 *   node tools/build.mjs ../../plugin-toolbar-fade  # 指定仓库目录（开发工具放在仓库外时）
 */

import {readFileSync, writeFileSync} from "node:fs";
import {dirname, resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {findPluginDir} from "./find-plugin-dir.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = findPluginDir(process.argv[2], here);
const srcPath = resolve(root, "src/index.js");
const outPath = resolve(root, "index.js");

let code = readFileSync(srcPath, "utf8");

/* 1) import * as siyuan from "siyuan";  →  const siyuan = require("siyuan");  */
const importPattern = /import\s+\*\s+as\s+([A-Za-z_$][\w$]*)\s+from\s+["']siyuan["'];?/g;
let converted = 0;
code = code.replace(importPattern, (match, name) => {
    converted += 1;
    return `const ${name} = require("siyuan");`;
});

/* 2) 其他形式的 siyuan 具名导入：直接拒绝，避免悄悄产出坏包 */
const otherImport = /^\s*import\s.*$/m;
if (otherImport.test(code)) {
    const line = code.match(otherImport)[0].trim();
    throw new Error(`还有未处理的 import 语句，请改成命名空间导入或扩展打包器：${line}`);
}

/* 3) import ... from "./xxx" 之类的本地依赖暂不支持（本插件用不到） */
if (/^\s*(import|export)\s.*$/m.test(code)) {
    if (/^\s*import\s/m.test(code)) {
        throw new Error("仍存在 import 语句，无法打包");
    }
}

/* 4) export default class X extends ... → class X extends ... + 末尾赋值导出 */
const defaultExport = /^\s*export\s+default\s+class\s+([A-Za-z_$][\w$]*)/m.exec(code);
if (!defaultExport) {
    throw new Error("没找到 `export default class`，打包器需要同步更新");
}
const className = defaultExport[1];
code = code.replace(/^\s*export\s+default\s+class\s+/m, "class ");

/* 5) 其余 export 关键字（本插件没有）一律报错，避免静默丢代码 */
if (/^\s*export\s/m.test(code)) {
    throw new Error("除 default class 外还有 export 语句，打包器需要同步更新");
}

if (converted === 0) {
    throw new Error('没有找到 `import * as ... from "siyuan"`，请确认源码入口写法');
}

/* 6) 生成思源能 eval 的 CJS 包装。
 *    思源自己提供 (require, module, exports)，所以这里直接写普通 CJS 代码：
 *      源码 −→ module.exports = 插件类
 *    不再套一层自己的 IIFE，避免出现两套 require 导致行为不一致。 */
const banner = `/*!
 * 工具条淡出 (Toolbar Fade) —— 思源笔记插件
 *
 * 这是由 src/index.js 打包生成的产物，请勿直接修改；
 * 改动请改 src/index.js，然后重新运行打包脚本（build.mjs）。
 */`;

const output = [
    banner,
    '"use strict";',
    "",
    code,
    "",
    `module.exports = ${className};`,
    `module.exports.default = ${className};`,
    ""
].join("\n");

writeFileSync(outPath, output, "utf8");
console.log(`已生成 ${outPath}`);
console.log(`  源码 ${srcPath}`);
console.log(`  大小 ${Buffer.byteLength(output, "utf8")} 字节（源码 ${Buffer.byteLength(readFileSync(srcPath, "utf8"), "utf8")} 字节）`);
console.log(`  CommonJS 包装: module.exports / module.exports.default 都指向 ${className}`);
