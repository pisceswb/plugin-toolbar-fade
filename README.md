# 工具条淡出 (Toolbar Fade)

[English](./README.en.md)

思源笔记插件：选中文字后弹出的浮动工具条，**鼠标离得越远颜色越淡，超过设定距离立即关闭**，
接近 Word 里浮动工具栏的手感。

思源原生的行为是「工具条一直挂着，直到你点别处或重新选字」。这个插件把它改成跟着鼠标走：
不打扰你用它，但鼠标移开后就自己让位。

## 效果

默认参数下（80px / 200px）：

```
选中文字            → 工具条弹出，完全清晰（鼠标就在旁边）
鼠标离开 80px 以内   → 依旧完全清晰
鼠标离开 80px 以上   → 随距离线性变淡
鼠标离开 200px 时    → 还看得见，但已明显较淡（不透明度约 0.4）
鼠标超过 200px       → 立即关闭，不延时、不留动画
鼠标中途移回来       → 立刻恢复清晰，可以正常点按钮
关闭之后再动鼠标     → 不会自己冒出来（想用就重新选一次字）
```

不透明度对照：

| 鼠标距离 | 80px | 110px | 140px | 170px | 200px | >200px |
| --- | --- | --- | --- | --- | --- | --- |
| 工具条不透明度 | 1 | 0.85 | 0.70 | 0.55 | 0.40 | 直接关闭 |

![预览](preview.png)

## 安装

**从集市安装（推荐）**

`设置 → 集市 → 下载` 搜索「工具条淡出」，安装后启用。

**手动安装**

把下面这些文件复制到思源工作区的 `data/plugins/plugin-toolbar-fade/`：

```
plugin.json      ← 必须
index.js         ← 必须（打包产物，勿手改）
icon.png
index.css
preview.png
i18n/            ← zh-CN.json / en.json
README.md
README.en.md
```

注意是**把这个目录本身放进 plugins 下**，不要多套一层
（`plugins/plugin-toolbar-fade/plugin.json` 才是对的）。`src/` 是源码，不必复制。

从 Release 安装的话，也可以直接下载 `package.zip` 解压到 `data/plugins/plugin-toolbar-fade/`。

## 设置

`设置 → 集市 → 已下载 → 工具条淡出 → 设置`（不占用顶栏图标）。

| 选项 | 默认值 | 说明 |
| --- | --- | --- |
| 启用距离淡出 | 开 | 总开关；关掉后完全恢复思源原生行为 |
| 开始变淡的距离 | 80 px | 这个距离以内工具条完全清晰，超出后越远越淡 |
| 立即关闭的距离 | 200 px | 超过这个距离立即关闭工具条 |

只有这两项距离可调。「停留时间」和「淡出动画时长」刻意不做成设置项：变淡是随距离连续变化的，
关闭也是越过距离就立即执行，都不需要额外的时间参数。

距离是**鼠标到「工具条」与「当前选区」两者的最近距离**，取更近的那个。
所以鼠标停在选中的文字上、或停在工具条上，都算距离 0，工具条保持完全清晰。

## 实现原理

思源的工具条是普通 DOM，不是原生窗口：

- 每个编辑器面板各有一个 `div.protyle-toolbar`（`position: fixed`、`z-index: 7`），
  挂在 `.protyle` 元素里，创建后**不会**随选中内容重建；
- 显示与隐藏只靠切换类名 `fn__none`，而它的定义是 `display: none !important`；
- 思源**没有任何**基于鼠标移动或计时器的隐藏逻辑，鼠标驱动的隐藏只发生在
  「在工具条之外按下鼠标」（`mousedown`）时。

因此纯 CSS 做不到这个效果（CSS 不知道鼠标在哪），插件的做法是：

1. 用 `MutationObserver` 盯住工具条的 `class` / `style`，判断它「刚弹出来」；
2. 在 `document` 上以捕获阶段监听 `mousemove` / `scroll` / `mouseup`（`passive`，不阻塞滚动），
   用 `requestAnimationFrame` 节流，算出鼠标到「工具条 + 选区」的距离；
3. 距离 ≤ 200px 时，把距离线性映射成 0.4~1 的不透明度，写进工具条的**内联** `opacity`
   （CSS 只负责 0.18s 的过渡，让变化看起来平滑）；
4. 距离 > 200px 时**立即**补上 `fn__none` 关闭，不等动画、不留计时器
   —— 这正是思源核心自己用来隐藏工具条的同一个类名，没有用到任何私有 API。

