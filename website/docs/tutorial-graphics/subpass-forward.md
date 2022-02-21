---
sidebar_position: 10
---

# 渲染子通道： 正向渲染

基于正向渲染的渲染子通道是 Arche 引擎最为核心的渲染代码，利用了前面介绍的 `ResourceCache`，`WGSLEncoder` 等各个方面的能力。
因此，该管线在实现高性能的运行时渲染的同时，还可以保持想当的灵活性，针对各种形式的 `Mesh`，`Material` 和 `Shader`，都可以自动进行数据和管线的绑定。

## 准备渲染队列
在渲染一开始，首先通过调用 `ComponentManager::callRenderer` 进行场景剔除，并且将所有可渲染对象整合到一个队列当中：
```cpp
void ForwardSubpass::_drawMeshes(wgpu::RenderPassEncoder &passEncoder) {
    auto compileMacros = ShaderMacroCollection();
    _scene->shaderData.mergeMacro(compileMacros, compileMacros);
    _camera->shaderData.mergeMacro(compileMacros, compileMacros);
    
    std::vector<RenderElement> opaqueQueue;
    std::vector<RenderElement> alphaTestQueue;
    std::vector<RenderElement> transparentQueue;
    _scene->_componentsManager.callRender(_camera, opaqueQueue, alphaTestQueue, transparentQueue);
    std::sort(opaqueQueue.begin(), opaqueQueue.end(), _compareFromNearToFar);
    std::sort(alphaTestQueue.begin(), alphaTestQueue.end(), _compareFromNearToFar);
    std::sort(transparentQueue.begin(), transparentQueue.end(), _compareFromFarToNear);
    
    _drawElement(passEncoder, opaqueQueue, compileMacros);
    _drawElement(passEncoder, alphaTestQueue, compileMacros);
    _drawElement(passEncoder, transparentQueue, compileMacros);
}
```
:::tip
`opaqueQueue` 表示不透明的物体， `alphaTestQueue` 表示使用 alphaTest 技术的物体，这些物体在着色器中处理透明的方式，是直接 `discard` 不需要的片段。
最后 `transparentQueue` 表示使用透明通道的物体。对于透明物体来说，由于关闭了深度贴图的写入，因此需要对其进行排序。
:::

## 录制渲染命令
实际上直接与 `wgpu::RenderPassEncoder` 进行交互的操作并不是很多：
```cpp
void ForwardSubpass::_drawElement(wgpu::RenderPassEncoder &passEncoder,
                                  const std::vector<RenderElement> &items,
                                  const ShaderMacroCollection& compileMacros) {
    for (auto &element : items) {
        auto macros = compileMacros;
        auto& renderer = element.renderer;
        renderer->shaderData.mergeMacro(macros, macros);
        auto& material = element.material;
        material->shaderData.mergeMacro(macros, macros);
        auto& mesh = element.mesh;
        auto& subMesh = element.subMesh;
        
        ...
        passEncoder.SetBindGroup(layoutDesc.first, uniformBindGroup);
        
        ...
        passEncoder.SetPipeline(renderPipeline);
        
        // Draw Call
        for (uint32_t j = 0; j < mesh->vertexBufferBindings().size(); j++) {
            auto vertexBufferBinding =  mesh->vertexBufferBindings()[j];
            if (vertexBufferBinding) {
                passEncoder.SetVertexBuffer(j, mesh->vertexBufferBindings()[j]->handle());
            }
        }
        auto indexBufferBinding = mesh->indexBufferBinding();
        if (indexBufferBinding) {
            passEncoder.SetIndexBuffer(mesh->indexBufferBinding()->buffer(), mesh->indexBufferBinding()->format());
        }
        passEncoder.DrawIndexed(subMesh->count(), 1, subMesh->start(), 0, 0);
    }
}
```

从这段简化的代码可以看出实际上只有五个直接和 `wgpu::RenderPassEncoder` 相关联：
1. 绑定带有着色器资源的 `wgpu::BindGroup`
2. 绑定配置渲染管线状态的 `wgpu::RenderPipeline`
3. 绑定网格顶点数据 `wgpu::Buffer`
4. 绑定网格顶点指标 `wgpu::Buffer`
5. 绘制每一个顶点指标 `DrawIndexed`

### 绑定着色器资源
`wgpu::BindGroup` 的构造需要 `wgpu::BindGroupDescriptor`：
```cpp
struct BindGroupDescriptor {
    ChainedStruct const * nextInChain = nullptr;
    char const * label = nullptr;
    BindGroupLayout layout;
    uint32_t entryCount;
    BindGroupEntry const * entries;
};
```

