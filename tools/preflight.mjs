/*!
 * 集市规范预检：node tools/preflight.mjs
 *
 * 按思源社区集市（siyuan-note/bazaar）的校验规则，对 package.zip 与仓库根做本地自检，
 * 尽量在提 PR 之前就发现问题。规则来源：bazaar 仓库 rules/*.go
 *   - files.go    包根必要文件（大小写敏感）
 *   - manifest.go 清单字段白名单、必填项、semver、readme 指向的文件是否在包里
 *   - images.go   icon / preview 是否存在、格式受支持、体积是否超限
 *   - zip.go      条目路径必须是正斜杠、不能有符号链接
 *   - names.go    Windows 保留设备名 / 首尾空格
 *
 * 用法：
 *   node tools/preflight.mjs [--author <GitHub 用户名>] [插件目录]
 *   node tools/preflight.mjs --author pisceswb ../../plugin-toolbar-fade
 */

import {readFileSync, existsSync, statSync, readdirSync} from "node:fs";
import {dirname, join, resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {inflateRawSync} from "node:zlib";
import {findPluginDir} from "./find-plugin-dir.mjs";

const here = dirname(fileURLToPath(import.meta.url));

/**
 * 解析参数：--author <名字> 是选项，位置参数是插件目录。
 * 注意不能简单地「过滤掉以 -- 开头的项」——那样 --author 的**值**会被误当成目录。
 */
const rawArgs = process.argv.slice(2);
let authorArg = null;
const positional = [];
for (let i = 0; i < rawArgs.length; i += 1) {
    const arg = rawArgs[i];
    if (arg === "--author") {
        authorArg = rawArgs[i + 1] ?? null;
        i += 1;
    } else if (arg.startsWith("--author=")) {
        authorArg = arg.slice("--author=".length);
    } else if (!arg.startsWith("--")) {
        positional.push(arg);
    }
}

const root = findPluginDir(positional[0], here);

/* ────────────────────────── 规则常量（对齐 bazaar/rules） ────────────────────────── */

const COMMON_KEYS = [
    "name", "author", "url", "version",
    "displayName", "description", "readme", "icon", "preview",
    "funding", "keywords",
    "minAppVersion"
];
const PLUGIN_KEYS = [
    ...COMMON_KEYS,
    "backends", "frontends", "kernels", "bootAppearances",
    "disabledInPublish", "settingsWindow", "publish"
];

const REQUIRED_FILES = ["README.md", "plugin.json", "index.js"];
const IMAGE_SPECS = [
    {field: "icon", legacy: "icon.png", maxBytes: 64 * 1024},
    {field: "preview", legacy: "preview.png", maxBytes: 512 * 1024}
];
const IMAGE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".webp", ".avif"];
const ARRAY_FIELDS_WITH_ALL = ["backends", "frontends", "kernels"];
const RESERVED_DEVICE_NAMES = new Set([
    "CON", "PRN", "AUX", "NUL",
    "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9",
    "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9"
]);

const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-.]+)?(?:\+[0-9A-Za-z-.]+)?$/;

/* ────────────────────────── 小工具 ────────────────────────── */

const issues = [];
const notes = [];
const fail = (message) => issues.push(message);
const note = (message) => notes.push(message);

const checkSemver = (label, value, required) => {
    if (value === undefined) {
        if (required) {
            fail(`${label} 缺失`);
        }
        return;
    }
    if (typeof value !== "string" || value.trim() !== value || value === "") {
        fail(`${label} 必须是非空、无首尾空格的字符串，当前为 ${JSON.stringify(value)}`);
        return;
    }
    if (/^v/i.test(value)) {
        fail(`${label} 不能带 v 前缀：${value}`);
        return;
    }
    if (!SEMVER.test(value)) {
        fail(`${label} 不是合法的语义化版本：${value}`);
    }
};

/* ────────────────────────── 解析 package.zip ────────────────────────── */

