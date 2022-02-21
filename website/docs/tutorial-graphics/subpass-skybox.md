---
sidebar_position: 12
---

# 渲染子通道： 天空盒

围绕着 `ForwardSubpass` 我们描述了如何构建一条兼具灵活性和性能的渲染管线，这条关键依赖于几乎所有前面介绍的技术。
但如果只是希望让渲染管线实现某个特定的功能，或者快速实验某个渲染特性，使用这样一种高度依赖其他模块的方式构建渲染管线，就会感到非常繁琐。 幸运的是，`Subpass` 的组织方式并不对其他组件产生依赖，在这里完全可以使用 WebGPU
的接口，手工搭建以实现渲染的功能。本文介绍的天空盒就是这么一个例子。 通过将天空盒的渲染封装为 `SkyboxSubpass` 就可以根据情况加载或者移除这一能力，灵活地控制场景渲染的流程。

`SkyboxSubpass` 几乎没有依赖任何外部封装的组件，包括渲染管线配置以及着色器资源绑定，均为手动设置。在 `prepare` 函数中我们实现了一长串初始化代码：

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

## 录制渲染命令

实际渲染主要需要两个资源：

1. 天空盒网格，支持立方体贴图的立方体，和支持球形贴图的球体
2. 立方体贴图

由于天空盒算法的特殊性，因此在渲染一开始需要修改一下视图矩阵，然后将修改后的矩阵上传给GPU：

```cpp
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
```

接下来由于立方体贴图可以在运行时发生变化，因此需要在 `draw` 函数中进行绑定：

```cpp
_bindGroupEntries[1].textureView = _cubeMap->textureView();
_bindGroupEntries[2].sampler = _cubeMap->sampler();
passEncoder.SetBindGroup(0, _pass->resourceCache().requestBindGroup(_bindGroupDescriptor));
passEncoder.SetPipeline(_renderPipeline);
```

最后执行绘制即可。

## 添加天空盒渲染子通道

和 `ForwardSubpass` 属于引擎内置的渲染子通道不同，天空盒的渲染是可选的，用户继承 `ForwardApplication` 然后同样在 `prepare` 方法中将天空盒的渲染加入到 `RenderPass` 当中：

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

## 总结

如果说 `ForwardSubpass` 展示了引擎精心封装的诸多能力汇总后的效果，那么 `SkyboxSubpass` 就展示了引擎更加灵活的一面。 用户可以自行设定 `binding` 和 `group`
指标，自行绑定需要的资源，也一样能够完成渲染的工作。 更进一步，通过这样灵活的方式实验全新的渲染特性，然后再结合一系列工具将渲染特性重构成一项通用的功能，更加符合开发者迭代开发引擎的工作方式。
