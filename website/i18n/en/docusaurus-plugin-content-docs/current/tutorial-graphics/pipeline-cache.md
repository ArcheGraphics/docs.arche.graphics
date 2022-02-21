---
sidebar_position: 9
---

# Resource Cache

As mentioned in the chapter on shader programs, since compiling shader code is time-consuming and does not necessarily
compile every frame, it is cached based on the string of shader code. In fact, not only `wgpu::ShaderModule` needs
caching, but also a series of WebGPU Objects need to be cached in exchange for runtime performance:

````cpp
/**
 * @brief Struct to hold the internal state of the Resource Cache
 *
 */
struct ResourceCacheState {
    std::unordered_map<std::size_t, wgpu::BindGroupLayout> bindGroupLayouts;
    std::unordered_map<std::size_t, wgpu::PipelineLayout> pipelineLayouts;
    std::unordered_map<std::size_t, wgpu::RenderPipeline> renderPipelines;
    std::unordered_map<std::size_t, wgpu::BindGroup> bindGroups;
    
    std::unordered_map<std::size_t, std::unique_ptr<ShaderProgram>> shaders;
};
````

:::note

Among them, caching `wgpu::RenderPipeline` is the most necessary, because this object represents the underlying graphics
API according to the associated configuration in `wgpu::RenderPipelineDescriptor` (almost all the configuration items of
the rendering pipeline), The optimal GPU configuration state is generated, and when this object is recorded to the
rendering pipeline, it actually only takes a memory copy time.

:::

## Hash

Unlike `ShaderProgram`, which uses the string of shader code for caching, the other four types have
corresponding `Descriptor` structures, which need to be constructed using the corresponding structures:

```cpp
wgpu::BindGroupLayout &requestBindGroupLayout(wgpu::BindGroupLayoutDescriptor &descriptor);

wgpu::PipelineLayout &requestPipelineLayout(wgpu::PipelineLayoutDescriptor &descriptor);

wgpu::RenderPipeline &requestRenderPipeline(wgpu::RenderPipelineDescriptor &descriptor);

wgpu::BindGroup &requestBindGroup(wgpu::BindGroupDescriptor &descriptor);
```

Therefore, caching these types also needs to be calculated based on these structures. Fortunately, these structs are
used to describe the state of the object, so it is easy to hash the underlying variables and combine the hashes:

````cpp
/**
  * @brief Helper function to combine a given hash
  * with a generated hash for the input param.
  */
template<class T>
inline void hash_combine(size_t &seed, const T &v) {
     std::hash<T> hasher;
     size_t hash = hasher(v);
     hash += 0x9e3779b9 + (seed << 6) + (seed >> 2);
     seed ^= hash;
}
````

The engine declares functors that compute hash values for all relevant types by specializing the `std::hash` template
function, for example:

```cpp
template<>
struct hash<wgpu::RenderPipelineDescriptor> {
    std::size_t operator()(const wgpu::RenderPipelineDescriptor &descriptor) const {
        std::size_t result = 0;
        
        hash_combine(result, descriptor.layout.Get()); // internal address
        hash_combine(result, descriptor.primitive);
        hash_combine(result, descriptor.multisample);
        if (descriptor.depthStencil) {
            hash_combine(result, *descriptor.depthStencil);
        }
        hash_combine(result, descriptor.vertex);
        if (descriptor.fragment) {
            hash_combine(result, *descriptor.fragment);
        }
        
        return result;
    }
};

template<>
struct hash<wgpu::PrimitiveState> {
    std::size_t operator()(const wgpu::PrimitiveState &state) const {
        std::size_t result = 0;
        
        hash_combine(result, state.topology);
        hash_combine(result, state.frontFace);
        hash_combine(result, state.cullMode);
        hash_combine(result, state.stripIndexFormat);

        return result;
    }
};
```

:::tip

Some structures are values and enums, some are indeed pointers, and these objects are generally created
by `wgpu::Device`. To incorporate this information into the hash calculation, the memory address of the object is used
directly, for example:

````cpp
template<>
struct hash<wgpu::VertexState> {
     std::size_t operator()(const wgpu::VertexState &state) const {
         std::size_t result = 0;
        
         hash_combine(result, state.module.Get()); // internal address
         hash_combine(result, state.entryPoint);
         hash_combine(result, state.bufferCount);
         hash_combine(result, state.buffers); // internal address

         return result;
     }
};
````

:::

Starting from the description structure used by the object to be cached, all relevant types are defined as hash
functions, and then the `std::hash` template function can be used to calculate the corresponding hash value:

```cpp
wgpu::RenderPipeline &ResourceCache::requestRenderPipeline(wgpu::RenderPipelineDescriptor &descriptor) {
    std::hash<wgpu::RenderPipelineDescriptor> hasher;
    size_t hash = hasher(descriptor);
    
    auto iter = _state.renderPipelines.find(hash);
    if (iter == _state.renderPipelines.end()) {
        _state.renderPipelines[hash] = _device.CreateRenderPipeline(&descriptor);
        return _state.renderPipelines[hash];
    } else {
        return iter->second;
    }
}
```

## Practice in Arche.js

In the browser, Arche.js does not implement the above caching mechanism, because I found that for the time-consuming
objects like `wgpu::RenderPipeline`, the build time in the browser is almost negligible. Although I have not yet found
relevant information to prove that WebGPU implements a similar caching mechanism inside the browser, but since this
caching mechanism is a common practice in modern graphics APIs, I believe that a similar caching mechanism like object pool may have
been implemented internally.
