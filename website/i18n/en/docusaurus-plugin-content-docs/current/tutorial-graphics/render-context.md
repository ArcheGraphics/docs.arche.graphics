---
sidebar_position: 2
---

# RenderContext

In the whole rendering pipeline, the most important concept is the rendering context. `RenderContext` represents this
concept and encapsulates `wgpu::SwapChain`, from which you can get the `wgpu::TextureView` required by the current frame
and `wgpu::TextureFormat`, in its constructor, we can see:

```cpp
RenderContext::RenderContext(BackendBinding* binding, uint32_t width, uint32_t height):
_binding(binding),
_width(width),
_height(height) {
    wgpu::SwapChainDescriptor swapChainDesc;
    swapChainDesc.implementation = binding->swapChainImplementation();
    _swapchain = _binding->device().CreateSwapChain(nullptr, &swapChainDesc);
    
    _swapchain.Configure(drawableTextureFormat(),
                         wgpu::TextureUsage::RenderAttachment, _width, _height);
    _depthStencilTexture = _createDepthStencilView(_width, _height);
}
```

The construction of `wgpu::SwapChain` depends on `BackendBinding`, in fact, when we see where the constructor is called,
we find that `BackendBinding` is provided by `Window`:

```cpp
std::unique_ptr<RenderContext> Engine::createRenderContext(wgpu::Device& device) {
    _binding = _window->createBackendBinding(device);
    auto extent = _window->extent();
    auto scale = _window->contentScaleFactor();
    return std::make_unique<RenderContext>(_binding.get(), extent.width * scale, extent.height * scale);
}
```

## Backend binding

In fact, constructing `BackendBinding` requires two objects, `GLFWwindow` and `wgpu::Device`, and essentially
encapsulates the way of constructing SwapChain for different types of APIs:

```cpp
std::unique_ptr<BackendBinding> createBinding(wgpu::BackendType type,
                                              GLFWwindow* window, wgpu::Device& device) {
    switch (type) {
#if defined(DAWN_ENABLE_BACKEND_D3D12)
        case wgpu::BackendType::D3D12:
            return createD3D12Binding(window, device);
#endif
            
#if defined(DAWN_ENABLE_BACKEND_METAL)
        case wgpu::BackendType::Metal:
            return createMetalBinding(window, device);
#endif
            
#if defined(DAWN_ENABLE_BACKEND_NULL)
        case wgpu::BackendType::Null:
            return createNullBinding(window, device);
#endif
            
#if defined(DAWN_ENABLE_BACKEND_DESKTOP_GL)
        case wgpu::BackendType::OpenGL:
            return createOpenGLBinding(window, device);
#endif
            
#if defined(DAWN_ENABLE_BACKEND_OPENGLES)
        case wgpu::BackendType::OpenGLES:
            return createOpenGLBinding(window, device);
#endif
            
#if defined(DAWN_ENABLE_BACKEND_VULKAN)
        case wgpu::BackendType::Vulkan:
            return createVulkanBinding(window, device);
#endif
            
        default:
            return nullptr;
    }
}
```

:::note
**SwapChain** represents the double-buffer or triple-buffer structure required for rendering. When the rendering of the
current frame is completed, it will be displayed on the screen through the **swap** operation, and another block in **
chain** can be written. The area of will be written to the data of the next frame.
:::

### Metal

`MetalBinding` is a subclass of `BackendBinding`, specializing its functions:

```cpp
class MetalBinding : public BackendBinding {
public:
    MetalBinding(GLFWwindow* window, wgpu::Device& device) : BackendBinding(window, device) {
    }
    
    uint64_t swapChainImplementation() override {
        if (_swapchainImpl.userData == nullptr) {
            _swapchainImpl = CreateSwapChainImplementation(new SwapChainImplMTL(glfwGetCocoaWindow(_window)));
        }
        return reinterpret_cast<uint64_t>(&_swapchainImpl);
    }
    
    wgpu::TextureFormat preferredSwapChainTextureFormat() override {
        return wgpu::TextureFormat::BGRA8UnormSrgb;
    }
};
```

