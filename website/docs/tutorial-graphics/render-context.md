---
sidebar_position: 1
---

# 渲染上下文

在整个渲染管线当中，最为重要的概念就是渲染上下文，`RenderContext` 代表了这一概念，并且封装了 `wgpu::SwapChain`, 从这个类型当中可以获得当前帧所需要的 `wgpu::TextureView`
以及 `wgpu::TextureFormat`，在其构造函数中，我们可以看到：

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

其中 `wgpu::SwapChain` 的构造依赖于 `BackendBinding`，实际上，当我们看到调用该构造函数的位置时，就会发现`BackendBinding`是由 `Window` 提供的：

```cpp
std::unique_ptr<RenderContext> Engine::createRenderContext(wgpu::Device& device) {
    _binding = _window->createBackendBinding(device);
    auto extent = _window->extent();
    auto scale = _window->contentScaleFactor();
    return std::make_unique<RenderContext>(_binding.get(), extent.width * scale, extent.height * scale);
}
```

## 后端绑定

实际上，构造 `BackendBinding` 需要 `GLFWwindow` 和 `wgpu::Device` 两个对象，并且实质上封装了不同类型 API 的构造 SwapChain 的方式：

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
**SwapChain** 表示渲染所需要的双buffer，或者三buffer结构，当渲染当前帧完成后，就会通过 **swap** 操作呈现在屏幕上，而 **chain** 中另外一块可写的区域将写入下一帧的数据。
:::

### Metal

`MetalBinding` 作为 `BackendBinding` 的子类，特化了其中的函数：

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

其中 `SwapChainImplMTL` 将平台相关的操作封装起来例如：

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

在 `Cocoa` 当中，通过配置 `[CAMetalLayer layer]` 就可以得到一块可以渲染的视图，该视图底层会维护贴图，并且在每一次调用 `[_layer nextDrawable]`
时，提供该贴图用于配置渲染管线并渲染。具体可以参考[Apple 官方文档](https://developer.apple.com/documentation/quartzcore/cametallayer)。

## 更新渲染上下文

回到 `RenderContext`，通过将底层API封装成 `wgpu::SwapChain`，所有平台的差异被抹平，剩下就是通过封装后的接口进行配置：

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

其中 `Configure` 配置贴图的格式，大小；`GetCurrentTextureView` 获取当前帧可用的 `wgpu::TextureView`, `Present` 将渲染好的画面显示到屏幕上。但是，在 PC
上，用户可能会将窗口进行缩放，这就导致原先构造的 `wgpu::SwapChain` 失效，因此需要重新进行配置：

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

## 深度和模板

`wgpu::SwapChain` 只负责维护渲染画面所需要的贴图，如果需要渲染三维场景，还需要构造额外的贴图用于存储深度信息。因此，在渲染上下文当中还构造了深度和模板贴图，该贴图也需要根据窗口的大小进行构造：

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

## 构造顺序

`RenderContext` 作为最重要的渲染概念，后续将会用于维护 `wgpu::RenderPassDescriptor` 并且因为其中保存了`wgpu::Device` 因此会被传递到 `Subpass`
中构造一些资源。因此，`std::unique_ptr<RenderContext>` 保存到了 `GraphicsApplication` 当中。因此，整理上述流程，实际的构造顺序如下：
1. `GraphicsApplication` 调用 `Engine::createRenderContext`
2. `createRenderContext` 使用 `GlfwWindow::createBackendBinding` 构造 `RenderContext`
3. `GlfwWindow::createBackendBinding` 调用特化的函数，例如 `createMetalBinding` 创建与特定平台相关的 `std::unique_ptr<BackendBinding>`

## Arche.js 中的实践
尽管语言和API上略有不同，但总体上 Arche.js 中的 `RenderContext` 与上述内容是非常类似的：
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
其中 `GPUCanvasContext` 就类似上述的 `wgpu::Swapchain` 的概念：
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

如果将浏览器当中的 `Canvas` 类比做 `Window`，那么`GPUCanvasContext` 也应该从 `Canvas` 中获取到:
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

通过这样的方式，渲染画布的更新逻辑，只需要通过 `Configure` 函数进行配置即可，而渲染管线本身只需要关注如何录制渲染命令，将渲染的对象渲染到画布上即可。
