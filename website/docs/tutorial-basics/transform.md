---
sidebar_position: 4
---

# 组件：变换

## 坐标系
在 Arche 项目中，统一使用**右手坐标系**，且为了与着色器中使用的矩阵保持统一，矩阵和向量均采用**列主元**。 除此之外，为了在数学概念上对一些运算做更加细致的区分，因此区分了向量 `Vector` 和点 `Point`
这两个概念。 这两个类型非常相似，例如可以计算向量的长度，也可以计算点到原点的长度，`Point` 可以加上一段 `Vector` 表示的位移得到一个新的 `Point`， 而两个 `Point` 相加只能得到表示位移的 `Vector`。
因此，在具体使用时需要注意区分这两个概念。
:::tip 
所有数学类型都使用了 C++ 模板，对于渲染来说，一般使用 `float`， 而对于模拟项目来说 `double` 是一个常见的选择。使用模板类型，可以让程序按需选择精度，并且每一类型都提供了 `castTo`
成员函数，方便相互转换。由此，模拟的程序很容易结合渲染组件进行可视化，而无需额外引入另外一套数学类。
:::
:::caution 
在 Arche.js 中并未做 `Point` 和 `Vector` 的区分，主要是因为 JavaScript 不存在运算符重载，使得定义过多的数学概念很容易在使用时产生混淆，因此采用了更加精简的设计。
:::

## 变换组件

变换组件可以说是最为基础的组件，其在`Point`, `Vector`, `Quaternion` 和 `Matrix4x4`的基础上将这些概念打包成对于 `Entity` 的描述，并且通过`Entity`
中保存的子父实体的指针，得到世界空间中的坐标和变换矩阵。
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

### 脏标记
在具体实现中，由于每次需要更新的信息较多，包括位置，缩放，旋转等等，因此引入了脏标记：
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
当修改了某一变量时，不仅会修改当前 `Transform` 的值，而且会将脏标记记录到所有子实体对应的 `Transform` 组件上：
```cpp
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
```

这样一来，当获取子实体对应的 `Transform` 组件的姿态信息时，由于被标记了脏标记，就会触发 `_getParentTransform` 成员函数，从父实体中更新数据：
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

### 更新通知
除了在关联的 `Transform` 中标记，使得更新一个组件，相关组件也可以同步更新外，还存在一种观察者模式来获得数据更新的通知。这种机制是通过 `UpdateFlagManager` 来实现的。
对于需要观察的其他对象，都可以调用：
```cpp
std::unique_ptr<UpdateFlag> Transform::registerWorldChangeFlag() {
    return _updateFlagManager.registration();
}
```
当 `Transform` 发生改变时，`_worldAssociatedChange` 会被触发，这使得通过 `UpdateFlagManager` 注册的所有 `UpdateFlag` 都会被标记：
```cpp
void Transform::_worldAssociatedChange(int type) {
    _dirtyFlag |= type;
    _updateFlagManager.distribute();
}

void UpdateFlagManager::distribute() {
    for (size_t i = 0; i < _updateFlags.size(); i++) {
        _updateFlags[i]->flag = true;
    }
}
```

因此，只需要观察 `UpdateFlag` 的状态，就能够知道是否需要更新对应的状态。例如，在物理组件当中，`Collider` 就是通过这一方式，同步 `Entity` 和 `PxRigidActor` 的姿态：
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