const zipPath = join(root, "package.zip");
if (!existsSync(zipPath)) {
    console.error("找不到 package.zip，请先运行：node tools/pack.mjs");
    process.exit(1);
}

/** 解析 zip 的本地文件头，拿到条目名、内容与压缩方法 */
const readZip = (buffer) => {
    const entries = new Map();
    let offset = 0;
    while (offset + 4 <= buffer.length && buffer.readUInt32LE(offset) === 0x04034b50) {
        const method = buffer.readUInt16LE(offset + 8);
        const compressedSize = buffer.readUInt32LE(offset + 18);
        const nameLength = buffer.readUInt16LE(offset + 26);
        const extraLength = buffer.readUInt16LE(offset + 28);
        const name = buffer.slice(offset + 30, offset + 30 + nameLength).toString("utf8");
        const dataStart = offset + 30 + nameLength + extraLength;
        const raw = buffer.slice(dataStart, dataStart + compressedSize);
        entries.set(name, method === 8 ? inflateRawSync(raw) : raw);
        offset = dataStart + compressedSize;
    }
    return entries;
};

const zip = readZip(readFileSync(zipPath));
const entryNames = Array.from(zip.keys());

/* ────────────────────────── 必要文件 ────────────────────────── */

for (const name of REQUIRED_FILES) {
    if (!entryNames.includes(name)) {
        fail(`package.zip 包根缺少必要文件 ${name}（文件名大小写必须完全一致）`);
    }
}

/* ────────────────────────── 路径规范 ────────────────────────── */

for (const name of entryNames) {
    if (name.includes("\\")) {
        fail(`条目 ${name} 使用了反斜杠，ZIP 规范要求正斜杠 /（不要用 Compress-Archive 打包）`);
    }
    for (const part of name.split("/")) {
        if (part !== part.trim()) {
            fail(`路径 ${name} 中「${part}」有首尾空格，Windows 不支持`);
        }
        const base = part.split(".")[0].toUpperCase();
        if (RESERVED_DEVICE_NAMES.has(base)) {
            fail(`路径 ${name} 中「${part}」是 Windows 保留设备名`);
        }
    }
}

/* ────────────────────────── 清单 ────────────────────────── */

let manifest = null;
if (zip.has("plugin.json")) {
    try {
        manifest = JSON.parse(zip.get("plugin.json").toString("utf8"));
    } catch (error) {
        fail(`plugin.json 不是合法 JSON：${error.message}`);
    }
}

