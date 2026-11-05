# 真实视觉 · Truesight

Truesight 对 Foundry 条目进行聚类，并利用已确认的成员关系汇集名称证据。当前聚类规则仅覆盖 dnd5e 法术；名称解析仍支持独立条目的法术、职业能力及其他物品名称。插件不修改文档、角色卡或自动化。

## 使用

依赖 Quick Insert 3.7.8 或以上，不依赖 Slow Insert、中文汉化包、CPR 或 GPS。将发行包中的 `truesight` 目录安装到 `Data/modules`，启用后重新载入客户端。

在「配置设置 → 真实视觉 · Truesight → 审核规则分组」打开管理窗口。默认查看已应用的归组；点击「重新计算」生成完整索引的候选，再在固定底栏点击「应用变化」。风险后缀归并默认关闭；预览、关闭窗口和普通索引刷新都不会发布成员关系。停用 Slow Insert 后，管理入口及中文适配仍可工作。

审核按**当前世界、当前用户、当前浏览器客户端**保存。它不是 GM 发布的世界级审核，不会同步到其他浏览器。所有消费者在同一客户端使用同一份审核修订。每次写入保留一层撤销；撤销恢复成员关系与身份排除，不改变 Slow Insert 的首选或浏览偏好。

新增条目先独立；已删除或不可访问的成员不返回；身份字段变化的成员失效。仅改显示译名不会单独使普通分组失效。算法沿用 Slow Insert 0.6.7 的判定：同规则代际、有效 identifier、环阶和学派一致形成候选；可选风险规则允许来源印证的完整英文书目后缀。2014 与 2024 分开。算法不读取名称解析结果来证明身份。

## API v1

运行时入口：

```js
const {apiVersion, catalog, names, sources} = game.modules.get('truesight').api;
if (apiVersion !== 1) throw Error('Unsupported Truesight API');
await catalog.whenReady();
const view = catalog.read();
const member = catalog.getMember('Compendium.package.pack.Item.id');
```

也可从公开的 `modules/truesight/api-v1.mjs` 导入同一 API；该路径须保留 Foundry 的部署前缀。`scripts/` 是内部实现，消费者不应导入。`sources` 提供书目和来源解析；`names` 的纯解析函数与加载契约见工作区架构说明。

### 目录与状态

- `getStatus()`：`apiVersion`、`ruleVersion`、`revision`、`generation`、`scope`、`reviewed`、`canUndo`、`includeRisk`。
- `status` 区分 `not-ready`、`ready`、`unreviewed`、`unavailable`、`failed`。未审核成功返回独立条目；读取失败抛出带 `code`/`source` 的错误，不伪装成空组。
- `whenReady({timeout})`：等 Quick Insert 索引完成，默认 60 秒；超时、被 GM-only 限制、接口不支持或审核损坏均明确拒绝。
- `read(uuids?)`：返回同一审核修订下的 `entries: Map`、`groups: Map`、`changed` 和可见排除数量。成员包含类型、代际、状态、理由与来源证据，不含搜索包装、UI 对象或文档方法。指定 UUID 时，组成员仍是该组当前可访问的全部成员；未索引的查询条目标为 `not-indexed`，不会自行推断其归属。
- `getMember(uuid)`：读取一个成员。成员状态包括 `member`、`independent`、`pending`、`invalidated`、`conflict`、`not-indexed`，细分原因在 `warning`/`reason`。

### 审核与扩展

- `preview({includeRisk})`：生成本客户端预览，返回预览 `id`、差异、成员和独立条目。
- `apply(id)`：确认预览；证据或审核已改变时拒绝应用。
- `undo()`、`exclude(uuid)`、`restoreExcluded()`：操作审核关系与身份排除。个人隐藏和首选应由消费者另存。
- `openReview()`：打开独立管理入口。
- `registerPublications(id, records)` / `unregisterPublications(id)`：共享书目扩展。返回的注销函数只撤去本次注册，不会删除后来的同名替换。
- 声明式书目使用 `flags.truesight.publications`。
- `sourceEnvironment()`：当前来源解析上下文，供搜索展示等消费者使用。

监听 `Hooks.on('truesightChanged', status => ...)` 重建派生结果。应用、撤销、身份排除、索引和来源更新触发通知。通知只带状态与修订，不广播成员 UUID、名称或来源。每次读取重新按权限检查并验证已应用快照，普通刷新不自动扩大已确认组。

## 名称能力与失败

`names.apiVersion` 为 1。名称层读取可见索引、独立名称证据和 `catalog` 的有效成员关系，按消费者自己的候选目录消歧。没有中文汉化包时不读取其资产，仍可使用索引中的原名和双语名；汉化包已启用但读取失败则报告失败，不发布不完整结果。

CPR/GPS 适配监听目录变更重建计划；重建前先撤下旧派生结果。CPR 只撤回由本适配注册且尚未被其他代码改写的键；GPS 重建期间保留原生查找。基座不依赖或调用提供方的自动化入口。

## v0.1.1

「应用归组」移到成员列表上方；移除旧 Slow Insert 快照迁入及旧书目命名空间、旧 dnd5e 来源字段支持。现有 Truesight 审核和撤销状态保持原样。

## v0.1.2：审核工作台

- 当前归组与待审核预览分开；打开窗口不重新计算。预览默认只看变化，可切换新增、成员调整、解散、需注意或独立条目。
- 左侧每页最多 50 项，右侧显示成员、来源、规则代际和判断依据；调整项展示应用前后。搜索覆盖名称、标识和来源文本。UUID 收入技术详情并可复制。
- 计算选项提供风险归组开关；更多操作提供撤销、查看排除成员与恢复排除。保存与放弃预览在固定底栏；索引或审核改变时作废预览。
- 审核仍按当前客户端保存，本次仅调整管理体验，不修改聚类规则或现有审核数据。

## v0.1.3：主题配色

配色跟随 Foundry 的明暗主题，与 Slow Insert 使用相同的 Quick Insert 调色变量及回退值。文字、表单、选中、警告和错误状态同步适配；无需启用 Slow Insert，也不覆盖其他模块的变量。

## v0.1.4：成员行与布局修复

成员使用紧凑名称／次要信息行和来源徽标；长名称保留完整提示，来源冲突与未知状态明确标记。归组列表覆盖原生按钮固定高度，避免两行文字溢出；操作菜单改为浮层，不挤占内容区。内容字体独立设定，按钮样式不再覆盖 Foundry 标题栏图标。

验证使用加载本机 Foundry V13 样式的独立浏览器夹具，覆盖明暗主题、880×680 与 640×540 窗口和展开菜单；没有操作真实世界。

## v0.1.5：展开箭头尺寸

展开控件改用固定尺寸的箭头槽，开合时只旋转箭头，避免原生标记改变按钮宽高。「当前归组／待审核变化」移至第一排左侧，与右侧计算和操作入口同排。

## v0.1.6：精简顶部

移除页签下方的常驻说明，保留计算、保存和错误状态；首次使用引导放入空列表。
