---
sidebar_position: 1
---

# Gizmo
场景物体的拾取和操作是编辑器最为基本的功能， 基于 [ImGuizmo](https://github.com/CedricGuillemet/ImGuizmo) 提供的能力，在编辑器中增加了物体选取的功能。
具体来说分为两个阶段：
1. 基于引擎内置的 FramebufferPicker 拾取物体。
2. 在拾取到的物体上渲染 Gizmo，并且使用 raycast 拾取 Gizmo 上的诸多操纵轴。

:::tip
整合这两个技术规避了使用单一拾取技术的问题。framebufferPicker 可以精准拾取物体，但如果 Gizmo 的控制轴也这么做，很容易造成判断的物体和gizmo两者之前拾取的混乱。
使用 raycast，在大规模场景中需要组织场景结构，需要额外依赖于物理引擎的支持。将两种技术结合，既可以保持精准性，又可以保持规模扩张的有效性。
:::

在第一阶段，FramebufferPicker 会返回点击到的物体 `Renderer`:
```cpp
void Editor::pickFunctor(Renderer *renderer, MeshPtr mesh) {
    if (renderer && mesh) {
        _entry->setRenderer(renderer);
    }
}
```

进而在物体上渲染 GUI，并且根据鼠标事件改变模型的姿态：
```cpp
if (_render != nullptr) {
    if (ImGuizmo::IsOver()) {
        _controller->setEnabled(false);
    }
    
    auto modelMat = _render->entity()->transform->localMatrix();
    editTransform(cameraView.data(), cameraProjection.data(), modelMat.data(), true);
    _render->entity()->transform->setLocalMatrix(modelMat);
    cameraView.invert();
    _camera->entity()->transform->setWorldMatrix(cameraView);
}
```

