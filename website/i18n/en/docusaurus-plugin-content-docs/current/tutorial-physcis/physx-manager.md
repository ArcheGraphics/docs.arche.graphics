---
sidebar_position: 3
---

# PhysX Manager

Compared with the use of PhysX on the web side, it needs to be compiled into WebAssembly, and it also needs a layer of
encapsulation so that the interface exposed by WebAssembly can be easily called through TypeScript. Then the way to use
PhysX in Arche-cpp is more straightforward. This is mainly because the type of PhysX itself is relatively close to the
rendering architecture. Among them, `PxControllerManager` and `PxScene` are two manager classes, so Arche-cpp
encapsulates them together into `PhysicsManager`:

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

The rest is to wrap `PxRigidActor` into a component `Collider`; `PxController` into a component `CharacterController`.
The cache of these component pointers can also be seen from the above code. Using these caches, a series of function
objects required for ray detection and collision detection can be implemented.

## Raycast

Raycast is the most commonly used function of physics engines. It can not only be used to make shooting games, but also
to select objects in the scene like framebuffer picker:

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

The core is actually calling `PxSceneQueryExt::raycastSingle`, but this method can only return the found `PxShape`, and
what we need is the `PxRigidActor` that owns the `PxShape`, that is, `Collider`. To do this, we wrap the `PxShape` into
a `ColliderShape` and save the `Collider` pointer when adding it to the `Collider`:

````cpp
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
````

At the same time, a metric is also recorded in `PxShape` and maintained in `PhysicsManager`:

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

This way, with the metrics recorded on `PxShape`, you can search `_physicalObjectsMap` to find `ColliderShape`, which in
turn finds `Collider` and even `Entity`.

## Collision Detection

Collision detection in PhysX depends on the implementation of callback functions, and the parameters of these callback
functions are also `PxShape`. Therefore, the methods described above are also suitable for collision detection.

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

## Update and Sync

The physics engine will update the state of the collider and the character controller, and the engine itself may also
change the posture of the `Entity` through scripts, so the two systems must synchronize the data of both sides while
progressing in their respective loops:

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

Synchronization is divided into two conveniences, the physics engine synchronizes with the corresponding `Entity`, and
in turn the `Entity` synchronizes with the physics engine. For the change of `Transform` on `Entity`, you can
use `UpdateFlag` to monitor, only when the dirty flag takes effect, you need to synchronize the data to the physics
engine:

````cpp
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
````

For the physics engine, there are only two components that are affected by physical collisions and change their
attitude, namely `PxRigidDynamic` packaged as `DynamicCollider`, and `PxController` packaged as `CharacterController`.
Therefore, each frame needs to synchronize the data of both:

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
`PxTransform` has no scale change information, because as a rigid body engine, it only has two transformations, rotation
and translation. However, the user may perform scaling operations on `Entity`, and the corresponding collider also needs
to be scaled. This scaling is reflected in reducing the size of `BoxColliderShape`, reducing the
radius of the `SphereColliderShape` and the so on. Therefore, the scaling of the collider needs to simultaneously reduce the
scale of the `PxGeometry` and the local offset of the `PxShape`.
:::
