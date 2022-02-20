---
sidebar_position: 5
---

# Component: Camera

In order to render the scene, the camera component `Camera` must be added to the scene. Since the camera component only
contains a series of camera-related methods, although the camera component still needs to be added to an `Entity`
, which makes it possible to control the pose of the camera, but it does not mean that it only works on the entity that
mounts the camera component. This is different from other components:

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

:::info 
It can be seen that Arche-cpp needs to save the pointer of the camera component to _mainCamera, because the
framework will automatically call `resize` to provide the camera component with the width and height information of the
screen. And in the browser, `Window`
is a global variable, so the screen width and height can be easily obtained directly in the camera component.
:::

Since the camera is an integral component of describing a rendered scene, it can provide the necessary information for
operations on both the CPU and GPU.

## GPU shader data

Since WebGPU can bind a limited number of Uniform Buffers, it is best to pack the data into a structure and send it to
the GPU at one time, so `CameraData` is defined:

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

In this definition, it can be seen that the data provided by `Camera` for the shader calculation is mainly the view
matrix, the perspective matrix, and the camera position (the rest of the inverse matrices are mainly because the shader
matrix is not inverted operate).
:::tip 
Four-byte alignment is required for all UniformBuffers, so a padding bit of type `float` is added at the end.
:::

The above data does not need to be uploaded manually by the user. Before each frame starts, the data will be
automatically sent to the GPU according to the camera component:

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

In the Arche project, there is no distinction between orthographic and perspective cameras, and only a single `Camera`
component is provided. This way, the user can even interpolate the orthographic and perspective projection matrices for
a smooth transition.
`Camera` provides a series of member functions to help users configure it:

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

## CPU Scene Calculation

In addition to providing data for calculations in shaders, cameras can also support operations on the CPU side. These
operations are carried out around the view frustum, including two aspects:

1. Frustum-based scene culling
2. Generate a ray starting from the camera position and passing through the screen or view coordinates

### Frustum Culling

Store `BoundingFrustum` in `Camera`, and listen for events on `Transform` through `UpdateFlag`. Therefore, when updating
the camera, the frustum is updated according to the state of various flags:

````cpp
if (enableFrustumCulling && (_frustumViewChangeFlag->flag || _isFrustumProjectDirty)) {
     _frustum.calculateFromMatrix(_cameraData.u_VPMat);
     _frustumViewChangeFlag->flag = false;
     _isFrustumProjectDirty = false;
}
````

When all `Renderer` components are traversed in `ComponentManager`, and these components are divided into three queues,
each component will be judged whether it is within the visual range of the view frustum, and the distance from the
camera will be calculated by calculating Sort it:

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

### Ray Generation

Ray generation is very important for scene editing operations that rely on ray detection, as well as for shooting
operations. The camera component configures the viewport and screen size information. In addition to providing
conversion between view and screen coordinates, it can also easily generate rays from the camera position:

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
