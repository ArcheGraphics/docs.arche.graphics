---
sidebar_position: 7
---

# 组件：可渲染组件

可渲染组件代表一类可以被保存到渲染队列中的组件，该组件在被构造时，也会和 `Script` 一样，将自身的指针保存到 `ComponentManager` 当中：

```cpp
void Renderer::_onEnable() {
    auto &componentsManager = entity()->scene()->_componentsManager;
    componentsManager.addRenderer(this);
}

void Renderer::_onDisable() {
    auto &componentsManager = entity()->scene()->_componentsManager;
    componentsManager.removeRenderer(this);
}
```

这使得在主循环中，每一帧都 `ComponentManager` 都会根据 `Renderer` 和 `Camera` 相机的位置关系进行剔除， 并且调用 `_render`
纯虚函数，根据自身保存的材质类型，将 `RenderElement` 保存到渲染队列中：

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

除此之外 `Renderer` 和 `Camera` 类似，会提供一系列着色器计算时所需要的数据，因此定义了 `RendererData`：

```cpp
struct RendererData {
    Matrix4x4F u_localMat;
    Matrix4x4F u_modelMat;
    Matrix4x4F u_MVMat;
    Matrix4x4F u_MVPMat;
    Matrix4x4F u_MVInvMat;
    Matrix4x4F u_normalMat;
};
```

由于 `Renderer` 标记了所在的 `Entity` 是可以被渲染的，因此就需要获得该 `Entity` 的姿态，以计算 MVP 矩阵：

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

对于每一个 `Renderer` 的子类，可以根据需要实现三个虚函数：

```cpp
virtual void _render(std::vector<RenderElement> &opaqueQueue,
                     std::vector<RenderElement> &alphaTestQueue,
                     std::vector<RenderElement> &transparentQueue) = 0;

virtual void _updateBounds(BoundingBox3F &worldBounds) {}

virtual void update(float deltaTime) {}
```

但 `_render` 是必须实现的，因为 `_render` 函数需要负责构造 `RenderElement`，并将其添加到渲染队列当中。目前 Arche-cpp 针对需要渲染的场景，实现了三类可渲染组件：

1. 网格渲染组件：一般是静态网格，由 `Entity` 控制其运动。
2. CPU 蒙皮网格渲染组件：基于 `Ozz-Animation` 实现的 CPU 蒙皮网格，每一帧都会调用 `update` 得到新的蒙皮网格，然后发送到 GPU 中进行渲染。
3. GPU 蒙皮网格渲染组件：在着色器中完成顶点蒙皮的计算，`update` 负责在 `SceneAnimator` 组件更新骨骼节点的组态后，再计算节点变换矩阵发送给着色器进行计算。

## 静态网格渲染组件

网格渲染组件是最为简单的一类渲染组件，直接接受一个 `Mesh` 资源，然后将其中的 `SubMesh` 取出，对应材质的顺序提交到渲染队列：

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

上述代码中，`MeshRenderer` 还要根据 `Mesh` 中保存的 `wgpu::VertexBufferLayout` 判断是否需要开启或者关闭特定的着色器宏。

## CPU 蒙皮网格渲染组件

CPU 蒙皮即在 CPU 计算时，利用 simd 进行加速实现在每一帧都更新动画蒙皮，这样的好处是在着色器中不需要做额外的处理，动态物体和静态物体可以共享一套着色器体系。

Arche 中的 CPU 蒙皮使用了开源的 [Ozz-Animation](https://guillaumeblanc.github.io/ozz-animation/) 。
这一动画系统提供了大量动画混合和逆向动力学方面的工具，同时还提供了蒙皮的相关函数。 首先，`Animator` 组件中的`update` 函数会根据时间采样动画资源，这些动画资源以 `AnimationClip`
的形式从特定格式的文件中读取出来。

接着 `SkinnedMeshRenderer` 的 `update` 方法会在渲染前被调用。 在该方法当中，首先 `ozz::animation::BlendingJob`
会先结合 `ozz::animation::BlendingJob::Layer` 和自身保存的 `ozz::animation::Skeleton` 进行动画混合；再调用 `ozz::animation::LocalToModelJob`
将混合后的矩阵从局部空间转换到模型空间：

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

完成动画方面的工作后，`_render` 会使用 `ozz::geometry::SkinningJob` 获得新的骨骼姿态下的蒙皮，并且将蒙皮网格保存到渲染队列中。

## GPU 蒙皮网格渲染组件

GPU 蒙皮顾名思义是由着色器来计算蒙皮顶点的位置，相比于 CPU 蒙皮，主要的好处在于利用了 GPU 批处理的能力，蒙皮的效率会更高。
缺点则是需要在着色器当中特殊处理，因此适用于静态网格的着色器都需要进行改写，并且一般都只支持固定数量的权重。 在 Arche 中，GPU 蒙皮的结构主要对应与 GLTF 中的蒙皮数据。 在读取 GLTF
时，所谓的骨骼其实也会被转换为 `Entity`，骨骼之间的关系，由 `Entity` 的子父关系来表示，因此，蒙皮表示的就是这些 `Entity` 的集合：

```cpp
struct Skin {
    std::string name;
    std::vector<Matrix4x4F> inverseBindMatrices;
    std::vector<Entity *> joints;
};
```

为了和 CPU 动画系统进行区分，又因为 GPU 动画系统本质上是对 `Entity` 进行变换，因此对应的动画组件称作 `SceneAnimator`，这一组件会在每一帧更新对应 `Entity` 的姿态.
而 `GPUSkinnedMeshRenderer` 的任务则是根据新的骨骼姿态计算 JointMatrix:

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

## 总结

可渲染组件正如他的名字所表示的那样，代表了一种可以被渲染的属性，在他身上可以设置材质，网格，蒙皮，骨骼， 也可以在后续的开发中添加例如布料等一系列新的可被渲染的组件，这些组件只需要实现 `_render`
也一般会实现 `_updateBounds` 和 `upadte` 函数，使得每一帧都可以更新骨骼的包围盒和相关网格数据。
