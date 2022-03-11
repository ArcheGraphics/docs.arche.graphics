---
sidebar_position: 1
---

# 物理组件概览
![physx](https://arched-graphics.oss-cn-shanghai.aliyuncs.com/img/physx.gif)

物理组件并不是游戏引擎必要的元素，但是增加物理组件可以为场景添加真实的物理反馈，增强画面的交互性。
实时物理和离线物理一种是我个人的主要兴趣和研究方向，并且 Arche 项目将来也会向着物理编辑器和基于物理的内容生成这个方向进行发展。
因此，在 Arche Graphics 中，特地增加了一章有关物理模拟的章节。
在这个章节中，我会介绍 Arche 项目使用的物理组件，以及将要应用的一系列物理技术。

当前，Arche-cpp 已经整合了 PhysX 的基础能力，可以构建带有碰撞响应和碰撞反馈的场景，也可以为这些碰撞体添加约束，为动画角色添加角色控制器。
引擎会自动同步物理引擎和 `Transform` 相关属性的数据，使得物理仿真和渲染画面保持同步。在接下来一段时间内，我会重点研究：
1. 整合基于 PBD(Position-Based Dynamic) 实现的 NvCloth 布料解算
2. PBD 和 SPH 相关技术实现刚体，流体，弹性体，布料求解的统一
3. 基于 GPGPU 的 PBD 模拟技术
4. 基于 FEM 和 MPM 的弹性体，半连续介质求解

:::note
在 Arche-cpp 使用基于模板的数学类，使得不同需求的应用可以选择特定的求解精度。这一基础设计主要也是为了更好的融合物理模拟和渲染技术。
:::

除此之外，我还将介绍如何使用 WebAssembly 技术将 PhysX 编译成为浏览器可以调用的 [PhysX.js](https://github.com/oasis-engine/physX.js) ，
以及 [nvcloth.js](https://github.com/oasis-engine/nvcloth.js) . 并且探索基于 WebGPU 的计算着色器实现浏览器上的物理仿真计算。
这两项技术可能是实现浏览器高性能计算的重要途径，未来或许会基于这两大技术出现更多跨平台的高性能计算应用。
