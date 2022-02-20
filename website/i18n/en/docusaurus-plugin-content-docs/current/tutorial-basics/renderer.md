---
sidebar_position: 7
---

# Component: Renderer

The `Renderer` represents a class of components that can be saved to the render queue. When the component is
constructed, it also saves its own pointer to the `ComponentManager` like a `Script`:

````cpp
void Renderer::_onEnable() {
     auto &componentsManager = entity()->scene()->_componentsManager;
     componentsManager.addRenderer(this);
}

void Renderer::_onDisable() {
     auto &componentsManager = entity()->scene()->_componentsManager;
     componentsManager.removeRenderer(this);
}
````

This makes in the main loop, every frame `ComponentManager` will cull according to the positional relationship
between `Renderer` and `Camera` camera, and call `_render`
Pure virtual function, save `RenderElement` to the render queue according to the type of material it saves:

```cpp
/**
 * Render element.
 */
struct RenderElement {
    /** Render component. */
    Renderer *renderer;
    /** Mesh. */
    MeshPtr mesh;
    /** Sub mesh. */
    const SubMesh *subMesh;
    /** Material. */
    MaterialPtr material;
};

virtual void _render(std::vector<RenderElement> &opaqueQueue,
                     std::vector<RenderElement> &alphaTestQueue,
                     std::vector<RenderElement> &transparentQueue) = 0;
                     
void Renderer::pushPrimitive(const RenderElement &element,
                             std::vector<RenderElement> &opaqueQueue,
                             std::vector<RenderElement> &alphaTestQueue,
                             std::vector<RenderElement> &transparentQueue) {
    const auto renderQueueType = element.material->renderQueueType;
    
    if (renderQueueType > (RenderQueueType::Transparent + RenderQueueType::AlphaTest) >> 1) {
        transparentQueue.push_back(element);
    } else if (renderQueueType > (RenderQueueType::AlphaTest + RenderQueueType::Opaque) >> 1) {
        alphaTestQueue.push_back(element);
    } else {
        opaqueQueue.push_back(element);
    }
}
```

In addition, `Renderer` is similar to `Camera`, which provides a series of data required for shader calculation,
so `RendererData` is defined:

````cpp
struct RendererData {
     Matrix4x4F u_localMat;
     Matrix4x4F u_modelMat;
     Matrix4x4F u_MVMat;
     Matrix4x4F u_MVPMat;
     Matrix4x4F u_MVInvMat;
     Matrix4x4F u_normalMat;
};
````

Since the `Renderer` marks the `Entity` that it is in, it can be rendered, so you need to get the pose of the `Entity`
to calculate the MVP matrix:

```cpp
void Renderer::updateShaderData(const Matrix4x4F& viewMat,
                                const Matrix4x4F& projMat) {
    auto worldMatrix = entity()->transform->worldMatrix();
    _mvMatrix = viewMat * worldMatrix;
    _mvpMatrix = projMat * viewMat * worldMatrix;
    _mvInvMatrix = _mvMatrix.inverse();
    _normalMatrix = worldMatrix.inverse();
    _normalMatrix = _normalMatrix.transposed();
    
    _rendererData.u_localMat = entity()->transform->localMatrix();
    _rendererData.u_modelMat = worldMatrix;
    _rendererData.u_MVMat = _mvMatrix;
    _rendererData.u_MVPMat = _mvpMatrix;
    _rendererData.u_MVInvMat = _mvInvMatrix;
    _rendererData.u_normalMat = _normalMatrix;
    shaderData.setData(Renderer::_rendererProperty, _rendererData);
}
```

For each `Renderer` subclass, three virtual functions can be implemented as needed:

````cpp
virtual void _render(std::vector<RenderElement> &opaqueQueue,
                     std::vector<RenderElement> &alphaTestQueue,
                     std::vector<RenderElement> &transparentQueue) = 0;

virtual void _updateBounds(BoundingBox3F &worldBounds) {}

