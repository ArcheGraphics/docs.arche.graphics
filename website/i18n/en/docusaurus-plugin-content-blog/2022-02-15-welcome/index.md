---
slug: welcome 
title: Welcome to WebGPU 
authors: [yangfengzzz]
tags: [webgpu]
---

Welcome to the official website of Arche Graphics, which is a summary of a series of projects I have developed around
WebGPU. Interested people can get information about Arche directly from the documentation The introduction of the
project will not be explained too much here. As the first blog post on this site, I would like to introduce one of my
original intentions for starting this project, and what kind of information you can learn from the Arche project, which
may be helpful to understand the project in more depth.

Starting in 2018, I registered the domain name DigitalArche, and it was also at that point in time that I started
researching graphics. In the beginning I developed DigitalVox using the Metal API A series of projects that gradually
absorb the excellent open source engine architecture and try to maintain a balance between ease of use and performance
during development. However, Metal is only an API on the Apple platform after all, and cannot be cross-platform, and the
cross-platform API can only choose Vulkan, which is more complicated in design, was difficult for me to control for a
while.

So, when I noticed WebGPU, I decided to build on it, I went back to the Arche project, and registered the current domain
name Arche.graphics. Because I realized that the emergence of WebGPU and its underlying RHI will enable cross-platform
development of graphics applications, after experiencing After Metal, Vulkan, and DirectX are in the world, it can be
easier. In fact, almost all the graphics engines currently developed by Rust are based on the wgpu-rs project. I believe
that there will be more and more cross-platform applications developed based on Dawn in the future.

This project is completely developed around WebGPU, and there are two main projects, Arche-cpp and Arche.js, both of
which have different implementations due to language differences, but the overall design of the API is the same. In this
website, I hope to introduce the details of the relevant implementation around these two projects. In order to introduce
more detailed, I will mainly base on the C++ language and compare its differences with TypeScript. At the same time, I
will try to show the design and In the process of source code, use Arche.js This item renders the corresponding effect.
In this way, we can not only show the low-level implementation of WebGPU, but also understand why WebGPU's C++ bottom
layer designs this or that interface.

It should be pointed out that this project is not currently intended to become a commercial activity, and the efficiency
of implementation may not be the best. From my original intention, I want to do three things:

1. **Show the capabilities of WebGPU:** The emergence of WebGPU not only makes the development of cross-platform tools
   easier, but more importantly, on the Web side (even other embedded development platforms based on Chrome projects),
   have The ability to call modern GPUs. In particular, the introduction of compute shaders not only makes AI more
   efficient, but also a series of algorithms based on GPGPU can be implemented, such as culling, simulation, etc. By
   showing these effects on this website, we can accelerate the public perception of GPU programming. 
2. **Popularize WebGPU development:** I did not choose to create a website called learningWebGPU because I am not going to cover the
   details of WebGPU or modern graphics APIs, Instead, I want to be able to present my current work in a more hands-on
   way. I hope that readers can follow my development ideas and develop their own engines, not just learn a certain way
   of calling APIs. 
3. **Summarize the details of the development process:** In the development process, such as the
   organization of ShaderData, the organization of Pass, the use of Macro, etc., are the basis for developing general
   cross-platform tools, I hope readers can refer to my implementation, and Incorporate it into your own engine and
   improve the relevant design.

So in general, I'm trying to do this more for an educational purpose. Starting from my personal interest, in the future,
I will try to combine tools such as OpenVDB to make more attempts in physical simulation. Interested friends are also
welcome to contact me through GitHub and Zhihu.
