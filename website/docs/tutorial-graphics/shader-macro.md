---
sidebar_position: 5
---

# 着色器宏

如果说 `ShaderData` 串联了用户侧的资源组件和渲染侧的`Subpass`，那么`ShaderMacroCollection` 则串联了用户侧的资源组件和渲染侧的`WGSLEncoder`。 WGSL
编码器根据宏来判断是否需要生成特定的着色器片段，例如：

```cpp
void WGSLWorldPosShare::operator()(WGSLEncoder& encoder,
                                   const ShaderMacroCollection& macros, size_t counterIndex) {
    if (macros.contains(NEED_WORLDPOS)) {
        encoder.addInoutType(_outputStructName, WGSLEncoder::getCounterNumber(counterIndex),
                             "v_pos", UniformType::Vec3f32);
    }
}
```

宏由 `ShaderMacroCollection` 进行管理，本质就是一个 map：

```cpp
std::map<size_t, double> _value{};
```

:::note

实际上宏是对 `wgpu::ConstantEntry` 的一种模拟：

```cpp
struct ConstantEntry {
    ChainedStruct const * nextInChain = nullptr;
    char const * key;
    double value;
};
```

但是一方面目前 `wgpu::ConstantEntry` 还不可用，另外一方面对于例如结构体可选变量之类的场景，`wgpu::ConstantEntry` 无法像 MSL 一样发挥作用。更重要的是，结合宏和 `WGSLEncoder`
也可以在构造着色器代码的时候，直接拿到一些数据绑定的反射信息，例如 `wgpu::BindGroupLayoutEntry`，这样一来不需要额外的反射工具就能够搭建灵活的渲染管线。
:::

map 当中存储了键值和一个 `double` 类型的数据，实际上宏只有两种，**布尔宏**和**变量宏**。大多数宏只是一个`true` 或者 `false` 的开关，因此有两类实现：
```cpp
void ShaderMacroCollection::enableMacro(const std::string& macroName) {
    _value.insert(std::make_pair(std::hash<std::string>{}(macroName), 1));
}

void ShaderMacroCollection::enableMacro(const std::string& macroName, double value) {
    _value.insert(std::make_pair(std::hash<std::string>{}(macroName), value));
}
```

## 合并顺序
宏主要存在于四种类型：`Scene`， `Camera`， `Renderer`， `Material`，对应于：
```cpp
/**
 * Shader data grouping.
 */
enum class ShaderDataGroup {
    /** Scene group. */
    Scene,
    /** Camera group. */
    Camera,
    /** Renderer group. */
    Renderer,
    /** material group. */
    Material
};
```
首先 `Scene` 当中保存的 `LightManager` 会将光源数量合并到 `Scene` 的宏当中：
```cpp
void LightManager::updateShaderData(wgpu::Device& device, ShaderData &shaderData) {
    ...
    if (directLightCount) {
        shaderData.enableMacro(DIRECT_LIGHT_COUNT, directLightCount);
        shaderData.setData(LightManager::_directLightProperty, _directLightDatas);
    } else {
        shaderData.disableMacro(DIRECT_LIGHT_COUNT);
    }
    
    if (pointLightCount) {
        shaderData.enableMacro(POINT_LIGHT_COUNT, pointLightCount);
        shaderData.setData(LightManager::_pointLightProperty, _pointLightDatas);
    } else {
        shaderData.disableMacro(POINT_LIGHT_COUNT);
    }
    
    if (spotLightCount) {
        shaderData.enableMacro(SPOT_LIGHT_COUNT, spotLightCount);
        shaderData.setData(LightManager::_spotLightProperty, _spotLightDatas);
    } else {
        shaderData.disableMacro(SPOT_LIGHT_COUNT);
    }
}
```

接着在 `ForwardSubpass` 中会合并 `Scene` 和 `Camera` 当中的宏：
```cpp
void ForwardSubpass::_drawMeshes(wgpu::RenderPassEncoder &passEncoder) {
    auto compileMacros = ShaderMacroCollection();
    _scene->shaderData.mergeMacro(compileMacros, compileMacros);
    _camera->shaderData.mergeMacro(compileMacros, compileMacros);
    
    ...
}
```

最后在循环 `RenerElement` 时，会将 `Material` 和 `Renderer` 的宏合并进来：
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
        
        ...
    }
}
```

得到的宏会被发送给 `Shader` 用来查找缓存或者生成新的着色器代码：
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

## 内部宏
为了在编写 `WGSLEncoder` 时更加方便，以及方便开发者使用宏，字符串形式的宏并不是特别方便，因此将内置宏收拢到一个枚举类型当中，例如：
```cpp title="shader/internal_macro_name.h"
// int have no verb, other will use:
// HAS_ : Resouce
// OMMIT_ : Omit Resouce
// NEED_ : Shader Operation
// IS_ : Shader control flow
// _COUNT: type int constant
enum MacroName {
    HAS_UV = 0,
    HAS_NORMAL,
    HAS_TANGENT,
    HAS_VERTEXCOLOR,
    
