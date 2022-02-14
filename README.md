# Arche.Graphics Documentation Site

[![Netlify Status](https://api.netlify.com/api/v1/badges/6efa698d-b180-4836-a596-09167462b860/deploy-status)](https://app.netlify.com/sites/archegraphics/deploys)
[![Crowdin](https://badges.crowdin.net/digitalarche/localized.svg)](https://crowdin.com/project/digitalarche)

[English]:./README.md

[中文]:./README-zh_CN.md

English | [中文]

The static document is the official document of [Arche Graphics](https://arche.graphics), based
on [docusaurus](https://docusaurus.io/)
And hosted on [Netlify](https://www.netlify.com), multilingual services powered by [Crowdin](https://crowdin.com).

<details>
  <summary>Tips for Documentation Website Maintainers</summary>

We follow the corresponding
[docusaurus guide](https://docusaurus.io/docs/i18n/crowdin#crowdin-tutorial) for the translation setup. Please refer to
the guide for technical details.

If you want to spin up the development server locally for a specific locale, add `--locale TARGET_LOCALE` after the
command. For example, in order to start the server for `zh-Hans`:

  ```bash
  yarn --cwd=website start --locale zh-Hans
  ```

To preview the translated website, you can use

  ```bash
  yarn --cwd=website run crowdin download
  ```

to download **approved** translations to your local disk, and run the `start` command listed above to preview the
website in your desired locale locally. Note you may need to set the corresponding environment variable
`CROWDIN_TOKEN` locally. It can be generated from the Crowdin settings page, if you have the right permission.

You need to periodically check/refactor the file structure on Crowdin for any source file refactor. Please see more
details [here](https://docusaurus.io/docs/i18n/crowdin#maintaining-your-site).
</details>

## Prerequisites

You need to install the following before setting up this project:

- `yarn`

1. On macOS, you can install the above by:

```bash
brew install yarn
```

2. On Debian-based Linux distribution, you can install the above by:

```bash
sudo apt install yarn
```

For Arch Linux, use the following command:

```bash
sudo pacman -S yarn
```

3. To install yarn on Windows, you need to install Node.js first. You can check it using `node -v‘` in the terminal.
   After it's verified, download the [Yarn installer(.smi)](https://classic.yarnpkg.com/en/docs/install#windows-stable)
   from the official yarn website and install it. To verifiy the installation, use `yarn --version`.

## Setup

Install all of the dependencies by:

```bash
# from the root of the project
yarn --cwd=website install
```

### Trouble shooting

#### Ubuntu issues

If you are using `ubuntu`, you might get errors as below:

```
Usage: yarn [options]
yarn: error: no such option: --cwd
```

which indicates your  `yarn` is too old. You could install new version yarn with `npm`:

```
sudo apt install nodejs npm
sudo npm install -g yarn
```

#### Development server issues

If you run into `TypeError: Cannot read property 'latest' of undefined` error, try to remove both
of `website/node_modules` and `website/yarn.lock` and re-run the
`install` command. This issue has been reported [here](https://github.com/facebook/docusaurus/issues/5106).

## Local Development

In order to spin up the dev server locally for development:

```bash
yarn --cwd=website start
```

### Build

To build the static site, from the root, run:

```bash
yarn --cwd=website build
```

you can then serve the built static website locally using:

```bash
yarn --cwd=website serve
```

## Localization

We recommend the following translation process:

1. Upload source files to Crowdin (untranslated files): ```yarn run crowdin upload```
2. Use [Crowdin](https://crowdin.com/project/digitalarche) to translate content
3. Download translations (localized translation files) from Crowdin: ```yarn run crowdin download```

## Deployment

This website is currently hosted on [Netlify](netlify.com).

The deployment is automatically done when Pull Requests are merged to `master` branch. You may preview your PR before
merging utilizing Netlify's preview feature.

## Credits

This website is built on top of the wonderful Docusaurus along with a list of great open source projects, thanks to all
of the contributors of them!
