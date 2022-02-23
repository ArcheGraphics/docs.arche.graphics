---
sidebar_position: 14
---

# 阴影

阴影是引擎中非常重要的功能，可以使得场景渲染的效果更加真实。在 Arche 当中集成了基于 ShadowMap 的阴影技术。 想要开启阴影非常简单，主要分为三个部分：

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

为了使得用户侧的 API 尽可能简单，阴影系统内部做了一系列工作，其中 `ShadowManager` 是最主要的管理器。 其控制阴影绘制的流程，并且最终将贴图和绘制阴影所需要的信息保存到 `Scene` 的 `ShaderData` 中。
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

## ShadowMap 基本渲染管线

但无论哪一种，都需要渲染至少一次 ShadowMap。为了实现这样一次 ShadowMap 渲染，不仅需要 `Subpass` 而且由于深度贴图是通过 `wgpu::RenderPassDescriptor`
进行设置的，因此需要单独的一个 `RenderPass`。 这一点和 `FramebufferPicker` 是非常类似的。更进一步，渲染深度贴图不需要任何片段着色器，只需要执行一次顶点着色器即可，因此片段着色器相关的配置可以不处理：

```cpp
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
```

其中 `ShadowSubpass` 的整体逻辑和 `ForwardSubpass` 基本一致，只是不需要再配置 `wgpu::FragmentState` 相关的属性。 同时，所有 `RenderElement`
的材质都重要，因为用不到片段着色器。渲染所需要的透视矩阵和视图矩阵都由光源给出，需要根据不同的光源进行配置。 为了方便上传矩阵以及关联 `WGSLEncoder`，因此封装一个特殊的材质 `ShadowMaterial`：

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

需要注意的是，每一个矩阵都需要对应一个材质，而不能仅仅构造一个材质对象。否则随着矩阵被修改，最终提交到GPU进行运算的，只有最后一个矩阵。
:::

透视矩阵和视图矩阵不仅用于着色器中的计算，还可以用于场景剔除，由于不再通过相机中的信息进行剔除，因此特别又封装了一个简易版的剔除函数：

```cpp
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
```

将 `ShadowMaterial`, `ShadowSubpass` 打包到 `RenderPass` 当中，结合 `wgpu::RenderPassDepthStencilAttachment`
配置所需要进行渲染的深度贴图，就能很容易渲染出所需要的 ShadowMap。
对于像点光源这样需要渲染六次的情况，也可以很容易 `RenderPass::draw` 执行六次渲染。

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

## 贴图打包

由于着色器中的贴图绑定数量是有限的，`maxSampledTexturesPerShaderStage` 上限是16个，如果场景有好几个光源都在渲染阴影，加上物体本身的材质贴图，很容易超过上限。 因此最好的方式是将每个光源的
ShadowMap 打包成一个 TextureArray。利用 `CopyTextureToTexture` 方法可以很容易将贴图整合在一起，这样一来只需要绑定一次即可：

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