几个容易踩的坑（都在 `src/index.js` 里有注释）：

- **不要禁用工具条的指针事件**：`.protyle-toolbar` 是那些按钮的父元素，一旦给它加
  `pointer-events: none`，整条工具条就废了——光标会变成编辑框的 I 型、点击直接穿透到正文。
- **关闭前先清内联 `display`**：思源核心在「选区滚出视野」时会写
  `toolbar.element.style.display = "none"`；插件关闭时也照做一遍（核心的 `hideElements` 同样如此），
  否则鼠标回来时工具条会再也显示不出来。
- **鼠标从来没靠近过就不接管**：用键盘 `Shift+方向键` 选字、或鼠标停在远处选字时，
  工具条不会立刻消失。
- **武装状态每帧重新评估**：不能只在工具条出现那一刻判断，
  否则插件启动时就已存在的工具条永远不会生效。
- **关闭后不再跟踪**：关掉之后鼠标怎么动都不会让它「回魂」，想用就重新选一次字。
- **循环会停下**：工具条关闭、隐藏或开关关闭后 `requestAnimationFrame` 循环立即停止，不空转占 CPU。

## 已知边界

- 依赖思源的类名约定（`.protyle-toolbar`、`fn__none`）。思源大版本改类名时需要跟着改，
  这是所有同类插件的共性风险；本插件**不修改**思源本体，卸载后完全恢复原状。
- 只处理「选中文字后的浮动工具条」。子面板（`.protyle-util`，如颜色 / 字体面板）不参与淡出，
  但它由工具条按钮打开时鼠标本来就在工具条上，不影响使用。
- 思源不同版本会重建工具条按钮（重写 `innerHTML`），插件不往里插入任何节点，所以不受影响。

## 开发与测试

仓库里只有运行与发布必需的文件：

```
index.js              ← 打包产物（思源实际加载的文件，勿直接改）
src/index.js          ← 真正的源码（原生 ESM，便于维护）
i18n/                 ← zh-CN.json / en.json
plugin.json           ← 清单
icon.png preview.png  ← 集市用的图标与预览图
README.md README.en.md PUBLISH.md LICENSE
```

打包、测试、集市自检、图标生成等开发工具**不放在仓库里**（本机保存在同级的
`plugin-toolbar-fade-dev/`）。改完 `src/index.js` 后必须重新打包入口并生成
`package.zip`，两者都用那里的脚本：

```bash
cd plugin-toolbar-fade-dev/tools
node build.mjs            # src/index.js → index.js
node test-fade.test.mjs   # 离线测试（20 项）
node pack.mjs             # 生成 package.zip
node preflight.mjs --author pisceswb   # 按集市 rules/*.go 自检
# 或 npm run release 一次跑完；详见该目录的 DEVELOPMENT.md
```

脚本会自动定位仓库目录，也可以显式传路径：`node build.mjs ../../plugin-toolbar-fade`。
### 为什么必须打包（踩过的坑）

思源加载插件的方式是 **`eval` + CommonJS**（见 `stage/build/app/common.*.js` 里的 `Pe` 函数）：

```js
window.eval("(function anonymous(require, module, exports){" + 插件源码 + "\n})")(require, module, exports)
const ct = (module.exports || {}).default || module.exports
if (typeof ct != "function")            → 报 "has no export"
if (!(ct.prototype instanceof Plugin))  → 报 "does not extends Plugin"
```

所以：

- 插件源码里**不能有 `import` / `export`** —— 在 `eval` 里会直接
  `SyntaxError: Cannot use import statement outside a module`，
  表现是「插件完全没作用、也没有设置选项」，而且不会有任何界面提示；
- 必须用 `module.exports` 交出插件类，且这个类要继承 `siyuan.Plugin`；
- `siyuan` 由宿主以 `require("siyuan")` 提供，打包时标为 external 即可。

打包脚本 `build.mjs` 只做这一件事：把 `import * as siyuan from "siyuan"` 换成
`const siyuan = require("siyuan")`，把 `export default class X` 换成 `class X`，
再在结尾写上 `module.exports = X`。插件没有其它依赖，不需要引入完整打包器。

离线测试里的「加载产物」这一步走的就是思源的 `eval`/CJS 协议，
所以一旦源码混进 `import`、或忘记 `module.exports`，测试会立刻失败。

## 发布

见 [PUBLISH.md](./PUBLISH.md)（GitHub 建仓 + 发 Release + 提交到思源集市）。

## 许可证

[MIT](./LICENSE)
