---
sidebar_position: 6
---

# Component: Script

A large number of inheritable virtual functions are defined in script components. By implementing such virtual functions
in subclasses, custom logic can be inserted into the program.

```cpp
/**
 * Script class, used for logic writing.
 */
class Script : public Component {    
public:
    /**
     * Called before the frame-level loop start for the first time, only once.
     */
    virtual void onStart() {
    }
    
    /**
     * The main loop, called frame by frame.
     * @param deltaTime - The deltaTime when the script update.
     */
    virtual void onUpdate(float deltaTime) {
    }
    
    /**
     * Called after the onUpdate finished, called frame by frame.
     * @param deltaTime - The deltaTime when the script update.
     */
    virtual void onLateUpdate(float deltaTime) {
    }
};
```

In fact, functions in scripts fall into two categories:

1. Multiple calls with the main loop
2. One-time call when initializing or destroying

## Multiple Calls

### Callback Mechanism

The advantage of script components is that all user-oriented behaviors are closed, for example, for physical components,
three functions are provided:

```cpp
    /**
     * Called when the collision enter.
     * @param other ColliderShape
     */
    virtual void onTriggerEnter(physics::ColliderShapePtr other) {}
    
    /**
     * Called when the collision stay.
     * @remarks onTriggerStay is called every frame while the collision stay.
     * @param other ColliderShape
     */
    virtual void onTriggerExit(physics::ColliderShapePtr other) {}
    
    /**
     * Called when the collision exit.
     * @param other ColliderShape
     */
    virtual void onTriggerStay(physics::ColliderShapePtr other) {}
```

These three functions correspond to entering, leaving and maintaining the three states of the physical trigger,
respectively. For any component, it is possible to obtain a pointer to an `Entity` that was saved at construction time.
And when `Script` and its subclasses are constructed, pointers are also saved to `Entity`:

````cpp
void Script::_onEnable() {
     auto &componentsManager = entity()->scene()->_componentsManager;
     if (!_started) {
         componentsManager.addOnStartScript(this);
     }
     componentsManager.addOnUpdateScript(this);
     _entity->_addScript(this);
     onEnable();
}
````

In this way, you can get the script component bound to `Entity` and execute the corresponding method, for example:

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
```

Therefore, with the development of the engine, more and more functions can retain the interface of the callback function
in `Script` in a similar way. In the user's concept, you only need to inherit `Script` to provide some components. Add
custom logic.

### Registration Mechanism

For multiple calls, the implementation mechanism is to override the four virtual functions provided by `Component`:

```cpp
void Script::_onAwake() {
    onAwake();
}

void Script::_onEnable() {
    auto &componentsManager = entity()->scene()->_componentsManager;
    if (!_started) {
        componentsManager.addOnStartScript(this);
    }
    componentsManager.addOnUpdateScript(this);
    _entity->_addScript(this);
    onEnable();
}

void Script::_onDisable() {
    auto &componentsManager = entity()->scene()->_componentsManager;
    // Use "xxIndex" is more safe.
    // When call onDisable it maybe it still not in script queue,for example write "entity.isActive = false" in onWake().
    if (_onStartIndex != -1) {
        componentsManager.removeOnStartScript(this);
    }
    if (_onUpdateIndex != -1) {
        componentsManager.removeOnUpdateScript(this);
    }
    if (_entityCacheIndex != -1) {
        _entity->_removeScript(this);
    }
    onDisable();
}

void Script::_onDestroy() {
    entity()->scene()->_componentsManager.addDestroyComponent(this);
}
```

These functions register pointers to script components with the `ComponentManager`, and execute the scripts all at once
in the main loop:

````cpp
void Scene::update(float deltaTime) {
     _componentsManager.callScriptOnStart();
    
     _physicsManager.callColliderOnUpdate();
     _physicsManager.update(deltaTime);
     _physicsManager.callColliderOnLateUpdate();
     _physicsManager.callCharacterControllerOnLateUpdate();
    
     _componentsManager.callScriptOnUpdate(deltaTime);
     _componentsManager.callAnimatorUpdate(deltaTime);
     _componentsManager.callSceneAnimatorUpdate(deltaTime);
     _componentsManager.callScriptOnLateUpdate(deltaTime);
    
     _componentsManager.callRendererOnUpdate(deltaTime);
    
     updateShaderData();
}
````

## One-time Call

A one-time call does not mean that these functions will only be called once, but these functions are not triggered every
frame with the main loop. There are five related functions.

```cpp
    /**
     * Called when be enabled first time, only once.
     */
    virtual void onAwake() {}
    
    /**
     * Called when be enabled.
     */
    virtual void onEnable() {}
    
    /**
     * Called when be disabled.
     */
    virtual void onDisable() {}
    
    /**
     * Called at the end of the destroyed frame.
     */
    virtual void onDestroy() {}
    
    /**
     * Called before the frame-level loop start for the first time, only once.
     */
    virtual void onStart() {}
```

### OnAwake

The callback function will be called when the script is initialized if isActiveInHierarchy is true for the entity the
script is added to, or when the entity is activated, i.e. isActive is set to true, if isActiveInHierarchy is false.
`onAwake` will only be called once, and at the forefront of all life cycles, we usually do some initialization related
operations in `onAwake`.

### onEnable

The `onEnable` callback is activated when the script's enabled property changes from false to true, or when the entity's
isActiveInHierarchy property changes from false to true. If the entity is first created and enabled is true, it will be
called after `onAwake` but before `onStart`.

### onDisable

The `onDisable` callback is activated when the component's enabled property changes from true to false, or when the
entity's isActiveInHierarchy property changes from true to false

:::note 
The judgment method of isActiveInHierarchy is: the entity is in the active state in the hierarchical tree, that
is, the entity is in the active state, and its parent isActiveInHierarchy is true until the root entity is in the active
state
:::

### onStart

The onStart callback function is fired when the script enters the frame loop for the first time, i.e. before the first
execution of onUpdate . onStart is usually used to initialize some data that needs to be modified frequently, and these
data may change during onUpdate.

### onDestroy

When the component or its entity calls destroy, the `onDestroy` callback will be called, and the component will be
uniformly recycled when the frame ends.
