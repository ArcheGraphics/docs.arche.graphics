---
sidebar_position: 3
---

# 实体-组件-管理器

正如在介绍总体架构时提到的那样，Arche 中最为重要的概念就是"实体-组件-管理器"，其中实体代表了场景中某一具有空间姿态的对象，其在构造时默认创建了组件 `Transform`，而 `Component`
代表了实体具有的能力，管理器类，例如 `PhysicsMananger`, `LightMananger`, `ComponentMananger`
负责在主循环中一次性更新具体组件中的方法。通过这种组织方式，可以使得引擎的架构更具有可扩展性，可以根据需求配置场景的结构。
:::note 
目前还有一种称之为 ECS 的架构颇为流行，这种架构和这里的组织方式非常像，但存在较大的区别。其中 Entity 只是一种标记ID，Component 保存具体的数据，System
拥有方法。这样的组织方式更好地利用了缓存的性能，使得在更新较多实体的时候，能够尽可能提高CPU流水线的效率。
但是这种架构在扩展组件的时候其实并不是那么便利，特别是很多组件还需要和外部依赖进行绑定，而外部依赖库未必就是遵循这种思想开发的，并且这种架构本质上是一种面向数据的开发模式，因此最终牺牲了开发的便利性。
:::

## 实体

实体代表了一种具有空间结构关系的对象，并且其保存了对应子节点的指针，使得可以进行树形遍历：

```cpp
/// @brief A leaf of the tree structure which can have children and a single parent.
class Entity {
public:
    /** The name of entity. */
    std::string name;
    /** The layer the entity belongs to. */
    int layer = Layer::Layer0;
    /** Transform component. */
    Transform *transform;
    
    /**
     * Create a entity.
     */
    Entity(std::string name = "");
};
```

Entity 中可以增加添加组件，也可以创建子节点：

```cpp
    /**
     * Create child entity.
     * @param name - The child entity's name.
     * @returns The child entity.
     */
    EntityPtr createChild(const std::string &name = "");
    
        /**
     * Add component based on the component type.
     * @returns    The component which has been added.
     */
    template<typename T>
    T *addComponent();
```

但是，根节点需要由 `Scene` 构建，这样才能从场景中进入：

```cpp
EntityPtr Scene::createRootEntity(std::string name) {
    const auto entity = std::make_shared<Entity>(name);
    addRootEntity(entity);
    return entity;
}
```

这里可以看到，`Entity` 是由 `std::shared_ptr` 对象保存的，因此，采用引用计数的原则进行管理。 之所以选择这样的结构，是因为每一个 `Entity`
都可以重新连接到新的父节点，也可以被连接到另外一个场景的节点树中，为了避免循环引用的问题，`Entity` 中的子节点和父节点采用了不同方式进行存储：

```cpp
class Entity {
...
private:
    std::vector<EntityPtr> _children{};    
    Entity *_parent = nullptr;
};
```

### 实体状态

每一个 `Entity` 都可以设置自己的状态是否为 active：

```cpp
void Entity::setIsActive(bool value) {
    if (value != _isActive) {
        _isActive = value;
        if (value) {
            const auto &parent = _parent;
            if ((parent != nullptr && parent->_isActiveInHierarchy)
                || (_isRoot)) {
                _processActive();
            }
        } else {
            if (_isActiveInHierarchy) {
                _processInActive();
            }
        }
    }
}
```

当实体为 inactive 时，所有附带的组件以及子节点中的组件，全部递归地加入停用队列：

```cpp
void Entity::_setInActiveInHierarchy(std::vector<Component *> &activeChangedComponents) {
    _isActiveInHierarchy = false;
    auto &components = _components;
    for (size_t i = 0; i < components.size(); i++) {
        activeChangedComponents.push_back(components[i].get());
    }
    auto &children = _children;
    for (size_t i = 0; i < children.size(); i++) {
        const auto &child = children[i];
        if (child->isActive()) {
            child->_setInActiveInHierarchy(activeChangedComponents);
        }
    }
}
```

