---
sidebar_position: 7
---

# WGSL Encoder

`WGSLEncoder` is a solution proposed by the engine to deal with many problems with the current WGSL shader code. Several
problems were encountered during the development of the Arche project:

1. WGSL does not support `#define`, the `@override` keyword proposed in the standard is not currently available.
2. The WGSL reflection tool cannot reflect the information of `Binding`. Use `tint::inspector::Inspector` to achieve
   shader reflection, but there is no name of `Binding`, so you cannot directly search `ShaderData` by name data stored
   in.
3. WGSL does not support `#include`, so modular reuse cannot be achieved.

In addition, the syntax of WGSL itself is relatively complex, and there is currently a lack of a better editor
environment, so I hope to provide a set of coding tools that can solve the above problems and improve the experience of
writing WGSL.

In fact, the WGSL toolchain has three levels of concepts:

1. `WGSLEncoder` encapsulates standard shader statements, which are low-level encapsulation and improve the ease of use
   of encoding
2. `WGSL Functor` encapsulates a series of modular functors
3. `WGSL` combines functors for full shader functionality

## WGSLEncoder

The WGSL encoder encapsulates the hand-written WGSL code into a series of functions, some of which accept strings
directly, and some only expose specific parameter interfaces. These functions aggregate all the information and, while
assembling the final code, record the list of resources used by the shader, e.g. for UniformBuffer:

```cpp
void WGSLEncoder::addUniformBinding(const std::string& uniformName,
                                    UniformType type, uint32_t group) {
    addUniformBinding(uniformName, toString(type), group);
}

void WGSLEncoder::addUniformBinding(const std::string& uniformName,
                                    const std::string& type, uint32_t group) {
    auto property = Shader::getPropertyByName(uniformName);
    if (property.has_value()) {
        addUniformBinding(uniformName, type, property.value().uniqueId, group);
    } else {
        assert(false && "Unknown Uniform Name");
    }
}

void WGSLEncoder::addUniformBinding(const std::string& uniformName, const std::string& type,
                                    uint32_t binding, uint32_t group) {
    const std::string formatTemplate = "@group({}) @binding({})\n "
    "var<uniform> {}: {};\n ";
    
    _uniformBlock += fmt::format(formatTemplate, group, binding,
                                 uniformName, type);
    
    wgpu::BindGroupLayoutEntry entry;
    entry.binding = binding;
    entry.visibility = _currentStage;
    entry.buffer.type = wgpu::BufferBindingType::Uniform;
    auto iter = _bindGroupLayoutEntryMap.find(group);
    if (iter == _bindGroupLayoutEntryMap.end()) {
        _bindGroupLayoutEntryMap[group][binding] = entry;
    } else {
        auto entryIter = _bindGroupLayoutEntryMap[group].find(binding);
        if (entryIter == _bindGroupLayoutEntryMap[group].end()) {
            _bindGroupLayoutEntryMap[group][binding] = entry;
        }
    }
    _bindGroupInfo[group].insert(binding);
    _needFlush = true;
}
```

Of the three overloaded functions, the first is the simplest, using the enum `UniformType` to directly set simple types,
for example:

````cpp
enum class UniformType {
     F32,
     I32,
     U32,
    
     Vec2f32,
     Vec2i32,
     Vec2u32,
    
     ...
}
````

These types are converted to the corresponding WGSL syntax using the `toString` function. At the same time, it can be
seen that if `addUniformBinding` is called, it means that the shader uses a certain UniformBuffer, that is, the
corresponding resource needs to be bound. Therefore, the function also constructs `wgpu::BindGroupLayoutEntry` and
stores it in a hash table keyed by `group` and `binding`.

## WGSL Functor

Functors are used to implement modular WGSL code and can record specific code to `WGSLEncoder` based on shader macros,
for example:

```cpp
void WGSLCommonVert::operator()(WGSLEncoder& encoder, const ShaderMacroCollection& macros) {
    encoder.addInoutType(_inputStructName, Attributes::Position, UniformType::Vec3f32);
    if (macros.contains(HAS_UV)) {
        encoder.addInoutType(_inputStructName, Attributes::UV_0, UniformType::Vec2f32);
    }
    
    if (macros.contains(HAS_SKIN)) {
        encoder.addInoutType(_inputStructName, Attributes::Joints_0, UniformType::Vec4f32);
        encoder.addInoutType(_inputStructName, Attributes::Weights_0, UniformType::Vec4f32);
        if (macros.contains(HAS_JOINT_TEXTURE)) {
            // TODO
        } else {
            auto num = macros.macroConstant(JOINTS_COUNT);
            if (num.has_value()) {
                auto formatTemplate = "array<mat4x4<f32>, {}>";
                encoder.addUniformBinding("u_jointMatrix", fmt::format(formatTemplate, (int)*num));
            }
        }
    }
    
    ...
}
```

