---
sidebar_position: 3
---

# Entity-Component-Manager

As mentioned when introducing the overall architecture, the most important concept in Arche is "
entity-component-manager", where an entity represents an object with a spatial attitude in the scene, and a component is
created by default during construction.` Transform`, while `Component`
Represents the capabilities of entities, manager classes, such as `PhysicsMananger`, `LightMananger`
, `ComponentMananger`
Responsible for updating methods in specific components all at once in the main loop. Through this organization, the
architecture of the engine can be made more scalable, and the structure of the scene can be configured according to the
requirements.
:::note 
There is also a popular architecture called ECS, which is very similar to the organization here, but there are
big differences. Entity is just a tag ID, Component saves specific data, System have methods. This organization makes
better use of the cache performance, so that when more entities are updated, the efficiency of the CPU pipeline can be
improved as much as possible. However, this architecture is not so convenient when extending components, especially many
components need to be bound with external dependencies, and external dependency libraries may not be developed following
this idea, and this architecture is essentially a kind of data-oriented development model, thus ultimately sacrificing
ease of development.
:::

## Entity

An entity represents an object with a spatial structure relationship, and it holds pointers to corresponding child
entities, enabling tree traversal:

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

`Entity` can add components or create child entities:

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

However, the root entity needs to be constructed from `Scene` so that it can be entered from the scene:

```cpp
EntityPtr Scene::createRootEntity(std::string name) {
    const auto entity = std::make_shared<Entity>(name);
    addRootEntity(entity);
    return entity;
}
```

As you can see here, `Entity` is saved by `std::shared_ptr` object, so it is managed by reference counting principle.
This structure was chosen because each `Entity`
Both can be reconnected to a new parent entity, or can be connected to the entity tree of another scene. In order to
avoid the problem of circular references, the child entities and parent entity in `Entity` are stored in different ways:

```cpp
class Entity {
...
private:
    std::vector<EntityPtr> _children{};    
    Entity *_parent = nullptr;
};
```

### Entity Status

Each `Entity` can set its own state to be active:

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

When the entity is inactive, all attached components and components in child entities are all recursively added to the
deactivation queue:

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

In this way, `Entity` not only represents an entity with a spatial position, but also **has the function of classifying
scene objects**, entities with the same function, such as auxiliary views that sometimes need to be drawn during
rendering, These views can be mounted under the same `Entity`, when calling When the FramebufferPicker selects objects,
the `Entity` is set inactive to avoid selecting the rendering results of these auxiliary attempts.

In addition to active, each `Entity` has a `Layer` property, a total of 32 categories, and the scene objects can also be
classified by Layer. For example, setting the corresponding `cullingMask` in `Camera` can only render specific objects.
layer object.

:::note
`Layer` and active are similar in function, but in terms of design, `Layer` is more recommended for users to use, and as
an engine development, it is necessary to plan the organization of `Entity` more reasonably, and avoid using the default
inside the application. the `Layer`, otherwise the user's `Layer`
Once it conflicts with the default options, it is easy to cause some kind of bug.
:::

## components

A component represents a certain capability of an entity, and `Component` is just the basic interface of a component:

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

These basic interfaces concatenate relationships with `Entity`, for example:

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

When a component is constructed, it will check whether the corresponding `Entity` is active, or when its
described `Entity` modifies its own state, it will also trigger the corresponding method in `Component`. Disable, or
enable a feature.

The specific introduction of components will be left to the follow-up tutorials. In Arche, the four most important
components are:

1. Transform: Describes the pose of the entity, including local position, rotation, scaling, and world coordinates and
   matrices.
2. Script: Script components provide users with the opportunity to customize the `update` function, and built-in
   components can also write user logic through the exposed corresponding methods.
3. Camera: The camera component is always hung on the root entity, mainly used to maintain camera-related state, such as
   perspective matrix, view size, etc., and the component's pointer also needs to be used to construct `Subpass`.
4. Renderer: Represents that the entity has the ability to be rendered, which saves an array of `Material`, through
   which you can extend `MeshRenderer`, `SkinnedMeshRenderer` and other types to complete different types of rendering
   tasks.

## Manager

The manager class represents a set of systems for managing components. The core meaning is that the components are
stored in the entity, and the entity is essentially a tree structure, and the efficiency of traversing the tree
structure is not high. Therefore, when constructing these components, keep their **naked pointers** in the manager
class, and you can call the methods in it to update them in one go. And this kind of collection is convenient to
complete a series of things that need to be aggregated, such as scene culling, you can directly traverse the array
of `Renderer` to return the culled queue. In Arche, there are currently three manager classes:

1. ComponentManager: The most extensive manager class, but its main function is to save `Script` and `Renderer`, the
   former is used to execute user logic uniformly, and the latter is used to complete the work of scene culling.
2. PhysicsManager: It is used to save the Physx-specific PxScene object, which saves all the colliders, constraints and
   character controllers in the physical scene. By calling the `update` method in it, the work of the physics simulation
   can be done.
3. LightManager: Used to save multiple light source types, and save the state of the light source to the `ShaderData` of
   the scene when it is updated.
