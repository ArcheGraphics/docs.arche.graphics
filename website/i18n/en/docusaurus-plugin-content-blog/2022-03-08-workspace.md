---
slug: workspace
title: Workspace
authors: [yangfengzzz]
tags: [webgpu]
---

Before developing the Arche project, I mainly developed the DigitalVox series of engines, the latest
is [DigitalVox4](https://github.com/yangfengzzz/DigitalVox4). This series mainly uses the Metal API but since Metal is
not cross-platform I later moved to WebGPU. But while developing the Arche series, I insisted on keeping the project in
sync. There are mainly the following reasons:

1. WGSL is not very easy to use, there is no good debugger tool, there is no good visual editor. But MSL is very easy to
   write, and uses FunctionConstantValue to replace the role of macros well. More importantly, even though Dawn can
   debug frame grabbing on Xcode, the readability of the shader is very poor, which may be as good as
   SPIRV-Cross can be done by the Tint compiler in the future, but at least for now directly by capturing frame to get a
   lot of useful debugging information.
2. Metal is a single-platform API and has many features that WebGPU does not support, such as ray tracing, TAA, ModelIO,
   etc. Since WebGPU needs to abstract common APIs on various platforms, development will definitely be slower than a
   single API, so more interesting features can be experimented.
3. Implement the same algorithm on two architectures, such as shadows. I implemented it three times in Metal, Dawn, and
   Web. Each time, I have a different feeling. In the end, I will have a deeper understanding of the algorithm, and
   therefore optimize the algorithm. And have a better understanding of architectural design. Therefore, a common
   architecture design is often found gradually in this process.

Looking at the several projects in hand, a very complete closed loop of development has actually been formed:
![RoadMap](/img/roadmap.png)

From algorithm practice on DigitalVox4 and Arche-cpp, to Arche.js and website rendering. In the end, challenge the best
optimization and productization in Oasis-Engine, and finally come back to improve the architecture design of DigitalVox4
and Arche-cpp.
