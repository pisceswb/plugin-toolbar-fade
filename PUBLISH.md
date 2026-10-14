# 发布到思源集市（发布指南）

本文说明如何把「工具条淡出」发布到思源笔记的社区集市（bazaar）。
规则依据 [siyuan-note/bazaar](https://github.com/siyuan-note/bazaar) 的
`README.zh-CN.md` 与 `rules/*.go`（自动检查用的实际判定代码）。

---

## 0. 一句话流程

1. 建一个 GitHub 仓库（**仓库名 = `plugin.json` 的 `name`**，默认分支 `main`）
2. 确认 `plugin.json` 里的 `author` / `url` 是对的，然后打包
3. 发一个 Release：**Tag = 版本号（不带 `v`）**，附件上传 `package.zip`
4. Fork [siyuan-note/bazaar](https://github.com/siyuan-note/bazaar)，在 `plugins.txt` 末尾加一行 `你的用户名/仓库名`
5. 向 `main` 提 PR，等自动检查 + 人工审核通过后合并
6. 合并后几分钟内集市索引更新，**重启思源**即可在集市里搜到

---

## 1. 仓库现状与需要改的地方

> 仓库里只放**运行与发布必需**的文件；打包、测试、集市自检等开发工具保存在
> 同级的 `plugin-toolbar-fade-dev/`（含 `DEVELOPMENT.md`），不必上传。

本插件已经按集市规范整理过：

| 项目 | 状态 |
| --- | --- |
| `plugin.json` 的 `name` | `plugin-toolbar-fade`（GitHub 仓库名必须与它完全一致） |
| `plugin.json` 的 `author` / `url` | `pisceswb` / `https://github.com/pisceswb/plugin-toolbar-fade` |
| `plugin.json` 的 `readme` | `{ "default": "README.md", "en": "README.en.md" }`（集市**必填**，且文件必须在包里） |
| `plugin.json` 的 `icon` / `preview` | `icon.png`（7.8 KiB，上限 64 KiB）、`preview.png`（128 KiB，上限 512 KiB） |
| `plugin.json` 的 `version` | `0.2.1`，合法 semver，**不带 `v` 前缀** |
| `LICENSE` | 仓库根已有 MIT 全文（集市 PR Check 要求） |
| `README.md` / `README.en.md` | 中英文说明，都在包里 |
| i18n 文件名 | `i18n/zh-CN.json`、`i18n/en.json`（思源读的就是这个名字，别写成 `zh_CN`） |
| `package.zip` | 由 `pack.mjs` 生成，条目名全是正斜杠 `/`（用 Compress-Archive 会写反斜杠，集市直接判失败） |

### 如果你要换 GitHub 用户名或仓库名

改这三处，然后重新打包：

1. `plugin.json` 的 `author` → 你的 GitHub 用户名
2. `plugin.json` 的 `url` → `https://github.com/<用户名>/<仓库名>`
3. 仓库名（GitHub 上新建时的名字）→ 必须等于 `plugin.json` 的 `name`

> `url` 必须**正好**是 `https://github.com/<owner>/<repo>`：不能有结尾斜杠，不能以 `.git` 结尾，
> 也不能指向别处。`name` 只能包含可打印 ASCII，不能有空格、中文、`<>:"/\|?*` 等字符。

---

## 2. 打包并本地自检

打包、测试与自检脚本**不在仓库里**（为了仓库保持简洁），本机保存在同级的 `plugin-toolbar-fade-dev/tools/`：

```bash
cd plugin-toolbar-fade-dev/tools
node build.mjs         # src/index.js → index.js（转成思源要的 CommonJS 包装）
node test-fade.test.mjs  # 离线逻辑测试
node pack.mjs          # 生成 package.zip
node preflight.mjs --author pisceswb   # 按集市 rules/*.go 自检
```

脚本会自动定位插件仓库目录，也可以显式传路径：`node pack.mjs ../../plugin-toolbar-fade`。
也可以一条命令跑完：`npm run release`。细节见 `plugin-toolbar-fade-dev/DEVELOPMENT.md`。

`preflight.mjs` 会在提 PR 之前就把下面这些坑拦下来：

- 包根必要文件（`README.md`、`plugin.json`、`index.js`，文件名大小写敏感）
- 清单字段白名单（多一个未知字段就会失败）、必填字段、`version` / `minAppVersion` 语义化版本
- `readme` 各语言指向的文件是否真的在包里
- `icon` / `preview` 是否存在、格式受支持（PNG/JPEG/WebP/AVIF，**不支持 SVG**）、体积是否超限
- `backends` / `frontends` / `kernels` 含 `all` 时不能混入其它值
- zip 条目路径是否用了反斜杠、是否命中 Windows 保留设备名、是否有首尾空格
- 仓库根是否有 LICENSE（且内容不是空壳）
- `index.js` 里是否残留 ESM 的 `import` / `export`（思源用 `eval` 加载，残留就会静默失效）

`package.zip` 必须包含（都在包根，不能再套一层目录）：

```
plugin.json
index.js
index.css
icon.png
preview.png
i18n/zh-CN.json
i18n/en.json
README.md
README.en.md
```

---

## 3. 建仓库并推送

```bash
cd plugin-toolbar-fade
git init
git add .
git commit -m "Initial commit: Toolbar Fade (plugin-toolbar-fade) v0.2.1"
git branch -M main
git remote add origin https://github.com/pisceswb/plugin-toolbar-fade.git
git push -u origin main
```

提交的是**源码与发布必需的文件**（`src/`、`README`、清单、`LICENSE` 等）。
`package.zip` 已在 `.gitignore` 里（属于构建产物，放 Release 附件即可，不必入库）。

提交前确认没把 `node_modules/`、临时文件带进去。

---

## 4. 发 Release（集市读的就是这个）

在 GitHub 仓库页面 → **Releases** → **Draft a new release**：

- **Choose a tag**：填 `0.2.1`，点「Create new tag on publish」
  - Tag **必须等于** `plugin.json` 里的 `version`，且**不要写 `v0.2.1`**
- **Release title**：`0.2.1`（随意，一般同 Tag）
- **Attach binaries**：把 `package.zip` 拖进去
- 点 **Publish release**

> 集市索引拉取的是该仓库 **Latest Release** 里的 `package.zip`。
> 没有 Release、或附件里没有 `package.zip`，PR 检查必然失败。
>
> **改过代码或清单后，一定要发新的 Release 并把 `version` 提高**：
> 只改仓库文件而沿用旧 Release 是没用的，检查读的是 Release 里的包。

---

## 5. 提交到集市

1. **Fork** [siyuan-note/bazaar](https://github.com/siyuan-note/bazaar)
   （已经 Fork 过就先同步最新代码）

2. 在 `plugins.txt` **末尾新增一行**，格式为 `owner/repo`：

   ```
   siyuan-note/plugin-sample
   someone/another-plugin
   pisceswb/plugin-toolbar-fade        ← 新增这一行
   ```

   注意：

   - 每行一个，**不要有多余逗号或空行**
   - 一个 PR 只加一个包，不要夹带其它改动（比如顺手删别的行）

3. **提交 PR** 到 `siyuan-note/bazaar` 的 `main` 分支

   - 分支名建议 `add-plugin-plugin-toolbar-fade`
   - 标题建议 `Add pisceswb/plugin-toolbar-fade`
   - 正文按仓库里的 `.github/PULL_REQUEST_TEMPLATE.md` 填写，末尾附上仓库地址

4. **等待检查与合并**

   - PR Check 会自动校验：Release 是否存在、`package.zip` 里文件是否齐全、清单字段是否合法等
   - 检查失败**不要重新开 PR**，直接在原 PR 里改；修好包仓库后定时任务约每 20 分钟复检并更新评论
   - 维护者也会人工审核

5. 合并后集市索引几分钟内更新，**重启一次思源**即可在集市看到

---

## 6. 以后更新版本

**不需要再提 PR**。只要：

1. 把 `plugin.json` 的 `version` 提高（例如 `0.2.1` → `0.2.2`）
2. `npm run release`（或依次跑 build / test / pack / preflight）
3. 发布一个**新的 Latest Release**，Tag 用新版本号，附件上传新的 `package.zip`

集市索引会每一到三小时自动更新。如果长时间没更新：

- 确认 `version` 确实提高了（**不提版本号是最常见的失败原因**）
- 看 [Stage 检查失败 Issue](https://github.com/siyuan-note/bazaar/issues?q=is%3Aissue%20is%3Aopen%20label%3Astage-fail) 里有没有你的仓库
- 看 [Stage 工作流日志](https://github.com/siyuan-note/bazaar/actions/workflows/stage.yml)

---

## 7. 检查清单

提 PR 之前逐条确认：

- [ ] `plugin.json` 的 `author` 是自己的 GitHub 用户名
- [ ] `plugin.json` 的 `url` 指向自己的仓库，且是 `https://github.com/<owner>/<repo>` 形式
- [ ] `plugin.json` 的 `name` 与 GitHub 仓库名**完全一致**
- [ ] `plugin.json` 的 `readme` 指向的文件都在 `package.zip` 里
- [ ] **仓库根有 `LICENSE`** 并且已提交推送（只放进 `package.zip` 不算）
- [ ] 默认分支是 `main`
- [ ] 已发布 Release，且 **Latest Release** 附件里有 `package.zip`
- [ ] Release Tag = `plugin.json` 的 `version`，**不带 `v` 前缀**
- [ ] 改动过代码后**提高了 version** 并发新 Release
- [ ] `preflight.mjs` 通过（`plugin-toolbar-fade-dev/tools/` 里运行）
- [ ] `plugins.txt` 只加了一行 `owner/repo`
- [ ] 仓库里没有 `node_modules`、`package.zip`、临时文件

---

## 8. 规则来源

- 集市提交说明：[bazaar/README.zh-CN.md](https://github.com/siyuan-note/bazaar/blob/main/README.zh-CN.md)
- 自动校验实现：[bazaar/rules](https://github.com/siyuan-note/bazaar/tree/main/rules)
  - `files.go`：包根必要文件
  - `manifest.go`：清单字段与取值、`readme` 校验
  - `images.go`：`icon` / `preview` 校验
  - `names.go`：路径命名规范
  - `zip.go`：压缩包结构（正斜杠、无符号链接）
- 插件开发规范：[plugin-sample/README.zh-CN.md](https://github.com/siyuan-note/plugin-sample/blob/main/README.zh-CN.md)
