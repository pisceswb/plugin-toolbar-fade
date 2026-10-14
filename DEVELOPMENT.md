# 开发与发布说明

这个仓库（`plugin-toolbar-fade`）同时装着插件本体和开发工具：`plugin.json` / `index.js` 等
在根目录，源码在 `src/`，打包、测试、集市自检在 `tools/`。

```
plugin-toolbar-fade/
  plugin.json  index.js  index.css  icon.png  preview.png   ← 插件本体
  i18n/                 ← zh-CN.json / en.json
  src/index.js          ← 真正的源码（原生 ESM，便于维护）
  README.md  README.en.md  PUBLISH.md  DEVELOPMENT.md  LICENSE
  .github/workflows/check.yml   ← 推送时自动跑测试与自检
  tools/
    build.mjs           打包入口：src/index.js → index.js
    pack.mjs            生成 package.zip（Release 附件）
    preflight.mjs       按集市 rules/*.go 自检 package.zip 与仓库根
    test-fade.test.mjs  离线逻辑测试（20 项）
    load-built.mjs      按思源真实协议加载打包产物，供测试使用
    siyuan-stub.mjs     测试用的 siyuan 模块桩件
    find-plugin-dir.mjs 自动定位插件仓库目录
    make-icon.py        重新生成 icon.png
    make-preview.py     生成示意图预览图（仓库里有真实截图时不会用到）
    install.bat         把插件复制到本机思源工作区
```

> `package.zip` 是构建产物（已在 `.gitignore` 里），只作为 GitHub Release 的附件上传。
> `src/` 与 `tools/` 会随仓库提交，但**不会**打进 `package.zip`。

## 常用命令

在仓库根目录执行：

```bash
npm run build       # 打包入口：src/index.js → index.js
npm test            # 离线测试（20 项）
npm run pack        # 生成 package.zip
npm run preflight   # 集市规范自检
npm run release     # 上面四个一次跑完
```

等价的手工写法（工具会自动定位仓库目录，也可以显式传路径）：

```bash
node tools/build.mjs
node tools/test-fade.test.mjs
node tools/pack.mjs
node tools/preflight.mjs --author pisceswb
```

改完 `src/index.js` 或 `index.css` 后，**务必重新跑 `build` 和 `pack`**，
再发新的 Release —— 集市读的是 Release 里的 `package.zip`，不是仓库文件。

## 为什么必须打包（踩过的坑）

思源加载插件的方式是 **`eval` + CommonJS**（见 `stage/build/app/common.*.js` 里的 `Pe` 函数）：

```js
window.eval("(function anonymous(require, module, exports){" + 插件源码 + "\n})")(require, module, exports)
const ct = (module.exports || {}).default || module.exports
if (typeof ct != "function")            → 报 "has no export"
if (!(ct.prototype instanceof Plugin))  → 报 "does not extends Plugin"
```

所以：

- 插件源码里**不能有 `import` / `export`**。在 `eval` 里会直接抛
  `SyntaxError: Cannot use import statement outside a module`，
  表现为「插件完全没作用、也没有设置选项」，而且**不会有任何界面提示**；
- 必须用 `module.exports` 交出插件类，且这个类要继承 `siyuan.Plugin`；
- `siyuan` 由宿主以 `require("siyuan")` 提供，打包时标为 external 即可。

`tools/build.mjs` 只做这一件事：把 `import * as siyuan from "siyuan"` 换成
`const siyuan = require("siyuan")`，把 `export default class X` 换成 `class X`，
再在结尾写上 `module.exports = X`。插件没有其它依赖，不需要引入完整打包器。

**这也是必须记住的教训**：这个插件的第一版就是原生 ESM，结果装到思源里
「能启用、能显示在集市、就是完全没反应」——因为脚本在 `eval` 里第一行就语法错误了。

离线测试里的「加载产物」这一步走的就是思源的 `eval`/CJS 协议，
所以一旦源码混进 `import`、或忘记 `module.exports`，测试会立刻失败。

## 其他踩过的坑（都已在源码注释里说明）

- **不要给 `.protyle-toolbar` 加 `pointer-events: none`**：它是工具条按钮的父元素，
  加了之后整条工具条都点不动，光标会变成编辑框的 I 型、点击直接穿透到正文。
- **关闭工具条前要清掉内联 `display`**：思源核心在「选区滚出视野」时会写
  `toolbar.element.style.display = "none"`；插件关闭时也要照做（核心的 `hideElements` 同样如此），
  否则鼠标回来时工具条再也显示不出来。
- **武装状态要每帧重新评估**：只在工具条「弹出那一刻」判断的话，
  插件启动时就已存在的工具条永远不会生效。
- **i18n 文件名必须是 `zh-CN.json` / `en.json`**，写成 `zh_CN.json` 思源读不到，
  设置面板会显示成键名。
- **不要用 `Compress-Archive` 打包**：它写反斜杠条目名，集市 `rules/zip.go` 直接判失败。
  用 `tools/pack.mjs`（手工按 ZIP 规范写正斜杠）。

## GitHub 自动检查

`.github/workflows/check.yml` 已随仓库提交：每次 push 和 PR 都会自动跑
「打包入口 → 离线测试 → 生成 package.zip → 集市规范自检」，
并把 `package.zip` 作为构建产物上传，方便直接下载。

它不会自动发 Release —— 发布仍然按 `PUBLISH.md` 手动做。

## 发布前的自检清单

- [ ] 改过 `src/` 后跑过 `npm run build`（`index.js` 已更新）
- [ ] `npm test` 全部通过
- [ ] `npm run pack` 重新生成了 `package.zip`
- [ ] `npm run preflight` 通过（会检查清单字段、图片体积、zip 结构、仓库根 LICENSE 等）
- [ ] `plugin.json` 的 `version` 已提高，且 Release Tag 与它**完全一致**（不带 `v`）
- [ ] 新 Release 的附件里是**新**的 `package.zip`

详细发布流程见 [PUBLISH.md](./PUBLISH.md)。
