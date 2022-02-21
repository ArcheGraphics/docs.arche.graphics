---
sidebar_position: 10
---

# 渲染通道

Arche 基于 WebGPU 渲染管线的配置过程，使用 `RenderPass` 和 `Subpass` 这两个类型组织渲染渲染管线，
使得既可以利用前面几篇文章所介绍的各种工具实现一条灵活配置的高性能渲染管线，也可以直接调用 WebGPU 的接口快速搭建出完成某种特定功能的渲染管线。
同时，每一个`RenderPass` 都可以组合多个`Subpss` 使得在同一张"画布"，即 `wgpu::RenderPassDescriptor` 下完成渲染的工作。

## 渲染通道描述结构体
在 `ForwardApplication` 当中，构造了 `wgpu::RenderPassDescriptor`。
这一结构体关联了我们熟悉的 `RenderContext` 中的 `wgpu::TextureView`，并且对画布贴图载入和保存时的操作进行配置：
```cpp
bool ForwardApplication::prepare(Engine &engine) {
    GraphicsApplication::prepare(engine);
    
    _scene = std::make_unique<Scene>(_device);
    
    auto extent = engine.window().extent();
    loadScene(extent.width, extent.height);
    
    // Create a render pass descriptor for thelighting and composition pass
    // Whatever rendered in the final pass needs to be stored so it can be displayed
    _renderPassDescriptor.colorAttachmentCount = 1;
    _renderPassDescriptor.colorAttachments = &_colorAttachments;
    _renderPassDescriptor.depthStencilAttachment = &_depthStencilAttachment;
    
    _colorAttachments.storeOp = wgpu::StoreOp::Store;
    _colorAttachments.loadOp = wgpu::LoadOp::Clear;
    auto& color = _scene->background.solidColor;
    _colorAttachments.clearColor = wgpu::Color{color.r, color.g, color.b, color.a};
    _depthStencilAttachment.depthLoadOp = wgpu::LoadOp::Clear;
    _depthStencilAttachment.clearDepth = 1.0;
    _depthStencilAttachment.depthStoreOp = wgpu::StoreOp::Discard;
    _depthStencilAttachment.stencilLoadOp = wgpu::LoadOp::Clear;
    _depthStencilAttachment.stencilStoreOp = wgpu::StoreOp::Discard;
    _renderPass = std::make_unique<RenderPass>(_device, _renderPassDescriptor);
    _renderPass->addSubpass(std::make_unique<ForwardSubpass>(_renderContext.get(), _scene.get(), _mainCamera));
    
    return true;
}
```

由于 `RenderContext` 可能会由于用户改变窗口大小而重新构造深度贴图等，因此在每一个渲染循环中对其进行绑定：
```cpp
void ForwardApplication::update(float delta_time) {
    GraphicsApplication::update(delta_time);
    _scene->update(delta_time);
    
    wgpu::CommandEncoder commandEncoder = _device.CreateCommandEncoder();    
    _colorAttachments.view = _renderContext->currentDrawableTexture();
    _depthStencilAttachment.view = _renderContext->depthStencilTexture();
    
    _renderPass->draw(commandEncoder, "Lighting & Composition Pass");
    // Finalize rendering here & push the command buffer to the GPU
    wgpu::CommandBuffer commands = commandEncoder.Finish();
    _device.GetQueue().Submit(1, &commands);
    _renderContext->present();
}
```

## 渲染通道
注意到，主循环调用 `RenderPass::draw` 为 `wgpu::CommandEncoder` 录制 GPU 命令，`RenderPass` 有三个方面的作用：
1. 保存 `Subpass` 的指针，并将自身的指针保存到 `Subpass`，最后调用 `Subpass::prepare` 方法进行初始化
2. 构造 `wgpu::RenderPassEncoder` 并将其传递给 `Subpass`
3. 维护相关 `RenderPass` 之间的关系，使得 `Subpass` 可以访问渲染上下文的信息