if (manifest) {
    for (const key of Object.keys(manifest)) {
        if (!PLUGIN_KEYS.includes(key)) {
            fail(`plugin.json 含未知字段「${key}」，集市只允许：${PLUGIN_KEYS.join(", ")}`);
        }
    }

    for (const key of ["name", "author", "url", "version"]) {
        if (typeof manifest[key] !== "string" || manifest[key].trim() === "") {
            fail(`plugin.json 缺少必填字段 ${key}（必须是非空字符串）`);
        }
    }
    checkSemver("version", manifest.version, true);
    checkSemver("minAppVersion", manifest.minAppVersion, false);

    // name 的字符集限制（rules/manifest.go checkName）
    if (typeof manifest.name === "string") {
        if (!/^[\x20-\x7E]+$/.test(manifest.name)) {
            fail(`name「${manifest.name}」含非可打印 ASCII 字符（如中文），集市不接受`);
        }
        if (/[<>:"/\\|?*]/.test(manifest.name)) {
            fail(`name「${manifest.name}」含路径保留字符`);
        }
        if (manifest.name.length > 64) {
            fail(`name 超过 64 字节上限`);
        }
    }

    // url 必须正好是 https://github.com/<owner>/<repo>
    if (typeof manifest.url === "string") {
        const match = /^https:\/\/github\.com\/([^/]+)\/([^/]+)$/.exec(manifest.url);
        if (!match) {
            fail(`url 必须是 https://github.com/<owner>/<repo> 形式（结尾不能有 / 或 .git）：${manifest.url}`);
        } else if (typeof manifest.name === "string" && match[2] !== manifest.name) {
            note(`仓库名「${match[2]}」与 name「${manifest.name}」不一致（集市建议保持一致）`);
        }
    }

    // readme：必须有 default，且指向的文件要在包里
    if (!manifest.readme || typeof manifest.readme !== "object" || Array.isArray(manifest.readme)) {
        fail('plugin.json 的 readme 必须是对象，例如 { "default": "README.md" }');
    } else {
        if (typeof manifest.readme.default !== "string" || manifest.readme.default === "") {
            fail("plugin.json 的 readme 缺少必填键 default");
        }
        for (const [locale, file] of Object.entries(manifest.readme)) {
            if (typeof file !== "string") {
                fail(`readme.${locale} 必须是字符串文件名`);
                continue;
            }
            if (file.startsWith("/") || file.includes("\\") || file.includes("..")) {
                fail(`readme.${locale} 的路径不合法：${file}`);
                continue;
            }
            if (!entryNames.includes(file)) {
                fail(`readme.${locale} 指向的 ${file} 不在 package.zip 里`);
            }
        }
    }

    // 数组字段与 all 互斥
    for (const key of ARRAY_FIELDS_WITH_ALL) {
        const value = manifest[key];
        if (value === undefined) {
            continue;
        }
        if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
            fail(`${key} 必须是字符串数组`);
            continue;
        }
        if (value.includes("all") && value.length > 1) {
            fail(`${key} 含 "all" 时不能再混入其它取值`);
        }
    }

    for (const key of ["disabledInPublish", "settingsWindow"]) {
        if (manifest[key] !== undefined && typeof manifest[key] !== "boolean") {
            fail(`${key} 必须是布尔值 true/false，不能是字符串`);
        }
    }

    // 图片
    for (const spec of IMAGE_SPECS) {
        const declared = manifest[spec.field];
        let fileName = declared;
        if (fileName === undefined) {
            fileName = entryNames.includes(spec.legacy) ? spec.legacy : undefined;
        } else if (typeof fileName !== "string" || fileName.trim() === "") {
            fail(`${spec.field} 必须是无首尾空白的非空文件名字符串`);
            continue;
        } else if (fileName.includes("/") || fileName.includes("\\")) {
            fail(`${spec.field}「${fileName}」必须是包根文件名，不能带目录`);
            continue;
        }
        if (fileName === undefined) {
            note(`未提供 ${spec.field}，集市列表会缺少图片`);
            continue;
        }
        if (!entryNames.includes(fileName)) {
            fail(`${spec.field} 声明的 ${fileName} 不在 package.zip 包根`);
            continue;
        }
        const extension = fileName.slice(fileName.lastIndexOf(".")).toLowerCase();
        if (!IMAGE_EXTENSIONS.includes(extension)) {
            fail(`${spec.field}「${fileName}」格式不受支持（仅 PNG/JPEG/WebP/AVIF，不支持 SVG）`);
        }
        const size = zip.get(fileName).length;
        if (size > spec.maxBytes) {
            fail(`${spec.field}「${fileName}」为 ${Math.round(size / 1024)} KiB，超过 ${Math.round(spec.maxBytes / 1024)} KiB 上限`);
        }
    }
}

/* ────────────────────────── 入口脚本形态 ────────────────────────── */

