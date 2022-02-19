---
sidebar_position: 1
---

# Overall Architecture

## Component and Entity-based scene description

Arche projects all use a Unity-like component entity architecture to organize the rendering scene. The advantage of this
is that it is very easy to extend the capabilities of the engine, because for new capabilities, such as physics, it is
only necessary to encapsulate PhysX into physical components. Therefore, whether in C++ or TypeScript , you can see two
basic types: `Entity` and `Component`. But beyond that, there are certain differences in the overall architecture of
Arche-cpp and Arche.js. The fundamental reason for the difference lies in the Web engine and Native Engine usage
scenarios vary. For Web engines, it is often encountered that there will be multiple Engines in a page, but Native
engines generally do not have such a situation, which makes the objects of Engines need to be stored in various types in
order to share the resources of each Engine. Native The engine is not required. In addition, in the browser, Windows is
a global variable, so information such as window events, size, etc. can be obtained in each type, and the C++ engine
needs a well-designed interface to transmit such information.

On the other hand, C++ and TypeScript are two types of languages after all, so in addition to the difference in engine
architecture, a more important difference is reflected in the concept of **ownership**, JS With its own garbage
collection mechanism, in order to reduce the stuttering of the program caused by garbage collection, in the
implementation of specific methods, some static objects are often cached as much as possible to avoid creating temporary
variables each time. There are no such concerns in C++, but also garbage collection and various issues of avoiding
memory leaks must be considered, for simplicity I use C++
`std::shared_ptr` and `std::unique_ptr` of the standard library, although it is not necessarily a best practice to use
the reference counting classes of the standard library directly, but avoiding the implementation of garbage collection
mechanism can reduce the processing of many macros in the code, simplifying Engine code. For something like `Component`,
the unique component depended on entities, I use `std::unique_ptr`, and for common resource types such as `Mesh` and `Material` I
use `std::shared_ptr`.

All the above have created the difference between Arche-cpp and Arche.js, but at the root, both are component entity
architectures. Therefore, in use, the difference between the two is very small, which can be seen from the comparison of
the following two pieces of code:

```cpp title="Example of Component Entity for Arche-cpp"
auto cameraEntity = rootEntity->createChild("camera");
_mainCamera = cameraEntity->addComponent<Camera>();
_mainCamera->resize(width, height);
cameraEntity->transform->setPosition(10, 10, 10);
cameraEntity->transform->lookAt(Point3F(0, 0, 0));
cameraEntity->addComponent<control::OrbitControl>();
````

```ts title="Example of Component Entity for Arche.js"
const cameraEntity = rootEntity.createChild("camera");
cameraEntity.addComponent(Camera);
cameraEntity.transform.setPosition(10, 10, 10);
cameraEntity.transform.lookAt(new Vector3());
cameraEntity.addComponent(OrbitControl)
````

:::caution 
Although keywords such as `auto` are provided in C++, special attention should be paid to reference types,
pointer types, and const types when using them. For related content, please refer to the official C++ documentation.

What needs to be emphasized here is that in TypeScript, objects can be directly passed by assignment, but in
C++, **`Component` is actually stored in `Entity` in the form of `std::unique_ptr`, and `addComponent` returns its raw
pointer**, that is, the destruction of the component depends on the destruction of the entity:

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

Therefore, for most scenarios, the encapsulated component entity can be used directly. One of the most important
components is `Transform`, which is constructed at the same time when the `Entity` is constructed:

````cpp
Entity::Entity(std::string name) : name(name) {
     transform = addComponent<Transform>();
     _inverseWorldMatFlag = transform->registerWorldChangeFlag();
}
````

By building a tree structure with a child-parent relationship in `Entity`, and controlling the translation, rotation,
and scaling of each node through the `Transform` component, you can directly control the coordinate position of objects
in the scene. Also, configure different `Component` on `Entity`
It has various abilities.

## Main Loop

The component entity architecture just describes the location of objects in the scene and specific capabilities, and the
main loop actually triggers these capabilities and executes rendering commands. Although the main loop of Arche-cpp and
Arche.js is written in different places, the logic is akin:

```cpp title="Arche-cpp's main loop"
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
````

```ts title="Arche.js main loop"
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
````

When some components are constructed, they will save themselves to a manager type in their `onEnable` method. For
example, the physical components are saved in `PhysicsMananger`, and then in the main loop, the methods of these
managers will be called. All components are updated in batches. The main difference between the two engines is that in
Arche.js, the manager class is stored in the Engine, while in Arche-cpp, the manager class is stored in the scene.

### Render Loop

In the Arche project, according to the characteristics of WebGPU's own API, choose to use `RenderPass` and `Subpass` to
organize the rendering pipeline, each `RenderPass` saves one or more `Subpass`:

````cpp
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
````

The main reason for this approach is that when recording GPU commands, `RenderPass` receives `wgpu::CommandEncoder` and
constructs `wgpu::RenderPassEncoder`. And `Subpass` receives `wgpu::RenderPassEncoder` and
constructs `wgpu::RenderPipeline`, and finally calls the draw command. This method is naturally in line with the
pipeline logic of WebGPU, and the ability to flexibly customize the pipeline can be achieved by freely combining Passes.

Currently, at the very beginning of the entire program, a default forward rendering-centric rendering pipeline is
constructed:

```cpp title="Construct RenderPass through wgpu::RenderPassDescriptor and add ForwardSubpass "
bool ForwardApplication::prepare(Engine &engine) {
    GraphicsApplication::prepare(engine);
    
    _scene = std::make_unique<Scene>(_device);
    
    auto extent = engine.window().extent();
    loadScene(extent.width, extent.height);
        
    // Create a render pass descriptor for the lighting and composition pass
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
````

:::info 
If you need to add a rendering pipeline, such as SkyBox, you can simply override this method in a subclass:
````cpp
bool SkyboxApp::prepare(Engine &engine) {
     ForwardApplication::prepare(engine);
     ...
    
     auto skybox = std::make_unique<SkyboxSubpass>(_renderContext.get(), _scene.get(), _mainCamera);
     skybox->createCuboid();
     skybox->setTextureCubeMap(cubeMap);
     _renderPass->addSubpass(std::move(skybox));
    
     return true;
}
````

:::

:::caution 
Also notice in the above example that `Subpass` is stored in `RenderPass` as `std::unique_ptr`, so the
destructor of `Subpass` depends on `RenderPass`
:::
