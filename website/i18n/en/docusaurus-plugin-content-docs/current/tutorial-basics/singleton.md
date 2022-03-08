---
sidebar_position: 12
---

# Third Party Extensions by Singleton

In order to make more components can be easily plugged into the engine, a type mechanism needs to be designed so that
users can easily define functions. The important issue of these is to incorporate component updates into the main loop.
For example, the `ComponentManager` built into the current engine. These updates may only require a script, and may need
to rely on the WebGPU interface. Therefore, a separate function in the engine is removed from the main loop for
expansion:

````cpp
void ForwardApplication::updateGPUTask(wgpu::CommandEncoder& commandEncoder) {
    _shadowManager->draw(commandEncoder);
    _lightManager->draw(commandEncoder);
}
````

Currently `ShadowManager` and `LightManager` have been separated from `Scene` as separate manager types. In addition to
inserting the main loop, what is more important is how the components are collected into the manager class for unified
management and event dispatch. Since these manager classes are constructed by the user in their own Application, rather
than the default objects stored in `Scene`, it is impossible to save their own pointers to the manager class
when `onEnable` like `ComponentManager` among. In order to solve this problem, the singleton pattern is introduced,
which enables types such as light components to be registered directly through a singleton:

```cpp
void PointLight::_onEnable() {
    LightManager::getSingleton().attachPointLight(this);
}

void PointLight::_onDisable() {
    LightManager::getSingleton().detachPointLight(this);
}
```

## Singleton Template Class

In order to facilitate the implementation of the singleton pattern, a template class is provided to:

```cpp
/*
 * Template class for creating single-instance global classes.
 */
template<typename T>
class Singleton {
private:
    /** @brief Explicit private copy constructor. This is a forbidden operation.*/
    Singleton(const Singleton<T> &);
    
    /** @brief Private operator= . This is a forbidden operation. */
    Singleton &operator=(const Singleton<T> &);
    
protected:
    
    static T *msSingleton;
    
public:
    Singleton(void) {
        assert(!msSingleton);
        msSingleton = static_cast< T * >( this );
    }
    
    ~Singleton(void) {
        assert(msSingleton);
        msSingleton = 0;
    }
    
    static T &getSingleton(void) {
        assert(msSingleton);
        return (*msSingleton);
    }
    
    static T *getSingletonPtr(void) {
        return msSingleton;
    }
};
```

Template classes use singular template recursion to construct in subclasses:

````cpp
class LightManager : public Singleton<LightManager> {
public:
     static LightManager &getSingleton(void);
    
     static LightManager *getSingletonPtr(void);
};

template<> inline LightManager* Singleton<LightManager>::msSingleton{nullptr};

LightManager *LightManager::getSingletonPtr(void) {
     return msSingleton;
}

LightManager &LightManager::getSingleton(void) {
     assert(msSingleton);
     return (*msSingleton);
}
````

:::note

The singleton design can also make a series of compile-time parameters that depend on static methods become run-time
parameters.

:::

## Third Party Extensions

For third-party extensions, several types are generally involved:

1. The manager class is constructed using the singleton pattern.
2. The component inherits `Component` and inserts itself into the manager class in `onEnable`.
3. Inherit `updateGPUTask` to insert GPU-related update functions into the main loop, and inherit `Script` to insert
   GPU-independent update functions into the main loop. Available via `LightManager`, `ShadowManager`
   Check out similar implementations. Subsequent components such as particles and cloth will be implemented with similar
   architectures.
