---
sidebar_position: 1
---

# Gizmo

Picking and manipulating scene objects is the most basic function of the editor. Based on the capabilities provided
by [ImGuizmo](https://github.com/CedricGuillemet/ImGuizmo), the function of object selection is added to the editor.
Specifically, it is divided into two stages:

1. Pick up objects based on the engine's built-in FramebufferPicker.
2. Render the gizmo on the picked object, and use raycast to pick up many manipulation axes on the gizmo.

:::tip

Integrating these two technologies circumvents the problems of using a single pick-up technology. The framebufferPicker
can pick up objects accurately, but if the gizmo's control axis does the same, it is easy to cause confusion between the
judged object and the gizmo picked up before. Using raycast, in large-scale scenes, it is necessary to organize the
scene structure, and it is necessary to additionally rely on the support of the physics engine. Combining the two
technologies maintains both precision and scale-up effectiveness.
:::

In the first stage, FramebufferPicker returns the clicked object `Renderer`:

````cpp
void Editor::pickFunctor(Renderer *renderer, MeshPtr mesh) {
    if (renderer && mesh) {
        _entry->setRenderer(renderer);
    }
}
````

Then render the GUI on the object and change the pose of the model based on mouse events:

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

