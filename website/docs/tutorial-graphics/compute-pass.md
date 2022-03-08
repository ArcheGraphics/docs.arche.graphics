---
sidebar_position: 16
---

# 计算通道

在完成了一系列渲染上的架构设计，我们后续遇到的问题，包括Forward+，粒子系统，GPU布料，PBR预计算，都需要用到计算着色器。 因此，需要对计算着色器做一个比较完整的封装，使得计算的部分可以很容易与渲染结合起来，并且对于一些"纯计算"
应用，也能很容易进行配置。 为了满足计算着色器通用化的需求，因此引擎不能对其做特别复杂的封装，但是基础的结构还是要有，例如管线缓存，反射，自动绑定数据等之前介绍过的内容。 之前的这些工具也都可以很容扩展使得支持计算着色器的使用。

事实上，在 WebGPU 当中，`wgpu::ComputePassEncoder` 和 `wgpu::RenderPassEncoder` 是平级的关系，这使得我在一开始设计的时候，构造了计算子通道，和 `Subpass` 对应起来。
但我后来发现，这意味着计算着色器必须依附于 `RenderPass`，而这一对象是需要 `wgpu::RenderPassDescriptor` 进行构造的。对于那些"纯计算"的应用，这显然并不合适。
因此，我将计算子通道提升为计算通道 `ComputePass` 使之与 `RenderPass` 平级，并且将一系列功能都封装到一个类型当中。
**如果说对于渲染，我希望用户能够构造 `Subpass` 的子类；那么对于计算，我只希望用户关心着色器代码本身。**

在 `ComputePass` 中，核心的接口只有以下几个：

```cpp
class ComputePass {
public:      
    ComputePass(wgpu::Device& device, WGSLPtr&& source);

    uint32_t workgroupCountX() const;

    uint32_t workgroupCountY() const;

    uint32_t workgroupCountZ() const;
    
    void setDispatchCount(uint32_t workgroupCountX,
                          uint32_t workgroupCountY = 1,
                          uint32_t workgroupCountZ = 1);
    
    void attachShaderData(ShaderData* data);
    
    void detachShaderData(ShaderData* data);
    
    /**
     * @brief Compute virtual function
     * @param commandEncoder CommandEncoder to use to record compute commands
     */
    virtual void compute(wgpu::ComputePassEncoder &commandEncoder);
};
```

为了让数据绑定变得更具一般性，`ComputePass`只需要记录`ShaderData` 的指针，而不关心他到底来自 `Scene`， `Camera` 还是别的 `ShaderData` 对象。 所以在绑定时，只会遍历所有的着色器数据：

```cpp
void ComputePass::_bindingData(wgpu::BindGroupEntry& entry) {
    for (auto shaderData : _data) {
        auto buffer = shaderData->getData(entry.binding);
        if (buffer) {
            entry.buffer = buffer->handle();
            entry.size = buffer->size();
            break;
        }
    }
}
```

## 着色器数据扩展

为了使得着色器对象在支持计算着色器时由更强的灵活性，例如，在一些模拟场景中，往往会使用双缓存策略，即对于一个 `ShaderProperty` 会在主循环中不断变更自己所绑定的数据。 因此，在着色器数据当中增加了仿函数的接口：

```cpp
std::optional<Buffer> ShaderData::getData(uint32_t uniqueID) {
    auto iter = _shaderBuffers.find(uniqueID);
    if (iter != _shaderBuffers.end()) {
        return iter->second;
    }
    
    auto functorIter = _shaderBufferFunctors.find(uniqueID);
    if (functorIter != _shaderBufferFunctors.end()) {
        return functorIter->second();
    }
    
    return std::nullopt;
}

void ShaderData::setBufferFunctor(const std::string &property_name,
                                  std::function<Buffer()> functor) {
    auto property = Shader::getPropertyByName(property_name);
    if (property.has_value()) {
        setBufferFunctor(property.value(), functor);
    } else {
        assert(false && "can't find property");
    }
}
```

使用这一接口可以很容易实现双缓存策略：

```cpp title="particle/particle.cpp"
shaderData.setBufferFunctor(_writeAtomicBufferProp, [this]()->Buffer {
    return *_atomicBuffer[_write];
});
```

## 原子计数器

计算着色器可以实现非常通用的 GPU 计算，由于 GPU 在 `thread-group` 中的计算是并行且共享内存的，因此需要同步策略。具体的GPU计算比较复杂，这里不做展开。
为了体验引擎中的计算着色器的效果，这里展示一个基于原子计数的操作。正如上面所说，用户只需要关心计算着色器代码本身即可，因此这里构造一个着色器编码类型：

```cpp
class WGSLAtomicCompute : public WGSLCache {
public:
    WGSLAtomicCompute() {}
    
private:
    void _createShaderSource(size_t hash, const ShaderMacroCollection& macros) override {
        _source.clear();
        _bindGroupInfo.clear();
        {
            auto encoder = createSourceEncoder(wgpu::ShaderStage::Compute);
            encoder.addStruct("struct Counter {\n"
                              "counter: atomic<u32>;\n"
                              "}\n");
            encoder.addStorageBufferBinding("u_atomic", "Counter", false);
            
            encoder.addEntry({2, 2, 2}, [&](std::string &source){
                // source += "atomicStore(&u_atomic.counter, 0u);\n";
                // source += "storageBarrier();\n";
                source += "atomicAdd(&u_atomic.counter, 1u);\n";
            });
            encoder.flush();
        }
        _sourceCache[hash] = _source;
        _infoCache[hash] = _bindGroupInfo;
    }
};
```

这个着色器的唯一工作就是调用 `atomicAdd` 加一，为了可视化计算结果，我们用计算得到的数值用于渲染：
```cpp
encoder.addEntry({{"in", "VertexOut"}}, {"out", "Output"},  [&](std::string &source){
    source += "var counter:f32 = f32(u_atomic % 255u);\n";
    source += "out.finalColor = vec4<f32>(counter / 255.0, 1.0 - counter / 255.0, counter / 255.0, 1.0);\n";
});
```
每次运行时，值会增加 8 ，然后物体的颜色随之发生改变。有兴趣的读者可以尝试一下不使用原子操作，颜色变化的速度会明显减慢。我们在后续 Forward+ 和粒子系统中，还会看到原子计数器的使用。
