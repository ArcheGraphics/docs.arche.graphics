---
sidebar_position: 1
---

# 初入 WebGPU

WebGPU是新一代的跨平台图形API:
![WebGPU in Chrome](/img/tutorial/dawn-in-chrome.png)

他将系统底层的图形API抽象出统一的图形接口，形成 DawnNative 后，再经过 DawnWire 序列化，就可以在浏览器中调用现代图形 API 的能力，其在性能，特别是计算着色器， 以及未来可能支持的
RayTracing，Bindless，IndirectCommandBuffer 上，都有非常强的想象空间。

WebGPU的出现，使得图形API经历了Metal，Vulkan，DX12三分天下后，重新使得开发跨平台图形应用变得容易，这种易用性不仅仅指的是Web层面，
在Native层面，利用Dawn也完全能够更容易地开发出跨平台的图形应用。实际上，未来基于WebGPU的跨平台应用有三种表现形式：

1. Native：基于 Dawn 开发跨平台应用。
2. WebAssembly：基于 Dawn 开发跨平台应用，然后使用 WebAssembly 编译，再在浏览器中调用。
3. WebGPU：基于 H5 的 Web 跨平台应用。

因此，[Arche Graphics](https://github.com/ArcheGraphics) 基于
WebGPU，分别开发了[Arche-cpp](https://github.com/ArcheGraphics/Arche-cpp)
和 [Arche.js](https://github.com/ArcheGraphics/Arche.js) 两个项目，从 C++ 和 TypeScript
两个角度共同探索WebGPU的设计和实现。两者有所区别，但在API设计上尽可能保持接近。
**这使得本网站的文档，包括首页在展示 WebGPU 的 C++ 实现的同时，所呈现的在线交互，均由 Arche.js 渲染， 并且在后续的讨论中，会对比展示两种语言的不同，以此展示WebGPU在设计上的一些考虑。**

## 初始入手

您可以按照自己的习惯选择从基于 C++ 的 [Arche-cpp](https://github.com/ArcheGraphics/Arche-cpp)
和基于 TypeScript 的 [Arche.js](https://github.com/ArcheGraphics/Arche.js) 入手 WebGPU。

### [Arche-cpp](https://github.com/ArcheGraphics/Arche-cpp)

Arche-Cpp 使用 Xcode 进行开发，后续会增加 Cmake
构建支持，由于基于C++因此非常容易集成现有C++生态中的图形学库，例如PhysX和Ozz-Animation，整个项目基于Git-Submodule开发，因此可以一次性拉去所有代码：

```bash
git clone --recursive https://github.com/ArcheGraphics/Arche-cpp.git
```

拉去代码后通过third-party的脚本编译第三方依赖：

```bash
cd third-party && ./build.sh
```

最后打开 Xcode 项目编译代码即可。

### [Arche.js](https://github.com/ArcheGraphics/Arche.js)

Arche.js 采用 Monorepo 管理项目，并不包含应用脚本，如果你希望快速开发，可以借助 [create-arche-app](https://github.com/ArcheGraphics/create-arche-app)
工程脚手架:

```bash
npm init @arche-engine/arche-app
```

或者直接克隆 [Playground](https://github.com/ArcheGraphics/playground):

```bash
git clone --recursive https://github.com/ArcheGraphics/playground
```

playground 项目同样由 create-arche-app 脚手架生成，并且包含一系列范例，如果你希望边修改引擎，边测试，可以使用`npm link`命令进行连接：

```bash
npm link ../Arche.js/packages/* --no-package-lock
```

#### 浏览器配置
**目前 WebGPU 还不能直接跑在正式版的 Chrome 上，需要首先下载 [Chrome Canary](https://www.google.com/chrome/canary/)**  下载后在地址栏输入：
```
chrome://flags/
```
接着搜索 `Unsafe WebGPU` 设置 Enabled 状态，就可以看到 [Arche-Graphics](https://arche.graphics/zh-Hans/playground/cascade-shadow) 中的演示案例。

目前在 MacOS，Windows10 的 Chrome 101.0.4935.0 版本上已经测试通过。如果你的系统是Windows7等早期平台，因为这些平台上没有全功能的D3D12，因此可能渲染会出现问题。