virtual void update(float deltaTime) {}
````

But `_render` must be implemented because the `_render` function is responsible for constructing the `RenderElement` and
adding it to the render queue. Currently, Arche-cpp implements three types of renderable components for scenes that need
to be rendered:

1. Mesh rendering component: Usually a static mesh, whose motion is controlled by `Entity`.
2. CPU skinned mesh rendering component: Based on the CPU skinned mesh implemented by `Ozz-Animation`, each frame will
   call `update` to get a new skinned mesh, and then send it to the GPU for rendering.
3. GPU skinning mesh rendering component: complete the vertex skinning calculation in the shader, `update` is
   responsible for updating the configuration of the skeleton node in the `SceneAnimator` component, and then calculate
   the node transformation matrix and send it to the shader for calculation.

## Static Mesh Rendering Component

The mesh rendering component is the simplest type of rendering component. It directly accepts a `Mesh` resource, and
then takes out the `SubMesh` in it, and submits the order of the corresponding materials to the rendering queue:

```cpp
void MeshRenderer::_render(std::vector<RenderElement> &opaqueQueue,
                           std::vector<RenderElement> &alphaTestQueue,
                           std::vector<RenderElement> &transparentQueue) {
    if (_mesh != nullptr) {
        if (_meshUpdateFlag->flag) {
            const auto &vertexLayouts = _mesh->vertexBufferLayouts();
            
            shaderData.disableMacro(HAS_UV);
            shaderData.disableMacro(HAS_NORMAL);
            shaderData.disableMacro(HAS_TANGENT);
            shaderData.disableMacro(HAS_VERTEXCOLOR);
            
            for (size_t i = 0, n = vertexLayouts.size(); i < n; i++) {
                for (uint32_t j = 0, m = vertexLayouts[i].attributeCount; j < m; j++) {
                    if (vertexLayouts[i].attributes[j].shaderLocation == (uint32_t)Attributes::UV_0) {
                        shaderData.enableMacro(HAS_UV);
                    }
                    if (vertexLayouts[i].attributes[j].shaderLocation == (uint32_t)Attributes::Normal) {
                        shaderData.enableMacro(HAS_NORMAL);
                    }
                    if (vertexLayouts[i].attributes[j].shaderLocation == (uint32_t)Attributes::Tangent) {
                        shaderData.enableMacro(HAS_TANGENT);
                    }
                    if (vertexLayouts[i].attributes[j].shaderLocation == (uint32_t)Attributes::Color_0) {
                        shaderData.enableMacro(HAS_VERTEXCOLOR);
                    }
                }
            }
            _meshUpdateFlag->flag = false;
        }
        
        auto &subMeshes = _mesh->subMeshes();
        for (size_t i = 0; i < subMeshes.size(); i++) {
            MaterialPtr material;
            if (i < _materials.size()) {
                material = _materials[i];
            } else {
                material = nullptr;
            }
            if (material != nullptr) {
                RenderElement element(this, _mesh, &subMeshes[i], material);
                pushPrimitive(element, opaqueQueue, alphaTestQueue, transparentQueue);
            }
        }
    }
}
```

In the above code, `MeshRenderer` also determines whether to enable or disable specific shader macros according to
the `wgpu::VertexBufferLayout` stored in `Mesh`.

## CPU Skinned Mesh Rendering Component

CPU skinning is to use simd for acceleration to update the animation skinning at each frame during CPU calculation. The
advantage of this is that no additional processing is required in the shader, and dynamic objects and static objects can
share a set of shaders. system.

