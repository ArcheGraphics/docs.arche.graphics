---
sidebar_position: 18
---

# GPU 粒子

![particle](https://arched-graphics.oss-cn-shanghai.aliyuncs.com/img/particle.gif)

GPU 粒子是计算着色器最直接的应用，也是进入GPU物理模拟的第一道门。实际上，从我的开发过程来看，GPU粒子中比较困难的其实是渲染而不是模拟， 因为模拟的部分只是简单的无约束牛顿力学。但是渲染可以使用 MSL 和 GLSL 支持的
PointSize 方式，也可以使用 Instancing 的 Billboard 方式； 甚至在粒子数量非常多的时候，还可以应用类似 Forward+
的方式，对视锥体分块做剔除。但无论如何，我们都需要首先调用计算着色器模拟出粒子的位置以及相关生命周期变量。 对粒子系统，我们的架构和 `ShadowManager` 以及 `LightManager`
类似，都是一个单例的结构，`ParticleRenderer` 组件在构造时，将自己添加到管理器当中。 由管理器类负责更新所有粒子的状态，而 `ParticleRenderer`
本身负责维护粒子的配置以及实现粒子的渲染。因此，主体逻辑如下：

```cpp
void ParticleManager::draw(wgpu::CommandEncoder& commandEncoder) {
    auto passEncoder = commandEncoder.BeginComputePass();
    for (auto& particle : _particles) {        
        /* Max number of particles able to be spawned. */
        uint32_t const num_dead_particles = ParticleRenderer::kMaxParticleCount - particle->numAliveParticles();
        /* Number of particles to be emitted. */
        uint32_t const emit_count = std::min(ParticleRenderer::kBatchEmitCount, num_dead_particles); //
        _emission(emit_count, particle, passEncoder);
        _simulation(particle, passEncoder);
    }
    passEncoder.End();
}
```

## 原子计数器

GPU 粒子中很特殊的一点，在于粒子的初始化也在 GPU 上进行，而不需要每一帧在 CPU 上初始化粒子后更新到 GPU 上，这样一来使得 CPU 和 GPU 的操作不需要任何同步的阻塞。
要想实现这一点，就需要之前章节介绍过的原子计数器。每一个 thread 需要用原子的方式获得自身唯一的ID，然后将构造出的数据保存下来：

```wgsl
// Emit particle id.
let id = atomicAdd(&u_readAtomicBuffer.counter, 1u);

var p = TParticle();
p.position = vec4<f32>(pos, 1.0);
p.velocity = vec4<f32>(vel, 0.0);
p.start_age = age;
p.age = age;
p.id = id;

u_readConsumeBuffer[id] = p;
```

注意到，这里使用的是 `u_readAtomicBuffer` 和 `u_readConsumeBuffer`，对应的还有 `u_writeAtomicBuffer` 和 `u_writeConsumeBuffer`。
在模拟应用中，双缓存是一个非常常用的策略，readBuffer 负责保存当前步的初始化数据，writeBuffer 负责保存当前步最终的模拟数据，每一帧都将二者交换，交换操作非常简单：

```cpp
void ParticleRenderer::update(float deltaTime) {
    setTimeStep(deltaTime * ParticleManager::getSingleton().timeStepFactor());
    _write = 1 - _write;
    _read = 1 - _read;
    
    // todo
    _mesh->setInstanceCount(_numAliveParticles);
    _mesh->setVertexBufferBinding(*_appendConsumeBuffer[_read]);
    _generateRandomValues();
}
```

因为 read 和 write 只是0和1，因此做一个简单的减法就可以进行互换。也正是为了支持这种Buffer交换的模式，在之前扩展 `ShaderData` 时，才添加了函数对象的支持：

```cpp
_atomicBuffer[0] = std::make_unique<Buffer>(device, sizeof(uint32_t), wgpu::BufferUsage::Storage | wgpu::BufferUsage::CopySrc);
_atomicBuffer[1] = std::make_unique<Buffer>(device, sizeof(uint32_t), wgpu::BufferUsage::Storage | wgpu::BufferUsage::CopySrc);
shaderData.setBufferFunctor(_readAtomicBufferProp, [this]()->Buffer {
    return *_atomicBuffer[_read];
});
shaderData.setBufferFunctor(_writeAtomicBufferProp, [this]()->Buffer {
    return *_atomicBuffer[_write];
});
```

## GPU 模拟

在模拟时，`u_readAtomicBuffer` 减一，并且从 `u_readConsumeBuffer` pop 一个粒子的数据；然后`u_writeAtomicBuffer`
加一，并且将计算结果push `u_writeConsumeBuffer`。

```wgsl
fn popParticle(index: u32) -> TParticle {
    atomicSub(&u_readAtomicBuffer.counter, 1u);
    return u_readConsumeBuffer[index];
}
fn pushParticle(p: TParticle) {
    let index = atomicAdd(&u_writeAtomicBuffer.counter, 1u);
    u_writeConsumeBuffer[index] = p;
}
```

:::note

具体的模拟过程不做特别详细的介绍，因为粒子系统实际上是一个面向美术的系统，因此需要根据美术的需求进行扩展和特化。因此 Unity 和 Houdini 等特效软件均采用了可视化脚本的方式逐渐调整粒子的效果。
目前引擎中只是实现了非常简单的粒子效果，目的是为了跑通GPU粒子模拟的基础逻辑，后续会添加更多细节并且使用类似可视化脚本的方式进行扩展。

:::

## 渲染

### PointSize（WGSL 不支持）

一开始我在 [DigitalVox4](https://github.com/yangfengzzz/DigitalVox4/blob/main/vox.shader/particle_draw_point.metal) 中初步尝试时，
使用了 MSL 支持的 PointSize 方式渲染粒子，这种方式在渲染时，选择 `PrimitiveTypePoint` 然后在顶点着色器中设置点的大小：

```cpp
struct VertexOut {
    float4 position [[position]];
    float pointSize [[point_size]];
    float3 color;
    float decay;
};
```

渲染管线就会自动按照尺寸光栅化一个面片用于片段着色器中的渲染，但是这种方式其实在 HLSL 中并不支持，因此WGSL也无法支持这种特性。
相关讨论可以参考 [WebGPU Issue #1190](https://github.com/gpuweb/gpuweb/issues/1190).

### Instancing

由于MSL当中没有几何着色器，因此WGSL也无法用几何着色器的方式渲染粒子，因此唯一剩下的方式，就是用 GPU 实例化，即 Instancing。 实际上 Instancing 在 Forward+
中已经使用过了，当时是用于可视化光源的位置，方便调试。在这里，我们实际使用相同的方式对粒子进行渲染。渲染的核心在于生成 Billboard 矩阵:

```wgsl
var<private> pos : array<vec2<f32>, 4> = array<vec2<f32>, 4>(
    vec2<f32>(-1.0, 1.0), vec2<f32>(-1.0, -1.0), vec2<f32>(1.0, 1.0), vec2<f32>(1.0, -1.0)
);
                          
// Generate a billboarded model view matrix\n"
    var bbModelViewMatrix:mat4x4<f32> = mat4x4<f32>(1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0);
    bbModelViewMatrix[3] = vec4<f32>(in.position.xyz, 1.0);
    bbModelViewMatrix = u_cameraData.u_viewMat * bbModelViewMatrix;
    bbModelViewMatrix[0][0] = 1.0;
    bbModelViewMatrix[0][1] = 0.0;
    bbModelViewMatrix[0][2] = 0.0;
   
    bbModelViewMatrix[1][0] = 0.0;
    bbModelViewMatrix[1][1] = 1.0;
    bbModelViewMatrix[1][2] = 0.0;

    bbModelViewMatrix[2][0] = 0.0;
    bbModelViewMatrix[2][1] = 0.0;
    bbModelViewMatrix[2][2] = 1.0;
    out.position = u_cameraData.u_projMat * bbModelViewMatrix * vec4<f32>(worldPos, 1.0);
```

`bbModelViewMatrix` 的计算，首先需要将粒子的坐标变换到视图空间，然后消除所有旋转的信息，这样一来，粒子始终就会面向相机。然后在作用上 Billboard 的四个顶点，就可以得到最终的投影坐标。

在这里，每个粒子被渲染成一个朝向相机的小面片，因此需要绘制4个顶点，但是粒子的数量可能高达几十或者上百万个，因此instancing可以一次性绘制这么多个粒子。
由于GPU粒子需要通过计算着色器进行计算，因此需要设置 `wgpu::BufferUsage::Storage`。 但有两种方式将粒子的数据传送到顶点着色器当中，一种是 `wgpu::BufferUsage::Uniform`
另外一种是 `wgpu::BufferUsage::Vertex`。 前者和任何一种 UniformBuffer 的使用方式一样，但是 Buffer 的大小不能超过 `uint16_t` 的上界，因此只能最多有六万多个粒子。
为了支持更多数量，最佳的选择是 `wgpu::BufferUsage::Vertex`，通过 `RenderPassEncoder::SetVertexBuffer` 将数据绑定上去，为此我们还需要描述 VertexBuffer 的
Layout：

```cpp
std::vector<wgpu::VertexAttribute> vertexAttributes(3);
vertexAttributes[0].format = wgpu::VertexFormat::Float32x4;
vertexAttributes[0].offset = 0;
vertexAttributes[0].shaderLocation = 0;
vertexAttributes[1].format = wgpu::VertexFormat::Float32x4;
vertexAttributes[1].offset = sizeof(Vector4F);
vertexAttributes[1].shaderLocation = 1;
vertexAttributes[2].format = wgpu::VertexFormat::Float32x4;
vertexAttributes[2].offset = 2 * sizeof(Vector4F);
vertexAttributes[2].shaderLocation = 2;
_mesh->setVertexLayouts(vertexAttributes, sizeof(TParticle), wgpu::VertexStepMode::Instance);
```

:::tip
`wgpu::VertexStepMode::Instance` 是这里的关键，即逐 Instancing 遍历。一般来说更加常用的是 `wgpu::VertexStepMode::Vertex` 即逐顶点的方式遍历。
:::

## 高级主题

目前引擎中还未实现以下高级特性，有兴趣的可以参考 [GPUParticles11](https://github.com/GPUOpen-LibrariesAndSDKs/GPUParticles11) 中的实现。

### 物理碰撞

GPU 粒子相比于 CPU 粒子的最大缺陷，就是不是很容易和CPU上进行的操作进行交互，其中最重要的就是物理。 为了解决这一问题，可以使用深度图，首先渲染物体的位置，然后判断粒子的深度和物体深度的关系，以此进行碰撞检测。

### 粒子剔除

当粒子数量过大时，即使Instancing也无法直接渲染这么多的粒子。由于粒子之间相互堆叠，实际可以被看到的粒子是有限的。因此可以类似光源剔除时使用的 Tile/Cluster-based
方法，记录格子相关的粒子数，然后根据粒子数量渲染出特定的 alpha.
