---
sidebar_position: 8
---

# 组件：光源

光源在渲染有个方面的作用，一方面，光源为场景中的物体提供光照，另外一方面，也为接受阴影的物体产生阴影贴图， Arche 提供了四种光源：

1. 环境光（`AmbientLight`）并不是一种组件，因为其不需要设定具体的姿态，因此无需挂在到 `Entity`，而是直接内置到 `Scene` 当中
2. 点光源（`PointLight`）：从单点出发朝所有方向发射光线
3. 聚光灯（`SpotLight`）：从单点出发，在特定方向的角度范围内发射光线
4. 有向光（`DirectLight`）：朝着某个特定方向的光线

光源组件的基类 `Light` 除了作为三大光源组件的基础，还提供阴影渲染所需要的参数：
```cpp
    bool enableShadow();
    
    void setEnableShadow(bool enabled);
    
    /**
     * Shadow bias.
     */
    float shadowBias();
    
    void setShadowBias(float value);
    
    /**
     * Shadow intensity, the larger the value, the clearer and darker the shadow.
     */
    float shadowIntensity();
    
    void setShadowIntensity(float value);
    
    /**
     * Pixel range used for shadow PCF interpolation.
     */
    float shadowRadius();
    
    void setShadowRadius(float value);
    
    virtual Matrix4x4F shadowProjectionMatrix() = 0;
```
在 Arche 渲染阴影时，需要从三个方面描述阴影是否发生：
1. `Light` 通过 `enableShadow` 判断是否需要根据该光源渲染特定的阴影贴图。
2. `Renderer` 通过 `castShadow` 判断是否需要在渲染阴影贴图时被渲染。
3. `Renderer` 通过 `receiveShadow` 判断是否需要在渲染时还需要考虑阴影带来的影响。

## 环境光

环境光并不是一种组件，因为他不需要任何姿态位置的信息，而是**全局光照**。因此被直接内置到了 `Scene` 当中。 全局光照是一个非常复杂的问题，目前环境光为整个场景提供一个统一的漫反射光：

```cpp
struct EnvMapLight {
    Vector3F diffuse;
    uint32_t mipMapLevel;
    float diffuseIntensity;
    float specularIntensity;
    float _pad1, _pad2;
};
```

除了此之外，主要的作用是为 PBR 材质提供 IBL 光照，即基于图像的光照。IBL 光照需要对漫反射和高光进行预计算，某些 PBR 算法还需要对 BRDF 计算查询表（Look-Up
Table），这些预计算数据都可以通过环境光这一类型进行设置：

```cpp
    /**
     * Diffuse reflection spherical harmonics 3.
     * @remarks Effective when diffuse reflection mode is `DiffuseMode.SphericalHarmonics`.
     */
    const SphericalHarmonics3 &diffuseSphericalHarmonics();
    
    void setDiffuseSphericalHarmonics(const SphericalHarmonics3 &value);
    
    /**
     * Diffuse reflection texture.
     * @remarks This texture must be baked from MetalLoader::createIrradianceTexture
     */
    std::shared_ptr<SampledTexture> diffuseTexture();
    
    void setDiffuseTexture(std::shared_ptr<SampledTexture> value);

    /**
     * Specular reflection texture.
     * @remarks This texture must be baked from MetalLoader::createSpecularTexture
     */
    std::shared_ptr<SampledTexture> specularTexture();
    
    void setSpecularTexture(std::shared_ptr<SampledTexture> value);
    
    /**
     * brdf loopup texture.
     * @remarks This texture must be baked from MetalLoader::createBRDFLookupTable
     */
    std::shared_ptr<SampledTexture> brdfTexture();
    
    void setBRDFTexture(std::shared_ptr<SampledTexture> value);
```

:::tip
IBL 的漫反射可以通过预计算得到漫反射立方体贴图，也可以得到预计算的球谐参数，包括高光的预计算和 BRDF 贴图，都可以通过 Arche 提供的预计算工具获得.
:::

## 点光源
点光源表示一种从单点出发朝所有方向发射光，因此光源的方向并不重要，光源的位置很重要，这一点可以从 `PointLightData` 的结构中看出：
```cpp
struct PointLightData {
    Vector3F color;
    float _colorPad; // for align
    Vector3F position;
    float distance;
};
```
:::tip
作为 UniformBuffer 的结构体都需要四字节对齐。
:::
在渲染阴影贴图时，点光源需要渲染一个"万向"阴影贴图，即阴影立方体贴图，因此需要在六个方向都渲染一遍，每一个方向都是和坐标轴平行，并且使用透视投影进行渲染：
```cpp
Matrix4x4F PointLight::shadowProjectionMatrix() {
    return makepPerspective<float>(degreesToRadians(120), 1, 0.1, 100);
}
```

## 聚光灯
聚光灯表示从单点出发，在特定方向的角度范围内发射光，因此除了光源的位置，还需要光源的方向和可以被照到的角度：
```cpp
struct SpotLightData {
    Vector3F color;
    float _colorPad; // for align
    Vector3F position;
    float _positionPad; // for align
    Vector3F direction;
    float distance;
    float angleCos;
    float penumbraCos;
    float _pad; // for align
    float _pad2; // for align
};
```

在渲染阴影贴图时，聚光灯对应了最为简单的阴影贴图，只需要渲染一次，并且光源的角度提供了计算透视投影所需要的各种参数：
```cpp
Matrix4x4F SpotLight::shadowProjectionMatrix() {
    const auto fov = std::min(M_PI / 2, angle * 2 * std::sqrt(2));
    return makepPerspective<float>(fov, 1, 0.1, distance + 5);
}
```

## 有向光
有向光表示朝着某个特定方向的光，因此光源的方向比位置更加重要，在 `Transform` 组件中，可以获得世界坐标下的朝向 `worldForward`，以此作为光源的方向：
```cpp
struct DirectLightData {
    Vector3F color;
    float _colorPad; // for align
    Vector3F direction;
    float _directionPad; // for align
};
```
在渲染阴影时，由于有向光不是一个特定范围内的光线，因此很难直接写出渲染阴影贴图所需要的透视矩阵，如果对于大场景的视锥采用一张阴影贴图，很容易在近处因为精度问题降低阴影渲染的质量。
为了处理这个问题，一般使用级联阴影的方式，将视锥体进行切割，根据远近设置不同的透视矩阵参数。
因此 `DirectLight` 中并不直接实现 `shadowProjectionMatrix`，具体的实现方式，放在介绍阴影系统时再做详细说明。
```cpp
Matrix4x4F DirectLight::shadowProjectionMatrix() {
    assert(false && "cascade shadow don't use this projection");
}
```