The CPU skinning in Arche uses the open source [Ozz-Animation](https://guillaumeblanc.github.io/ozz-animation/). This
animation system provides a number of tools for animation blending and inverse dynamics, as well as skinning related
functions. First, the `update` function in the `Animator` component samples animation resources based on time, which are
defined as `AnimationClip`
The form is read from a file in a specific format.

Then the `update` method of `SkinnedMeshRenderer` will be called before rendering. In this method,
first `ozz::animation::BlendingJob`
It will first combine `ozz::animation::BlendingJob::Layer` and its own saved `ozz::animation::Skeleton` for animation
mixing; then call `ozz::animation::LocalToModelJob`
Transform the blended matrix from local space to model space:

```cpp
void SkinnedMeshRenderer::update(float deltaTime) {
    // Setups blending job.
    ozz::animation::BlendingJob blend_job;
    blend_job.threshold = _threshold;
    blend_job.rest_pose = _skeleton.joint_rest_poses();
    blend_job.output = make_span(_blendedLocals);
    if (_animator == nullptr) {
        _animator = entity()->getComponent<Animator>();
    }
    if (_animator) {
        blend_job.layers = _animator->layers();
    }
    
    // Blends.
    if (!blend_job.Run()) {
        return;
    }
    
    // Converts from local space to model space matrices.
    // Gets the output of the blending stage, and converts it to model space.
    
    // Setup local-to-model conversion job.
    ozz::animation::LocalToModelJob ltm_job;
    ltm_job.skeleton = &_skeleton;
    ltm_job.input = make_span(_blendedLocals);
    ltm_job.output = make_span(_models);
    
    // Runs ltm job.
    if (!ltm_job.Run()) {
        return;
    }
}
```

After finishing the animation work, `_render` uses `ozz::geometry::SkinningJob` to get the skin in the new skeletal pose
and saves the skinned mesh to the render queue.

## GPU Skinned Mesh Rendering Component

GPU skinning, as the name suggests, uses shaders to calculate the positions of skinned vertices. Compared with CPU
skinning, the main benefit is that it takes advantage of the GPU batch processing capabilities, and the skinning
efficiency will be higher. The disadvantage is that it needs special processing in the shader, so the shaders suitable
for static meshes need to be rewritten, and generally only support a fixed number of weights. In Arche, the structure of
GPU skinning mainly corresponds to the skinning data in GLTF. Reading GLTF When the so-called bones are actually
converted to `Entity`, the relationship between bones is represented by the child-parent relationship of `Entity`, so
the skin represents the collection of these `Entity`:

````cpp
struct Skin {
    std::string name;
    std::vector<Matrix4x4F> inverseBindMatrices;
    std::vector<Entity *> joints;
};
````

In order to distinguish it from the CPU animation system, and because the GPU animation system essentially
transforms `Entity`, the corresponding animation component is called `SceneAnimator`, which updates the pose of the
corresponding `Entity` at each frame. The task of `GPUSkinnedMeshRenderer` is to calculate the JointMatrix based on the
new skeleton pose:

```cpp
void GPUSkinnedMeshRenderer::update(float deltaTime) {
    if (_skin) {
        if (!_hasInitJoints) {
            _initJoints();
            _hasInitJoints = true;
        }
        
        // Update join matrices
        auto m = entity()->transform->worldMatrix();
        auto inverseTransform = m.inverse();
        for (size_t i = 0; i < _skin->joints.size(); i++) {
            auto jointNode = _skin->joints[i];
            auto jointMat = jointNode->transform->worldMatrix() * _skin->inverseBindMatrices[i];
            jointMat = inverseTransform * jointMat;
            std::copy(jointMat.data(), jointMat.data() + 16, jointMatrix.data() + i * 16);
        }
        shaderData.setData(_jointMatrixProperty, jointMatrix);
        shaderData.enableMacro(JOINTS_COUNT, _skin->joints.size());
    }
}
```

## Summarize

The `Renderer`, as its name suggests, represents a property that can be rendered. Materials, meshes, skins,
bones can be set on it, and a series of such as cloth can also be added in subsequent development. New renderable
component that only need to implement `_render`
The `_updateBounds` and `upadte` functions are also generally implemented, so that the bounding boxes of the bones and
related mesh data can be updated every frame.
