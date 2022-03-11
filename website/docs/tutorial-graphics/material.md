---
sidebar_position: 6
---

# 材质总揽

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

PBR 是当前非常流行的材质，可以实现非常真实的渲染效果。尽管 PBR 本身的算法原理非常简单，但是有许多细分的实现。 引擎的 PBR 材质均继承于 `PBRBaseMaterial`，其中实现了部分公共属性：

```cpp
struct PBRBaseData {
    Color baseColor = Color(1, 1, 1, 1);
    Color emissiveColor = Color(0, 0, 0, 1);
    float normalTextureIntensity = 1.f;
    float occlusionTextureIntensity = 1.f;
    float _pad1, _pad2;
};
```

在此基础上，有两类 PBR 工作流：金属度工作流和高光工作流，这两类工作流提供的材质是有区别的。 前者金属度粗糙度，甚至包括遮罩都在一张贴图的不同的通道中；后者则是高光和光泽度保存在一张贴图中：

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

## Arche.js 中的实践

材质在 Arche.js 中的不同，主要源自底层 `Shader`, `ShaderData` 等类型在实现上的差异，以及 TypeScript 语言自身的差异。
首先，除了着色器属性需要被构造外，为了避免在运行时出发垃圾回收，还需要获得着色器宏的对象：

```ts
export class BaseMaterial extends Material {
    private static _alphaCutoffMacro: ShaderMacro = Shader.getMacroByName("NEED_ALPHA_CUTOFF");
}
```

除此之外 `get/set` 在 TypeScript 都可以被实现成为属性而不是成员函数。但 JavaScript 不存在结构体，因此所谓的 `BlinnPhongData` 只能用一个Float32Array进行替代

```ts
export class BlinnPhongMaterial extends BaseMaterial {
    // baseColor, specularColor, emissiveColor, normalIntensity, shininess, _pad1, _pad2
    private _blinnPhongData: Float32Array = new Float32Array(16);
}
```

这样一来，如果用户调用 `get baseColor` 就无法获得一个 `Color` 类型的对象。为了方便起见，在材质当中，类似情况都需要额外存储一些数据，使得 `get/set` 方法更加自然：

```ts
export class BlinnPhongMaterial extends BaseMaterial {
    /**
     * Base color.
     */
    get baseColor(): Color {
        return this._baseColor;
    }

    set baseColor(value: Color) {
        const blinnPhongData = this._blinnPhongData;
        blinnPhongData[0] = value.r;
        blinnPhongData[1] = value.g;
        blinnPhongData[2] = value.b;
        blinnPhongData[3] = value.a;
        this.shaderData.setFloatArray(BlinnPhongMaterial._blinnPhongProp, blinnPhongData);

        const baseColor = this._baseColor;
        if (value !== baseColor) {
            value.cloneTo(baseColor);
        }
    }
}
```
:::danger
上述方式使得用户获得数据和实际发送到 GPU 的数据分裂开来，因此直接修改获得的 `Color` 实际上没有任何效果，即
```ts 
mat.baseColor.r = 1.0
``` 
不会起任何作用。 需要额外调用
```ts 
mat.baseColor = mat.baseColor
``` 
才会触发数据更新。
这一设计在修改 `Transform` 组件的属性是也有类似的问题。
:::
