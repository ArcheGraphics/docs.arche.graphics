---
sidebar_position: 6
---

# 组件：脚本

脚本组件中定义了大量可以继承的虚函数，通过在子类中实现这类虚函数，就可以在程序中插入自定义的逻辑。

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

实际上，脚本中的函数分为两个类别：

1. 和主循环一起的多次的调用
2. 初始化或者销毁时的一次性调用

## 多次调用

### 回调机制

脚本组件的优点在于收口了所有面向用户的行为，例如针对物理组件，提供了三个函数：

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

这三个函数分别对应于物理触发器的进入，离开和保持这三个状态。对于任意组件，都可以获得其在构造时就保存的指向 `Entity` 的指针。
而当 `Script` 及其子类被构造时，就会同时将指针保存到 `Entity` 当中：

```cpp
void Script::_onEnable() {
    auto &componentsManager = entity()->scene()->_componentsManager;
    if (!_started) {
        componentsManager.addOnStartScript(this);
    }
    componentsManager.addOnUpdateScript(this);
    _entity->_addScript(this);
    onEnable();
}
```

这样一来就可以获取 `Entity` 上所绑定的脚本组件，并执行对应的方法，例如：

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

所以，随着引擎的发展，越来越多的函数都可以通过类似的方式在 `Script` 中保留回调函数的接口，在用户的概念中，也只需要继承 `Script`，就能为一些组件添加自定义的逻辑。

### 注册机制

对于多次调用来说，其实现机制在于覆盖了 `Component` 提供的四个虚函数：

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

这些函数会向 `ComponentManager` 注册脚本组件的指针，并且在主循环中一次性执行这些脚本：

```cpp
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
```

## 一次性调用

一次性调用并不意味着这些函数只会被调用一次，而是这些函数并不随着主循环每帧都会触发，相关函数有五个

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

如果脚本添加到的实体的 isActiveInHierarchy 为 true，则在脚本初始化时回调函数将被调用，如果 isActiveInHierarchy 为 false，则在实体被激活，即 isActive 被设为 true 时被调用。
`onAwake` 只会被调用一次，并且在所有生命周期的最前面，通常我们会在 `onAwake` 中做一些初始化相关的操作。

### onEnable

当脚本的 enabled 属性从 false 变为 true 时，或者所在实体的 isActiveInHierarchy 属性从 false 变为 true 时，会激活 `onEnable` 回调。倘若实体第一次被创建且 enabled 为
true，则会在 `onAwake` 之后，`onStart` 之前被调用。

### onDisable

当组件的 enabled 属性从 true 变为 false 时，或者所在实体的 isActiveInHierarchy 属性从 true 变为 false 时，会激活 `onDisable` 回调

:::note
isActiveInHierarchy 的判断方法是：实体在层级树中是被激活状态即该实体为激活状态，它的父亲直到根实体都为激活状态 isActiveInHierarchy 才为 true
:::

### onStart

onStart 回调函数会在脚本第一次进入帧循环，也就是第一次执行 onUpdate 之前触发。onStart 通常用于初始化一些需要经常修改的数据，这些数据可能在 onUpdate 时会发生改变。

### onDestroy
当组件或者所在实体调用了 destroy，则会调用 `onDestroy` 回调，并在当帧结束时统一回收组件。
