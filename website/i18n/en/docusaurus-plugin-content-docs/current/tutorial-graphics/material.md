---
sidebar_position: 6
---

# Material

With `ShaderData` and `RenderState` you can implement material `Material`, which is user-facing and integrates three
underlying types:

1. `ShaderData` (including `ShaderMacroCollection`)
2. `RenderState`
3. `Shader`, the shader class, used to generate shader code and construct `ShaderProgram`

On the user-facing side, the above concepts are regrouped into the following aspects:

1. Rendering resources: `SampledTexture`, `Color` and other data
2. Rendering state: whether the material is transparent, how to mix
3. Shaders: how to render objects All interfaces are encapsulated into `set/get` member functions, which are more
   convenient to call.

`Material` is the base class for all material classes:

```cpp
class Material {
public:
    /** Name. */
    std::string name = "";
    /** Shader used by the material. */
    Shader *shader;
    /** Render queue type. */
    RenderQueueType::Enum renderQueueType = RenderQueueType::Enum::Opaque;
    /** Shader data. */
    ShaderData shaderData;
    /** Render state. */
    RenderState renderState = RenderState();
    
    /**
     * Create a material instance.
     * @param shader - Shader used by the material
     */
    Material(wgpu::Device& device, Shader *shader);
};
```

The `BaseMaterial` implemented on this base class mainly handles the public functions of the material, such
as `tilingOffset`, `renderFace`, `blendMode`. On this basis, the engine provides four materials:

1. `UnlitMaterial`
2. `BlinnPhongMaterial`
3. `PBRMaterial`: Metallic Workflow PBR
4. `PBRSpecularMaterial`: Specular workflow PBR

## UnlitMaterial

Unlit materials are not affected by the `Light` component and are generally used for baked materials. Use a shader
named "unlit" and have the simplest interface:

````cpp
UnlitMaterial::UnlitMaterial(wgpu::Device& device) :
BaseMaterial(device, Shader::find("unlit")),
_baseColorProp(Shader::createProperty("u_baseColor", ShaderDataGroup::Material)),
_baseTextureProp(Shader::createProperty("u_baseTexture", ShaderDataGroup::Material)),
_baseSamplerProp(Shader::createProperty("u_baseSampler", ShaderDataGroup::Material)) {
    shaderData.enableMacro(OMIT_NORMAL);
    
    shaderData.setData(_baseColorProp, _baseColor);
}
````

It constructs shader properties named "u_baseTexture" and "u_baseSampler", each of which has a unique indicator,
although `SampledTextuer` packs the sampler and shader together, it still needs to apply for two indicators.
In `setBaseTexture`, these two properties are used together to set the shader data and open the texture macro:

```cpp
void UnlitMaterial::setBaseTexture(SampledTexture2DPtr newValue) {
    _baseTexture = newValue;
    shaderData.setSampledTexture(UnlitMaterial::_baseTextureProp,
                                 UnlitMaterial::_baseSamplerProp, newValue);
    
    if (newValue) {
        shaderData.enableMacro(HAS_BASE_TEXTURE);
    } else {
        shaderData.disableMacro(HAS_BASE_TEXTURE);
    }
}
```

## BlinnPhongMaterial

The `BlinnPhongMaterial` material is the most classic rendering material, which involves many attributes, and this
series of attributes are packaged into a UniformBuffer:

````cpp
struct BlinnPhongData {
    Color baseColor = Color(1, 1, 1, 1);
    Color specularColor = Color(1, 1, 1, 1);
    Color emissiveColor = Color(0, 0, 0, 1);
    float normalIntensity = 1.f;
    float shininess = 16.f;
    float _pad1, _pad2; // align
};
````

## Physically based materials

PBR is currently a very popular material that can achieve very realistic rendering effects. Although the algorithmic
principle of PBR itself is very simple, there are many subdivided implementations. The PBR materials of the engine all
inherit from `PBRBaseMaterial`, which implements some public properties:

````cpp
struct PBRBaseData {
    Color baseColor = Color(1, 1, 1, 1);
    Color emissiveColor = Color(0, 0, 0, 1);
    float normalTextureIntensity = 1.f;
    float occlusionTextureIntensity = 1.f;
    float _pad1, _pad2;
};
````

On this basis, there are two types of PBR workflows: metallic workflow and specular workflow, and the materials
provided by these two workflows are different. The former metal roughness, and even the mask are stored in different
channels of a map; the latter is the specular and glossiness stored in a map:

### PBRMaterial

```cpp
struct PBRData {
    float metallic = 1.f;
    float roughness = 1.f;
    float _pad1, _pad2;
};
```

### PBRSpecularMaterial

```cpp
struct PBRSpecularData {
    Color specularColor = Color(1, 1, 1, 1);
    float glossiness = 1.f;;
    float _pad1, _pad2, _pad3;
};
```
