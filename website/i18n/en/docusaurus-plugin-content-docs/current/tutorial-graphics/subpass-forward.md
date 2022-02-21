---
sidebar_position: 10
---

# Render Subpass: Forward Rendering

The rendering sub-pass based on forward rendering is the core rendering code of the Arche engine, using the capabilities
of `ResourceCache`, `WGSLEncoder` and other aspects introduced earlier. Therefore, the pipeline can maintain the desired
flexibility while achieving high-performance runtime rendering. For various forms of `Mesh`, `Material` and `Shader`,
data and pipeline binding can be automatically performed. Certainly.

## Prepare the Render Queue

At the beginning of rendering, the scene is first culled by calling `ComponentManager::callRenderer`, and all renderable
objects are integrated into a queue:

````cpp
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
````

:::tip
`opaqueQueue` represents opaque objects, and `alphaTestQueue` represents objects that use alphaTest technology. The way
these objects handle transparency in the shader is to directly `discard` unnecessary fragments.
Finally `transparentQueue` represents the object that uses the transparency channel. For transparent objects, since
depth map writing is turned off, it needs to be sorted.
:::

## Record Rendering Pass Commands

Actually interacting directly with `wgpu::RenderPassEncoder` is not very much:

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

As you can see from this simplified code, there are actually only five directly associated
with `wgpu::RenderPassEncoder`:

1. Bind `wgpu::BindGroup` with shader resources
2. Bind the `wgpu::RenderPipeline` that configures the rendering pipeline state
3. Bind mesh vertex data `wgpu::Buffer`
4. Bind the mesh vertex index `wgpu::Buffer`
5. Draw each vertex index `DrawIndexed`

### Binding Shader Resources

The construction of `wgpu::BindGroup` requires `wgpu::BindGroupDescriptor`:

````cpp
struct BindGroupDescriptor {
     ChainedStruct const * nextInChain = nullptr;
     char const * label = nullptr;
     BindGroupLayout layout;
     uint32_t entryCount;
     BindGroupEntry const * entries;
};
````

Where `wgpu::BindGroupLayout` needs to be constructed by `wgpu::BindGroupLayoutDescriptor`. This structure has been
introduced in the previous article, which is constructed by `Shader` after integrating the auxiliary information of
vertex shader and fragment shader. Next, focus on `wgpu::BindGroupEntry`:

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

There is also a `binding` property, which corresponds to a `ShaderProperty`. The rest of the properties are basically
one-to-one correspondence, `Buffer`, `TextureView`, `Sampler` and so on. The main difference is
that `wgpu::BindGroupEntry` binds handles to these resources, while `wgpu::BindGroupLayoutEntry` just describes the
data. Therefore, the `wgpu::BindGroupLayoutEntry` obtained from the `Shader` can help us construct
the `wgpu::BindGroupEntry`:

````cpp
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
````

### Render Pipeline Status

`wgpu::RenderPipeline` is constructed from `wgpu::RenderPipelineDescriptor`:

````cpp
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
````

It can be seen from this structure that some attributes are optional, and these attributes are basically divided into
three categories:

1. `wgpu::VertexState` and `wgpu::FragmentState` are associated with the shader program `wgpu::ShaderModule`.
2. `wgpu::PipelineLayout` needs to be configured using `wgpu::BindGroupLayout` in the previous section.
3. We have already seen the remaining properties when we introduced `RenderState`, so they can be configured through
   material-related interfaces

In summary, you can have the following code:

````cpp
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
````

## Summarize

The series of WebGPU can be confusing, but in fact, the most important thing is to find the key types, and follow the
information required to construct these types of objects, and gradually clarify the relationship between them. In Arche,
a series of complex concepts are repackaged into more understandable concepts through the user-side material system, as
well as the shader data and shader macros behind it. Automatically construct some objects through `WGSLEncoder` to
record the relationship between resources; combine with `ResourceCache` to cache related resources, and finally build
the above-mentioned forward rendering pipeline that maintains flexibility and has runtime performance.
