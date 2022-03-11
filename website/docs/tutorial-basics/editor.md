---
sidebar_position: 13
---

# GUI 与编辑器

![editor](https://arched-graphics.oss-cn-shanghai.aliyuncs.com/img/editor.gif)

## IMGUI 整合
Arche 项目围绕着3D图形技术进行开发，未来的目标是发展面向特定需求的编辑器，但目前仍然停留在算法和功能层面。目前Arche-cpp 已经接入了 `IMGUI` 作为 GUI 的主要核心部分。
由于 `IMGUI` 提供了对于 WebGPU 接口的适配器，因此很容易接入到引擎内部：
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

### GUI渲染
渲染的核心的是每一帧开始时需要调用的 `newFrame` 和 每一帧结束时需要调用的 `draw`。前者在主循环的开始时触发：
```cpp
void GraphicsApplication::update(float delta_time) {
    if (_gui) {
        _gui->newFrame();
    }
}
```
后者则直接内置到 `RenderPass` 当中，在所有非GUI的渲染命令提交后触发：
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

### GUI事件
事件和窗口有着直接的联系，因此在 `GlfwWindow` 派发事件的同时，也将事件发送给 `IMGUI` 进行处理：
```cpp
void GlfwWindow::processEvents() {
    glfwPollEvents();
    ImGui_ImplGlfw_NewFrame();
}
```
同时窗口也复杂初始化 `IMGUI` 的配置参数：
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

## 编辑器组件
即时模式的编辑器非常容易将 GUI 组件与数据绑定在一起。但是为了实现扩展性，还是需要在架构上进行一定的处理。首先，`IMGUI` 和渲染一样，控件每一帧都需要重新提交一次。
因此可以通过在脚本组件的 `onUpdate` 中提交GUI的渲染命令即可：
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

作为主入口 `GUIEntry` 整合了 `OrbitControl`, `FramebufferPicker`, `Gizmo` 等一系列工具。并且可以通过扩展 `EditorComponent` 添加更多功能：
```cpp
class EditorComponent {
public:
    virtual ~EditorComponent() {
    }
    
    virtual void onUpdate() = 0;
};
```
