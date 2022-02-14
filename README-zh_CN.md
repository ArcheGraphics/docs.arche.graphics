# Arche.Graphics 文档站

[![Netlify Status](https://api.netlify.com/api/v1/badges/6efa698d-b180-4836-a596-09167462b860/deploy-status)](https://app.netlify.com/sites/archegraphics/deploys)
[![Crowdin](https://badges.crowdin.net/digitalarche/localized.svg)](https://crowdin.com/project/digitalarche)

[English]:./README.md

[中文]:./README-zh_CN.md

[English] | 中文

文本档是 [Arche Graphics](https://arche.graphics) 的官方文档, 基于 [docusaurus](https://docusaurus.io/)
并且托管于 [Netlify](https://www.netlify.com), 多语言服务由 [Crowdin](https://crowdin.com) 提供支持。

<details>
  <summary>给文档站维护者的提示</summary>

我们遵循本文档对应的 [docusaurus 指南](https://docusaurus.io/docs/i18n/crowdin#crowdin-tutorial)进行翻译工作. 请阅读这份指南以了解技术细节.

如果你希望单独在本地为某个具体的多语言项启用开发服务环境, 在命令后添加 `--locale TARGET_LOCALE` 即可, 比如, 为 `zh-Hans` 启动服务环境的命令:

  ```bash
  yarn --cwd=website start --locale zh-Hans
  ```

要预览翻译后的网站效果, 可执行

  ```bash
  yarn --cwd=website run crowdin download
  ```

以下载经过**通过审核**的的翻译项到你本地, 并执行上文的 `start` 命令, 在本地预览你关心的多语言项.

注意, 你可能需要在本地设置相应的环境变量 `CROWDIN_TOKEN`. 如果你有对应的权限, 可以从 Crowdin 的设置页生成 token.

为了适配源文件可能的重构, 你需要不定期地检查或重构 Crowdin 上的文件结构. 更多细节请参考[这里](https://docusaurus.io/docs/i18n/crowdin#maintaining-your-site).
</details>

## 项目准备

在开始本项目前, 你需要安装以下工具:

- `yarn`

1. 在 macOS 上, 你可以这样安装:

```bash
brew install yarn
```

2. 在基于 Debian 的 Linux 发行版中, 你可以这样安装:

```bash
sudo apt install yarn
```

在 Arch Linux 上, 可以使用以下命令:

```bash
sudo pacman -S yarn
```

3. 在 Windows 上, 你需要首先安装 Node.js. 你可以在终端中运行 `node -v` 以检查它是否安装. 确认 Node.js 安装后, 从 yarn
   的官方站点下载 [Yarn installer(.smi)](https://classic.yarnpkg.com/en/docs/install#windows-stable) 并安装它. 安装完毕后,
   运行 `yarn --version` 以检查是否安装成功.

## 项目设置

安装所有的依赖:

```bash
# 在项目根目录执行
yarn --cwd=website install
```

### 常见问题

#### Ubuntu 上的 issues

如果你在使用 `ubuntu`, 你可能会遇到以下错误:

```
Usage: yarn [options]
yarn: error: no such option: --cwd
```

这说明你的 `yarn` 版本太旧. 你可以通过 `npm` 来更新 yarn:

```
sudo apt install nodejs npm
sudo npm install -g yarn
```

#### Development Server 的 issues

如果你遇到了 `TypeError: Cannot read property 'latest' of undefined` 错误, 请尝试删除 `website/node_modules` 和 `website/yarn.lock`,
然后重新运行 `install` 命令. 该问题可参考[这里](https://github.com/facebook/docusaurus/issues/5106).

## 本地开发

要在本地启动 dev server, 请运行

```bash
yarn --cwd=website start
```

### 编译

要编译静态站点, 请在项目根目录运行:

```bash
yarn --cwd=website build
```

你可以通过以下命令在本地 serve 编译后的静态站点:

```bash
yarn --cwd=website serve
```

## 本地化

我们推荐以下的翻译流程：

1. 上传源文件至 Crowdin（未翻译文件）: ```yarn run crowdin upload```
2. 使用 [Crowdin](https://crowdin.com/project/digitalarche) 来翻译内容
3. 从 Crowdin 下载译文（本地化的翻译文件）: ```yarn run crowdin download```

## 部署

该站点目前部署在 [Netlify](netlify.com) 上.

部署动作会在 Pull Requests 被合并到 `master` 分之后自动执行. 如需在合并前预览你的 PR 的效果, 可使用 Netlify 的预览特性.

## 鸣谢

该站点基于 Docusaurus 和其它很棒的开源项目构建, 感谢所有这些项目的贡献者们!
