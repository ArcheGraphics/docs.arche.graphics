---
sidebar_position: 14
---

# 阴影

阴影是引擎中非常重要的功能，可以使得场景渲染的效果更加真实。在 Arche 当中集成了基于 ShadowMap 的阴影技术。
想要开启阴影非常简单，主要分为三个部分：
1. 光源设置启动阴影，使其渲染 ShadowMap
2. 投影物选择投射阴影，使其在渲染 ShadowMap 时被渲染
3. 接受物选择接受阴影，使其在正常渲染时从 ShadowMap 中读取深度

```cpp
auto light = rootEntity->createChild("light");
light->addComponent<lightMovemenet>();
auto spotLight = light->addComponent<SpotLight>();
spotLight->intensity = 0.2;
spotLight->setEnableShadow(true);

auto boxRenderer = boxEntity->addComponent<MeshRenderer>();
boxRenderer->setMesh(PrimitiveMesh::createCuboid(_device, cubeSize, cubeSize, cubeSize));
boxRenderer->setMaterial(boxMtl);
boxRenderer->castShadow = true;

auto planeRenderer = planeEntity->addComponent<MeshRenderer>();
planeRenderer->setMesh(PrimitiveMesh::createPlane(_device, 10, 10));
planeRenderer->setMaterial(planeMtl);
planeRenderer->receiveShadow = true;
 ```

为了使得用户侧的 API 尽可能简单，阴影系统内部做了一系列工作，其中 `ShadowManager` 是最主要的管理器。
其控制阴影绘制的流程，并且最终将贴图和绘制阴影所需要的信息保存到 `Scene` 的 `ShaderData` 中。
对于需要使用阴影的应用，只需要使用 `ShadowManager::draw` 就可以将阴影渲染加入到主循环当中：
```cpp
void ShadowManager::draw(wgpu::CommandEncoder& commandEncoder) {
    _numOfdrawCall = 0;
    _shadowCount = 0;
    _drawSpotShadowMap(commandEncoder);
    _drawDirectShadowMap(commandEncoder);
    if (_shadowCount) {
        ...
        _scene->shaderData.setSampledTexture(_shadowMapProp, _shadowSamplerProp, _packedTexture);
        _scene->shaderData.setData(_shadowDataProp, _shadowDatas);
    }
    
    _cubeShadowCount = 0;
    _drawPointShadowMap(commandEncoder);
    if (_cubeShadowCount) {
        ... 
        _scene->shaderData.setSampledTexture(_cubeShadowMapProp, _cubeShadowSamplerProp, _packedCubeTexture);
        _scene->shaderData.setData(_cubeShadowDataProp, _cubeShadowDatas);
    }
}
```

针对目前引擎中的三种直接光，ShadowMap 在实现上很多细节需要处理，其中最为核心的问题是 **如何确定从光源投影矩阵和视图矩阵**。因此最终渲染阴影贴图分为三种情况考虑：
1. 聚光灯：只需要渲染一张阴影贴图即可，透视矩阵的参数可以直接通过聚光灯参数得到。
2. 有向灯：使用*级联阴影CSSM*技术，通过对视锥体切分成几个部分，分块设定透视矩阵。
3. 点光源：使用万向阴影贴图，在六个面上渲染一个立方体阴影贴图。

在后续的几篇文章中，我们会详细介绍具体的实现技术。
