---
sidebar_position: 14
---

# Shadow
![shadow](https://arched-graphics.oss-cn-shanghai.aliyuncs.com/img/multi_shadow.gif)

Shadows are a very important part in the engine, which can make the rendering of the scene more realistic. The shadow
technology based on ShadowMap is integrated in Arche. It is very simple to turn on shadows, and it is mainly divided
into three parts:

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

For the three types of light in the current engine, ShadowMap needs to deal with many details in the implementation, and
the core problem is how to determine the projection matrix and view matrix from the light source. Therefore, the final
rendered shadow map is divided into three cases to consider:

1. Spotlight: Only need to render a shadow map, and the parameters of the perspective matrix can be obtained directly
   through the parameters of the spotlight.
2. Directional light: Use *Cascade Shadow Map(CSSM)* technology to set the perspective matrix by dividing the view
   frustum into several parts.
3. Point Light: Using an omnidirectional shadow map, render a cube shadow map on six faces.

In the following articles, we will introduce the specific implementation technology in detail.

## ShadowMap Basic Rendering Pipeline

But no matter which one, you need to render ShadowMap at least once. In order to achieve such a ShadowMap rendering, not
only `Subpass` is required but also because the depth map is passed through `wgpu::RenderPassDescriptor`
set, so a separate RenderPass is required. This is very similar to `FramebufferPicker`. Further, rendering the depth map
does not require any fragment shader, only one execution of the vertex shader is required, so the fragment
shader-related configuration can be left out:

````cpp
ShadowManager::ShadowManager(Scene* scene, Camera* camera):
_scene(scene),
_camera(camera),
_shadowMapProp(Shader::createProperty("u_shadowMap", ShaderDataGroup::Scene)),
_shadowSamplerProp(Shader::createProperty("u_shadowSampler", ShaderDataGroup::Scene)),
_shadowDataProp(Shader::createProperty("u_shadowData", ShaderDataGroup::Scene)),

_cubeShadowMapProp(Shader::createProperty("u_cubeShadowMap", ShaderDataGroup::Scene)),
_cubeShadowSamplerProp(Shader::createProperty("u_cubeShadowSampler", ShaderDataGroup::Scene)),
_cubeShadowDataProp(Shader::createProperty("u_cubeShadowData", ShaderDataGroup::Scene)) {
    _renderPassDescriptor.colorAttachmentCount = 0;
    _renderPassDescriptor.colorAttachments = nullptr;
    _renderPassDescriptor.depthStencilAttachment = &_depthStencilAttachment;
    _depthStencilAttachment.depthLoadOp = wgpu::LoadOp::Clear;
    _depthStencilAttachment.depthClearValue = 1.0;
    _depthStencilAttachment.depthStoreOp = wgpu::StoreOp::Store;
    _depthStencilAttachment.stencilLoadOp = wgpu::LoadOp::Load;
    _depthStencilAttachment.stencilStoreOp = wgpu::StoreOp::Discard;
    
    _renderPass = std::make_unique<RenderPass>(_scene->device(), _renderPassDescriptor);
    auto shadowSubpass = std::make_unique<ShadowSubpass>(nullptr, _scene, _camera);
    _shadowSubpass = shadowSubpass.get();
    _renderPass->addSubpass(std::move(shadowSubpass));
}
````

The overall logic of `ShadowSubpass` is basically the same as that of `ForwardSubpass`, but there is no need to
configure `wgpu::FragmentState` related properties. At the same time, all `RenderElement`
materials are important because fragment shaders are not used. The perspective matrix and view matrix required for
rendering are both given by the light source and need to be configured according to different light sources. In order to
facilitate the uploading of matrices and the associated `WGSLEncoder`, a special material `ShadowMaterial` is
encapsulated:

```cpp
ShadowMaterial::ShadowMaterial(wgpu::Device& device):
BaseMaterial(device, Shader::find("shadow")),
_shadowViewProjectionProp(Shader::createProperty("u_shadowVPMat", ShaderDataGroup::Material)) {
    
}

void ShadowMaterial::setViewProjectionMatrix(const Matrix4x4F& vp) {
    _vp = vp;
    shaderData.setData(_shadowViewProjectionProp, _vp);
}

const Matrix4x4F& ShadowMaterial::viewProjectionMatrix() const {
    return _vp;
}
```

:::caution

It should be noted that each matrix needs to correspond to a material, rather than just constructing a material object.
Otherwise, as the matrix is modified, only the last matrix is finally submitted to the GPU for operation.
:::

The perspective matrix and view matrix are not only used for calculations in the shader, but also for scene culling.
Since culling is no longer performed through the information in the camera, a simplified version of the culling function
is specially encapsulated:

````cpp
void ComponentsManager::callRender(const BoundingFrustum &frustrum,
                                   std::vector<RenderElement> &opaqueQueue,
                                   std::vector<RenderElement> &alphaTestQueue,
                                   std::vector<RenderElement> &transparentQueue) {
    for (size_t i = 0; i < _renderers.size(); i++) {
        const auto &renderer = _renderers[i];
        // filter by renderer castShadow and frustrum cull
        if (frustrum.intersectsBox(renderer->bounds())) {
            renderer->_render(opaqueQueue, alphaTestQueue, transparentQueue);
        }
    }
}
````

Pack `ShadowMaterial`, `ShadowSubpass` into `RenderPass`, combined with `wgpu::RenderPassDepthStencilAttachment`
Configure the depth map that needs to be rendered, and you can easily render the required ShadowMap. For situations like
point lights that require rendering six times, it is also easy to `RenderPass::draw` to perform.

```cpp
void ShadowManager::_drawSpotShadowMap(wgpu::CommandEncoder& commandEncoder) {
    const auto &lights = _scene->light_manager.spotLights();
    for (const auto &light: lights) {
        if (light->enableShadow() && _shadowCount < MAX_SHADOW) {
            _updateSpotShadow(light, _shadowDatas[_shadowCount]);
            ...
            
            _depthStencilAttachment.view = texture.CreateView();
            {
                std::shared_ptr<ShadowMaterial> material{nullptr};
                if (_numOfdrawCall < _materialPool.size()) {
                    material = _materialPool[_numOfdrawCall];
                } else {
                    material = std::make_shared<ShadowMaterial>(_scene->device());
                    _materialPool.emplace_back(material);
                }
                material->setViewProjectionMatrix(_shadowDatas[_shadowCount].vp[0]);
                _shadowSubpass->setShadowMaterial(material);
                _renderPass->draw(commandEncoder, "Spot Shadow Pass");
                _numOfdrawCall++;
            }
            _shadowCount++;
        }
    }
}
```

## Texture Packing

Since the number of texture bindings in the shader is limited, the upper limit of `maxSampledTexturesPerShaderStage` is
16. If the scene has several light sources rendering shadows, plus the texture of the object itself, it is easy to
exceed the upper limit. So the best way is to put the ShadowMap is packed into a TextureArray. Textures can be easily
combined using the `CopyTextureToTexture` method, which only needs to be bound once:

```cpp
void TextureUtils::buildTextureArray(const std::vector<wgpu::Texture>::iterator &texturesBegin,
                                     const std::vector<wgpu::Texture>::iterator &texturesEnd,
                                     uint32_t width, uint32_t height,
                                     wgpu::Texture& textureArray,
                                     wgpu::CommandEncoder& commandEncoder) {
    wgpu::ImageCopyTexture destination;
    destination.texture = textureArray;
    
    wgpu::ImageCopyTexture source;
    
    wgpu::Extent3D copySize;
    copySize.width = width;
    copySize.height = height;
    copySize.depthOrArrayLayers = 1;
    
    for (auto iter = texturesBegin; iter < texturesEnd; iter++) {
        destination.origin.z = static_cast<uint32_t>(iter - texturesBegin);
        source.texture = *iter;
        
        commandEncoder.CopyTextureToTexture(&source, &destination, &copySize);
    }
}
```
