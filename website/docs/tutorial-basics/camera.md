---
sidebar_position: 5
---

# 组件：相机

为了对场景进行渲染，就必须为场景添加相机组件 `Camera`，由于相机组件只是包含一系列相机相关的方法，因此虽然依旧需要将相机组件添加到某个 `Entity`
，使得可以控制相机的姿态，但并不意味着只有在挂载相机组件的实体上起作用。这一点和其他组件有所区别:

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

:::info 
可以看到 Arche-cpp 需要将相机组件的指针保存到 _mainCamera，这是因为框架会自动调用`resize` 为相机组件提供屏幕的宽高信息。而在浏览器当中，`Window`
是一个全局变量，因此屏幕宽高可以很容易在相机组件中直接获得。
:::

由于相机是描述渲染场景不可或缺的组件，因此对于 CPU 和 GPU 上的运算，相机都可以提供必要的信息。

## GPU着色器数据

由于 WebGPU 能够绑定Uniform Buffer 的数量有限，最好尽可能将数据打包成结构体一次性发送给GPU，因此定义了 `CameraData`:

```c
struct CameraData {
    Matrix4x4F u_viewMat;
    Matrix4x4F u_projMat;
    Matrix4x4F u_VPMat;
    Matrix4x4F u_viewInvMat;
    Matrix4x4F u_projInvMat;
    Point3F u_cameraPos;
    float _cameraPosPad; // for align
};
```

在这一定义中，可以看出 `Camera` 对于着色器的计算所提供的数据，主要就是视图矩阵，透视矩阵，相机位置这三者（其余的逆矩阵主要是因为着色器的矩阵没有求逆操作）。
:::tip 
对于所有 UniformBuffer，都需要四字节对齐，因此在最后添加一个 `float` 类型的补齐位。
:::

上述数据，不需要用户手动上传，每一帧开始前，数据会根据相机组件自动发送到GPU：

```cpp
void Camera::update() {
    _cameraData.u_viewMat = viewMatrix();
    _cameraData.u_projMat = projectionMatrix();
    _cameraData.u_VPMat = projectionMatrix() * viewMatrix();
    _cameraData.u_viewInvMat = _transform->worldMatrix();
    _cameraData.u_projInvMat = inverseProjectionMatrix();
    _cameraData.u_cameraPos = _transform->worldPosition();
    shaderData.setData(Camera::_cameraProperty, _cameraData);

    if (enableFrustumCulling && (_frustumViewChangeFlag->flag || _isFrustumProjectDirty)) {
        _frustum.calculateFromMatrix(_cameraData.u_VPMat);
        _frustumViewChangeFlag->flag = false;
        _isFrustumProjectDirty = false;
    }
}
```

在 Arche 项目中，不区分正交相机和透视相机，只提供单一的 `Camera` 组件。这样一来，用户甚至可以对正交投影矩阵和透视投影矩阵做插值，以获得一种平滑的切换效果。
`Camera` 提供了一系列成员函数，帮助用户对其进行配置：

```cpp
/**
 * Whether it is orthogonal, the default is false. True will use orthographic projection, false will use perspective projection.
 */
bool isOrthographic() const;

void setIsOrthographic(bool value);

/**
 * Half the size of the camera in orthographic mode.
 */
float orthographicSize() const;

void setOrthographicSize(float value);

/**
 * View matrix.
 */
Matrix4x4F viewMatrix();

/**
 * The projection matrix is calculated by the relevant parameters of the camera by default.
 * If it is manually set, the manual value will be maintained. Call resetProjectionMatrix() to restore it.
 */
void setProjectionMatrix(const Matrix4x4F &value);

Matrix4x4F projectionMatrix();
```

## CPU场景计算

除了为着色器中的计算提供数据外，相机还可以支持在CPU侧的运算，这些运算都围绕视锥体开展，包括两个方面：

1. 基于视锥体的场景剔除
2. 生成从相机位置出发，经过屏幕或者视图坐标的射线

### 视锥剔除

在 `Camera` 中储存了 `BoundingFrustum`, 并且通过 `UpdateFlag` 监听 `Transform` 上的事件。因此，在更新相机时，会根据各种 flag 的状态更新视锥体：

```cpp
if (enableFrustumCulling && (_frustumViewChangeFlag->flag || _isFrustumProjectDirty)) {
    _frustum.calculateFromMatrix(_cameraData.u_VPMat);
    _frustumViewChangeFlag->flag = false;
    _isFrustumProjectDirty = false;
}
```

当 `ComponentManager` 中对所有 `Renderer` 组件进行遍历，并且将这些组件分为三种队列时，会对每一个组件都判断是否在视锥体的可视范围内，同时通过计算与相机的距离对其进行排序：

```cpp
void ComponentsManager::callRender(Camera* camera,
                                   std::vector<RenderElement> &opaqueQueue,
                                   std::vector<RenderElement> &alphaTestQueue,
                                   std::vector<RenderElement> &transparentQueue) {
    for (size_t i = 0; i < _renderers.size(); i++) {
        const auto &element = _renderers[i];
        
        // filter by camera culling mask.
        if (!(camera->cullingMask & element->_entity->layer)) {
            continue;
        }
        
        // filter by camera frustum.
        if (camera->enableFrustumCulling) {
            element->isCulled = !camera->_frustum.intersectsBox(element->bounds());
            if (element->isCulled) {
                continue;
            }
        }
        
        const auto &transform = camera->entity()->transform;
        const auto position = transform->worldPosition();
        auto center = element->bounds().midPoint();
        if (camera->isOrthographic()) {
            const auto forward = transform->worldForward();
            const auto offset = center - position;
            element->setDistanceForSort(offset.dot(forward));
        } else {
            element->setDistanceForSort(center.distanceSquaredTo(position));
        }
        
        element->updateShaderData(camera->viewMatrix(), camera->projectionMatrix());
        
        element->_render(opaqueQueue, alphaTestQueue, transparentQueue);
    }
}
```

### 射线生成

射线生成对于依靠射线检测的场景编辑操作，以及射击类操作都非常重要。
相机组件配置了画面视图(viewport) 和屏幕的尺寸信息，除了提供视图与屏幕坐标之间的转换，还可以很容易生成从相机位置出发的射线：

```cpp
/**
 * Generate a ray by a point in viewport.
 * @param point - Point in viewport space, which is represented by normalization
 * @returns Ray
 */
Ray3F viewportPointToRay(const Vector2F &point);

    /**
 * Generate a ray by a point in screen.
 * @param point - Point in screen space, the unit is pixel
 * @returns Ray
 */
Ray3F screenPointToRay(const Vector2F &point);
```
