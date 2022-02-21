---
sidebar_position: 7
---

# WGSL 编码器

`WGSLEncoder` 是引擎为了处理目前 WGSL 着色器代码的诸多问题而提出的一种解决方案。在 Arche 项目开发过程中遇到几个问题：

1. WGSL 不支持 `#define`，在标准中提出的 `@override` 关键词当前不可用。
2. WGSL 反射工具无法反射 `Binding` 的信息，使用 `tint::inspector::Inspector` 可以实现着色器反射，但是没有 `Binding` 的名字，因此无法直接通过名字搜索 `ShaderData`
   中存储的数据。
3. WGSL 不支持 `#include`，因此无法做到模块化复用。

除此之外，WGSL 本身的语法是比较复杂的，目前也缺少比较好的编辑器环境，因此希望能够提供一套编码工具，能够在解决上述问题的同时，改善 WGSL 编写的体验。

实际上 WGSL 工具链有三个层次的概念：

1. `WGSLEncoder` 对标准着色器语句进行了封装，属于底层封装，提高编码的易用度
2. WGSL Functor 封装了一系列模块化的仿函数
3. `WGSL` 将仿函数组合起来，实现完整的着色器功能

## WGSLEncoder

WGSL 编码器将手工编写 WGSL 代码封装成一系列函数，这些函数有的直接接受字符串，有的只暴露特定的参数接口。 
这些函数将所有信息汇总起来，并且在拼装最终代码的同时，记录着色器用到的资源列表，例如对于 UniformBuffer：

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

这三个重载函数中，第一个是最为简单的，使用了枚举 `UniformType` 直接设置简单的类型，例如：

```cpp
enum class UniformType {
    F32,
    I32,
    U32,
    
    Vec2f32,
    Vec2i32,
    Vec2u32,
    
    ...
}
```

这些类型通过 `toString` 函数转换成对应的 WGSL 语法。同时还可以看到，如果调用了 `addUniformBinding` 就意味着着色器使用了某种 UniformBuffer，即需要绑定对应的资源。
因此，函数同时构造了 `wgpu::BindGroupLayoutEntry` 将其保存在由 `group` 和 `binding` 作为键值的哈希表当中。

## WGSL 仿函数

仿函数的作用在于实现模块化 WGSL 代码，并且可以根据着色器宏向 `WGSLEncoder` 录制特定的代码，例如：

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

这些代码根据宏判断是否调用编码器的特定函数进行录制，这种方式不仅可以实现灵活录制，而且可以相互组合。 上述代码主要是根据 `Mesh`
的特点生成输入着色器的结构体，不同的网格就可以生成不同的代码。因此，几乎所有着色器应用都可以通过复用这一仿函数以实现相同的功能。

## WGSL 拼装

`WGSL` 接收 `WGSLEncoder` 生成的最终代码，同时 `WGSLCache` 基于着色器宏缓存最终得到的着色器代码：

```cpp
std::pair<const std::string&, const WGSL::BindGroupInfo&> 
WGSLCache::compile(const ShaderMacroCollection& macros) {
    size_t hash = macros.hash();
    auto iter = _sourceCache.find(hash);
    if (iter == _sourceCache.end()) {
        _createShaderSource(hash, macros);
    }
    return {_sourceCache[hash], _infoCache[hash]};
}
```

:::note
`ShaderMacroCollection` 中存储宏的方式使用了基于红黑树的 `std::map` 由此保证了宏是有序排列的，如果无序就无法计算所有宏的哈希值。
:::
以 `WGSLUnlitVertex` 为例，首先需要声明着色器 `Entry` 用到的一系列资源，然后从 `addEntry` 开始编写主函数内部的代码：
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
```
注意到编码器的 `addEntry` 特别选用了匿名函数的形式录制函数体内部的代码，使得编码体验贴近直接编写着色器的体验。
:::tip
对于着色器的结构体，需要设定`@location`，每一项都需要一个指标:
```wgsl
struct VertexOut {
    @location(0) v_uv: vec2<f32>;
    @builtin(position) position: vec4<f32>;
}
```
为此 `WGSLEncoder` 提供了计数器工具：
```cpp
static size_t startCounter(uint32_t initVal = (uint32_t)Attributes::TOTAL_COUNT);

static uint32_t getCounterNumber(size_t index);

static void endCounter(size_t index);
```
:::
这些计数器可以传送给对应的仿函数，并且按照调用 `getCounterNumber` 的顺序自动编码0，1，2...的顺序。

:::caution
在 Arche 内部的所有网格数据，使用默认的 `Attribute` 枚举类型对应的指标：
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
因此无需使用 `WGSLEncoder` 提供的计数器工具，直接使用该枚举类型，就可以设定对应的指标。否则网格数据和着色器中代码描述不一致，会导致渲染管线报错。
:::

## Arche.js 中的实践

TypeScript 可以直接将字符串组合成类型，并且该类型和字符串等价，这样一来例如 `UniformType` 都不需要再额外定义一个 `toString` 函数将其转换成字符串，而是可以直接将着色器语法编码成类型：

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

这么一来编写的仿函数代码更加贴近 WGSL 的编码方式：

```ts
encoder.addUniformBinding("u_tilingOffset", "vec4<f32>", 0);
```