These codes judge whether to call the specific function of the encoder to record according to the macro. This method can
not only realize flexible recording, but also can be combined with each other. The above code is mainly based on `Mesh`
The feature of generating the structure of the input shader, different meshes can generate different codes. Therefore,
almost any shader application can reuse this functor to achieve the same functionality.

## WGSL Assembly

`WGSL` receives the final code generated by `WGSLEncoder`, while `WGSLCache` caches the final shader code based on
shader macros:

````cpp
std::pair<const std::string&, const WGSL::BindGroupInfo&>
WGSLCache::compile(const ShaderMacroCollection& macros) {
    size_t hash = macros.hash();
    auto iter = _sourceCache.find(hash);
    if (iter == _sourceCache.end()) {
        _createShaderSource(hash, macros);
    }
    return {_sourceCache[hash], _infoCache[hash]};
}
````

:::note

The way macros are stored in `ShaderMacroCollection` uses a red-black tree-based `std::map`, which ensures that the
macros are arranged in order, and the hash values of all macros cannot be calculated if they are out of order.
:::
Taking `WGSLUnlitVertex` as an example, you first need to declare a series of resources used by the shader `Entry`, and
then start from `addEntry` to write the code inside the main function:

```cpp
void WGSLUnlitVertex::_createShaderSource(size_t hash, const ShaderMacroCollection& macros) {
    _source.clear();
    _bindGroupInfo.clear();
    auto inputStructCounter = WGSLEncoder::startCounter();
    auto outputStructCounter = WGSLEncoder::startCounter(0);
    {
        auto encoder = createSourceEncoder(wgpu::ShaderStage::Vertex);
        _commonVert(encoder, macros);
        _blendShapeInput(encoder, macros, inputStructCounter);
        _uvShare(encoder, macros, outputStructCounter);
        encoder.addInoutType("VertexOut", BuiltInType::Position, "position", UniformType::Vec4f32);

        encoder.addEntry({{"in", "VertexIn"}}, {"out", "VertexOut"}, [&](std::string &source){
            _beginPositionVert(source, macros);
            _blendShapeVert(source, macros);
            _skinningVert(source, macros);
            _uvVert(source, macros);
            _positionVert(source, macros);
        });
        encoder.flush();
    }
    WGSLEncoder::endCounter(inputStructCounter);
    WGSLEncoder::endCounter(outputStructCounter);
    _sourceCache[hash] = _source;
    _infoCache[hash] = _bindGroupInfo;
}
````

Note that the `addEntry` of the encoder specially selects the form of an anonymous function to record the code inside
the function body, making the coding experience close to the experience of directly writing shaders.
:::tip

For shader structs, `@location` needs to be set, each of which requires an indicator:

````wgsl
struct VertexOut {
     @location(0) v_uv: vec2<f32>;
     @builtin(position) position: vec4<f32>;
}
````

`WGSLEncoder` provides counter tools for this:

````cpp
static size_t startCounter(uint32_t initVal = (uint32_t)Attributes::TOTAL_COUNT);

static uint32_t getCounterNumber(size_t index);

static void endCounter(size_t index);
````

:::
These counters can be passed to the corresponding functor, and the order of 0, 1, 2... is automatically encoded in the
order in which `getCounterNumber` is called.

:::caution

For all grid data inside Arche, use the default `Attribute` enumeration type corresponding to the index:

```cpp
enum class Attributes : uint32_t {
    Position = 0,
    Normal,
    UV_0,
    Tangent,
    Bitangent,
    Color_0,
    Weights_0,
    Joints_0,
    UV_1,
    UV_2,
    UV_3,
    UV_4,
    UV_5,
    UV_6,
    UV_7,
    TOTAL_COUNT
};
```

Therefore, without using the counter tool provided by `WGSLEncoder`, you can directly use this enumeration type to set
the corresponding indicator. Otherwise, the mesh data is inconsistent with the code description in the shader, which
will cause the rendering pipeline to report an error.
:::

## Practice in Arche.js

TypeScript can directly combine strings into types, and the types are equivalent to strings, so for
example, `UniformType` does not need to define an additional `toString` function to convert it into a string, but can
directly colorize The generator syntax is encoded into a type:

```ts
export type UniformType =
    "f32"
    | "i32"
    | "u32"
    | "vec2<f32>"
    | "vec2<i32>"
    | "vec2<u32>"
    | "vec3<f32>"
    | "vec3<i32>"
    | "vec3<u32>"
    | "vec4<f32>"
    | "vec4<i32>"
    | "vec4<u32>"
    | "mat2x2<f32>"
    | "mat3x2<f32>"
    | "mat4x2<f32>"
    | "mat2x3<f32>"
    | "mat3x3<f32>"
    | "mat4x3<f32>"
    | "mat2x4<f32>"
    | "mat3x4<f32>"
    | "mat4x4<f32>";
```

The functor code written in this way is closer to the WGSL way of coding:

```ts
encoder.addUniformBinding("u_tilingOffset", "vec4<f32>", 0);
```