if (zip.has("index.js")) {
    const indexJs = zip.get("index.js").toString("utf8");
    if (!/require\(\s*["']siyuan["']\s*\)/.test(indexJs)) {
        note('index.js 里没有 require("siyuan")，确认插件入口是否正确');
    }
    // 思源用 eval + CJS 加载插件，ESM 语法会直接报 SyntaxError
    if (/^\s*import\s/m.test(indexJs)) {
        fail("index.js 里仍有 ESM 的 import 语句，插件前端入口必须是 CommonJS/IIFE");
    }
    if (/^\s*export\s/m.test(indexJs)) {
        fail("index.js 里仍有 ESM 的 export 语句，插件前端入口必须是 CommonJS/IIFE");
    }
    if (!/module\.exports\s*=/.test(indexJs)) {
        fail("index.js 里没有 module.exports，思源会报 has no export");
    }

    // 同一层级的重复成员定义：后者会静默覆盖前者，只在运行时才暴露。
    // （真踩过：类里 define 了两次 readAndValidateSettings，行为一直是旧那份。）
    const memberPattern = /^(\s{2,8})(?:async\s+)?([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{/gm;
    const seen = new Map();
    let match;
    while ((match = memberPattern.exec(indexJs)) !== null) {
        const [full, indent, name] = match;
        if (["if", "for", "while", "switch", "catch", "function"].includes(name)) {
            continue;
        }
        const key = `${indent.length}:${name}`;
        if (seen.has(key)) {
            fail(`index.js 里同一层级重复定义了成员「${name}」（第 ${seen.get(key)} 行与第 ${indexJs.slice(0, match.index).split("\n").length} 行）。`
                + "后者会静默覆盖前者，请删除多余的那份。");
        } else {
            seen.set(key, indexJs.slice(0, match.index).split("\n").length);
        }
        void full;
    }
}

/* ────────────────────────── 仓库根（不在 zip 里，但集市会查） ────────────────────────── */

for (const spec of [
    {name: "LICENSE", alternatives: ["LICENSE", "LICENSE.txt", "LICENSE.md", "COPYING"], hint: "集市 PR Check 要求仓库根存在完整许可证"},
    {name: "README.md", alternatives: ["README.md"], hint: "默认说明文档"},
    {name: "plugin.json", alternatives: ["plugin.json"], hint: "插件清单"},
    {name: "index.js", alternatives: ["index.js"], hint: "前端入口"}
]) {
    if (!spec.alternatives.some((file) => existsSync(join(root, file)))) {
        fail(`仓库根缺少 ${spec.name}：${spec.hint}（要提交进 Git 仓库，不能只放进 package.zip）`);
    }
}
for (const file of ["LICENSE", "LICENSE.txt", "LICENSE.md", "COPYING"]) {
    const path = join(root, file);
    if (existsSync(path) && statSync(path).size < 100) {
        fail(`${file} 内容过短（${statSync(path).size} 字节），确认是完整的许可证文本`);
    }
}

/* ────────────────────────── i18n 文件名提醒 ────────────────────────── */

if (existsSync(join(root, "i18n"))) {
    const locales = readdirSync(join(root, "i18n"));
    const bad = locales.filter((name) => /_(CN|US|TW|HK)\.json$/i.test(name) || /^zh_/.test(name));
    for (const name of bad) {
        fail(`i18n/${name} 命名不规范：思源读取的是 zh-CN.json / zh-TW.json / en.json 这类「语言-地区」形式`);
    }
}

/* ────────────────────────── 输出 ────────────────────────── */

const expectedAuthor = authorArg;

console.log(`检查对象：package.zip（${entryNames.length} 个条目）`);
console.log(`条目：${entryNames.join(", ")}`);
if (manifest) {
    console.log(`插件名：${manifest.name}   版本：${manifest.version}   最低思源：${manifest.minAppVersion || "(未声明)"}`);
    console.log(`作者：${manifest.author}   仓库：${manifest.url}`);
    if (expectedAuthor && manifest.author !== expectedAuthor) {
        fail(`plugin.json 的 author「${manifest.author}」与预期的 GitHub 用户名「${expectedAuthor}」不一致`);
    }
}
console.log("");

if (notes.length > 0) {
    console.log("提示：");
    notes.forEach((item) => console.log(`  · ${item}`));
    console.log("");
}

if (issues.length > 0) {
    console.log(`发现 ${issues.length} 个会导致集市检查失败的问题：`);
    issues.forEach((item) => console.log(`  ✗ ${item}`));
    process.exit(1);
}

console.log("预检通过：未发现会导致集市 PR Check 失败的问题。");
