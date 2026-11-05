# Truesight 架构

Truesight 独立于搜索界面和自动化适配插件。来源解析、条目聚类和名称解析在基座内部单向分层；各消费者通过公共 API 读取结果，不复制内部算法。

## 基座接口与快照

基座在 Foundry `init` 发布 `apiVersion: 1`，分为 `catalog`、`names`、`sources` 三个命名空间。目录与审核 API 见 [Truesight 说明](../module/README.md)。以下函数位于 `api.names`，其 `apiVersion` 也为 1。该版本是接口版本，不是插件发行版本。适配层只接受兼容的接口版本，不支持时保留原查找。

- `loadCorpus({fields})`：使用当前 Foundry 客户端读取快照；`readCorpus(...)` 是可注入数据源的同一加载过程，用于测试。每次快照并发读取至多八个合集，不在适配器之间复用可变状态。
- `collectNamePairs(...)`：归一译表名称对，保留来源及可确认的类型、规则代际。ID 键使用本次快照恢复原名；缺少上下文的证据保持未限定，不凭显示名猜代际。
- `itemGroups(...)`：仅消费聚类层返回的有效审核成员关系，记录普通名称证据；适配层可传入额外证据提取函数。目录不可用或形状不符时失败，不创建替代分组。
- `planAliases({pairs, lookupNames, existingAliases, groups, scope})`：纯计算，返回 `{aliases: Map, report}`；不修改参数、名称表或文档。

作用域由适配层指定。`scope: null` 要求所有同名键全局一致；指定 `{rules, type, types}` 时，先排除已知不属于该作用域的证据和成员。未限定证据仍参与歧义检查。共享字段 `lookupNames` 表示额外的已确认查找名，不替代系统的 `system.identifier` 或提供方自己的标识。

计划先收集独立证据，再检查共用显示名的组。一个组的推断不会成为另一个组的新证据。已命中的完整双语名、明确原名和既有映射都保留来源；未命中的双语弱推测不能制造冲突，也不能单独发布别名。

## 消费者边界

Slow Insert 使用公开的 `api-v1.mjs`；中文适配插件使用 `game.modules.get("truesight").api.names`。基座只依赖 Quick Insert，不依赖这两个开发项目，也不包含 CPR、GPS 或 MISC 的查找入口。
