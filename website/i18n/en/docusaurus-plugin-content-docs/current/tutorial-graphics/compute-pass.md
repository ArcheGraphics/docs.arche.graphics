---
sidebar_position: 16
---

# Compute Pass

After completing a series of rendering architecture designs, the problems we encountered later, including Forward+,
particle system, GPU cloth, and PBR pre-computation, all require the use of compute shaders. Therefore, it is necessary
to make a relatively complete encapsulation of compute shader, so that the computation part can be easily
combined with rendering, and some "pure computation"
application can be easily configured. In order to meet the requirements of generalization of compute shaders, the
engine cannot do a particularly complex encapsulation of them, but the basic structure still has, such as pipeline
cache, reflection, automatic data binding and so on. These previous tools can also be easily extended to support the use
of compute shaders.

In fact, in WebGPU, `wgpu::ComputePassEncoder` and `wgpu::RenderPassEncoder` are in a level relationship, which makes me
construct a `ComputeSubpass` corresponding to `Subpass` at the beginning of the design. But I later found out
that this meant that the compute shader had to be attached to `RenderPass`, which was constructed
with `wgpu::RenderPassDescriptor`. For those "purely computational" applications, this is obviously not appropriate.
Therefore, I promoted the compute subpass to the compute pass `ComputePass` to make it level with `RenderPass`, and
encapsulated a bunch of functionality into a single type.
**If for rendering, I want the user to be able to subclass `Subpass`; then for computation, I only want the user to care
about the shader code itself. **

In `ComputePass`, the core interfaces are only the following:

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

In order to make data binding more general, `ComputePass` only needs to record the pointer of `ShaderData`, regardless
of whether it comes from `Scene`, `Camera` or another `ShaderData` object. So when binding, it just loops through all
the shader data:

````cpp
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
````

## ShaderData Extension

In order to make the shader object more flexible when supporting compute shaders, for example, in some simulation
scenarios, the double-buffer strategy is often used, that is, for a `ShaderProperty`, it will constantly change its
binding in the main loop The data. Therefore, the interface of the functor is added to the shader data:

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

Using this interface, the double-cache strategy can be easily implemented:

```cpp title="particle/particle.cpp"
shaderData.setBufferFunctor(_writeAtomicBufferProp, [this]()->Buffer {
     return *_atomicBuffer[_write];
});
````

## Atomic Counter

Compute shaders can implement very general GPU computing, since GPU computing in `thread-group` is parallel and shared
memory, so synchronization strategy is required. The synchronization on GPU is very complicated, so it will not be
expanded here. To experience the effects of compute shaders in the engine, here is an atomic count-based operation. As
mentioned above, the user only needs to care about compute shader code itself, so here is a shader encoding type
constructed:

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

The only job of this shader is to call `atomicAdd` to add one. To visualize the result of the calculation, we use the
calculated value for rendering:

````cpp
encoder.addEntry({{"in", "VertexOut"}}, {"out", "Output"}, [&](std::string &source){
     source += "var counter:f32 = f32(u_atomic % 255u);\n";
     source += "out.finalColor = vec4<f32>(counter / 255.0, 1.0 - counter / 255.0, counter / 255.0, 1.0);\n";
});
````

On each run, the value increases by 8 and the color of the object changes accordingly. Interested readers can try not to
use atomic operations, the speed of color change will be significantly slowed down. We will also see the use of atomic
counters in subsequent Forward+ and particle systems.
