# 真实视觉 · Truesight

Truesight 为搜索界面和中文自动化名称适配提供共享的规则身份、来源解析、已审核成员关系与名称证据。它是与 Slow Insert、中文适配工作区平级的独立项目；运行时只依赖 Quick Insert。

## 项目结构

```text
projects/
  truesight/
    module/          # 可安装源码；Foundry 模块 ID 为 truesight
    tests/           # 聚类、名称、审核界面与发行测试
    tools/           # 检查与打包
    docs/            # 公共接口与架构
  slow-insert/       # 搜索界面消费者
  fvtt-zh-aliases/   # CPR、GPS、MISC 名称适配消费者
```

[设计](DESIGN.md) 描述目标体验，[架构](docs/architecture.md) 定义接口与分层，[模块说明](module/README.md) 介绍使用方法，[协作约定](AGENTS.md) 规定验证及部署授权。

## 开发与验证

使用 Node.js 22 或以上版本，无需安装 npm 依赖。打包与发行测试使用系统 `zip`、`unzip`。

```sh
npm test
npm run check
npm run package
```

基座测试和打包不依赖同级消费者项目。公共 API 变更后，在 Slow Insert 和中文适配项目分别执行测试与检查。消费者测试使用同级基座源码，Foundry 运行时仍使用安装后的模块路径及公共 API。

## 安装与发行

打包输出 `dist/truesight-v<version>.zip`，ZIP 顶层为 `truesight/`。解压到 Foundry 用户数据的 `Data/modules/`，使 `module.json` 位于 `Data/modules/truesight/module.json`。`module/` 是开发目录名，不是安装目录名。

源码修改在本项目进行，不直接在 Foundry 安装目录开发。打包本身不会安装、启用或重启 Foundry；用户明确要求部署时按协作约定直接执行授权范围内的部署与验证。

## 迁移记录

源码与基座测试从 `fvtt-zh-aliases` 拆出；旧提交历史保留在该仓库。历史 Truesight ZIP 一并迁入本项目 `dist/`，适配发行包及原工作区的历史评估记录仍留在原项目。本次目录迁移不改变模块 ID、公共 API 或运行时行为。
