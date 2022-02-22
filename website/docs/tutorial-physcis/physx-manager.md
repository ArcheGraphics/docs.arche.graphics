---
sidebar_position: 3
---

# PhysX 管理器

相比于 Web 端使用 PhysX 需要将其编译成 WebAssembly，并且还需要一层封装使得 WebAssembly 暴露出的接口可以很容易通过 TypeScript 进行调用。
那么 Arche-cpp 中使用 PhysX 的方式就要显得更加直接。这主要还是因为 PhysX 的类型本身和渲染架构是比较接近的。
其中，`PxControllerManager` 和 `PxScene` 是两个管理器类，因此 Arche-cpp 将二者共同封装成 `PhysicsManager`：
```cpp
/**
 * A physics manager is a collection of bodies and constraints which can interact.
 */
class PhysicsManager {
public:
    static uint32_t _idGenerator;
    static Physics _nativePhysics;
    
    PhysicsManager();
    
private:
    PxControllerManager *_nativeCharacterControllerManager;
    PxScene *_nativePhysicsManager;
    
    std::unordered_map<uint32_t, ColliderShapePtr> _physicalObjectsMap;
    std::vector<Collider *> _colliders;
    std::vector<CharacterController *> _controllers;
    
    std::function<void(PxShape *obj1, PxShape *obj2)> onContactEnter;
    std::function<void(PxShape *obj1, PxShape *obj2)> onContactExit;
    std::function<void(PxShape *obj1, PxShape *obj2)> onContactStay;
    
    std::function<void(PxShape *obj1, PxShape *obj2)> onTriggerEnter;
    std::function<void(PxShape *obj1, PxShape *obj2)> onTriggerExit;
    std::function<void(PxShape *obj1, PxShape *obj2)> onTriggerStay;
};
```

剩下的就是将 `PxRigidActor` 封装成组件 `Collider`；`PxController` 封装成组件 `CharacterController`。
从上述代码中也可以看到这些组件指针的缓存，利用这些缓存可以实现射线检测和碰撞检测所需的一系列函数对象。

## 射线检测
射线检测是物理引擎最为常用的功能，其不仅可以用来制作射击类游戏，还可以和帧缓冲拾取那样，选取场景中的物体：
```cpp
bool PhysicsManager::_raycast(const Ray3F &ray, float distance,
                              std::function<void(uint32_t, float,
                                                 const Vector3F &,
                                                 const Point3F &)> outHitResult) {
    PxRaycastHit hit = PxRaycastHit();
    PxSceneQueryFilterData filterData = PxSceneQueryFilterData();
    filterData.flags = PxQueryFlags(PxQueryFlag::eSTATIC | PxQueryFlag::eDYNAMIC);
    
    const auto &origin = ray.origin;
    const auto &direction = ray.direction;
    bool result = PxSceneQueryExt::raycastSingle(*_nativePhysicsManager,
                                                 PxVec3(origin.x, origin.y, origin.z),
                                                 PxVec3(direction.x, direction.y, direction.z),
                                                 distance, PxHitFlags(PxHitFlag::eDEFAULT),
                                                 hit, filterData);
    
    if (result && outHitResult != nullptr) {
        outHitResult(hit.shape->getQueryFilterData().word0,
                     hit.distance,
                     Vector3F(hit.normal.x, hit.normal.y, hit.normal.z),
                     Point3F(hit.position.x, hit.position.y, hit.position.z));
    }
    
    return result;
}
```

核心其实就是调用 `PxSceneQueryExt::raycastSingle`，但是这个方法只能返回找到的 `PxShape`，而我们需要的是拥有该 `PxShape` 的 `PxRigidActor`，即 `Collider`。
为了做到这一点，我们将 `PxShape` 封装成 `ColliderShape`，并且在将其添加给 `Collider` 时保存 `Collider` 的指针：
```cpp
void Collider::addShape(const ColliderShapePtr &shape) {
    const auto &oldCollider = shape->_collider;
    if (oldCollider != this) {
        if (oldCollider != nullptr) {
            oldCollider->removeShape(shape);
        }
        _shapes.push_back(shape);
        entity()->scene()->_physicsManager._addColliderShape(shape);
        _nativeActor->attachShape(*shape->_nativeShape);
        shape->_collider = this;
    }
}
```
同时，还在 `PxShape` 当中记录了一个指标，并且在 `PhysicsManager` 维护该指标：
```cpp
BoxColliderShape::BoxColliderShape() : ColliderShape() {
    ...
    _nativeShape->setQueryFilterData(PxFilterData(PhysicsManager::_idGenerator++, 0, 0, 0));
    ...
}

uint32_t ColliderShape::uniqueID() {
    return _nativeShape->getQueryFilterData().word0;
}

void PhysicsManager::_addColliderShape(const ColliderShapePtr &colliderShape) {
    _physicalObjectsMap[colliderShape->uniqueID()] = (colliderShape);
}
```