    // Blend Shape
    HAS_BLENDSHAPE,
    HAS_BLENDSHAPE_TEXTURE,
    HAS_BLENDSHAPE_NORMAL,
    HAS_BLENDSHAPE_TANGENT,
    
    // Skin
    HAS_SKIN,
    HAS_JOINT_TEXTURE,
    JOINTS_COUNT,
    
    ...
}
```
并且在 `ShaderMacroCollection` 中将其转换成字符串生成的哈希值，作为宏 map 的键值：
```cpp
std::vector<size_t> ShaderMacroCollection::_internalMacroHashValue = {
    std::hash<std::string>{}("HAS_UV"),
    std::hash<std::string>{}("HAS_NORMAL"),
    std::hash<std::string>{}("HAS_TANGENT"),
    std::hash<std::string>{}("HAS_VERTEXCOLOR"),
    
    // Blend Shape
    std::hash<std::string>{}("HAS_BLENDSHAPE"),
    std::hash<std::string>{}("HAS_BLENDSHAPE_TEXTURE"),
    std::hash<std::string>{}("HAS_BLENDSHAPE_NORMAL"),
    std::hash<std::string>{}("HAS_BLENDSHAPE_TANGENT"),
    
    // Skin
    std::hash<std::string>{}("HAS_SKIN"),
    std::hash<std::string>{}("HAS_JOINT_TEXTURE"),
    std::hash<std::string>{}("JOINTS_COUNT"),
    
    ...
}
```

## Arche.js 中的实践
Arche.js 中宏的配置和上述类似，但是为了兼容 [Oasis Engine](https://github.com/oasis-engine/engine) 中的宏因此所区别。
首先宏名并不是直接通过 map 存储在 `ShaderMacroCollection` 当中的，而是在 `Shader` 中统一声明的：
```ts
/**
 * Shader containing vertex and fragment source.
 */
export class Shader {
    private static _macroMap: Record<string, ShaderMacro> = Object.create(null);
    
    static getMacroByName(name: MacroName): ShaderMacro;

    static getMacroByName(name: string): ShaderMacro;

    /**
     * Get shader macro by name.
     * @param name - Name of the shader macro
     * @returns Shader macro
     */
    static getMacroByName(name: string): ShaderMacro {
        let macro = Shader._macroMap[name];
        if (!macro) {
            const maskMap = Shader._macroMaskMap;
            const counter = Shader._macroCounter;
            const index = Math.floor(counter / 32);
            const bit = counter % 32;
            macro = new ShaderMacro(name, index, 1 << bit);
            Shader._macroMap[name] = macro;
            if (index == maskMap.length) {
                maskMap.length++;
                maskMap[index] = new Array<string>(32);
            }
            maskMap[index][bit] = name;
            Shader._macroCounter++;
        }
        return macro;
    }
}
```
`ShaderMacroCollection` 负责存储变量宏和布尔宏的值：
```ts
/**
 * Shader macro collection.
 * @internal
 */
export class ShaderMacroCollection {
    /** @internal */
    _variableMacros: Map<string, string> = new Map<string, string>();
    /** @internal */
    _mask: number[] = [];
    /** @internal */
    _length: number = 0;
}
```

尽管这样的做法看似繁琐，实际上兼容了 `GLSL` 宏的使用，因为在 `GLSL` 中，宏是通过例如：
```c
#define HAS_UV
```
这样方式在着色器代码的开头声明的，因此需要保存宏的字符串，通过上述方式，可以减少字符串存储所需的空间。

同时，TypeScript 中可以使用字符串定义类型，且该类型和字符串等价转换，因此对于内部宏可以定义：
```ts
export type MacroName =
  "HAS_UV"
  | "HAS_NORMAL"
  | "HAS_TANGENT"
  | "HAS_VERTEXCOLOR"

  // Blend Shape
  | "HAS_BLENDSHAPE"
  | "HAS_BLENDSHAPE_TEXTURE"
  | "HAS_BLENDSHAPE_NORMAL"
  | "HAS_BLENDSHAPE_TANGENT"

  // Skin
  | "HAS_SKIN"
  | "HAS_JOINT_TEXTURE"
  | "JOINTS_COUNT"
```
只需要为相关宏函数添加重载声明即可：
```ts
export class ShaderMacroCollection {
    isEnable(macroName: MacroName): boolean;

    isEnable(macroName: string): boolean;

    isEnable(macroName: string): boolean {
        const variableValue = this._variableMacros.get(macroName);
        if (variableValue !== undefined) {
            const macro = Shader.getMacroByName(`${macroName} ${variableValue}`);
            return this._isEnable(macro);
        } else {
            const macro = Shader.getMacroByName(macroName);
            return this._isEnable(macro);
        }
    }
}
```
