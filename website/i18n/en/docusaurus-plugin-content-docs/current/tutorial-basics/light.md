---
sidebar_position: 8
---

# Component: Light

Light play a role in rendering. On the one hand, lights provide lighting for objects in the scene. On the other
hand, they also generate shadow maps for objects that receive shadows. Arche provides four types of light:

1. Ambient Light (`AmbientLight`) is not a component, because it does not need to set a specific attitude, so it does
   not need to be attached to `Entity`, but is directly built into `Scene`.
2. Point Light (`PointLight`): emit light in all directions from a single point.
3. Spotlight (`SpotLight`): Starting from a single point, it emits light within an angular range in a specific direction.
4. Directed Light (`DirectLight`): Light directed in a specific direction.

The base class of the light component `Light` In addition to being the basis for the three light
components, it also provides the parameters required for shadow rendering:

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

When Arche renders shadows, there are three aspects to describe whether shadows occur:

1. `Light` uses `enableShadow` to determine whether a specific shadow map needs to be rendered according to the light.
2. `Renderer` uses `castShadow` to determine whether it needs to be rendered when rendering shadow maps.
3. `Renderer` uses `receiveShadow` to determine whether it is necessary to consider the influence of shadows when
   rendering.

## AmbientLight

Ambient light is not a component, because it does not need any information about the pose, but **Global
Illumination**. So it's built directly into `Scene`. Global illumination is a very complex problem, currently ambient
light provides a uniform diffuse light for the entire scene:

````cpp
struct EnvMapLight {
    Vector3F diffuse;
    uint32_t mipMapLevel;
    float diffuseIntensity;
    float specularIntensity;
    float _pad1, _pad2;
};
````

In addition to this, the main role is to provide IBL lighting for PBR materials, i.e. image-based lighting. IBL lighting
requires pre-computing for diffuse and specular, and some PBR algorithms also require a look-up table for BRDF
calculations (LUT), these pre-computed data can be set by the type of ambient light:

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
IBL's diffuse reflection can be pre-computed to obtain diffuse reflection cube maps, and pre-computed spherical
harmonic parameters, including specular pre-computing and BRDF maps, can be obtained through the pre-computing tools
provided by Arche.
:::

## PointLight

A point light represents a light that emits light in all directions from a single point, so the direction of the
light is not important, the position of the light is important, which can be seen from the structure
of `PointLightData`:

````cpp
struct PointLightData {
    Vector3F color;
    float _colorPad; // for align
    Vector3F position;
    float distance;
};
````

:::tip 
Structures as UniformBuffers all require four-byte alignment.
:::
When rendering shadow maps, point lights need to render a "universal" shadow map, that is, a shadow cube map, so it
needs to be rendered in six directions, each of which is parallel to the coordinate axis, and rendered using perspective
projection:

````cpp
Matrix4x4F PointLight::shadowProjectionMatrix() {
    return makepPerspective<float>(degreesToRadians(120), 1, 0.1, 100);
}
````

## SpotLight

Spotlight means starting from a single point and emitting light in a specific direction and angle range, so in addition
to the position of the light, the direction of the light and the angle that can be illuminated are also
required:

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

When rendering shadow maps, the spotlight corresponds to the simplest shadow map, and only needs to be rendered once,
and the angle of the light provides various parameters needed to calculate the perspective projection:

````cpp
Matrix4x4F SpotLight::shadowProjectionMatrix() {
    const auto fov = std::min(M_PI / 2, angle * 2 * std::sqrt(2));
    return makepPerspective<float>(fov, 1, 0.1, distance + 5);
}
````

## DirectLight

Directional light means light directed in a specific direction, so the direction of the light is more important
than the position. In the `Transform` component, you can get the direction `worldForward` in world coordinates as the
direction of the light:

````cpp
struct DirectLightData {
    Vector3F color;
    float _colorPad; // for align
    Vector3F direction;
    float _directionPad; // for align
};
````

When rendering shadows, since the directional light is not a light in a specific range, it is difficult to directly
write the perspective matrix required to render the shadow map. Reduced quality of shadow rendering due to precision
issues. In order to deal with this problem, the method of cascading shadows is generally used to cut the frustum, and
different perspective matrix parameters are set according to the distance. Therefore, `shadowProjectionMatrix` is not
directly implemented in `DirectLight`. The specific implementation method will be explained in detail when introducing
the shadow system.

```cpp
Matrix4x4F DirectLight::shadowProjectionMatrix() {
    assert(false && "cascade shadow don't use this projection");
}
```



