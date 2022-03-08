---
slug: workspace
title: 开发闭环
authors: [yangfengzzz]
tags: [webgpu]
---

在开发 Arche 项目之前，我主要开发了 DigitalVox 系列引擎，最新的是 [DigitalVox4](https://github.com/yangfengzzz/DigitalVox4) 。
这一系列主要使用 Metal API 但由于 Metal 不是跨平台的所以我后来转向了 WebGPU。但是在开发 Arche 系列的同时，我还是坚持维护这一项目的同步发展。
主要有以下几个原因：
1. WGSL 并不是特别好用，没有很好的 debugger tool，没有很好的可视化编辑器。但是 MSL 却很好写，而且用FunctionConstantValue很好的替代了宏的作用。
更重要的是，即使Dawn可以在 Xcode 上抓帧调试，但是着色器的可读性已经非常差了，这一点或许将来Tint 编译器可以做的和 SPIRV-Cross 一样好，但至少目前直接通过抓帧得到很多有用的调试信息。
2. Metal 是单一平台的API，有许多 WebGPU 不支持的特性，比如光追，TAA，ModelIO等等。由于WebGPU需要在各个平台上抽象出共性的API，因此发展一定会比单一API要更慢，因此可以实验更多有趣的特性。
3. 在两个架构上实现同一种算法，例如阴影，我在Metal，Dawn，Web实现了三遍，每次都有不同的感觉，到最后对算法的理解会更加深入，并且因此对算法优化和架构设计有更好的理解。因此往往会在这个过程中逐渐找到通用的架构设计。

纵观手上的几个项目，其实形成了一个非常完整的开发闭环：
![RoadMap](/img/roadmap.png)

从 DigitalVox4 和 Arche-cpp 上的算法实践，到 Arche.js 和网站的呈现。到最后在 Oasis-Engine 中挑战最佳优化和产品化落地，最后在回过来完善 DigitalVox4 和 Arche-cpp 的架构设计。
