---
sidebar_position: 6
---

# 材质

有了 `ShaderData` 和 `RenderState` 就可以实现材质 `Material` 了，材质是面向用户的，将三个底层类型整合在一起：

1. `ShaderData`（包含 `ShaderMacroCollection`）
2. `RenderState`
3. `Shader`，即着色器类，用于生成着色器代码，并构造 `ShaderProgram`

在面向用户一侧，上述概念重新组合为以下几个方面：

1. 渲染资源：`SampledTexture`，`Color` 等数据
2. 渲染状态：材质是否透明，如何混合
3. 着色器：如何渲染物体 所有接口封装成 `set/get` 成员函数，更加方便调用。

`Material` 是所有材质类型的基类：

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

在该基类上实现的 `BaseMaterial` 主要处理材质的公共功能，例如 `tilingOffset`， `renderFace`， `blendMode`。在此基础上，引擎提供了四种材质：

1. `UnlitMaterial`
2. `BlinnPhongMaterial`
3. `PBRMaterial`：金属度粗糙度工作流 PBR
4. `PBRSpecularMaterial`：高光工作流 PBR

## UnlitMaterial

无光照材质不会受到 `Light` 组件的影响，一般用于烘焙材质。使用名为 "unlit" 的着色器，并且接口最为简单：

```cpp
UnlitMaterial::UnlitMaterial(wgpu::Device& device) :
BaseMaterial(device, Shader::find("unlit")),
_baseColorProp(Shader::createProperty("u_baseColor", ShaderDataGroup::Material)),
_baseTextureProp(Shader::createProperty("u_baseTexture", ShaderDataGroup::Material)),
_baseSamplerProp(Shader::createProperty("u_baseSampler", ShaderDataGroup::Material)) {
    shaderData.enableMacro(OMIT_NORMAL);
    
    shaderData.setData(_baseColorProp, _baseColor);
}
```

其中构造了名为 "u_baseTexture" 和 "u_baseSampler" 的着色器属性，每一个属性都有唯一的指标，尽管`SampledTextuer` 将采样器和着色器打包在一起，但还是需要申请两个指标.
在 `setBaseTexture` 当中，会共同使用这两个属性设置着色器数据，并且开启贴图的宏：

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

`BlinnPhongMaterial` 材质是最为经典的一种渲染材质，其中涉及到诸多属性，并且这一系列属性都打包成一个 UniformBuffer：

```cpp
struct BlinnPhongData {
    Color baseColor = Color(1, 1, 1, 1);
    Color specularColor = Color(1, 1, 1, 1);
    Color emissiveColor = Color(0, 0, 0, 1);
    float normalIntensity = 1.f;
    float shininess = 16.f;
    float _pad1, _pad2; // align
};
```

## 基于物理的材质

PBR 是当前非常流行的材质，可以实现非常真实的渲染效果。尽管 PBR 本身的算法原理非常简单，但是有许多细分的实现。
引擎的 PBR 材质均继承于 `PBRBaseMaterial`，其中实现了部分公共属性：

```cpp
struct PBRBaseData {
    Color baseColor = Color(1, 1, 1, 1);
    Color emissiveColor = Color(0, 0, 0, 1);
    float normalTextureIntensity = 1.f;
    float occlusionTextureIntensity = 1.f;
    float _pad1, _pad2;
};
```

在此基础上，有两类 PBR 工作流：金属度工作流和高光工作流，这两类工作流提供的材质是有区别的。
前者金属度粗糙度，甚至包括遮罩都在一张贴图的不同的通道中；后者则是高光和光泽度保存在一张贴图中：

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
