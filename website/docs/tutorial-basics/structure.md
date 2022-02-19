---
sidebar_position: 1
---

# 总体架构

## 基于组件与实体的场景描述

Arche 项目全都采用类似 Unity 的组件实体架构对渲染场景进行组织，这样做的好处在于非常容易扩展引擎的能力，因为对于新的能力，例如物理，只需要将 PhysX 封装成物理组件即可。因此，无论在 C++ 还是 TypeScript
的项目当中，都可以看到两个基本类型：`Entity` 和 `Component`。但除此之外，Arche-cpp 和 Arche.js 的整体架构存在一定的区别。出现区别的根本原因，在于 Web 引擎和 Native
引擎的使用场景有所不同。对于Web引擎来说，常常遇到的是一个页面当中会有多 Engine 存在，而 Native 引擎一般不存在这样情况，这使得为了共享各个 Engine 的资源，Engine的对象需要被保存在各个类型当中，而 Native
引擎则不需要。另外，在浏览器当中，Windows 是一个全局变量，因此类似窗口事件，尺寸等信息，可以在每一个类型中获得，而C++引擎则需要设计良好的接口以传递此类信息。

另外一方面，C++ 和 TypeScript 毕竟是两种类型的语言，所以除了引擎架构上的区别，更重要的一个差异体现在**所有权**这个概念上，JS
自带垃圾回收机制，为了减少垃圾回收造成程序的卡顿，在具体方法的实现中，往往会尽可能通过缓存一些静态对象，避免每次新建临时变量。在 C++ 中没有这样的顾虑，却也必须考虑垃圾回收以及避免内存泄漏的各种问题，为了简单起见，我使用了 C++
标准库的`std::shared_ptr` 和 `std::unique_ptr`, 尽管直接用标准库的引用计数类未必是一个最佳实践，但免除实现垃圾回收机制可以使得代码中减少很多宏的处理，简化引擎的代码。对于类似 `Component`
这样依赖实体的组件，我使用 `std::unique_ptr`，对于公共的资源类型，例如 `Mesh` 和 `Material` 我采用了 `std::shared_ptr`。

以上种种造成了 Arche-cpp 和 Arche.js 之间的差异，但是究其根本，两者都是组件实体架构。因此，在使用上，两者的差异是非常小的，这一点可以通过下面两段代码的对比中看到：

```cpp title="Arche-cpp 的组件实体示例"
auto cameraEntity = rootEntity->createChild("camera");
_mainCamera = cameraEntity->addComponent<Camera>();
_mainCamera->resize(width, height);
cameraEntity->transform->setPosition(10, 10, 10);
cameraEntity->transform->lookAt(Point3F(0, 0, 0));
cameraEntity->addComponent<control::OrbitControl>();
```

```ts title="Arche.js 的组件实体示例"
const cameraEntity = rootEntity.createChild("camera");
cameraEntity.addComponent(Camera);
cameraEntity.transform.setPosition(10, 10, 10);
cameraEntity.transform.lookAt(new Vector3());
cameraEntity.addComponent(OrbitControl)
```

:::caution 
尽管 C++ 中提供了例如 `auto` 这种关键字，但在使用时针对引用类型，指针类型，const类型要特别注意，相关内容请参考 C++ 官方文档。

这里需要特别强调的是，在 TypeScript 中，对象可以直接赋值传递，但是 C++ 当中，**`Component` 实际上是以 `std::unique_ptr` 的形式保存在了 `Entity` 当中，并且 `addComponent`
返回其裸指针**，也就是说，组件的析构依赖于实体的析构：

```cpp
    template<typename T>
    T *addComponent() {
        auto component = std::make_unique<T>(this);
        T *componentPtr = component.get();
        _components.emplace_back(std::move(component));
        if (_isActiveInHierarchy) {
            componentPtr->_setActive(true);
        }
        return componentPtr;
    }
```

:::

因此，对于大多数场景，可以直接使用封装好的组件实体。其中最为重要的组件就是 `Transform`, 这一组件在构造 `Entity` 时会被同时构造：

```cpp
Entity::Entity(std::string name) : name(name) {
    transform = addComponent<Transform>();
    _inverseWorldMatFlag = transform->registerWorldChangeFlag();
}
```

通过在 `Entity` 搭建具有子父关系的树形结构，并且通过 `Transform` 组件控制每个节点的平移，旋转，缩放，就可以直接控制场景中物体的坐标位置。同时，在 `Entity` 上配置不同的 `Component`
就使其具备了各种能力。

## 主循环

组件实体架构只是描述了场景中物体的位置以及特定能力，而主循环则实际上触发这些能力，并且执行渲染命令，尽管 Arche-cpp 和 Arche.js 的主循环写在不同的地方，但逻辑是类似的：