Where `SwapChainImplMTL` encapsulates platform-related operations such as:

```cpp
   DawnSwapChainError SwapChainImplMTL::Configure(WGPUTextureFormat format,
                                                WGPUTextureUsage usage,
                                                uint32_t width,
                                                uint32_t height) {
        if (format != WGPUTextureFormat_BGRA8UnormSrgb) {
            return "unsupported format";
        }
        
        NSView* contentView = [_nsWindow contentView];
        [contentView setWantsLayer:YES];
        
        CGSize size = {};
        size.width = width;
        size.height = height;
        
        _layer = [CAMetalLayer layer];
        [_layer setDevice:_mtlDevice];
        [_layer setPixelFormat:MTLPixelFormatBGRA8Unorm_sRGB];
        [_layer setDrawableSize:size];
        
        constexpr uint32_t kFramebufferOnlyTextureUsages =
        WGPUTextureUsage_RenderAttachment | WGPUTextureUsage_Present;
        bool hasOnlyFramebufferUsages = !(usage & (~kFramebufferOnlyTextureUsages));
        if (hasOnlyFramebufferUsages) {
            [_layer setFramebufferOnly:YES];
        }
        
        [contentView setLayer:_layer];
        
        return DAWN_SWAP_CHAIN_NO_ERROR;
    }
```

