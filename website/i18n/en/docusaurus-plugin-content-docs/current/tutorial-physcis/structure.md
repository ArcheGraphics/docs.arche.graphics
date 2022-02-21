---
sidebar_position: 1
---

# Physical Component Overview

Physical components are not necessary elements of a game engine, but adding physical components can add real physical
feedback to the scene and enhance the interactivity of the screen. Real-time physics and offline physics one is my main
interest and research direction, and the Arche project will also develop in the direction of physics editor and
physics-based content generation in the future. Therefore, in Arche Graphics, a special chapter on physics simulation
has been added. In this chapter, I will introduce the physical components used by the Arche project, as well as a series
of physical techniques that will be applied.

Currently, Arche-cpp has integrated the basic capabilities of PhysX, which can build scenes with collision response and
collision feedback, add constraints to these colliders, and add character controllers to animated characters. The engine
will automatically synchronize the data of the physics engine and `Transform` related properties, so that the physical
simulation and the rendering screen are kept in sync. In the next period of time, I will focus on:

1. Integrate NvCloth cloth solution based on PBD (Position-Based Dynamic) implementation
2. PBD and SPH related technologies realize the unification of rigid body, fluid, elastic body and cloth solution
3. PBD simulation technology based on GPGPU
4. Elastomeric, semi-continuous medium solution based on FEM and MPM

:::note The use of template-based math classes in Arche-cpp enables applications with different needs to choose a
specific solution precision. This basic design is mainly to better integrate physical simulation and rendering
technology.
:::

In addition to this, I will also introduce how to use WebAssembly technology to compile PhysX
into [PhysX.js](https://github.com/oasis-engine/physX.js) that the browser can call, And explore WebGPU-based compute
shaders for physically simulated computations on the browser. These two technologies may be an important way to achieve
high-performance computing in browsers, and there may be more cross-platform high-performance computing applications
based on these two technologies in the future.
