---
sidebar_position: 10
---

# Render Pass

Arche is based on the configuration process of the WebGPU rendering pipeline, using the two types of `RenderPass`
and `Subpass` to organize the rendering pipeline, This makes it possible to use the various tools introduced in the
previous articles to implement a flexible configuration of a high-performance rendering pipeline, or to directly call
the WebGPU interface to quickly build a rendering pipeline that completes a specific function. At the same time,
each `RenderPass` can combine multiple `Subpss` to complete the rendering work under the same "canvas",
namely `wgpu::RenderPassDescriptor`.

## Render Pass Descriptor

In `ForwardApplication`, `wgpu::RenderPassDescriptor` is constructed. This structure is associated with
the `wgpu::TextureView` in the familiar `RenderContext`, and configures the operation when the canvas texture is loaded
and saved:

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

Since the `RenderContext` may rebuild the depth map etc. due to the user resizing the window, bind it in every render
loop:

````cpp
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
````

## Render Pass

Note that the main loop calls `RenderPass::draw` to record GPU commands for `wgpu::CommandEncoder`. `RenderPass` has
three functions:

1. Save the pointer of `Subpass`, save its own pointer to `Subpass`, and finally call the `Subpass::prepare` method to
   initialize
2. Construct `wgpu::RenderPassEncoder` and pass it to `Subpass`
3. Maintain the relationship between the related `RenderPass` so that the `Subpass` can access the information of the
   rendering context

In `RenderPass::draw`, the saved `Subpass` object will be called for rendering:

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

## Render Subpass

`Subpass` needs to specify the rendered scene and camera during construction. The reason why this information is
specified in the constructor is to generate a series of WebGPU objects earlier and cache them to improve runtime
performance. All subclasses must implement two pure virtual functions:

````cpp
/**
  * @brief Prepares the shaders and shader variants for a subpass
  */
virtual void prepare() = 0;

/**
  * @brief Draw virtual function
  * @param commandEncoder CommandEncoder to use to record draw commands
  */
virtual void draw(wgpu::RenderPassEncoder& commandEncoder) = 0;
````

The former constructs as many WebGPU objects as possible and caches them, while the latter records rendering commands
into `wgpu::RenderPassEncoder`.

## Practice in Arche.js

The overall architecture of Arche.js is similar, but since users are not expected to extend `Engine` through inheritance
in Arche.js, So `wgpu::RenderPassDescriptor` is built directly inside `RendPass`:

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
        renderPassColorAttachment.clearValue = {r: 0.4, g: 0.4, b: 0.4, a: 1.0};
        renderPassDepthStencilAttachment.depthLoadOp = 'clear';
        renderPassDepthStencilAttachment.depthClearValue = 1.0;
        renderPassDepthStencilAttachment.depthStoreOp = "store";
        renderPassDepthStencilAttachment.stencilLoadOp = 'clear';
        renderPassDepthStencilAttachment.stencilClearValue = 0.0;
        renderPassDepthStencilAttachment.stencilStoreOp = "store";
        renderPassDepthStencilAttachment.view = engine.renderContext.depthStencilTexture();

        this.addSubpass(new ForwardSubpass(engine));
    }

    draw(scene: Scene, camera: Camera, commandEncoder: GPUCommandEncoder) {
        this._renderPassColorAttachment.view = this._engine.renderContext.currentDrawableTexture();
        super.draw(scene, camera, commandEncoder);
    }
}
````

Make `RenderPass` and `Subpass` the same, can be combined to render:

```ts title="Engine._render"
   const commandEncoder = this._device.createCommandEncoder();
for (let j = 0, n = this._renderPasses.length; j < n; j++) {
    const renderPass = this._renderPasses[j];
    renderPass.draw(scene, camera, commandEncoder);
}
this._device.queue.submit([commandEncoder.finish()]);
````

:::caution

This combination is not optimal. For example, the `FrameBufferColorPicker` described later will add
a blocking operation to the rendering pipeline, waiting for the rendering task to complete. Blocking operations require
careful configuration, otherwise it can easily affect performance.
:::
