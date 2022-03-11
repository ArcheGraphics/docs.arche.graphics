---
sidebar_position: 12
---

# Render Subpass: Skybox

![skybox](https://arched-graphics.oss-cn-shanghai.aliyuncs.com/img/skybox.gif)

Around `ForwardSubpass` we describe how to build a rendering pipeline that combines flexibility and performance, which
critically relies on almost all the techniques described above. But if you just want to make the rendering pipeline
implement a specific function, or quickly experiment with a rendering feature, it will be very cumbersome to build the
rendering pipeline in such a way that is highly dependent on other modules. Fortunately, the organization of `Subpass`
does not depend on other components, and the interface of WebGPU can be used here to manually build to achieve the
rendering function. The skybox introduced in this article is such an example. Interested readers can directly see the
specific case effect in [Playground](https://arche.graphics/zh-hans/playground/skybox/). By encapsulating the rendering
of the skybox as `SkyboxSubpass`, this ability can be loaded or removed according to the situation, and the process of
scene rendering can be flexibly controlled.

`SkyboxSubpass` hardly depends on any externally packaged components, including rendering pipeline configuration and
shader resource binding, which are all set manually. In the `prepare` function we implement a long list of
initialization code:

```cpp
void SkyboxSubpass::prepare() {
    _depthStencil.format = _renderContext->depthStencilTextureFormat();
    _depthStencil.depthWriteEnabled = false;
    _depthStencil.depthCompare = wgpu::CompareFunction::LessEqual;
    _forwardPipelineDescriptor.depthStencil = &_depthStencil;
    _colorTargetState.format = _renderContext->drawableTextureFormat();
    _fragment.targetCount = 1;
    _fragment.targets = &_colorTargetState;
    _forwardPipelineDescriptor.fragment = &_fragment;
    _forwardPipelineDescriptor.label = "Skybox Pipeline";
    
    ...
    
    // BindGroupLayout
    {
        _bindGroupLayoutEntry.resize(3);
        _bindGroupLayoutEntry[0].binding = 10;
        _bindGroupLayoutEntry[0].visibility = wgpu::ShaderStage::Vertex;
        _bindGroupLayoutEntry[0].buffer.type = wgpu::BufferBindingType::Uniform;
        _bindGroupLayoutEntry[1].binding = 0;
        _bindGroupLayoutEntry[1].visibility = wgpu::ShaderStage::Fragment;
        _bindGroupLayoutEntry[1].texture.multisampled = false;
        _bindGroupLayoutEntry[1].texture.sampleType = wgpu::TextureSampleType::Float;
        _bindGroupLayoutEntry[1].texture.viewDimension = wgpu::TextureViewDimension::Cube;
        _bindGroupLayoutEntry[2].binding = 1;
        _bindGroupLayoutEntry[2].visibility = wgpu::ShaderStage::Fragment;
        _bindGroupLayoutEntry[2].sampler.type = wgpu::SamplerBindingType::Filtering;
        _bindGroupLayoutDescriptor.entryCount = static_cast<uint32_t>(_bindGroupLayoutEntry.size());
        _bindGroupLayoutDescriptor.entries = _bindGroupLayoutEntry.data();
        _bindGroupLayout = _pass->resourceCache().requestBindGroupLayout(_bindGroupLayoutDescriptor);
    }
    // BindGroup
    {
        _bindGroupEntries.resize(3);
        _bindGroupEntries[0].binding = 10;
        _bindGroupEntries[0].size = sizeof(Matrix4x4F);
        _bindGroupEntries[0].buffer = _vpMatrix.handle();
        _bindGroupEntries[1].binding = 0;
        _bindGroupEntries[2].binding = 1;
        _bindGroupDescriptor.entryCount = static_cast<uint32_t>(_bindGroupEntries.size());
        _bindGroupDescriptor.entries = _bindGroupEntries.data();
        _bindGroupDescriptor.layout = _bindGroupLayout;
    }
    
    ...
}
```

## Record Rendering Commands

The actual rendering mainly requires two resources:

1. Skybox meshes, cubes with cubemap, and spheres with sphere-map
2. Cubemap

Due to the particularity of the skybox algorithm, it is necessary to modify the view matrix at the beginning of
rendering, and then upload the modified matrix to the GPU:

````cpp
void SkyboxSubpass::draw(wgpu::RenderPassEncoder& passEncoder) {
    passEncoder.PushDebugGroup("Draw Skybox");
    
    const auto projectionMatrix = _camera->projectionMatrix();
    auto viewMatrix = _camera->viewMatrix();
    if (_type == SkyBoxType::Cuboid) {
        viewMatrix[12] = 0;
        viewMatrix[13] = 0;
        viewMatrix[14] = 0;
        viewMatrix[15] = 1;
    }
    auto _matrix = projectionMatrix * viewMatrix;
    std::vector<uint8_t> bytes = to_bytes(_matrix);
    _renderContext->device().GetQueue().WriteBuffer(_vpMatrix.handle(), 0, bytes.data(), sizeof(Matrix4x4F));
    
    ...
}
````

Next, since the cubemap can change at runtime, it needs to be bound in the `draw` function:

```cpp
_bindGroupEntries[1].textureView = _cubeMap->textureView();
_bindGroupEntries[2].sampler = _cubeMap->sampler();
passEncoder.SetBindGroup(0, _pass->resourceCache().requestBindGroup(_bindGroupDescriptor));
passEncoder.SetPipeline(_renderPipeline);
```

Finally, execute the drawing.

## Add Skybox Render Subpass

Unlike `ForwardSubpass`, which is a built-in rendering sub-pass of the engine, the rendering of the skybox is optional.
The user inherits `ForwardApplication` and then also adds the rendering of the skybox to `RenderPass` in the `prepare`
method:

```cpp
bool SkyboxApp::prepare(Engine &engine) {
    ForwardApplication::prepare(engine);
        
    const std::string path = "SkyMap/country/";
    const std::array<std::string, 6> imageNames = {"posx.png", "negx.png", "posy.png", "negy.png", "posz.png", "negz.png"};
    std::array<std::unique_ptr<Image>, 6> images;
    std::array<Image*, 6> imagePtr;
    for (int i = 0; i < 6; i++) {
        images[i] = Image::load(path + imageNames[i]);
        imagePtr[i] = images[i].get();
    }
    auto cubeMap = std::make_shared<SampledTextureCube>(_device, images[0]->extent().width, images[0]->extent().height,
                                                        images[0]->format());
    cubeMap->setPixelBuffer(imagePtr);
    
    auto skybox = std::make_unique<SkyboxSubpass>(_renderContext.get(), _scene.get(), _mainCamera);
    skybox->createCuboid();
    skybox->setTextureCubeMap(cubeMap);
    _renderPass->addSubpass(std::move(skybox));
    
    return true;
}
```

## Summarize

If `ForwardSubpass` shows the combined effect of many capabilities carefully encapsulated by the engine,
then `SkyboxSubpass` shows the more flexible side of the engine. Users can set the `binding` and `group` indicators by
themselves, bind the required resources by themselves, and can also complete the rendering work. Going a step further,
experimenting with new rendering features in such a flexible way, and then combining a series of tools to refactor the
rendering features into a general function, is more in line with the way developers work iteratively with the
development engine.
