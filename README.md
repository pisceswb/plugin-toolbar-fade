# 工具条淡出 (Toolbar Fade)

[English](./README.en.md)

思源笔记插件：选中文字后弹出的浮动工具条，**鼠标离得越远颜色越淡，超过设定距离立即关闭**，接近 Word 里浮动工具栏的手感。

思源原生的行为是「工具条一直挂着，直到你点别处或重新选字」。这个插件把它改成跟着鼠标走：不打扰你用它，但鼠标移开后就自己让位。

## 效果

默认参数下（20px / 200px）：

```
选中文字            → 工具条弹出，完全清晰（鼠标就在旁边）
鼠标离开 20px 以内   → 依旧完全清晰
鼠标离开 20px 以上   → 随距离线性变淡
鼠标离开 200px 时    → 还看得见，但已明显较淡（不透明度约 0.4）
鼠标超过 200px       → 立即关闭，不延时、不留动画
鼠标中途移回来       → 立刻恢复清晰，可以正常点按钮
关闭之后再动鼠标     → 不会自己冒出来（想用就重新选一次字）
```

不透明度对照：

| 鼠标距离 | 20px | 65px | 110px | 155px | 200px | >200px |
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
index.js         ← 必须
icon.png
index.css
preview.png
i18n/            ← zh-CN.json / en.json
README.md
README.en.md
```

注意是**把这个目录本身放进 plugins 下**，不要多套一层（`plugins/plugin-toolbar-fade/plugin.json` 才是对的）。

从 Release 安装的话，也可以直接下载 `package.zip` 解压到 `data/plugins/plugin-toolbar-fade/`。

## 设置

`设置 → 集市 → 已下载 → 工具条淡出 → 设置`（不占用顶栏图标）。

| 选项 | 默认值 | 说明 |
| --- | --- | --- |
| 启用距离淡出 | 开 | 总开关；关掉后完全恢复思源原生行为 |
| 开始变淡的距离 | 20 px | 这个距离以内工具条完全清晰，超出后越远越淡 |
| 立即关闭的距离 | 200 px | 超过这个距离立即关闭工具条 |

约束：**「开始变淡的距离」必须小于「立即关闭的距离」**。填反时点保存会弹出错误提示、**不会保存、面板也保持打开**，请自己把数字改好再保存（插件不会替你改数字）。

距离是**鼠标到「工具条」与「当前选区」两者的最近距离**，取更近的那个。所以鼠标停在选中的文字上、或停在工具条上，都算距离 0，工具条保持完全清晰。

## 已知边界

- 只处理「选中文字后的浮动工具条」。子面板（如颜色 / 字体面板）不参与淡出，但它由工具条按钮打开时鼠标本来就在工具条上，不影响使用。
- 本插件**不修改**思源本体，卸载后完全恢复原状。
- 用键盘 `Shift+方向键` 选字、或鼠标停在远处选字时，工具条不会立刻消失。

## 开发

```
index.js         ← 打包产物（思源实际加载的就是它，勿直接改）
src/index.js     ← 真正的源码（原生 ESM，便于维护）
i18n/            ← zh-CN.json / en.json
tools/           ← 打包 / 测试 / 集市自检 / 图标与预览图生成
```

改完 `src/index.js` 或 `index.css` 后，必须重新打包入口并重新生成 `package.zip`：

```bash
npm run build       # src/index.js → index.js
npm test            # 离线测试（20 项）
npm run pack        # 生成 package.zip
npm run preflight   # 按集市 rules/*.go 自检
npm run release     # 上面四个一次跑完
```

细节见 [DEVELOPMENT.md](./DEVELOPMENT.md)。

### 为什么必须打包

思源加载插件的方式是 **`eval` + CommonJS**（不是 ES 模块）：

```js
window.eval("(function anonymous(require, module, exports){" + 插件源码 + "\n})")(require, module, exports)
const ct = (module.exports || {}).default || module.exports
if (typeof ct != "function")            → 报 "has no export"
if (!(ct.prototype instanceof Plugin))  → 报 "does not extends Plugin"
```

所以插件源码里**不能有 `import` / `export`**：在 `eval` 里会直接抛
`SyntaxError: Cannot use import statement outside a module`，表现为「插件能启用、能显示在集市，
但完全没作用、也没有设置选项」，而且**不会有任何界面提示**。

打包脚本只做三件事：把 `import * as siyuan from "siyuan"` 换成 `const siyuan = require("siyuan")`，
把 `export default class X` 换成 `class X`，再在结尾写上 `module.exports = X`。
插件没有其它依赖，不需要引入完整打包器。

> 这个插件的第一个版本就是原生 ESM，正是踩了这个坑才彻底没反应——离线测试里
> 「加载产物」这一步走的就是思源同款的 `eval`/CJS 协议，所以忘了打包会立刻被测出来。

另外几个已踩过的坑（源码里都有注释）：不要给 `.protyle-toolbar` 加 `pointer-events: none`
（会让工具条按钮全部失效、点击穿透到正文）；关闭前要清掉思源核心可能写过的内联 `display`；
i18n 文件名必须是 `zh-CN.json` / `en.json`。

## 许可证

[MIT](./LICENSE)