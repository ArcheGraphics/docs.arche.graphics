---
sidebar_position: 8
---

# Shader

Introduced a series of concepts such as `ShaderData`, `ShaderMacroCollection`, `WGSLEncoder`, and finally these can be
summarized into `Shader`. Shaders represent code that runs on the GPU. In the engine, construct it using `WGSLPtr`, or
call a static method to cache it in a hash table keyed by name strings:

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

For the code inside the engine, it is directly initialized in the static function of `ShaderPool`:

````cpp
void ShaderPool::init() {
    Shader::create("unlit", std::make_unique<WGSLUnlitVertex>(), std::make_unique<WGSLUnlitFragment>());
    Shader::create("blinn-phong", std::make_unique<WGSLBlinnPhongVertex>(), std::make_unique<WGSLBlinnPhongFragment>());
    Shader::create("pbr", std::make_unique<WGSLPbrVertex>(), std::make_unique<WGSLPbrFragment>(true));
    Shader::create("pbr-specular", std::make_unique<WGSLPbrVertex>(), std::make_unique<WGSLPbrFragment>(false));
}
````

This way, for example `UnlitMaterial` only needs to index the shader named `unlit`.

## Auxiliary Information for Fused Vertex and Fragment Shaders

In WebGPU, the binding of GPU data does not distinguish between vertex and fragment shaders, because
the `wgpu::ShaderStage` property itself is stackable. Therefore, the `BindGroupLayoutEntryMap` obtained in the `WGSL` of
the vertex shader and fragment shader, respectively, needs to be merged into a hash table, and then
a `wgpu::BindGroupLayoutDescriptor` can be constructed:

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

## Shader Program

`Shader` doesn't actually provide any functionality for compiling shader code, at best it just concatenates `WGSL` of
vertex and fragment shaders, and fuses auxiliary information. In the rendering pipeline, it is necessary to use the
final obtained vertex shader and fragment shader code strings to compile into `wgpu::ShaderModule`, which requires the
ability to use `ShaderProgram` encapsulation:

````cpp
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
````

As you can see in the previous article, `WGSLEncoder` is time-consuming to compile the shader code once, so it needs to
be cached according to the hash value of the macro. Similarly, compiling shader strings into shader code is
time-consuming, so the hash value of the shader string is calculated directly in the engine, and then
the `ShaderProgram` is cached:

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

## Practice in Arche.js

In order to be as compatible as possible with the Oasis-Engine architecture, Arche.js adopts a simpler design here:

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

In this function, `ShaderProgram` is cached into `ShaderProgramPool` directly based on the address of the `Shader`
object and shader macros. At the same time, `BindGroupLayoutDescriptorMap` is saved to `ShaderProgram`, to avoid the
need to merge vertex shader and fragment shader data in the next run.