这种方式使得，`Entity` 不仅仅代表了一种具有空间位置的实体，而且**具备场景对象分类的功能**，具有相同功能的实体，例如在渲染时有时候需要绘制的辅助视图，这些视图可以挂载在同一个 `Entity` 下，当调用
FramebufferPicker 选取物体时，该 `Entity` 设置为 inactive，以避免选取到这些辅助试图的渲染结果。

除了 active 之外，每一个 `Entity` 都带有 `Layer` 属性，一共 32 个类别，通过Layer也可以将场景对象进行分类，例如在 `Camera` 中设置对应的 `cullingMask` 就可以只渲染特定层的对象。

:::note
`Layer` 和 active 在功能上是接近的，但在设计上，`Layer` 更多推荐用户使用，而作为引擎开发和则需要更合理的规划 `Entity` 的组织方式，避免在应用内部使用默认的 `Layer`，否则用户的 `Layer`
一旦和默认选项冲突，很容易造成某种 BUG。
:::

## 组件
组件代表了实体具备的某种能力，而 `Component` 只是组件的基本接口：
```cpp
class Component {
public:
    virtual void _onAwake() {}
    
    virtual void _onEnable() {}
    
    virtual void _onDisable() {}
    
    virtual void _onDestroy() {}
    
    virtual void _onActive() {}
    
    virtual void _onInActive() {}
};
```

这些基本接口串联了与 `Entity` 之间的关系，例如：
```cpp
void Component::_setActive(bool value) {
    if (value) {
        if (!_awoken) {
            _awoken = true;
            _onAwake();
        }
        // You can do isActive = false in onAwake function.
        if (_entity->_isActiveInHierarchy) {
            _onActive();
            if (_enabled) {
                _onEnable();
            }
        }
    } else {
        if (_enabled) {
            _onDisable();
        }
        _onInActive();
    }
}
```
当组件被构造时，会检查对应的 `Entity` 是否是active，或者当其所述的`Entity` 修改了自身的状态，也会触发 `Component` 中相应的方法。停用，或者启用某种功能。

有关组件的具体介绍，留到后续教程中展开，在 Arche 中，最重要的四大组件为：
1. Transform：描述了实体的姿态，包括局部的位置，旋转，缩放，以及世界坐标和矩阵。
2. Script：脚本组件为用户提供了自定义 `update` 函数的机会，并且内置组件也可以通过暴露出来的对应方法，实现用户逻辑的编写。
3. Camera：相机组件始终挂在了根节点上，主要用于维护相机相关的状态，例如透视矩阵，视图大小等等，同时组件的指针还需要用于构建 `Subpass`。
4. Renderer：代表实体具有可以被渲染的能力，其中保存了 `Material` 的数组，通过这类型，可以扩展出`MeshRenderer`， `SkinnedMeshRenderer` 等等类型，用于完成不同种类的渲染任务。

## 管理器类
管理器类代表了一组用于管理组件的系统，其核心意义在于，组件保存在实体当中，而实体本质上是一种树形结构，遍历树形结构的效率并不高。
因此，在构造这些组件时，将其**裸指针**保留在管理器类当中，就可以一次性调用其中的方法对其做更新。
并且这种集合方便完成一系列需要聚合的才做，例如场景剔除，就可以直接对`Renderer`的数组进行遍历，以返回剔除后的队列。在 Arche 当中，目前有三种管理器类：
1. ComponentManager：最为广泛的一种管理器类，但其主要作用在于保存`Script` 和`Renderer` ，前者用于统一执行用户逻辑，后者则用于完成场景剔除的工作。
2. PhysicsManager: 用于保存 Physx 特有的 PxScene 对象，该对象保存了物理场景中所有的碰撞体，约束和角色控制器。通过调用其中的 `update` 方法，可以完成物理模拟的工作。
3. LightManager：用于保存多种光源类型，并且在更新时将光源的状态保存到场景的 `ShaderData` 当中。
