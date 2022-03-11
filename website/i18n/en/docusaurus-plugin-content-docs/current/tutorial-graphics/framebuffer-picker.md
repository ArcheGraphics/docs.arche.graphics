---
sidebar_position: 13
---

# Framebuffer Picker

![picker](https://arched-graphics.oss-cn-shanghai.aliyuncs.com/img/picker.gif)

Frame buffer picking is a very important function in the development of graphics editors. This function marks each
object in the scene with a color for rendering, and then reads the rendered texture and determines which object is
picked by color. Compared to raycast, which relies on physics-engine, framebuffer picking only depends
on the rendering system. But since this technique not only relies on `Subpass`, it also needs to be used
for `OnSubmittedWorkDone`.
This function provides a callback function that reads the data in the texture after completing the submitted rendering
task, which is a very comprehensive example so far. With this example, we'll see how to add a wait operation for
rendering, and how to configure the various modules so that this wait completes as quickly as possible.

## Render Subpass

The implementation of `ColorPickerSubpass` is very simple, using almost the same code as `ForwardSubpass`, while only
using `UnlitMaterial` as the material for all rendered objects. For each rendered object, number it in order, then
convert the `uint32_t` number to a `Vector3F` color:

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

It should be noted that this color cannot be uploaded directly with the `ShaderData` in `UnlitMaterial`, because the
entire rendering shares a material, so each rendering requires a different `Buffer` to save these colors. This is
because `DrawIndexed` is called When it is not rendered, if the next object uploads the color again, it will overwrite
the previous data. Therefore, an additional `BufferPool` needs to be maintained:

````cpp
// prealloc buffer
size_t total = opaqueQueue.size() + alphaTestQueue.size() + transparentQueue.size();
_bufferPool.reserve(total);
for (size_t i = _bufferPool.size(); i < total; i++) {
     _bufferPool.push_back(Buffer(_renderContext->device(), sizeof(Color), wgpu::BufferUsage::Uniform | wgpu::BufferUsage::CopyDst));
}
````

## Read Color

Since the actual rendering happens after the `wgpu::CommandBuffer` is submitted, you must wait for all rendering to
complete before taking the color from the texture. `wgpu::Queue` provides a method `OnSubmittedWorkDone` with a callback
function:

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

This function is triggered after the rendering command is completed, and the `_readColorFromRenderTarget` function can
read the data in the texture.

Reading texture data is not as simple as uploading texture data. First, you need to copy the data to a `wgpu::Buffer`
located on the GPU. This buffer is constructed as follows:

````cpp
wgpu::BufferDescriptor bufferDesc;
bufferDesc.usage = wgpu::BufferUsage::MapRead | wgpu::BufferUsage::CopyDst;
bufferDesc.size = 4;
_stageBuffer = _device.CreateBuffer(&bufferDesc);
````

`wgpu::BufferUsage::MapRead` means that this buffer can use the `MapAsync` method to map memory addresses in the GPU to
main memory, and a size of 4 means that only attempts to read a pixel from the map data. By reducing the amount of data
read, the execution of the callback function is accelerated as soon as possible to avoid blocking the entire rendering
process. Because the copying of `wgpu::Texture` to `wgpu::Buffer` happens on the GPU, it needs to be done before
submitting the rendering command:

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

Finally, after rendering is complete, call `_readColorFromRenderTarget` to read the data:

````cpp
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
````

`MapAsync` is an asynchronous function, this design conforms to the asynchronous operation habit of JavaScript in the
browser. Therefore, in the callback function, you can use `GetConstMappedRange` to map a specific memory address and
copy it to the main memory object. After all copying is done, the `Unmap` function closes the memory map so that the
next rendering cycle can continue.

## Summarize

Frame buffer picking is a relatively comprehensive technology, the most critical of which is the copying between data
and waiting for the rendering command to complete this step. Of course, waiting takes time. For frames that do not need
to be picked up, you can continuously submit commands to the GPU, and the GPU will render the pictures in the order in
which the commands are submitted, but the additional synchronization caused by waiting makes the overhead more
expensive, so synchronization is only enabled when necessary:

```cpp
void EditorApplication::pick(float offsetX, float offsetY) {
    _needPick = true;
    _pickPos = Vector2F(offsetX, offsetY);
}
```

So far in this section, the basic technology used by the engine in graphics rendering has been introduced, after
implementing basic functions such as texture reading and rendering pipeline organization. The following is more about
the technical implementation related to graphics rendering algorithms.
:::note

Modern graphics APIs make the engine more natural to use multi-threading technology. Of course, WebGPU can currently
record `wgpu::CommandEncoder` in threads. The Arche engine may be refactored in this direction in the future. However,
the main goal is to keep it simple at present, and further optimization will be made when performance bottlenecks are
encountered.
:::
