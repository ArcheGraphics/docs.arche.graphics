---
sidebar_position: 2
---

# initialization

In the App, you can see that the main function is as follows:

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

Among them, something like `PrimitiveApp` is just a subclass of `Application`, and different scenarios can be set by
configuring different subclasses. As you can see from this function, you first need to initialize `UnixEngine`, which is
for `Unix`
A platform-specialized `Engine` subclass, mainly responsible for specializing the `createWindow` function to create
platform-dependent windows:

```cpp
void UnixEngine::createWindow(const Window::Properties &properties) {
    _window = std::make_unique<GlfwWindow>(this, properties);
}
```

Therefore, you can create the corresponding implementation according to the needs of your own platform.

## Engine

`Engine` essentially concatenates `Windows` and `Application`, and forwards events from `Windows` to `Application` for
processing.

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

`GLFW` uses event monitoring to control the events of the entire window. A series of callback functions are registered
during construction. When `glfwPollEvents` is called, these callback functions are called at one time, for example:

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

In these callback functions, events are encapsulated as `InputEvent` objects and sent to `Engine`, and finally forwarded
to `Application`.
:::tip 
Encapsulation into `InputEvent` enables other types of operating system windows, such as `SDL` or `Cocoa`, even
if the callback function has a different form, the result can be packaged into `InputEvent`, so that upper-level users
have no idea about the underlying behavior. feel.
:::

## Application

`Application` is the main entrance of the application. You can construct suitable applications as needed through
subclass inheritance. Currently, the following inheritance relationships exist in Arche-cpp:

1. Application: defines the basic interface of `Application`
2. GraphicsApplication: Construct WebGPU-based objects, including `wgpu::Device`, `RenderContext`
3. ForwardApplication: Defines the forward rendering pipeline as the core application, and the scenes in the executable
   file App are based on this type.
4. EditorApplication: Defines the texture reading methods including forward rendering and FrameBufferPicker, so that a
   variety of scene editing methods can be added. The executable file Editor is based on this type.

Because `Application` is almost responsible for the assets and execution logic of the entire engine, it will not be
expanded here, including rendering loops, physical components, etc., please refer to the subsequent tutorials.

## Compare with Arche.js

The architecture described above does not exist in Arche.js, because the browser itself handles many issues including
creating windows, responding to events, and cross-platform. In the specific use, the core is to construct the `Canvas`
canvas, namely:

```html

<body style="margin: 0; padding: 0">
<canvas id="canvas" style="width: 100vw; height: 100vh"></canvas>
<script type="module" src="/apps/main.js"></script>
</body>
```

At the same time, the initialization of WebGPU is asynchronous, so it is necessary to construct the objects required by
the scene in the `Promise`:

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