```cpp title="Arche-cpp 的主循环"
void ForwardApplication::update(float delta_time) {
    GraphicsApplication::update(delta_time);
    _scene->update(delta_time);
    _scene->updateShaderData();
    
    wgpu::CommandEncoder commandEncoder = _device.CreateCommandEncoder();
    
    // Render the lighting and composition pass
    _colorAttachments.view = _renderContext->currentDrawableTexture();
    _depthStencilAttachment.view = _renderContext->depthStencilTexture();
    
    _renderPass->draw(commandEncoder, "Lighting & Composition Pass");
    // Finalize rendering here & push the command buffer to the GPU
    wgpu::CommandBuffer commands = commandEncoder.Finish();
    _device.GetQueue().Submit(1, &commands);
    _renderContext->present();
}

void Scene::update(float deltaTime) {
    _componentsManager.callScriptOnStart();
    
    _physicsManager.callColliderOnUpdate();
    _physicsManager.update(deltaTime);
    _physicsManager.callColliderOnLateUpdate();
    _physicsManager.callCharacterControllerOnLateUpdate();
    
    _componentsManager.callScriptOnUpdate(deltaTime);
    _componentsManager.callAnimatorUpdate(deltaTime);
    _componentsManager.callSceneAnimatorUpdate(deltaTime);
    _componentsManager.callScriptOnLateUpdate(deltaTime);
    
    _componentsManager.callRendererOnUpdate(deltaTime);
}
```

```ts title="Arche.js 的主循环"
  update():void {
    const time = this._time;
    const deltaTime = time.deltaTime;

    time.tick();
    this._renderElementPool.resetPool();

    const scene = this._sceneManager._activeScene;
    const componentsManager = this._componentsManager;
    if(scene) {
        scene._activeCameras.sort((camera1, camera2) => camera1.priority - camera2.priority);

        componentsManager.callScriptOnStart();
        componentsManager.callScriptOnUpdate(deltaTime);
        componentsManager.callAnimationUpdate(deltaTime);
        componentsManager.callScriptOnLateUpdate(deltaTime);

        this._render(scene);
    }
    this._componentsManager.callComponentDestroy();
}
```

有部分组件在构造的时候，会在其 `onEnable` 方法中，将自身保存到一个管理器类型当中，例如物理组件保存在 `PhysicsMananger`，然后在主循环中，会调用这些管理器的方法对所有组件做批量地更新。
两个引擎的主要区别自安于，在 Arche.js 中，管理器类保存在Engine当中，而 Arche-cpp 中，管理器类保存在场景当中。

### 渲染循环
在 Arche 项目中，根据 WebGPU 自身API的特点，选择使用以 `RenderPass` 和 `Subpass` 的方式组织渲染管线，每一个 `RenderPass` 都保存一个或者多个 `Subpass`:
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
    
    if (_gui) {
        ImDrawData *drawData = ImGui::GetDrawData();
        if (drawData) {
            encoder.PushDebugGroup("GUI Rendering");
            _gui->draw(drawData, encoder);
            encoder.PopDebugGroup();
        }
    }
    encoder.EndPass();
}
```

采用这种方式的主要原因，是在录制 GPU 命令的时候，`RenderPass` 接收 `wgpu::CommandEncoder`，并且构造 `wgpu::RenderPassEncoder`。
而 `Subpass` 则接收 `wgpu::RenderPassEncoder` 并构造 `wgpu::RenderPipeline`，最终调用 draw 命令。这种方式自然符合 WebGPU的管线逻辑，通过自由组合Pass以达到灵活定制管线的能力。

目前，在整个程序的一开始，就会构造默认的以前向渲染为核心的渲染管线：

```cpp title="通过 wgpu::RenderPassDescriptor 构造 RenderPass 并加入 ForwardSubpass "
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
    if (_gui) {
        _renderPass->setGUI(_gui.get());
    }
    
    return true;
}
```

:::info
如果需要添加渲染管线，例如 SkyBox 可以非常简单地在子类中覆盖这一方法：
```cpp
bool SkyboxApp::prepare(Engine &engine) {
    ForwardApplication::prepare(engine);
    ...
    
    auto skybox = std::make_unique<SkyboxSubpass>(_renderContext.get(), _scene.get(), _mainCamera);
    skybox->createCuboid();
    skybox->setTextureCubeMap(cubeMap);
    _renderPass->addSubpass(std::move(skybox));
    
    return true;
}
```
:::

:::caution
在上述例子中也可以注意到 `Subpass` 以 `std::unique_ptr` 保存在 `RenderPass` 当中，因此 `Subpass` 的析构依赖于 `RenderPass` 
:::
