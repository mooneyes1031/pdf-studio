# PDF Studio

> 把阅读、标注与笔记留在本机。

![PDF Studio](build/icon.png)

一款面向 Windows 的**本地 PDF 阅读与标注工作台**：连续滚动阅读、七类标注、写回真实 PDF 注释对象、自由文档式笔记本、导出中心。不需要账号、不需要启动服务、不联网上传任何文档。

- 仓库：https://github.com/mooneyes1031/pdf-studio · 官网：https://mooneyes1031.github.io/pdf-studio/
- 许可：[PolyForm Noncommercial 1.0.0](LICENSE)（非商用免费，商用需[另行授权](COMMERCIAL.md)）
- 隐私：[PRIVACY.md](PRIVACY.md) · 协议：[EULA.md](EULA.md)
- 平台：Windows x64 · Node.js ≥ 18（仅开发时需要）

---

## 为什么不用「截图式标注」

大多数轻量阅读器把标注画在自己的界面上，换台电脑或发给别人就看不见了。PDF Studio 会把标注导出为**标准 PDF 注释对象**：

| 工具 | PDF 注释类型 |
| --- | --- |
| 高亮 / 下划线 / 删除线 | `/Highlight`（QuadPoints）/ `/Underline` / `/StrikeOut` |
| 框选区域 | `/Square` |
| 箭头 | `/Line` + `ClosedArrow` 线端，终点自动吸附原文 |
| 笔刷 | `/Ink`（InkList），粗细可调 |
| 便签 | `/Text` + `/Note` |

导出的新 PDF 在 Adobe Reader、Edge、Chrome、微信内置查看器里都能看到标注，也可以直接发给同事。**原始 PDF 一个字节都不改。**

## 功能

| 分类 | 内容 |
| --- | --- |
| 阅读 | 连续滚动、缩放 / 适应宽度、页码跳转、书签目录、页面缩略图、全文查找与高亮 |
| 标注 | 7 类工具、10 色调色板、箭头/笔刷粗细、橡皮擦除、定位与备注、按页清空 |
| 笔记 | 独立文档库：可嵌套文件夹、全文搜索、Markdown 编辑与预览、一键插入「原文 + 页码」出处 |
| 导出 | 带真实注释的新 PDF、标注汇总 Markdown、笔记与标注合订、完整备份 JSON、一键打包 |
| 数据安全 | 按文档指纹存标注、关窗强制落盘、`.bak` 滚动备份、损坏副本与告警、备份导入（合并 / 覆盖） |
| 集成 | 双击 `.pdf` 打开、拖放打开、命令行参数、单实例转发、HKCU 可逆文件关联 |

## 下载与安装

