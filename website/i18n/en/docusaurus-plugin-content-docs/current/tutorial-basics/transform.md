---
sidebar_position: 4
---

# Component: Transform

## Coordinate System

In the Arche project, the **right-handed coordinate system** is used uniformly, and to maintain uniformity with the
matrix used in the shader, both the matrix and the vector are stored in **column-major**. In addition, in order to make a more
detailed distinction between some operations in terms of mathematical concepts, we distinguish between `Vector`
and `Point`. These two types are very similar. For example, the length of a vector can be calculated, and the
length from a point to the origin can also be calculated. `Point` can add a displacement represented by a `Vector` to
get a new `Point`, and two `Point` Adding only gives a `Vector` representing the displacement. Therefore, it is
necessary to pay attention to distinguish these two concepts in specific use.
:::tip 
C++ Templates are used for all math types, `float` is generally used for rendering, and `double` is a common choice
for simulation projects. Using template types, you can let the programmer choose the precision as needed, and each type
provides `castTo` member functions to facilitate mutual conversion. As a result, simulated programs can be easily visualized in
conjunction with rendering component without introducing another set of math classes.
:::
:::caution 
There is no distinction between `Point` and `Vector` in Arche.js, mainly because JavaScript does not have
operator overloading, which makes it easy to confuse the use of too many mathematical concepts, so a more streamlined
design is adopted.
:::

## Transform component

Transform component can be said to be the most basic component, which package these concepts into a description
of `Entity` based on `Point`, `Vector`, `Quaternion` and `Matrix4x4`. And use the pointer of the child and parent entity
saved in the `Entity` to get the coordinates and transformation matrix in world space.

```cpp
class Transform : public Component {
public:
    Transform(Entity *entity);
    
    /**
     * Local position.
     * @remarks Need to re-assign after modification to ensure that the modification takes effect.
     */
    Point3F position();
    
    void setPosition(const Point3F &value);
    
    /**
     * World position.
     * @remarks Need to re-assign after modification to ensure that the modification takes effect.
     */
    Point3F worldPosition();
    
    void setWorldPosition(const Point3F &value);
    
    ...
};
```

### Dirty marks

In the specific implementation, since more information needs to be updated each time, including position, scaling,
rotation, etc., dirty marks are introduced:

```cpp
/**
 * Dirty flag of transform.
 */
enum TransformFlag {
    LocalEuler = 0x1,
    LocalQuat = 0x2,
    WorldPosition = 0x4,
    WorldEuler = 0x8,
    WorldQuat = 0x10,
    WorldScale = 0x20,
    LocalMatrix = 0x40,
    WorldMatrix = 0x80,
    
    /** WorldMatrix | WorldPosition */
    WmWp = 0x84,
    /** WorldMatrix | WorldEuler | WorldQuat */
    WmWeWq = 0x98,
    /** WorldMatrix | WorldPosition | WorldEuler | WorldQuat */
    WmWpWeWq = 0x9c,
    /** WorldMatrix | WorldScale */
    WmWs = 0xa0,
    /** WorldMatrix | WorldPosition | WorldScale */
    WmWpWs = 0xa4,
    /** WorldMatrix | WorldPosition | WorldEuler | WorldQuat | WorldScale */
    WmWpWeWqWs = 0xbc
};
```

When a variable is modified, it will not only modify the value of the current `Transform`, but also record the dirty
mark on the corresponding `Transform` components of all child entities:

````cpp
void Transform::setPosition(const Point3F &value) {
     _position = value;
     _setDirtyFlagTrue(TransformFlag::LocalMatrix);
     _updateWorldPositionFlag();
}

void Transform::_updateWorldPositionFlag() {
     if (!_isContainDirtyFlags(TransformFlag::WmWp)) {
         _worldAssociatedChange(TransformFlag::WmWp);
         const auto &nodeChildren = _entity->_children;
         for (size_t i = 0, n = nodeChildren.size(); i < n; i++) {
             nodeChildren[i]->transform->_updateWorldPositionFlag();
         }
     }
}
````

In this way, when the pose information of the `Transform` component corresponding to the child entity is obtained,
the `_getParentTransform` member function will be triggered to update the data from the parent entity because it is
marked as dirty:

```cpp
Point3F Transform::worldPosition() {
    if (_isContainDirtyFlag(TransformFlag::WorldPosition)) {
        if (_getParentTransform()) {
            _worldPosition = getTranslation(worldMatrix());
        } else {
            _worldPosition = _position;
        }
        _setDirtyFlagFalse(TransformFlag::WorldPosition);
    }
    return _worldPosition;
}

Transform *Transform::_getParentTransform() {
    if (!_isParentDirty) {
        return _parentTransformCache;
    }
    Transform *parentCache = nullptr;
    auto parent = _entity->parent();
    while (parent) {
        const auto &transform = parent->transform;
        if (transform) {
            parentCache = transform;
            break;
        } else {
            parent = parent->parent();
        }
    }
    _parentTransformCache = parentCache;
    _isParentDirty = false;
    return parentCache;
}
```

### Update notification

In addition to marking in the associated `Transform` so that when a component is updated, related components can also be
updated synchronously, there is also an observer pattern to be notified of data updates. This mechanism is implemented
through `UpdateFlagManager`. For other objects that need to be observed, you can call:

````cpp
std::unique_ptr<UpdateFlag> Transform::registerWorldChangeFlag() {
    return _updateFlagManager.registration();
}
````

`_worldAssociatedChange` is fired when `Transform` changes, which causes all `UpdateFlag` registered
with `UpdateFlagManager` to be flagged:

````cpp
void Transform::_worldAssociatedChange(int type) {
    _dirtyFlag |= type;
    _updateFlagManager.distribute();
}

void UpdateFlagManager::distribute() {
    for (size_t i = 0; i < _updateFlags.size(); i++) {
        _updateFlags[i]->flag = true;
    }
}
````

Therefore, you only need to observe the state of `UpdateFlag` to know whether the corresponding state needs to be
updated. For example, in the physics component, `Collider` synchronizes the poses of `Entity` and `PxRigidActor` in this
way:

```cpp
void Collider::_onUpdate() {
    if (_updateFlag->flag) {
        const auto &transform = entity()->transform;
        const auto &p = transform->worldPosition();
        auto q = transform->worldRotationQuaternion();
        q.normalize();
        _nativeActor->setGlobalPose(PxTransform(PxVec3(p.x, p.y, p.z), PxQuat(q.x, q.y, q.z, q.w)));
        _updateFlag->flag = false;
        
        const auto worldScale = transform->lossyWorldScale();
        for (auto &_shape: _shapes) {
            _shape->setWorldScale(worldScale);
        }
    }
}
```
