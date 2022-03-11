---
sidebar_position: 13
---

# GUI and editor

![editor](https://arched-graphics.oss-cn-shanghai.aliyuncs.com/img/editor.gif)

## IMGUI integration

The Arche project is developed around 3D graphics technology. The future goal is to develop editors for specific needs,
but it is still at the level of algorithms and functions. At present, Arche-cpp has integrated `IMGUI` as the main core
part of the GUI. Since `IMGUI` provides an adapter for the WebGPU interface, it is easy to access the engine:

```cpp
GUI::GUI(RenderContext* context) {
    ImGui_ImplWGPU_Init(context->device().Get(), 3,
                        (WGPUTextureFormat)context->drawableTextureFormat(),
                        (WGPUTextureFormat)context->depthStencilTextureFormat());
}

GUI::~GUI() {
    ImGui_ImplWGPU_Shutdown();
}

void GUI::newFrame() {
    ImGui_ImplWGPU_NewFrame();
}

void GUI::draw(ImDrawData* drawData,
               wgpu::RenderPassEncoder& passEncoder) {
    ImGui_ImplWGPU_RenderDrawData(drawData, passEncoder.Get());
}
```

### GUI rendering

The core of rendering is `newFrame` that needs to be called at the beginning of each frame and `draw` that needs to be
called at the end of each frame. The former fires at the beginning of the main loop:

````cpp
void GraphicsApplication::update(float delta_time) {
     if (_gui) {
         _gui->newFrame();
     }
}
````

The latter is built directly into `RenderPass`, which fires after all non-GUI rendering commands are submitted:

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
    encoder.End();
}
```

### GUI events

Events are directly related to windows, so when `GlfwWindow` dispatches events, it also sends events to `IMGUI` for
processing:

````cpp
void GlfwWindow::processEvents() {
     glfwPollEvents();
     ImGui_ImplGlfw_NewFrame();
}
````

At the same time, the window also complexly initializes the configuration parameters of `IMGUI`:

```cpp
void GlfwWindow::_createGUIContext(const Window::Properties &properties) {
    // Setup Dear ImGui context
    IMGUI_CHECKVERSION();
    ImGui::CreateContext();
    
    ImGuiStyle &style = ImGui::GetStyle();
    
    // Color scheme
    style.Colors[ImGuiCol_TitleBg] = ImVec4(1.0f, 0.0f, 0.0f, 0.6f);
    style.Colors[ImGuiCol_TitleBgActive] = ImVec4(1.0f, 0.0f, 0.0f, 0.8f);
    style.Colors[ImGuiCol_MenuBarBg] = ImVec4(1.0f, 0.0f, 0.0f, 0.4f);
    style.Colors[ImGuiCol_Header] = ImVec4(1.0f, 0.0f, 0.0f, 0.4f);
    style.Colors[ImGuiCol_HeaderActive] = ImVec4(1.0f, 0.0f, 0.0f, 0.4f);
    style.Colors[ImGuiCol_HeaderHovered] = ImVec4(1.0f, 0.0f, 0.0f, 0.4f);
    style.Colors[ImGuiCol_FrameBg] = ImVec4(0.0f, 0.0f, 0.0f, 0.8f);
    style.Colors[ImGuiCol_CheckMark] = ImVec4(0.0f, 1.0f, 0.0f, 1.0f);
    style.Colors[ImGuiCol_SliderGrab] = ImVec4(1.0f, 0.0f, 0.0f, 0.4f);
    style.Colors[ImGuiCol_SliderGrabActive] = ImVec4(1.0f, 0.0f, 0.0f, 0.8f);
    style.Colors[ImGuiCol_FrameBgHovered] = ImVec4(1.0f, 1.0f, 1.0f, 0.1f);
    style.Colors[ImGuiCol_FrameBgActive] = ImVec4(1.0f, 1.0f, 1.0f, 0.2f);
    style.Colors[ImGuiCol_Button] = ImVec4(1.0f, 0.0f, 0.0f, 0.4f);
    style.Colors[ImGuiCol_ButtonHovered] = ImVec4(1.0f, 0.0f, 0.0f, 0.6f);
    style.Colors[ImGuiCol_ButtonActive] = ImVec4(1.0f, 0.0f, 0.0f, 0.8f);
    
    // Borderless window
    style.WindowBorderSize = 0.0f;
    
    // Global scale
    style.ScaleAllSizes(dpiFactor());
    
    ImGuiIO &io = ImGui::GetIO();
    io.DisplaySize.x = static_cast<float>(properties.extent.width);
    io.DisplaySize.y = static_cast<float>(properties.extent.height);
    io.FontGlobalScale = 1.0f;
    io.DisplayFramebufferScale = ImVec2(1.0f, 1.0f);
    io.Fonts->AddFontFromFileTTF("../assets/Fonts/Roboto-Regular.ttf", 16.0f);
    
    ImGui_ImplGlfw_InitForOpenGL(_handle, true);
}
```

## editor component

The editor in immediate mode makes it easy to bind GUI components with data. However, in order to achieve scalability,
certain processing needs to be done on the architecture. First, `IMGUI` is the same as rendering, the control needs to
be resubmitted every frame. So you can submit the GUI rendering command in the `onUpdate` of the script component:

```cpp
class GUIEntry : public Script {
public:
    GUIEntry(Entity *entity);
    
    ~GUIEntry();
    
    void setRenderer(Renderer *render);
    
    void onUpdate(float deltaTime) override;
    
    void addEditorComponent(std::unique_ptr<EditorComponent> &&component);
    
    void removeEditorComponent(EditorComponent *component);
};
```

As the main entry `GUIEntry` integrates a series of tools such as `OrbitControl`, `FramebufferPicker`, `Gizmo`. And more
functionality can be added by extending `EditorComponent`:

```cpp
class EditorComponent {
public:
    virtual ~EditorComponent() {
    }
    
    virtual void onUpdate() = 0;
};
```