在 `RenderPass::draw` 当中会调用其保存的 `Subpass` 对象进行渲染：
```cpp
void RenderPass::draw(wgpu::CommandEncoder& commandEncoder,
                      std::optional<std::string> label) {
    assert(!_subpasses.empty() && "Render pipeline should contain at least one sub-pass");
    
    wgpu::RenderPassEncoder encoder = commandEncoder.BeginRenderPass(&_desc);
    if (label) {
        encoder.SetLabel(label.value().c_str());
    }
    for (size_t i = 0; i < _subpasses.size(); ++i) {
        _activeSubpassIndex = i;
        _subpasses[i]->draw(encoder);
    }
    _activeSubpassIndex = 0;

    encoder.EndPass();
}
```

## 渲染子通道
`Subpass` 在构造时需要制定渲染的场景，相机，之所以在构造函数中就指定这些信息，是为了能够更早生成一系列 WebGPU 对象并对其进行缓存，提高运行时的性能。
所有子类必须实现两个纯虚函数：
```cpp
/**
 * @brief Prepares the shaders and shader variants for a subpass
 */
virtual void prepare() = 0;

/**
 * @brief Draw virtual function
 * @param commandEncoder CommandEncoder to use to record draw commands
 */
virtual void draw(wgpu::RenderPassEncoder& commandEncoder) = 0;
```
前者尽可能构造更多的 WebGPU 对象并对其进行缓存，而后者将渲染命令录制到 `wgpu::RenderPassEncoder` 当中。

## Arche.js 中的实践
Arche.js 的总体架构与之类似，但是由于不希望用户在 Arche.js 通过继承的方式对 `Engine` 进行扩展，
因此 `wgpu::RenderPassDescriptor` 直接在 `RendPass` 内部构建：
```ts
export class ForwardRenderPass extends RenderPass {
  private _renderPassColorAttachment = new RenderPassColorAttachment();
  private _renderPassDepthStencilAttachment = new RenderPassDepthStencilAttachment();
  private _engine: Engine;

  constructor(engine: Engine) {
    super();
    this._engine = engine;
    const renderPassDescriptor = this.renderPassDescriptor;
    const renderPassColorAttachment = this._renderPassColorAttachment;
    const renderPassDepthStencilAttachment = this._renderPassDepthStencilAttachment;

    renderPassDescriptor.colorAttachments.push(this._renderPassColorAttachment);
    renderPassDescriptor.depthStencilAttachment = this._renderPassDepthStencilAttachment;
    renderPassColorAttachment.storeOp = "store";
    renderPassColorAttachment.loadOp = 'clear';
    renderPassColorAttachment.clearValue = { r: 0.4, g: 0.4, b: 0.4, a: 1.0 };
    renderPassDepthStencilAttachment.depthLoadOp = 'clear';
    renderPassDepthStencilAttachment.depthClearValue = 1.0;
    renderPassDepthStencilAttachment.depthStoreOp = "store";
    renderPassDepthStencilAttachment.stencilLoadOp = 'clear';
    renderPassDepthStencilAttachment.stencilClearValue= 0.0;
    renderPassDepthStencilAttachment.stencilStoreOp = "store";
    renderPassDepthStencilAttachment.view = engine.renderContext.depthStencilTexture();

    this.addSubpass(new ForwardSubpass(engine));
  }

  draw(scene: Scene, camera: Camera, commandEncoder: GPUCommandEncoder) {
    this._renderPassColorAttachment.view = this._engine.renderContext.currentDrawableTexture();
    super.draw(scene, camera, commandEncoder);
  }
}
```
使得 `RenderPass` 和 `Subpass` 一样，可以组合起来进行渲染：
```ts title="Engine._render"
  const commandEncoder = this._device.createCommandEncoder();
  for (let j = 0, n = this._renderPasses.length; j < n; j++) {
    const renderPass = this._renderPasses[j];
    renderPass.draw(scene, camera, commandEncoder);
  }
  this._device.queue.submit([commandEncoder.finish()]);
```

:::caution
这种组合的方式并不是最优的。例如后面会介绍的帧缓冲拾取 `FrameBufferColorPicker` 会在渲染管线当中添加一步阻断操作，等待渲染任务完成。阻断操作需要精心配置，否则很容易影响性能。
:::
