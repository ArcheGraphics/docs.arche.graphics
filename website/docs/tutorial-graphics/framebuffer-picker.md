---
sidebar_position: 13
---

# 帧缓冲拾取

帧缓冲拾取是图形编辑器开发中非常重要的一项功能，这一功能将场景中每个物体都标记一种颜色进行渲染，然后读取渲染后的贴图，通过颜色判断拾取到哪一种物体。
相比于射线检测这种依赖物理引擎的拾取方法，帧缓冲拾取只依赖于渲染系统。但由于这一技术不仅依赖于 `Subpass`，还需要为 `OnSubmittedWorkDone`
这一函数提供一个回调函数，即在完成提交的渲染任务后才读取贴图中的数据，算是到目前为止的一个非常综合的例子。 通过这一例子，我们将看到如何为渲染添加等待操作，以及如何配置各个模块，使得这种等待尽可能快速完成。

## 渲染子通道

`ColorPickerSubpass` 的实现非常简单，使用和 `ForwardSubpass` 几乎一样的代码，同时只使用 `UnlitMaterial` 作为所有渲染物体的材质。
对于每个渲染物体，按照顺序进行编号，然后将 `uint32_t` 的编号转化成 `Vector3F` 的颜色：

```cpp
Vector3F ColorPickerSubpass::id2Color(uint32_t id) {
    if (id >= 0xffffff) {
        std::cout << "Framebuffer Picker encounter primitive's id greater than " + std::to_string(0xffffff)
        << std::endl;
        return Vector3F(0, 0, 0);
    }
    
    return Vector3F((id & 0xff) / 255.0, ((id & 0xff00) >> 8) / 255.0, ((id & 0xff0000) >> 16) / 255.0);
}

void ColorPickerSubpass::_drawElement(wgpu::RenderPassEncoder &passEncoder,
                                      const std::vector<RenderElement> &items,
                                      const ShaderMacroCollection& compileMacros) {
    for (auto &element : items) {
        auto macros = compileMacros;
        auto& renderer = element.renderer;
        renderer->shaderData.mergeMacro(macros, macros);
        auto& mesh = element.mesh;
        auto& subMesh = element.subMesh;
        
        _primitivesMap[_currentId] = std::make_pair(renderer, mesh);
        Vector3F color = id2Color(_currentId);
        auto reverseColor = Color(color.z, color.y, color.x, 1);
        Buffer& buffer = _bufferPool[_currentId];
        buffer.uploadData(_renderContext->device(), &reverseColor, sizeof(Color));
        _currentId += 1;
        
        ...
    }
}
```

需要特别注意的是，不能直接用 `UnlitMaterial` 中的 `ShaderData` 上传这一颜色，因为整个渲染都是共享一个材质，才每次渲染都需要不同的 `Buffer` 保存这些颜色。 这是因为调用 `DrawIndexed`
的时候并没有渲染，而下一个物体如果再次上传颜色，就会覆盖之前的数据。因此，需要额外维护一个 `BufferPool`：

```cpp
// prealloc buffer
size_t total = opaqueQueue.size() + alphaTestQueue.size() + transparentQueue.size();
_bufferPool.reserve(total);
for (size_t i = _bufferPool.size(); i < total; i++) {
    _bufferPool.push_back(Buffer(_renderContext->device(), sizeof(Color), wgpu::BufferUsage::Uniform | wgpu::BufferUsage::CopyDst));
}
```

## 读取颜色

由于真正的渲染发生在提交 `wgpu::CommandBuffer` 之后，因此必须等待所有渲染完成，才能从贴图中取出颜色。`wgpu::Queue` 提供了一个带有回调函数的方法 `OnSubmittedWorkDone`：

```cpp
_device.GetQueue().OnSubmittedWorkDone(0, [](WGPUQueueWorkDoneStatus status, void * userdata) {
    if (status == WGPUQueueWorkDoneStatus_Success) {
        EditorApplication* app = static_cast<EditorApplication*>(userdata);
        if (app->_needPick) {
            app->_readColorFromRenderTarget();
            app->_needPick = false;
        }
    }
}, this);
```

该函数在渲染命令完成后触发，`_readColorFromRenderTarget` 函数就可以将贴图中的数据读取出来。

读取贴图数据并不像上传贴图数据那么简单，首先需要将数据复制到一块位于GPU的 `wgpu::Buffer`，这块缓存通过如下方式构造：

```cpp
wgpu::BufferDescriptor bufferDesc;
bufferDesc.usage = wgpu::BufferUsage::MapRead | wgpu::BufferUsage::CopyDst;
bufferDesc.size = 4;
_stageBuffer = _device.CreateBuffer(&bufferDesc);
```