这样一来，通过 `PxShape` 上记录的指标，就可以搜索 `_physicalObjectsMap` 找到 `ColliderShape`，进而找到 `Collider` 甚至是 `Entity`。

## 碰撞检测
PhysX 中的碰撞检测需要依赖回调函数的实现，并且这些回调函数的参数也是 `PxShape`。因此上述介绍的方法同样适用于碰撞检测。
```cpp
onTriggerEnter = [&](PxShape *obj1, PxShape *obj2) {
    const auto shape1 = _physicalObjectsMap[obj1->getQueryFilterData().word0];
    const auto shape2 = _physicalObjectsMap[obj2->getQueryFilterData().word0];
    
    auto scripts = shape1->collider()->entity()->scripts();
    for (const auto &script: scripts) {
        script->onTriggerEnter(shape2);
    }
    
    scripts = shape2->collider()->entity()->scripts();
    for (const auto &script: scripts) {
        script->onTriggerEnter(shape1);
    }
};

PxSimulationEventCallbackWrapper *simulationEventCallback =
new PxSimulationEventCallbackWrapper(onContactEnter, onContactExit, onContactStay,
                                     onTriggerEnter, onTriggerExit, onTriggerStay);

PxSceneDesc sceneDesc(_nativePhysics()->getTolerancesScale());
sceneDesc.simulationEventCallback = simulationEventCallback;
_nativePhysicsManager = _nativePhysics()->createScene(sceneDesc);
```

## 更新与同步
物理引擎会更新碰撞体和角色控制器的状态，同时引擎自身可能也会通过脚本改变 `Entity` 的姿态，因此两个系统在各自循环递进同时，还要同步双方的数据：
```cpp
void PhysicsManager::update(float deltaTime) {
    _nativePhysicsManager->simulate(deltaTime);
    _nativePhysicsManager->fetchResults(true);
}

void PhysicsManager::callColliderOnUpdate() {
    for (auto &collider: _colliders) {
        collider->_onUpdate();
    }
}

void PhysicsManager::callColliderOnLateUpdate() {
    for (auto &collider: _colliders) {
        collider->_onLateUpdate();
    }
}

void PhysicsManager::callCharacterControllerOnLateUpdate() {
    for (auto &controller: _controllers) {
        controller->_onLateUpdate();
    }
}
```

同步分为两个方便，物理引擎向对应 `Entity` 同步，以及反过来 `Entity` 向物理引擎同步。
对 `Entity` 上的 `Transform` 的变化，可以使用 `UpdateFlag` 进行监听，只有在脏标记生效时，才需要将数据同步给物理引擎：
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

对于物理引擎而言，只有两个组件是会受到物理碰撞影响，发生姿态变化的，即封装成 `DynamicCollider` 的 `PxRigidDynamic`，以及封装成 `CharacterController` 的 `PxController`。
因此每一帧都需要同步两者的数据：
```cpp
void DynamicCollider::_onLateUpdate() {
    const auto &transform = entity()->transform;
    
    PxTransform pose = _nativeActor->getGlobalPose();
    transform->setWorldPosition(Point3F(pose.p.x, pose.p.y, pose.p.z));
    transform->setWorldRotationQuaternion(QuaternionF(pose.q.x, pose.q.y, pose.q.z, pose.q.w));
    _updateFlag->flag = false;
}

void CharacterController::_onLateUpdate() {
    entity()->transform->setWorldPosition(position());
}
```

:::tip
`PxTransform` 没有尺度变化的信息，因为作为刚体引擎，其只有旋转和平移两个变换。
但是用户可能会对 `Entity` 进行缩放操作，对应的碰撞体也需要缩放，这种缩放体现在缩小碰撞盒 `BoxColliderShape` 的长宽高，缩小碰撞球 `SphereColliderShape` 半径等类似的方面。
因此，碰撞体的缩放需要同步缩小 `PxGeometry` 的尺度和 `PxShape` 的局部偏移。
:::
