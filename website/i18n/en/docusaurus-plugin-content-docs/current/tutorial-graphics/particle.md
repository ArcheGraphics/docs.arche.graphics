---
sidebar_position: 18
---

# GPU Particles

![particle](https://arched-graphics.oss-cn-shanghai.aliyuncs.com/img/particle.gif)

GPU particles are the most direct application of compute shaders and the first door to GPU physics simulation. In fact,
from my development process, the more difficult part of GPU particles is rendering rather than simulation, because the
simulation part is just simple unconstrained Newtonian mechanics. But rendering can use MSL and GLSL supported PointSize
method, you can also use Instancing's Billboard method; even when the number of particles is very large, you can also
apply something similar to Forward+ method, culling frustum blocks. But in any case, we need to call the compute shader
first to simulate the position of the particle and related life cycle variables. For particle systems, our architecture
and `ShadowManager` and `LightManager`
Similarly, it is a singleton structure, and the `ParticleRenderer` component adds itself to the manager when it is
constructed. The manager class is responsible for updating the state of all particles, and the `ParticleRenderer`
It is responsible for maintaining the configuration of particles and implementing the rendering of particles. Therefore,
the main logic is as follows:

````cpp
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
````

## Atomic Counter

A very special point in GPU particles is that the initialization of particles is also carried out on the GPU, and it is
not necessary to initialize the particles on the CPU every frame and then update them to the GPU, so that the operations
of the CPU and GPU do not need any synchronous blocking. . To do this, you need the atomic counters described in the
previous chapters. Each thread needs to obtain its own unique ID atomically, and then save the constructed data:

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

Note that `u_readAtomicBuffer` and `u_readConsumeBuffer` are used here, corresponding to `u_writeAtomicBuffer`
and `u_writeConsumeBuffer`. In simulation applications, double buffering is a very common strategy. readBuffer is
responsible for saving the initialization data of the current step, and writeBuffer is responsible for saving the final
simulation data of the current step. The two are exchanged every frame. The exchange operation is very simple:

````cpp
void ParticleRenderer::update(float deltaTime) {
     setTimeStep(deltaTime * ParticleManager::getSingleton().timeStepFactor());
     _write = 1 - _write;
     _read = 1 - _read;
    
     // todo
     _mesh->setInstanceCount(_numAliveParticles);
     _mesh->setVertexBufferBinding(*_appendConsumeBuffer[_read]);
     _generateRandomValues();
}
````

Since read and write are just 0s and 1s, doing a simple subtraction will do the swap. It is also in order to support
this mode of Buffer exchange that when extending `ShaderData` before, support for function objects was added:

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

## GPU Simulation

During simulation, `u_readAtomicBuffer` is decremented by one, and one particle's data is popped
from `u_readConsumeBuffer`; then `u_writeAtomicBuffer`
Add one, and push the result to `u_writeConsumeBuffer`.

````wgsl
fn popParticle(index: u32) -> TParticle {
    atomicSub(&u_readAtomicBuffer.counter, 1u);
    return u_readConsumeBuffer[index];
}
fn pushParticle(p: TParticle) {
    let index = atomicAdd(&u_writeAtomicBuffer.counter, 1u);
    u_writeConsumeBuffer[index] = p;
}
````

:::note

The specific simulation process will not be introduced in particular, because the particle system is actually an
art-oriented system, so it needs to be extended and specialized according to the needs of the art. Therefore, special
effects software such as Unity and Houdini use visual scripting to gradually adjust the effect of particles. At present,
only a very simple particle effect is implemented in the engine, the purpose is to run through the basic logic of GPU
particle simulation, and more details will be added later and extended in a way similar to visual scripting.

:::

## Render

### PointSize (not supported by WGSL)

When I first tried it out
in [DigitalVox4](https://github.com/yangfengzzz/DigitalVox4/blob/main/vox.shader/particle_draw_point.metal), Particles
are rendered using the PointSize method supported by MSL. In this method, when rendering, select `PrimitiveTypePoint`
and set the point size in the vertex shader:

```cpp
struct VertexOut {
    float4 position [[position]];
    float pointSize [[point_size]];
    float3 color;
    float decay;
};
```

The rendering pipeline will automatically rasterize a patch according to the size for rendering in the fragment shader,
but this method is not actually supported in HLSL, so WGSL cannot support this feature. For related discussions, please
refer to [WebGPU Issue #1190](https://github.com/gpuweb/gpuweb/issues/1190).

### Instancing

Since there is no geometry shader in MSL, WGSL cannot render particles in the way of geometry shader, so the only
remaining way is to use GPU instancing, that is, Instancing. Actually Instancing in Forward+ It has been used in , and
it was used to visualize the position of the light source for easy debugging. Here, we actually render the particles in
the same way. The core of rendering lies in generating the Billboard matrix:

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

The calculation of `bbModelViewMatrix` first needs to transform the coordinates of the particles into view space, and
then remove all rotation information, so that the particles always face the camera. Then act on the four vertices of the
Billboard to get the final projected coordinates.

Here, each particle is rendered as a small patch facing the camera, so 4 vertices need to be drawn, but the number of
particles can be as high as tens or millions, so instancing can draw so many particles at once. Since GPU particles need
to be calculated by compute shaders, `wgpu::BufferUsage::Storage` needs to be set. But there are two ways to transfer
particle data to vertex shader, one is `wgpu::BufferUsage::Uniform`
The other is `wgpu::BufferUsage::Vertex`. The former is used in the same way as any UniformBuffer, but the size of the
Buffer cannot exceed the upper bound of `uint16_t`, so there can only be a maximum of more than 60,000 particles. In
order to support more numbers, the best choice is `wgpu::BufferUsage::Vertex`, bind the data
through `RenderPassEncoder::SetVertexBuffer`, for this we also need to describe the VertexBuffer Layout:

````cpp
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
````

:::tip
`wgpu::VertexStepMode::Instance` is the key here, traversing by Instancing. Generally
speaking, `wgpu::VertexStepMode::Vertex` is more commonly used, which is a vertex-by-vertex traversal.
:::

## Advanced Topics

At present, the following advanced features have not been implemented in the engine. If you are interested, you can
refer to the implementation in [GPUParticles11](https://github.com/GPUOpen-LibrariesAndSDKs/GPUParticles11).

### Physical Collision

The biggest drawback of GPU particles compared to CPU particles is that it is not easy to interact with operations on
the CPU, the most important of which is physics. In order to solve this problem, a depth map can be used, first
rendering the position of the object, and then judging the relationship between the depth of the particle and the depth
of the object, so as to perform collision detection.

### Particle Culling

When the number of particles is too large, even Instancing cannot directly render so many particles. Since the particles
are stacked on top of each other, the particles that can actually be seen are limited. Therefore, it can be similar to
Tile/Cluster-based used in light source culling method that records the number of particles associated with the grid,
and then renders a specific alpha based on the number of particles.
