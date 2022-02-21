---
sidebar_position: 8
---

# 着色器

介绍了 `ShaderData`，`ShaderMacroCollection`，`WGSLEncoder` 等一系列概念，终于可以将这些汇总到 `Shader`。着色器代表了在 GPU 运行的代码。
在引擎当中，使用 `WGSLPtr` 对其进行构造，或者调用静态方法将其缓存到以名称字符串为键值的哈希表当中：
```cpp
/**
 * Shader containing vertex and fragment source.
 */
class Shader {
public:    
    Shader(const std::string &name, WGSLPtr&& vertexSource, WGSLPtr&& fragmentSource);
    
        /**
     * Create a shader.
     * @param name - Name of the shader
     * @param vertexSource - Vertex source creator
     * @param fragmentSource - Fragment source creator
     */
    static Shader *create(const std::string &name, WGSLPtr&& vertexSource, WGSLPtr&& fragmentSource);
    
    /**
     * Find a shader by name.
     * @param name - Name of the shader
     */
    static Shader *find(const std::string &name);
};
```

对于引擎内部的代码，都在 `ShaderPool` 的静态函数中直接初始化：
```cpp
void ShaderPool::init() {
    Shader::create("unlit", std::make_unique<WGSLUnlitVertex>(), std::make_unique<WGSLUnlitFragment>());
    Shader::create("blinn-phong", std::make_unique<WGSLBlinnPhongVertex>(), std::make_unique<WGSLBlinnPhongFragment>());
    Shader::create("pbr", std::make_unique<WGSLPbrVertex>(), std::make_unique<WGSLPbrFragment>(true));
    Shader::create("pbr-specular", std::make_unique<WGSLPbrVertex>(), std::make_unique<WGSLPbrFragment>(false));
}
```

这样一来，例如 `UnlitMaterial` 只需要索引名为 `unlit` 的着色器即可。

## 融合顶点和片段着色器的附属信息
在 WebGPU 中，GPU 数据的绑定并不区分顶点还是片段着色器，因为 `wgpu::ShaderStage` 属性本身是可以叠加的。
因此，在顶点着色器和片段着色器的 `WGSL` 中分别得到的 `BindGroupLayoutEntryMap`，需要融合到一个哈希表当中，进而可以构造 `wgpu::BindGroupLayoutDescriptor`：
```cpp
const Shader::BindGroupLayoutDescriptorMap& Shader::bindGroupLayoutDescriptors(const ShaderMacroCollection& macros) {
    ...

    for (const auto& entryVec : _bindGroupLayoutEntryVecMap) {
        wgpu::BindGroupLayoutDescriptor desc;
        desc.entryCount = static_cast<uint32_t>(entryVec.second.size());
        desc.entries = entryVec.second.data();
        _bindGroupLayoutDescriptorMap[entryVec.first] = desc;
    }
    return _bindGroupLayoutDescriptorMap;
}
```

## 着色器程序
`Shader` 实际上并不提供任何编译着色器代码的功能，充其量只是串联起顶点和片段着色器的 `WGSL`，并且将附属信息融合起来。
在渲染管线中，需要利用最终获得的顶点着色器和片段着色器的代码字符串，编译成为 `wgpu::ShaderModule`，这就需要使用 `ShaderProgram` 封装的能力：
```cpp
void ShaderProgram::_createProgram(const std::string& vertexSource,
                                   const std::string& fragmentSource) {
    wgpu::ShaderModuleDescriptor desc;
    wgpu::ShaderModuleWGSLDescriptor wgslDesc;
    desc.nextInChain = &wgslDesc;

    wgslDesc.source = vertexSource.c_str();
    _vertexShader = _device.CreateShaderModule(&desc);
    
    wgslDesc.source = fragmentSource.c_str();
    _fragmentShader = _device.CreateShaderModule(&desc);
}
```

在之前的文章中可以看到，`WGSLEncoder` 编译一次着色器代码是比较耗时的，因此需要根据宏的哈希值进行缓存。
同样的，将着色器字符串编译成着色器代码也是比较耗时的，因此在引擎中直接计算着色器字符串的哈希值，然后缓存`ShaderProgram`:
```cpp
ShaderProgram *ResourceCache::requestShader(const std::string &vertexSource,
                                            const std::string &fragmentSource) {
    std::size_t hash{0U};
    hash_combine(hash, std::hash<std::string>{}(vertexSource));
    hash_combine(hash, std::hash<std::string>{}(fragmentSource));
    
    auto iter = _state.shaders.find(hash);
    if (iter == _state.shaders.end()) {
        auto shader = std::make_unique<ShaderProgram>(_device, vertexSource, fragmentSource);
        _state.shaders[hash] = std::move(shader);
        return _state.shaders[hash].get();
    } else {
        return iter->second.get();
    }
}
```

## Arche.js 中的实践
Arche.js 为了尽可能兼容 Oasis-Engine 的架构，在这里采取了更加简单的设计：
```ts
export class Shader {
    /**
     * Compile shader variant by macro name list.
     *
     * @remarks
     * Usually a shader contains some macros,any combination of macros is called shader variant.
     *
     * @param engine - Engine to which the shader variant belongs
     * @param macroCollection - Macro name list
     */
    getShaderProgram(engine: Engine, macroCollection: ShaderMacroCollection): ShaderProgram {
        const shaderProgramPool = engine._getShaderProgramPool(this);
        let shaderProgram = shaderProgramPool.get(macroCollection);
        if (shaderProgram) {
            return shaderProgram;
        }

        // merge info
        const vertexCode = this._vertexSource.compile(macroCollection);
        vertexCode[1].forEach(((bindings, group) => {
            bindings.forEach((binding => {
                if (!this._bindGroupInfo.has(group)) {
                    this._bindGroupInfo.set(group, new Set<number>());
                }
                this._bindGroupInfo.get(group).add(binding);
            }));
        }));
        const fragmentCode = this._fragmentSource.compile(macroCollection);
        fragmentCode[1].forEach(((bindings, group) => {
            bindings.forEach((binding => {
                if (!this._bindGroupInfo.has(group)) {
                    this._bindGroupInfo.set(group, new Set<number>());
                }
                this._bindGroupInfo.get(group).add(binding);
            }));
        }));

        // move to vecMap
        this._bindGroupInfo.forEach(((bindings, group) => {
            bindings.forEach((binding => {
                if (!this._bindGroupLayoutEntryVecMap.has(group)) {
                    this._bindGroupLayoutEntryVecMap.set(group, []);
                }
                this._bindGroupLayoutEntryVecMap.get(group).push(this._findEntry(group, binding));
            }));
        }));

        // generate map
        this._bindGroupLayoutEntryVecMap.forEach(((entries, group) => {
            const desc = new BindGroupLayoutDescriptor();
            desc.entries = entries;
            this._bindGroupLayoutDescriptorMap.set(group, desc);
        }));

        shaderProgram = new ShaderProgram(engine.device, vertexCode[0], fragmentCode[0],
            this._bindGroupLayoutDescriptorMap);
        shaderProgramPool.cache(shaderProgram);
        return shaderProgram;
    }
}
```
在这一函数中，`ShaderProgram` 直接根据 `Shader` 对象的地址和着色器宏，被缓存到 `ShaderProgramPool` 中。
同时，`BindGroupLayoutDescriptorMap` 被保存到 `ShaderProgram` 中，避免下次运行时还需要合并顶点着色器与片段着色器的数据。
