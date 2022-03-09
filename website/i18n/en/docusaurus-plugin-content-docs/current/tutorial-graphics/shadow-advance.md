---
sidebar_position: 15
---

# Shadows - Advanced

In the previous article, we used `ShadowSubpass` to encapsulate the operation of rendering a ShadowMap. In this way,
only need to change `wgpu::RenderPassDepthStencilAttachment`, you can easily get the desired ShadowMap by using the
texture bound on it. At the same time, in order to reduce the occupation of the shader map binding channel, the rendered
ShadowMap is packaged into a TextureArray. For spotlights, the perspective and view matrices needed to render from the
light source are easily determined based on the direction and extent. However, it is not particularly easy for
directional light, because directional light is unbounded, and if a very large view frustum is used to calculate the
perspective matrix, it will cause a waste of texture accuracy. Therefore, a cascade method is generally used to cut the
viewing frustum from far to near. After cutting, the bounding boxes of these cut frustums are calculated from the
direction of the light source, thereby obtaining the **orthogonal projection matrix** . At the same time, the point
light source is also unbounded, so the shadow cube map is generally used to render the shadow map of the six faces.

## Cascaded Shadows

For cascaded shadows, you first need to cut the frustum according to the direction of the camera:

```cpp
void ShadowManager::_updateCascadesShadow(DirectLight *light, ShadowManager::ShadowData& shadowData) {
    shadowData.radius = light->shadowRadius();
    shadowData.bias = light->shadowBias();
    shadowData.intensity = light->shadowIntensity();
    
    std::array<float, SHADOW_MAP_CASCADE_COUNT> cascadeSplits{};
    auto worldPos = light->entity()->transform->worldPosition();
    
    float nearClip = _camera->nearClipPlane();
    float farClip = _camera->farClipPlane();
    float clipRange = farClip - nearClip;
    
    float minZ = nearClip;
    float maxZ = nearClip + clipRange;
    
    float range = maxZ - minZ;
    float ratio = maxZ / minZ;
    
    // Calculate split depths based on view camera frustum
    // Based on method presented in https://developer.nvidia.com/gpugems/GPUGems3/gpugems3_ch10.html
    for (uint32_t i = 0; i < SHADOW_MAP_CASCADE_COUNT; i++) {
        float p = (i + 1) / static_cast<float>(SHADOW_MAP_CASCADE_COUNT);
        float log = minZ * std::pow(ratio, p);
        float uniform = minZ + range * p;
        float d = _cascadeSplitLambda * (log - uniform) + uniform;
        cascadeSplits[i] = (d - nearClip) / clipRange;
    }
    
    ...
}
```

Then, according to the cut distance, the eight points of the view frustum are transformed into the local coordinate
system centered on the light source:

```cpp
// Calculate orthographic projection matrix for each cascade
float lastSplitDist = 0.0;
for (uint32_t i = 0; i < SHADOW_MAP_CASCADE_COUNT; i++) {
    float splitDist = cascadeSplits[i];
    std::array<Point3F, 8> _frustumCorners = frustumCorners;
    
    for (uint32_t i = 0; i < 4; i++) {
        Vector3F dist = _frustumCorners[i + 4] - _frustumCorners[i];
        _frustumCorners[i + 4] = _frustumCorners[i] + (dist * splitDist);
        _frustumCorners[i] = _frustumCorners[i] + (dist * lastSplitDist);
    }
    
    auto lightMat = light->entity()->transform->worldMatrix();
    auto lightViewMat = lightMat.inverse();
    for (uint32_t i = 0; i < 8; i++) {
        _frustumCorners[i] = lightViewMat * _frustumCorners[i];
    }
    float farDist = _frustumCorners[7].distanceTo(_frustumCorners[5]);
    float crossDist = _frustumCorners[7].distanceTo(_frustumCorners[1]);
    float maxDist = farDist > crossDist ? farDist : crossDist;
    
    ...
 }
```

The advantage of this is that it is easy to calculate the bounding box of these eight points in the local coordinate
system.
:::tip

The biggest difficulty with cascaded shadows is that when the camera moves, the shadows often shake as well. At the
pixel level, the reason for shadow flickering is that, with the movement of the shadow camera, the movement of the
shadow map relative to the sampling point does not only include a simple translation and rotation, but also a certain
scaling. When panning and rotating, the sample point moves smoothly from one pixel to another, but when zooming, the
shadow jumps quickly between multiple pixels, which is one of the reasons for edge flickering. Scaling can be prevented
by facets:

1. Make sure that the aspect ratio of the shadow map is the same as the aspect ratio of the shadow camera frustum.
2. Ensure that the corresponding size of each pixel in the shadow map in the world space remains unchanged.

For the previous point: the shadow map aspect ratio is constant 1:1, so you need to ensure that the shadow camera
frustum aspect ratio is also 1:1, which means the viewport is square. For the latter point: just keep the shadow camera
viewport size fixed.

