---
sidebar_position: 12
---

# 基于单例的第三方扩展

为了使得更多的组件可以很容易插入到引擎当中，需要设计一种类型机制使得用户可以很容易定义化功能。其中最重要的就是将组件的更新纳入到主循环当中。例如当前引擎内置的 `ComponentManager`。
这些更新有可能只需要一个脚本，有可能需要依赖 WebGPU 的接口。因此，引擎当中从主循环拆除一个单独的函数用于扩展：

```cpp
void ForwardApplication::updateGPUTask(wgpu::CommandEncoder& commandEncoder) {
    _shadowManager->draw(commandEncoder);
    _lightManager->draw(commandEncoder);
}
```

当前 `ShadowManager` 和 `LightManager` 已经从 `Scene` 内部分离出来，成为单独的管理器类型。 除了插入主循环外，更重要的是，组件如何收集到管理器类当中进行统一的管理和事件派发。
由于这些管理器类都是用户在自己的Application当中构造的，而不是保存在 `Scene` 中的默认对象，因此就无法像 `ComponentManager` 那样在 `onEnable` 时将自己的指针保存到管理器类当中。
为了解决这一问题，引入了单例模式，这使得对于像光源组件这样的类型，都可以直接通过单例进行注册：

```cpp
void PointLight::_onEnable() {
    LightManager::getSingleton().attachPointLight(this);
}

void PointLight::_onDisable() {
    LightManager::getSingleton().detachPointLight(this);
}
```

## 单例模板类

为了方便实现单例模式，提供了要给模板类：

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

模板类使用奇异模板递归的方式，在子类中进行构造：

```cpp
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
```

:::note

单例的设计，还可以使得原先一系列依赖静态方法的编译时参数，都可以变成运行时参数。

:::

## 第三方扩展

对于第三方扩展，一般涉及几个类型：

1. 管理器类用单例模式构造。
2. 组件继承`Component`，并且在 `onEnable` 中将自己插入到管理器类当中。
3. 继承 `updateGPUTask` 将GPU相关的更新函数插入到主循环当中，继承 `Script` 将与GPU无关的更新函数插入到主循环当中。 可以通过 `LightManager`， `ShadowManager`
   查看类似的实现，后续有关粒子，布料等组件，都将有用类似的架构进行实现。
