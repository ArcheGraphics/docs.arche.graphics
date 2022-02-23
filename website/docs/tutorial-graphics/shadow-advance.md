---
sidebar_position: 15
---

# 阴影 - 高级

在上一篇文章中，我们利用 `ShadowSubpass` 将渲染一张 ShadowMap 的操作进行封装. 这么一来，只需要改变 `wgpu::RenderPassDepthStencilAttachment`
上绑定的贴图，就可以很容易得到想要的 ShadowMap。 同时，为了减少对着色器贴图绑定通道的占用，因此将渲染出来的 ShadowMap 再打包一个 TextureArray 当中。
对于聚光灯来说，根据方向和范围很容易决定从光源进行渲染时所需要的透视矩阵和视图矩阵。 但是，对于有向光来说就不是特别容易了，因为有向光是无界的，如果计算透视矩阵采用非常大的视锥体，会造成贴图精度的浪费。
因此一般都会采用级联的方式，将视锥体从远到近进行切割，切割后，再从光源方向计算这些切割后的视锥体的包围盒，由此得到**正交投影矩阵**。 同时，点光源也是无界的，因此一般采用阴影立方体贴图的方式，渲染六个面的阴影贴图。

## 级联阴影

对于级联阴影来说，一开始首先需要根据相机的方向切割视锥体：

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

然后根据切割出来的距离，将视锥体的八个点变换到以光源为中心的局部坐标系当中：

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

这样的好处在于很容易在局部坐标系下计算这八个点的包围盒。
:::tip

对于级联阴影来说，最大的难点在于相机移动时，阴影常常也会随之发生抖动。 在像素层面上，阴影闪烁的原因是，随着阴影相机的运动，阴影贴图相对于采样点的移动并不是只包含单纯的平移和旋转，还包含了一定缩放。
平移和旋转时采样点平滑的从一个像素移动到另一个像素，但缩放时，阴影会在多个像素之间快速跳跃，这就是边缘闪烁产生的原因之一。 可以通过方面防止缩放产生：
1. 保证阴影贴图的宽高比和阴影相机视锥体宽高比一致。
2. 保证阴影贴图中每个像素在世界空间中对应的大小不变。

对于前一点：阴影贴图宽高比恒定为1：1，所以需要保证阴影相机视锥体宽高比也为1：1，也就是说视口为正方形。对于后一点：只需保证阴影相机视口大小固定即可。

除此之外，产生闪烁的另一个原因在于像素的对齐，
这一点[微软的文档](https://docs.microsoft.com/en-us/windows/win32/dxtecharts/common-techniques-to-improve-shadow-depth-maps#moving-the-light-in-texel-sized-increments)里有讲到。
:::

为了实现稳定的级联阴影，我们选取切割后的视锥体最大的对角线作为包围球的直径。接着再完成像素对齐：
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

在引擎当中，将视锥体分为了四块。通过上述的变换，可以得到四组透视和视图矩阵。利用这些矩阵，要渲染场景四次。
为了减少贴图的数量，将这四次渲染的结果保留在同一张贴图上，这就需要每次渲染都使用 `setViewport` 将渲染结果保留在贴图的某一范围内：
```cpp
_shadowSubpass->setViewport(_viewport[i]);
if (i == 0) {
    _depthStencilAttachment.depthLoadOp = wgpu::LoadOp::Clear;
} else {
    _depthStencilAttachment.depthLoadOp = wgpu::LoadOp::Load;
}
_renderPass->draw(commandEncoder, "Direct Shadow Pass");
```
:::tip

对于其他类型的渲染，一般 `depthLoadOp` 会设置成 `wgpu::LoadOp::Clear`，这里需要调整为 `wgpu::LoadOp::Load` 否则只能保留最后一次的渲染结果。
:::

这一贴图到了着色器当中，也需要根据级联的位置，对UV进行一定的偏移：
```wgsl
var shadow_sample = textureSampleCompare(u_shadowMap, u_shadowSampler, xy + off + offsets[cascadeIndex], index, shadowCoord.z / shadowCoord.w);
return select(1.0, u_shadowData.intensity, shadow_sample < 1.0);
```
:::tip

使用 `textureSampleCompare` 可以避免因为比较深度带来的着色器分支问题，该函数直接返回 0 或者 1，然后再借助 `select` 可以彻底消除分支判断。
:::

## 万向阴影
从点光源投射的阴影，一般会使用万向阴影贴图来处理，即将阴影贴图保存在一个立方体贴图中，利用深度立方体贴图绘制阴影。和级联阴影类似，我们需要渲染一张贴图六次。
但不同的是，立方体贴图具有六个面，因此可以通过 `wgpu::TextureViewDescriptor` 进行配置：
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

同样的，到了着色器当中，也需要判断特定的面，然后采样深度：
```wgsl
fn convertUVToDirection( face:i32,  uv:vec2<f32>)->vec3<f32> {
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
```

## 一个小BUG，或者说是一次优化
无论是聚光灯，点光源还是有向光，为了尽可能将深度贴图都打包在一起，在完成各自的渲染之后，都需要转移到一个 TextureArray 上。
在实现过过程中，我发现如果场景中只有一张深度贴图， 无法使用 `wgpu::TextureViewDimension::e2DArray` 绑定到着色器的 `texture_depth_2d_array`，
Dawn 本身并没有报错，但底层的 Metal API 会报错。我已向 Dawn 提交了改 BUG 的信息。
但是这种通用的设计对于只有一张深度贴图的情况是比较冗余的，完全可以避免额外的一次拷贝工作，因此，程序上虽然会繁琐一点，但为了绕开目前的问题，并且也是一个优化代码的机会，我做了一些细微修改：
```cpp
if (_shadowCount == 1) {
    _packedTexture->setTextureViewDimension(wgpu::TextureViewDimension::e2D);
} else {
    _packedTexture->setTextureViewDimension(wgpu::TextureViewDimension::e2DArray);
}
```