In addition to this, another reason for flickering is the alignment of pixels,
This [Microsoft's documentation](https://docs.microsoft.com/en-us/windows/win32/dxtecharts/common-techniques-to-improve-shadow-depth-maps#moving-the-light-in-texel-sized-increments)
are mentioned.
:::

In order to achieve stable cascaded shadows, we select the largest diagonal of the cut frustum as the diameter of the
bounding sphere. Then complete the pixel alignment:

```cpp
// texel tile
float fWorldUnitsPerTexel = maxDist / (float) 1000;
float posX = (minX + maxX) * 0.5f;
posX /= fWorldUnitsPerTexel;
posX = std::floor(posX);
posX *= fWorldUnitsPerTexel;

float posY = (minY + maxY) * 0.5f;
posY /= fWorldUnitsPerTexel;
posY = std::floor(posY);
posY *= fWorldUnitsPerTexel;

float posZ = maxZ;
posZ /= fWorldUnitsPerTexel;
posZ = std::floor(posZ);
posZ *= fWorldUnitsPerTexel;
```

In the engine, the view frustum is divided into four pieces. Through the above transformation, four sets of perspective
and view matrices can be obtained. With these matrices, the scene is rendered four times. In order to reduce the number
of textures, keep the results of these four renderings on the same texture, which requires each rendering to
use `setViewport` to keep the rendering results within a certain range of the texture:

````cpp
_shadowSubpass->setViewport(_viewport[i]);
if (i == 0) {
     _depthStencilAttachment.depthLoadOp = wgpu::LoadOp::Clear;
} else {
     _depthStencilAttachment.depthLoadOp = wgpu::LoadOp::Load;
}
_renderPass->draw(commandEncoder, "Direct Shadow Pass");
````

:::tip

For other types of rendering, generally `depthLoadOp` will be set to `wgpu::LoadOp::Clear`, which needs to be adjusted
to `wgpu::LoadOp::Load`, otherwise only the last rendering result can be retained.
:::

This texture is in the shader, and it also needs to offset the UV according to the position of the cascade:

```wgsl
var shadow_sample = textureSampleCompare(u_shadowMap, u_shadowSampler, xy + off + offsets[cascadeIndex], index, shadowCoord.z / shadowCoord.w);
return select(1.0, u_shadowData.intensity, shadow_sample < 1.0);
```

:::tip

Using `textureSampleCompare` can avoid the shader branch problem caused by comparing depth, the function directly
returns 0 or 1, and then `select` can completely eliminate branch judgment.
:::

## Omnidirectional Shadow
![shadow](https://arched-graphics.oss-cn-shanghai.aliyuncs.com/img/cube_shadow.gif)

Shadows cast from point light sources are generally processed using an omnidirectional shadow map, which saves the
shadow map in a cube map and uses the depth cube map to draw shadows. Similar to cascaded shadows, we need to render a
texture six times. But the difference is that the cubemap has six faces, so it can be configured
via `wgpu::TextureViewDescriptor`:

```cpp
 wgpu::TextureViewDescriptor descriptor;
descriptor.format = SHADOW_MAP_FORMAT;
descriptor.dimension = wgpu::TextureViewDimension::e2D;
descriptor.arrayLayerCount = 1;
for (int i = 0; i < 6; i++) {
    descriptor.baseArrayLayer = i;
    _depthStencilAttachment.view = texture.CreateView(&descriptor);
    
    ...
    material->setViewProjectionMatrix(_cubeShadowDatas[_cubeShadowCount].vp[i]);
    _shadowSubpass->setShadowMaterial(material);
    _renderPass->draw(commandEncoder, "Point Shadow Pass");
    _numOfdrawCall++;
}
```

Similarly, in the shader, it is also necessary to determine a specific face, and then sample the depth:

````wgsl
fn convertUVToDirection( face:i32, uv:vec2<f32>)->vec3<f32> {
    var u = 2.0 * uv.x - 1.0;
    var v = -2.0 * uv.y + 1.0;
    
    let offsets = array<vec3<f32>, 6>(
        vec3<f32>(1.0, v, -u),
        vec3<f32>(-1.0, v, u),
        vec3<f32>(u, 1.0, -v),
        vec3<f32>(u, -1.0, v),
        vec3<f32>(u, v, 1.0),
        vec3<f32>(-u, v, -1.0),
    );
    return offsets[face];
}
````

## A small bug, or An optimization

Whether it is a spot light, a point light or a directional light, in order to pack the depth maps together as much as
possible, after completing their respective renderings, they need to be transferred to a TextureArray. During the
implementation process, I found that if there is only one depth map in the scene, I cannot
use `wgpu::TextureViewDimension::e2DArray` to bind to the shader's `texture_depth_2d_array`, Dawn itself does not report
errors, but the underlying Metal API does. I have submitted a bug fix to Dawn. However, this general design is redundant
for the case where there is only one depth map, and an extra copy work can be completely avoided. Therefore, although
the program is a bit cumbersome, in order to bypass the current problem, it is also an optimization. Chances of the
code, I made some minor modifications:

```cpp
if (_shadowCount == 1) {
    _packedTexture->setTextureViewDimension(wgpu::TextureViewDimension::e2D);
} else {
    _packedTexture->setTextureViewDimension(wgpu::TextureViewDimension::e2DArray);
}
```