In `Cocoa`, by configuring `[CAMetalLayer layer]`, you can get a view that can be rendered, the bottom layer of the view
will maintain the texture, and every time you call `[_layer nextDrawable]`
, this map is provided to configure the rendering pipeline and render. For details, please refer
to [Apple official documentation](https://developer.apple.com/documentation/quartzcore/camallayer).

## Update rendering context

Back to `RenderContext`, by encapsulating the underlying API into `wgpu::SwapChain`, all platform differences are
smoothed out, and the rest is to configure through the encapsulated interface:

```cpp
class SwapChain : public ObjectBase<SwapChain, WGPUSwapChain> {
      public:
        using ObjectBase::ObjectBase;
        using ObjectBase::operator=;

        void Configure(TextureFormat format, TextureUsage allowedUsage, uint32_t width, uint32_t height) const;
        TextureView GetCurrentTextureView() const;
        void Present() const;

      private:
        friend ObjectBase<SwapChain, WGPUSwapChain>;
        static void WGPUReference(WGPUSwapChain handle);
        static void WGPURelease(WGPUSwapChain handle);
    };
```

`Configure` configures the format and size of the texture; `GetCurrentTextureView` gets the `wgpu::TextureView`
available for the current frame, and `Present` displays the rendered image on the screen. However, on PC , the user may
zoom the window, which will invalidate the originally constructed `wgpu::SwapChain`, so it needs to be reconfigured:

```cpp
void RenderContext::resize(uint32_t width, uint32_t height) {
    if (width != _width || height != _height) {
        _swapchain.Configure(drawableTextureFormat(),
                             wgpu::TextureUsage::RenderAttachment, width, height);
        _depthStencilTexture = _createDepthStencilView(width, height);
    }
    _width = width;
    _height = height;
}
```

## depth and stencil

`wgpu::SwapChain` is only responsible for maintaining the textures required for rendering the screen. If you need to
render a 3D scene, you need to construct additional textures to store depth information. Therefore, the depth and
stencil texture is also constructed in the rendering context, which also needs to be constructed according to the size of
the window:

```cpp
wgpu::TextureView RenderContext::_createDepthStencilView(uint32_t width, uint32_t height) {
    wgpu::TextureDescriptor descriptor;
    descriptor.dimension = wgpu::TextureDimension::e2D;
    descriptor.size.width = width;
    descriptor.size.height = height;
    descriptor.size.depthOrArrayLayers = 1;
    descriptor.sampleCount = 1;
    descriptor.format = _depthStencilTextureFormat;
    descriptor.mipLevelCount = 1;
    descriptor.usage = wgpu::TextureUsage::RenderAttachment;
    auto depthStencilTexture = _binding->device().CreateTexture(&descriptor);
    return depthStencilTexture.CreateView();
}
```

## Construction order

`RenderContext` as the most important rendering concept, will be used to maintain `wgpu::RenderPassDescriptor` and will
be passed to `Subpass` because `wgpu::Device` is stored in it to construct some resources.
Therefore, `std::unique_ptr<RenderContext>` is stored in `GraphicsApplication`. Therefore, sorting out the above
process, the actual construction sequence is as follows:

1. `GraphicsApplication` calls `Engine::createRenderContext`
2. `createRenderContext` constructs a `RenderContext` using `GlfwWindow::createBackendBinding`
3. `GlfwWindow::createBackendBinding` calls specialized functions, such as `createMetalBinding` to create a
   platform-specific `std::unique_ptr<BackendBinding>`

## Practice in Arche.js

Although there are slight differences in language and API, in general the `RenderContext` in Arche.js is very similar to
the above:

```ts
export class RenderContext {
    constructor(adapter: GPUAdapter, device: GPUDevice, context: GPUCanvasContext) {
        this._adapter = adapter;
        this._device = device;
        this._context = context;

        this._size.width = (<HTMLCanvasElement>context.canvas).width;
        this._size.height = (<HTMLCanvasElement>context.canvas).height;
        this._size.depthOrArrayLayers = 1;

        this._configure = new CanvasConfiguration();
        this._configure.device = this._device;
        this._configure.format = this.drawableTextureFormat();
        this._configure.usage = GPUTextureUsage.RENDER_ATTACHMENT;
        this._configure.size = this._size;
        this._context.configure(this._configure);

        this._depthStencilDescriptor.dimension = "2d";
        this._depthStencilDescriptor.size = this._size;
        this._depthStencilDescriptor.sampleCount = 1;
        this._depthStencilDescriptor.format = "depth24plus-stencil8";
        this._depthStencilDescriptor.mipLevelCount = 1;
        this._depthStencilDescriptor.usage = GPUTextureUsage.RENDER_ATTACHMENT;
        this._depthStencilAttachmentView = this._device.createTexture(this._depthStencilDescriptor).createView();
    }
}
```

Where `GPUCanvasContext` is similar to the above concept of `wgpu::Swapchain`:

```ts
interface GPUCanvasContext {
    /**
     * Configures the context for this canvas. Destroys any textures produced with a previous
     * configuration.
     * @param configuration - Desired configuration for the context.
     */
    configure(
        configuration: GPUCanvasConfiguration
    ): undefined;

    /**
     * Removes the context configuration. Destroys any textures produced while configured.
     */
    unconfigure(): undefined;

    /**
     * Returns an optimal {@link GPUTextureFormat} to use with this context and devices created from
     * the given adapter.
     * @param adapter - Adapter the format should be queried for.
     */
    getPreferredFormat(
        adapter: GPUAdapter
    ): GPUTextureFormat;

    /**
     * Get the {@link GPUTexture} that will be composited to the document by the {@link GPUCanvasContext}
     * next.
     * Note: Developers can expect that the same {@link GPUTexture} object will be returned by every
     * call to {@link GPUCanvasContext#getCurrentTexture} made within the same frame (i.e. between
     * invocations of Update the rendering) unless {@link GPUCanvasContext#configure} is called.
     */
    getCurrentTexture(): GPUTexture;
}
```

If `Canvas` in the browser is analogous to `Window`, then `GPUCanvasContext` should also be obtained from `Canvas`:

```ts
/**
 * The canvas used on the web, which can support HTMLCanvasElement and OffscreenCanvas.
 */
export class WebCanvas implements Canvas {
    createRenderContext(adapter: GPUAdapter, device: GPUDevice): RenderContext {
        return new RenderContext(adapter, device, this._webCanvas.getContext("webgpu") as GPUCanvasContext);
    }
}
```

In this way, the update logic of the rendering canvas only needs to be configured through the `Configure` function, and
the rendering pipeline itself only needs to focus on how to record rendering commands and render the rendered objects to
the canvas.
