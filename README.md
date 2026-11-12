# PDF Studio

> 把阅读、标注与笔记留在本机。

![PDF Studio](build/icon.png)

一款 Windows 上的**本地 PDF 阅读与标注工作台**。不需要账号、不需要启动服务、不联网上传任何文档。

- **下载**：[最新版本](https://github.com/mooneyes1031/pdf-studio/releases/latest) · **官网**：https://mooneyes1031.github.io/pdf-studio/
- **许可**：[PolyForm Noncommercial 1.0.0](LICENSE)（非商用免费，商用需[另行授权](COMMERCIAL.md)）
- **平台**：Windows 10 及以上，x64
- 隐私：[PRIVACY.md](PRIVACY.md) · 协议：[EULA.md](EULA.md)

---

## 能做什么

| | |
| --- | --- |
| **阅读** | 连续滚动、缩放与适应宽度、页码跳转、书签目录、页面缩略图、全文查找 |
| **标注** | 高亮、下划线、删除线、框选区域、箭头、笔刷、便签；10 种颜色、粗细可调、橡皮擦除 |
| **笔记** | 独立文档库，可嵌套文件夹、全文搜索、Markdown 编辑与预览，一键插入「原文 + 页码」出处 |
| **导出** | 带标注的新 PDF、标注汇总、笔记与标注合订、完整备份、一键打包 |

标注会写成**标准 PDF 注释对象**，用 Adobe Reader、Edge、Chrome 或微信内置查看器打开都能看到，也能直接发给同事；**原始 PDF 一个字节都不改**。

数据安全：按文档指纹保存标注，关窗强制落盘，自动滚动备份，损坏时留副本并告警，支持备份导入（合并 / 覆盖）。

## 下载与安装

在 [Releases](https://github.com/mooneyes1031/pdf-studio/releases/latest) 任选一种：

| 形态 | 说明 |
| --- | --- |
| **安装版（推荐）** | NSIS 安装向导，开始菜单 / 桌面快捷方式、完整卸载程序 |
| 便携版 | 单个 exe，免安装，适合 U 盘；每次启动需自解压 |
| 绿色版 | 解压到任意目录，启动最快 |

> **不会抢默认程序**：安装器只注册「打开方式」，不改 `.pdf` 默认关联，静默安装也不弹窗。想双击直接打开，运行随包的 `associate.cmd`（`unassociate.cmd` 可还原）。

首次运行若被 Windows SmartScreen 拦截，点「更多信息 → 仍要运行」。卸载不会删除数据；如需彻底清除，删除 `%APPDATA%\pdf-studio\`。

## 数据与隐私

完全离线。笔记与标注存在 `%APPDATA%\pdf-studio\studio-data.json`，没有遥测、没有崩溃上报、没有账号。唯一可能的出站请求是你手动点「帮助 → 检查更新」。详见 [PRIVACY.md](PRIVACY.md)。

## 已知事项

- 未做代码签名，SmartScreen 会拦首次运行。
- 扫描版 PDF 没有文字层，只能用框选 / 箭头 / 笔刷 / 便签，无法选字高亮。
- 加密或带数字签名的 PDF，导出注释副本可能使原签名失效，请保留原件。

## 许可与联系

非商业用途免费，源码可见；**商业使用与分发需书面授权**。详见 [LICENSE](LICENSE)、[COMMERCIAL.md](COMMERCIAL.md)，第三方组件见 [NOTICE](NOTICE)。

商业授权洽谈：atonce1031@proton.me