`wgpu::BufferUsage::MapRead` 意味着这块缓存可以使用 `MapAsync` 方法将 GPU 内的内存地址映射到主存上，而大小为 4 则意味着只试图从贴图中读取一个像素上的数据。
通过减少读取的数据量，尽快加速回调函数的执行，以避免阻塞整个渲染流程。因为 `wgpu::Texture` 到 `wgpu::Buffer` 的拷贝发生在GPU，因此需要在提交渲染命令之前进行：

```cpp
void EditorApplication::update(float delta_time) {
    ....
    
    _renderPass->draw(commandEncoder, "Lighting & Composition Pass");
    if (_needPick) {
        _colorPickerColorAttachments.view = _colorPickerTexture.CreateView();
        _colorPickerDepthStencilAttachment.view = _renderContext->depthStencilTexture();
        _colorPickerRenderPass->draw(commandEncoder, "color Picker Pass");
        _copyRenderTargetToBuffer(commandEncoder);
    }
    // Finalize rendering here & push the command buffer to the GPU
    wgpu::CommandBuffer commands = commandEncoder.Finish();
    
    ....
}

void EditorApplication::_copyRenderTargetToBuffer(wgpu::CommandEncoder& commandEncoder) {
    uint32_t clientWidth = _mainCamera->width();
    uint32_t clientHeight = _mainCamera->height();
    uint32_t canvasWidth = static_cast<uint32_t>(_colorPickerTextureDesc.size.width);
    uint32_t canvasHeight = static_cast<uint32_t>(_colorPickerTextureDesc.size.height);

    const float px = (_pickPos.x / clientWidth) * canvasWidth;
    const float py = (_pickPos.y / clientHeight) * canvasHeight;

    const auto viewport = _mainCamera->viewport();
    const auto viewWidth = (viewport.z - viewport.x) * canvasWidth;
    const auto viewHeight = (viewport.w - viewport.y) * canvasHeight;

    const float nx = (px - viewport.x) / viewWidth;
    const float ny = (py - viewport.y) / viewHeight;
    const uint32_t left = std::floor(nx * (canvasWidth - 1));
    const uint32_t bottom = std::floor((1 - ny) * (canvasHeight - 1));
    
    _imageCopyTexture.origin = wgpu::Origin3D{left, canvasHeight - bottom, 0};
    commandEncoder.CopyTextureToBuffer(&_imageCopyTexture, &_imageCopyBuffer, &_extent);
}
```

最后才可以在渲染完成之后，调用 `_readColorFromRenderTarget` 将数据读取出来：

```cpp
void EditorApplication::_readColorFromRenderTarget() {
    _stageBuffer.MapAsync(wgpu::MapMode::Read, 0, 4, [](WGPUBufferMapAsyncStatus status, void * userdata) {
        if (status == WGPUBufferMapAsyncStatus_Success) {
            EditorApplication* app = static_cast<EditorApplication*>(userdata);
            memcpy(app->_pixel.data(), app->_stageBuffer.GetConstMappedRange(0, 4), 4);
            auto picker = app->_colorPickerSubpass->getObjectByColor(app->_pixel);
            app->pickFunctor(picker.first, picker.second);
            
            app->_stageBuffer.Unmap();
        }
    }, this);
}
```

`MapAsync` 是一个异步函数，这种设计符合 JavaScript 在浏览器当中异步的操作习惯。 因此在回调函数当中，就可以使用 `GetConstMappedRange` 将特定的内存地址映射出来，复制到主存的对象当中。
在完成所有拷贝工作后，`Unmap` 函数关闭内存映射，这样才能继续下一个渲染循环。

## 总结

帧缓冲拾取是一个相对比较综合的技术，其中最为关键的是数据之间的拷贝，以及等待渲染命令完成这一步。当然，等待是需要时间的。
对于不需要拾取的帧，可以不断向GPU提交命令，GPU会按照提交命令的顺序渲染画面，但是等待造成的额外同步，使得其中的开销比较昂贵，因此也只在必要的时候开启同步：
```cpp
void EditorApplication::pick(float offsetX, float offsetY) {
    _needPick = true;
    _pickPos = Vector2F(offsetX, offsetY);
}
```

到这一节为止，引擎在图形渲染上使用的基础技术已经介绍完了，在实现了贴图的读取，渲染管线组织等基础功能后。后面更多则是围绕着图形渲染算法相关的技术实现展开介绍。
:::note
现代图形API使得引擎可以更自然地使用多线程技术，当然 WebGPU 目前可以在线程中录制 `wgpu::CommandEncoder`，Arche 引擎未来有可能会向着这个方向进行重构。
但目前任意保持简单为主要目标，等遇到性能瓶颈的时候，再做进一步的优化。
:::
