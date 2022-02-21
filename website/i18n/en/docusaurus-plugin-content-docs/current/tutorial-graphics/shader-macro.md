---
sidebar_position: 4
---

# Shader Macro

If `ShaderData` connects the resource components on the user side and `Subpass` on the rendering side,
then `ShaderMacroCollection` connects the resource components on the user side and `WGSLEncoder` on the rendering side.
WGSL The encoder determines whether a specific shader fragment needs to be generated based on the macro, for example:

````cpp
void WGSLWorldPosShare::operator()(WGSLEncoder& encoder,
                                   const ShaderMacroCollection& macros, size_t counterIndex) {
    if (macros.contains(NEED_WORLDPOS)) {
        encoder.addInoutType(_outputStructName, WGSLEncoder::getCounterNumber(counterIndex),
                             "v_pos", UniformType::Vec3f32);
    }
}
````

Macros are managed by `ShaderMacroCollection`, which is essentially a map:

````cpp
std::map<size_t, double> _value{};
````

:::note

Actually the macro is an analog of `wgpu::ConstantEntry`:

````cpp
struct ConstantEntry {
    ChainedStruct const * nextInChain = nullptr;
    char const *key;
    double value;
};
````

But on the one hand, `wgpu::ConstantEntry` is not yet available, and on the other hand, for scenarios such as struct
optional variables, `wgpu::ConstantEntry` cannot function like MSL. More importantly, combine the macro
with `WGSLEncoder`
When constructing shader code, you can directly get some data binding reflection information, such
as `wgpu::BindGroupLayoutEntry`, so that you can build a flexible rendering pipeline without additional reflection
tools.
:::

The key value and a `double` type of data are stored in the map. In fact, there are only two kinds of macros, **boolean
macro** and **variable macro**. Most macros are just a `true` or `false` switch, so there are two types of
implementations:

```cpp
void ShaderMacroCollection::enableMacro(const std::string& macroName) {
    _value.insert(std::make_pair(std::hash<std::string>{}(macroName), 1));
}

void ShaderMacroCollection::enableMacro(const std::string& macroName, double value) {
    _value.insert(std::make_pair(std::hash<std::string>{}(macroName), value));
}
```

## Merge Order

Macros mainly exist in four types: `Scene`, `Camera`, `Renderer`, `Material`, corresponding to:

````cpp
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
````

First, the `LightManager` saved in `Scene` will merge the number of lights into the `Scene` macro:

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

Then in `ForwardSubpass` the macros in `Scene` and `Camera` are merged:

````cpp
void ForwardSubpass::_drawMeshes(wgpu::RenderPassEncoder &passEncoder) {
    auto compileMacros = ShaderMacroCollection();
    _scene->shaderData.mergeMacro(compileMacros, compileMacros);
    _camera->shaderData.mergeMacro(compileMacros, compileMacros);
    
    ...
}
````

Finally, when looping through `RenerElement`, the `Material` and `Renderer` macros are merged in:

````cpp
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
````

The resulting macro will be sent to `Shader` to look up the cache or generate new shader code:

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

## Internal Macros

In order to make it easier to write `WGSLEncoder` and to facilitate developers to use macros, macros in the form of
strings are not particularly convenient, so the built-in macros are gathered into an enumeration type, for example:

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
````

And in `ShaderMacroCollection` convert it into a hash value generated by a string, as the key value of the macro map:

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

## Practice in Arche.js

The configuration of macros in Arche.js is similar to the above, but it is different for compatibility with macros
in [Oasis Engine](https://github.com/oasis-engine/engine). First of all, the macro name is not directly stored
in `ShaderMacroCollection` through map, but is uniformly declared in `Shader`:

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
````

`ShaderMacroCollection` is responsible for storing the values of variable macros and boolean macros:

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
````

Although this may seem cumbersome, it is actually compatible with the use of `GLSL` macros, because in `GLSL` macros are
implemented via, for example:

````c
#define HAS_UV
````

This method is declared at the beginning of the shader code, so it is necessary to save the string of the macro. Through
the above method, the space required for string storage can be reduced.

At the same time, TypeScript can use strings to define types, and the types and strings are equivalently converted, so
internal macros can be defined:

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

Just add an overload declaration for the relevant macro function:

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