其中 `wgpu::BindGroupLayout` 需要由 `wgpu::BindGroupLayoutDescriptor` 构建。
在之前的文章中已经介绍过这一结构体，该结构体由 `Shader` 整合顶点着色器和片段着色器的附属信息后构造而成。
接下来重点来看 `wgpu::BindGroupEntry`:
```cpp
struct BindGroupEntry {
    ChainedStruct const * nextInChain = nullptr;
    uint32_t binding;
    Buffer buffer = nullptr;
    uint64_t offset = 0;
    uint64_t size;
    Sampler sampler = nullptr;
    TextureView textureView = nullptr;
};
```
和 `wgpu::BindGroupLayoutEntry` 相比：
```cpp
struct BindGroupLayoutEntry {
    ChainedStruct const * nextInChain = nullptr;
    uint32_t binding;
    ShaderStage visibility;
    BufferBindingLayout buffer;
    SamplerBindingLayout sampler;
    TextureBindingLayout texture;
    StorageTextureBindingLayout storageTexture;
};
```

同样都有 `binding` 属性，该属性和某个 `ShaderProperty` 是对应的。而其余的属性也基本上一一对应，`Buffer`， `TextureView`， `Sampler`等等。
最主要的区别是 `wgpu::BindGroupEntry` 绑定了这些资源的句柄，而 `wgpu::BindGroupLayoutEntry` 只是描述了这些数据。
因此，从`Shader`中获取的 `wgpu::BindGroupLayoutEntry` 可以帮助我们构建 `wgpu::BindGroupEntry`：
```cpp
for (uint32_t i = 0; i < layoutDesc.second.entryCount; i++) {
    auto& entry = layoutDesc.second.entries[i];
    _bindGroupEntries[i].binding = entry.binding;
    if (entry.buffer.type != wgpu::BufferBindingType::Undefined) {
        _bindingData(_bindGroupEntries[i], material, renderer);
    } else if (entry.texture.sampleType != wgpu::TextureSampleType::Undefined ||
               entry.storageTexture.access != wgpu::StorageTextureAccess::Undefined) {
        _bindingTexture(_bindGroupEntries[i], material, renderer);
    } else if (entry.sampler.type != wgpu::SamplerBindingType::Undefined) {
        _bindingSampler(_bindGroupEntries[i], material, renderer);
    }
}
```

### 渲染管线状态
`wgpu::RenderPipeline` 通过 `wgpu::RenderPipelineDescriptor` 进行构建：
```cpp
struct RenderPipelineDescriptor {
    ChainedStruct const * nextInChain = nullptr;
    char const * label = nullptr;
    PipelineLayout layout = nullptr;
    VertexState vertex;
    PrimitiveState primitive;
    DepthStencilState const * depthStencil = nullptr;
    MultisampleState multisample;
    FragmentState const * fragment = nullptr;
};
```
从这个结构体可以看出有部分属性是可选的，这些属性基本上分成三类：
1. `wgpu::VertexState` 和 `wgpu::FragmentState` 和着色器程序 `wgpu::ShaderModule` 相关联。
2. `wgpu::PipelineLayout` 需要使用上一小节的 `wgpu::BindGroupLayout` 进行配置。
3. 剩下的几个属性，我们在介绍 `RenderState` 时也都已经看过了，因此可以通过材质相关的接口进行配置

综上可以有如下代码：
```cpp
_pipelineLayoutDescriptor.bindGroupLayoutCount = static_cast<uint32_t>(bindGroupLayouts.size());
_pipelineLayoutDescriptor.bindGroupLayouts = bindGroupLayouts.data();
_pipelineLayout = _pass->resourceCache().requestPipelineLayout(_pipelineLayoutDescriptor);
_forwardPipelineDescriptor.layout = _pipelineLayout;

material->renderState.apply(&_colorTargetState, &_depthStencil,
                            _forwardPipelineDescriptor, passEncoder, true);

_forwardPipelineDescriptor.vertex.bufferCount = static_cast<uint32_t>(mesh->vertexBufferLayouts().size());
_forwardPipelineDescriptor.vertex.buffers = mesh->vertexBufferLayouts().data();
_forwardPipelineDescriptor.primitive.topology = subMesh->topology();

auto renderPipeline = _pass->resourceCache().requestRenderPipeline(_forwardPipelineDescriptor);
```

## 总结
WebGPU 的一系列比较容易令人感到混淆，但其实最关键的是找到关键类型，顺着构造这些类型对象所需要的信息，逐渐就可以理清他们之间的关系。
在 Arche 当中，通过用户侧的材质系统，以及背后的着色器数据，着色器宏，将一系列复杂概念重新封装成更加容易理解的概念。
通过 `WGSLEncoder` 自动构造某些对象，记录资源之间的关系；结合 `ResourceCache` 将相关资源缓存下来，最终构建出上述保持灵活性的同时，兼具运行时性能的正向渲染管线。
