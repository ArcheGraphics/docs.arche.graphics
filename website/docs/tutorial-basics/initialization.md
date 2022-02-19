---
sidebar_position: 2
---

# 初始化逻辑

在 App 的可以看到 main 函数如下所示：

```cpp
int main(int argc, char * argv[]) {
    vox::UnixEngine engine{vox::UnixType::Mac, argc, argv};
        
    auto code = engine.initialize();
    if (code == vox::ExitCode::Success) {
        engine.setApp(std::make_unique<vox::PrimitiveApp>());
        utils::ScopedAutoreleasePool pool;
        code = engine.mainLoop();
    }
    
    engine.terminate(code);
    
    return EXIT_SUCCESS;
}
```

其中 类似 `PrimitiveApp` 只不过是 `Application` 的子类，可以通过配置不同的子类来设置不同的场景。从这段函数中可以看到，首先需要初始化 `UnixEngine`，这是针对 `Unix`
平台特化的一种 `Engine` 子类，主要负责特化 `createWindow` 函数，以创建平台依赖的窗口：

```cpp
void UnixEngine::createWindow(const Window::Properties &properties) {
    _window = std::make_unique<GlfwWindow>(this, properties);
}
```

因此，你可以根据自己平台的需要创建对应的实现。

## Engine

`Engine` 实质上串联了 `Windows` 和 `Application`, 并且将 `Windows` 中的事件转发到 `Application` 中进行处理。

```cpp
void GlfwWindow::processEvents() {
    glfwPollEvents();
    ImGui_ImplGlfw_NewFrame();
}

ExitCode Engine::mainLoop() {
    // Load the requested app
    if (!startApp()) {
        LOG(ERROR) << "Failed to load requested application";
        return ExitCode::FatalError;
    }
    
    // Compensate for load times of the app by rendering the first frame pre-emptively
    _timer.tick<Timer::Seconds>();
    _activeApp->update(0.01667f);
    
    while (!_window->shouldClose()) {
        try {
            update();
            
            _window->processEvents();
        }
        catch (std::exception &e) {
            LOG(ERROR) << "Error Message: " << e.what();
            LOG(ERROR) << "Failed when running application " << _activeApp->name();
            
            return ExitCode::FatalError;
        }
    }
    
    return ExitCode::Success;
}
```

`GLFW` 使用事件监听的方式控制整个窗口的事件，在构造的时候就会将一系列回调函数注册进去，当调用 `glfwPollEvents` 时会一次性调用这些回调函数，例如：

```cpp
void mouseButtonCallback(GLFWwindow *window, int button, int action, int /*mods*/) {
    MouseAction mouse_action = translateMouseAction(action);
    
    if (auto *engine = reinterpret_cast<Engine *>(glfwGetWindowUserPointer(window))) {
        double xpos, ypos;
        glfwGetCursorPos(window, &xpos, &ypos);
        
        engine->inputEvent(MouseButtonInputEvent{
            translateMouseButton(button),
            mouse_action,
            static_cast<float>(xpos),
            static_cast<float>(ypos)});
    }
}

void Engine::inputEvent(const InputEvent &inputEvent) {
    if (_processInputEvents && _activeApp) {
        _activeApp->inputEvent(inputEvent);
    }
    
    if (inputEvent.source() == EventSource::Keyboard) {
        const auto &key_event = static_cast<const KeyInputEvent &>(inputEvent);
        
        if (key_event.code() == KeyCode::Back ||
            key_event.code() == KeyCode::Escape) {
            close();
        }
    }
}
```

在这些回调函数中，事件会被封装成 `InputEvent` 对象发送到 `Engine`, 最终再转发到 `Application` 当中。
:::tip 
封装成 `InputEvent` 使得对于其他种类的操作系统窗口，例如 `SDL` 或者 `Cocoa`，即使回调函数的形式有所不同，但都可以将结果打包成 `InputEvent`，使得上层用户对底层行为无感。
:::

## Application
`Application` 是应用的主入口，可以通过子类继承的方式按需构造合适的应用程序，目前 Arche-cpp 中存在以下继承关系：
1. Application：定义了 `Application` 的基础接口
2. GraphicsApplication：构造 WebGPU 基础的对象，包括 `wgpu::Device`, `RenderContext`
3. ForwardApplication: 定义了前向渲染管线为核心的应用，可执行文件 App 中的场景均基于此类型。
4. EditorApplication：定义了包括前向渲染以及 FrameBufferPicker 所需要的贴图读取方法，以此可以增加多种场景编辑方法， 可执行文件 Editor 基于此类型。

因为 `Application` 几乎负责了整个引擎的资产和执行逻辑，因此此处不再展开，具体包括渲染循环，物理组件等等信息，请参考后续教程。

## 与 Arche.js 对比
上述介绍的架构，在 Arche.js 中都不存在，因为浏览器本身处理了包括创建窗口，响应事件，跨平台等诸多问题。在具体使用时，最核心的是构造 `Canvas` 画布，即：
```html
<body style="margin: 0; padding: 0">
    <canvas id="canvas" style="width: 100vw; height: 100vh"></canvas>
    <script type="module" src="/apps/main.js"></script>
</body>
```

同时，WebGPU 的初始化是异步的，因此需要在 `Promise` 中构造场景所需要的对象：
```ts
init(): Promise<void> {
    return new Promise<void>((resolve => {
      navigator.gpu.requestAdapter({
        powerPreference: "high-performance"
      }).then((adapter) => {
        this._adapter = adapter;
        this._adapter.requestDevice().then((device) => {
          this._device = device;

          this._renderContext = this._canvas.createRenderContext(this._adapter, this._device);
          this._renderPasses.push(new ForwardRenderPass(this));
          this._sceneManager.activeScene = new Scene(this, "DefaultScene");
          resolve();
        });
      });
    }));
}
```
