---
sidebar_position: 9
---

# 管线状态缓存

在着色器程序的章节中曾经介绍过，由于编译着色器代码比较耗时且没必要每一帧都进行编译，因此基于着色器代码的字符串进行缓存。实际上，不仅是 `wgpu::ShaderModule` 需要缓存，还有一系列 WebGPU
对象需要进行缓存，以换取运行时的性能：

```cpp
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
```

:::note

其中缓存 `wgpu::RenderPipeline` 是最具必要性的，因为这个对象表示底层的图形 API 根据 `wgpu::RenderPipelineDescriptor` 中关联的配置（几乎涉及所有渲染管线的配置项），
生成了最优的 GPU 配置状态，在这一对象录制到渲染管线时，实际却只耗费一段内存拷贝的时间。

:::

## 哈希
和 `ShaderProgram` 利用着色器代码的字符串进行缓存不同，其余四种类型都有对应的 `Descriptor` 结构体，需要使用对应的结构体进行构造：
```cpp
wgpu::BindGroupLayout &requestBindGroupLayout(wgpu::BindGroupLayoutDescriptor &descriptor);

wgpu::PipelineLayout &requestPipelineLayout(wgpu::PipelineLayoutDescriptor &descriptor);

wgpu::RenderPipeline &requestRenderPipeline(wgpu::RenderPipelineDescriptor &descriptor);

wgpu::BindGroup &requestBindGroup(wgpu::BindGroupDescriptor &descriptor);
```
因此，缓存这些类型也需要基于这些结构体进行计算。好在这些结构体都是用来描述该对象的状态，因此很容易对基础变量计算哈希值，然后将这些哈希值合并起来：
```cpp
/**
 * @brief Helper function to combine a given hash
 *        with a generated hash for the input param.
 */
template<class T>
inline void hash_combine(size_t &seed, const T &v) {
    std::hash<T> hasher;
    size_t hash = hasher(v);
    hash += 0x9e3779b9 + (seed << 6) + (seed >> 2);
    seed ^= hash;
}
```

引擎通过特化 `std::hash` 模板函数为所有相关类型声明了计算哈希值的仿函数，例如：
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
结构体中有些是数值和枚举，有些确是指针，并且这些对象一般都是由 `wgpu::Device` 创建的。
为了将这些信息纳入到哈希计算中，于是直接使用对象的内存地址，例如：
```cpp
template<>
struct hash<wgpu::VertexState> {
    std::size_t operator()(const wgpu::VertexState &state) const {
        std::size_t result = 0;
        
        hash_combine(result, state.module.Get());  // internal address
        hash_combine(result, state.entryPoint);
        hash_combine(result, state.bufferCount);
        hash_combine(result, state.buffers);  // internal address

        return result;
    }
};
```
:::

从需要缓存的对象所使用的描述结构体出发，将相关的类型全部定义哈希函数，就可以最终使用`std::hash` 模板函数计算对应的哈希值：
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
