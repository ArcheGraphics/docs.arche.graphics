---
sidebar_position: 14
---

# shadow

Shadows are a very important part in the engine, which can make the rendering of the scene more realistic. The
shadow technology based on ShadowMap is integrated in Arche. It is very simple to turn on shadows, and it is mainly
divided into three parts:

1. The light source settings enable shadows to render ShadowMap
2. The Projector chooses to cast a shadow so that it is rendered when the ShadowMap is rendered
3. The acceptor chooses to receive the shadow, so that it reads the depth from the ShadowMap during forward rendering

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

In order to make the API on the user side as simple as possible, a series of work has been done inside the shadow
system, among which `ShadowManager` is the main manager. It controls the process of shadow drawing, and finally saves
the texture and information needed to draw shadows to the `ShaderData` of the `Scene`. For applications that need to use
shadows, just use `ShadowManager::draw` to add shadow rendering to the main loop:

````cpp
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
````

For the three types of light in the current engine, ShadowMap needs to deal with many details in the
implementation, and the core problem is how to determine the projection matrix and view matrix from the light source.
Therefore, the final rendered shadow map is divided into three cases to consider:

1. Spotlight: Only need to render a shadow map, and the parameters of the perspective matrix can be obtained
   directly through the parameters of the spotlight.
2. Directional light: Use *Cascade Shadow Map(CSSM)* technology to set the perspective matrix by dividing the view frustum
   into several parts.
3. Point Light: Using an omnidirectional shadow map, render a cube shadow map on six faces.

In the following articles, we will introduce the specific implementation technology in detail.