发布包在 [GitHub Releases](https://github.com/mooneyes1031/pdf-studio/releases/latest)。三种形态任选：

| 形态 | 文件 | 说明 |
| --- | --- | --- |
| **安装版（推荐）** | `PDF-Studio-Setup-1.0.0.exe` | NSIS 安装器：开始菜单 / 桌面快捷方式、完整卸载程序、随附许可与隐私文档 |
| 便携版 | `PDF-Studio-1.0.0-portable.exe` | 单文件免安装，双击即用，每次启动需自解压 |
| 绿色版 | `win-unpacked/` | 解压到任意目录，启动最快 |

> **不会抢默认程序**：安装器只注册「打开方式」入口，不修改 `.pdf` 默认关联，静默部署（`/S`）也不弹窗、不改用户设置。如需双击直接打开，运行随包的 `associate.cmd`（`unassociate.cmd` 可还原），或在系统「打开方式」中选 PDF Studio → 始终。

首次运行若被 Windows SmartScreen 拦截：点「更多信息 → 仍要运行」。原因与彻底解决办法见 [COMMERCIAL.md](COMMERCIAL.md#关于代码签名)。

卸载后数据仍留在本机；如需彻底清除，删除 `%APPDATA%\pdf-studio\`。

## 从源码运行

```bash
git clone https://github.com/mooneyes1031/pdf-studio.git
cd pdf-studio
npm install
npm start          # 或双击 run.cmd
```

Electron 二进制较大，国内网络可设置镜像后再安装：

```bash
ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ npm install
```

## 开发命令

| 命令 | 作用 |
| --- | --- |
| `npm run check` | 全部 JS 语法检查 |
| `npm test` | 语法检查 + 66 项回归测试（注释对象、导出打包、备份合并、损坏恢复、flush 契约） |
| `npm run icon` | 从几何定义重新生成多尺寸 ICO / PNG（纯 Node，无依赖） |
| `npm run pack` | 构建安装版 + 便携版 + 绿色版，并复制分发脚本 |
| `npm run pack:dir` | 只构建绿色版 |
| `npm run verify:packed` | 校验 dist 产物、asar 内容、图标、许可文本、CRLF |
| `npm run verify:packed:run` | 额外启动真实 Electron，通过 CDP 读取产品信息 |
| `publish.cmd --dry` | 预览发布会改哪些内容，不写文件、不推送 |

打包前建议先 `npm test`。国内网络打包需设置 `ELECTRON_BUILDER_BINARIES_MIRROR`。

## 项目结构

```
pdf-studio/
├─ main.js / preload.js       Electron 主进程、菜单、IPC、contextBridge
├─ lib/
│  ├─ pdf-annotate.js         比例坐标 → 真实 PDF 注释对象
│  ├─ store.js                原子写入、滚动备份、损坏保护
│  ├─ backup.js               UMD：全量备份组装 / 解析 / 合并
│  ├─ export-bundle.js        一键打包的纯文件逻辑
│  ├─ product.js              产品信息：环境变量 > product.config.json
│  └─ update.js               版本更新检查（只发一次匿名 GET）
├─ renderer/                  UI、pdf.js 引擎、标注与笔记前端
├─ build/                     图标生成、安装脚本、打包后处理
├─ test/run.cjs               回归测试
├─ product.config.json        发布信息（仓库地址、联系邮箱）
├─ docs/index.html            官网落地页（GitHub Pages 指向 /docs）
├─ RELEASE_NOTES.md           版本发布说明
├─ publish.cmd                一键发布到 GitHub
└─ .github/workflows/         CI 与自动构建 Release
```

## 发布到 GitHub

首次发布只需两步，全程不用手改任何占位符：

```bash
gh auth login          # 一次即可，浏览器授权
publish.cmd            # 填配置 → 提交 → 建公开仓库 → 推送 → 打 tag
```

`publish.cmd` 会自动：`gh api user` 取用户名与邮箱 → 写 `product.config.json` → 替换 README / 落地页 / 商业文档里的 `mooneyes1031/pdf-studio`、`mooneyes1031`、`atonce1031@proton.me` → 设置 git 身份 → 创建 `<owner>/pdf-studio` 公开仓库并推送 → 打 `v1.0.0` tag。tag 一推，`.github/workflows/release.yml` 就会在 Windows runner 上跑测试、打包，并把安装版 / 便携版 / 关联脚本发到 Release。

官网落地页：仓库 Settings → Pages → Deploy from a branch → `main` / `docs`。

> 手动发布也可以：`git remote add origin <url>` → `git push -u origin main` → `git tag v1.0.0` → `git push origin v1.0.0`。
> 构建产物不进 git 仓库（`.gitignore` 排除 `dist/`），107MB+ 的 exe 只走 GitHub Release。

### 备用通道：只走 API，不需要 `github.com` 可达

某些网络里 `github.com` 的 GET 可用但 **POST 被拦**（`gh auth login` 的设备码、`git push` 的 `git-receive-pack` 都是 POST），此时 `publish.cmd` 无法完成。改用：

```bash
GH_TOKEN=<classic PAT: repo + workflow> npm run publish:api:dry   # 预览
GH_TOKEN=<classic PAT: repo + workflow> npm run publish:api       # 发布
```

token 也可写进仓库根目录 `.github-token`（已 gitignore）。脚本走 `api.github.com` 的 Git Data API：建公开仓库 → 上传全部已跟踪文件为 blob → 建 tree / commit / `refs/heads/main` → 建 `refs/tags/v1.0.0` 触发 Release → 开 Pages。exe 由云端 Actions 构建，本机不需要上传 100MB+ 文件。

## 数据与隐私

默认完全离线。笔记与标注存在 `%APPDATA%\pdf-studio\studio-data.json`，带 `.bak` 滚动备份与损坏副本。没有遥测、没有崩溃上报、没有账号。唯一可能的出站请求是你手动点击「帮助 → 检查更新」。详见 [PRIVACY.md](PRIVACY.md)。

## 已知事项

- **未做代码签名**，SmartScreen 会拦首次运行。
- 加密或带数字签名的 PDF，导出注释副本可能使原签名失效，请务必保留原件。
- 扫描版 PDF 没有文字层，只能用框选 / 箭头 / 笔刷，无法选字高亮。
- 超大文档（上千页）首屏构建页面骨架会有可感知延迟。
- 文件指纹目前是抽样哈希，极小概率出现不同文档被判为同一份；重要资料建议保持原路径稳定。

## 许可

非商业用途免费，源码可见；**商业使用与商业分发需书面授权**。版权所有者可自行商业化。详见 [LICENSE](LICENSE)、[COMMERCIAL.md](COMMERCIAL.md)。

第三方组件许可见 [NOTICE](NOTICE)。
