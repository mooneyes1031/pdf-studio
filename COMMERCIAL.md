# 商业授权与上线清单

## 许可结构

PDF Studio 采用**源码可见 + 非商用**的单一许可：

- 源码与二进制向所有人公开，遵循 [PolyForm Noncommercial License 1.0.0](LICENSE)。
- 个人学习、研究、实验、业余项目，以及慈善 / 教育 / 公共研究 / 政府机构的非商业使用：**免费**。
- **任何商业目的的使用或分发：需要版权所有者单独书面授权。**
- 版权所有者本人（licensor）不受该许可限制，可自行商业化、另行授权或更改许可模式。

典型需要授权的场景：企业或经营性组织在日常业务中使用、把本软件或其修改版作为付费产品/服务的一部分提供、预装到商用设备、为客户提供基于本软件的付费部署或维护。

## 申请方式

发邮件至 **atonce1031@proton.me**（见下方「上线前必须替换」），说明：

1. 主体名称与所在地区；
2. 使用场景（内部使用 / 分发 / 集成 / OEM）；
3. 预计装机量与是否需要定制、技术支持、发票。

版权所有者会提供单独的双边商业许可协议。本仓库的 PolyForm 许可**不因付费而自动变更**，也不会被任何第三方自动授予。

## 定价（文案占位，不含在线支付）

| 版本 | 适用 | 价格 |
| --- | --- | --- |
| 社区版 | 个人、教育、非商业组织 | 免费 |
| 商业单机授权 | 企业内部分单用户使用 | 请联系洽谈 |
| 团队 / OEM 授权 | 批量部署、集成、二次分发 | 请联系洽谈 |

> 官网落地页 `docs/index.html` 中的定价区仅作展示，**当前没有接入支付或 License Key 发放系统**。正式售卖前需补齐：支付渠道、许可签发、发票与售后流程。

## 上线前必须替换

**`gh auth login` 之后运行 `publish.cmd` 会自动完成第 1–4 项**，不用手改：

| # | 位置 | 当前值 | 由谁改 |
| --- | --- | --- | --- |
| 1 | `product.config.json` `repository` / `contact` | 空 | `publish.cmd` 自动填 |
| 2 | `README.md` / `docs/index.html` 的仓库、官网、下载链接 | `mooneyes1031/pdf-studio` / `mooneyes1031` | `publish.cmd` 自动替换 |
| 3 | `COMMERCIAL.md` 与落地页的联系邮箱 | `atonce1031@proton.me` | `publish.cmd` 自动替换 |
| 4 | git 提交身份 | `atonce1031@proton.me` | `publish.cmd` 自动设为 gh 主邮箱 |
| 5 | `.github/workflows/release.yml` | 无需改 | 走 `github.repository` 自身上下文 |

**仍需人工决定**（不影响发布，影响正式售卖）：

| # | 事项 | 说明 |
| --- | --- | --- |
| 6 | 版权主体 | `PDF Studio Authors` 目前是发布者署名。若要改成真实公司 / 姓名，需全局替换 `lib/product.js`、`LICENSE`、`NOTICE`、`EULA.md`、`docs/index.html` 页脚，且各处保持一致 |
| 7 | 定价与支付 | 落地页定价区仅展示，当前没有支付渠道与 License Key 发放系统 |
| 8 | 代码签名证书 | 购买 OV / EV 证书后通过 GitHub Actions Secrets 注入，**不要提交证书或密码** |

## 关于代码签名

当前 exe **未签名**，Windows SmartScreen 首次运行会提示「未知发布者」。这是分发转化率的最大障碍，建议正式售卖前购买 OV 或 EV 代码签名证书。配置好后由 GitHub Actions 在构建时注入证书（用仓库 Secrets，不要放进源码）。
