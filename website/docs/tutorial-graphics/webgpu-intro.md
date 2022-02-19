---
sidebar_position: 1
---

# 使用 WebGPU

在介绍有关 Arche 在渲染方面的设计之前，我们先来看如何使用 WebGPU，之所以要关注这一层，是因为这将会决定我们如何构造和析构一系列对象。针对对象的构造和析构，是一切程序的基础。

## Arche-cpp

在 Arche-cpp 当中，我们基于 Dawn 开发WebGPU的应用，并且通过 Git Submodule，在拉取仓库的时候就能够下载对应的代码，具体的操作这里不展开。具体到调用 WebGPU，有两个核心的头文件：

```cpp
#include <webgpu/webgpu.h> // C Header
#include <webgpu/webgpu_cpp.h> // C++ Header
```

前者对应 C 的头文件，后者则是使用 C++ 对其进行的封装，对于 WebGPU 的 C 类型，例如 `WGPUBuffer` 都是 Opaque Pointer（不透明指针）：

```c
typedef struct WGPUBufferImpl* WGPUBuffer;
```

可以通过 `WGPUDevice` 相关的函数来构造具体的对象：

```c
typedef WGPUBuffer (*WGPUProcDeviceCreateBuffer)(WGPUDevice device, WGPUBufferDescriptor const * descriptor);
```

可以看到这些函数也都是函数指针。使用 C 类型可以很容易和其他语言进行绑定，例如 JavaScript，但是在实际使用中，并不是特别方便。于是 Dawn 提供了 C++ 的封装版本。

在 C++ 当中，等价的 `Buffer` 声明如下：

```cpp
class Buffer : public ObjectBase<Buffer, WGPUBuffer> {
  public:
    using ObjectBase::ObjectBase;
    using ObjectBase::operator=;

    void Destroy() const;
    void const * GetConstMappedRange(size_t offset = 0, size_t size = 0) const;
    void * GetMappedRange(size_t offset = 0, size_t size = 0) const;
    void MapAsync(MapMode mode, size_t offset, size_t size, BufferMapCallback callback, void * userdata) const;
    void SetLabel(char const * label) const;
    void Unmap() const;

  private:
    friend ObjectBase<Buffer, WGPUBuffer>;
    static void WGPUReference(WGPUBuffer handle);
    static void WGPURelease(WGPUBuffer handle);
};
```

可以看到这一类型继承 ObjectBase, 并且通过奇异模板递归的方式提供了两个静态函数，`WGPUReference` 和 `WGPURelease`。事实上，所有类似的类都是通过这样的方式继承的。 从 `ObjectBase`
当中可以看到实现了一系列的构造函数：

```cpp
class ObjectBase {
  public:
    ObjectBase() = default;
    ObjectBase(CType handle): mHandle(handle) {
        if (mHandle) Derived::WGPUReference(mHandle);
    }
    ~ObjectBase() {
        if (mHandle) Derived::WGPURelease(mHandle);
    }

    ObjectBase(ObjectBase const& other)
        : ObjectBase(other.Get()) {
    }
    Derived& operator=(ObjectBase const& other) {
        if (&other != this) {
            if (mHandle) Derived::WGPURelease(mHandle);
            mHandle = other.mHandle;
            if (mHandle) Derived::WGPUReference(mHandle);
        }

        return static_cast<Derived&>(*this);
    }

    ObjectBase(ObjectBase&& other) {
        mHandle = other.mHandle;
        other.mHandle = 0;
    }
    Derived& operator=(ObjectBase&& other) {
        if (&other != this) {
            if (mHandle) Derived::WGPURelease(mHandle);
            mHandle = other.mHandle;
            other.mHandle = 0;
        }

        return static_cast<Derived&>(*this);
    }

    ObjectBase(std::nullptr_t) {}
    Derived& operator=(std::nullptr_t) {
        if (mHandle != nullptr) {
            Derived::WGPURelease(mHandle);
            mHandle = nullptr;
        }
        return static_cast<Derived&>(*this);
    }
};
```

可以看到当这些类型被构造的时候，内部保存了 mHandle，而析构的时候，自动调用 `Derived::WGPURelease` 将这些类型释放，这样符合 C++ 的构造原则 RAII（Resource Acquisition Is
Initialization）即资源获取即初始化，因此，使用 C++ 版的接口就能够自动析构对象，不会存在内存泄漏的问题。因此，Arche-cpp 使用 C++ 接口搭建整个引擎。

:::tip 
有的时候有一些项目使用 C 类型的 WebGPU 接口，例如 IMGUI 提供的后端实现，因此可以通过 `Get` 将 C++ 对象保存的 C 指针拿出来， 但是要避免这些项目对这些指针进行了析构，否则 C++
类型中的指针就会在析构之前就变成了野指针：

```cpp
void GUI::draw(ImDrawData* drawData,
               wgpu::RenderPassEncoder& passEncoder) {
    ImGui_ImplWGPU_RenderDrawData(drawData, passEncoder.Get());
}
```

:::

## Arche.js

WebGPU 的标准制定方提供了一个 TypeScript 的 Type 包，即 [@webgpu/types](https://www.npmjs.com/package/@webgpu/types) 。
在这个包当中所有的类型都已经封装成了 `interface`，例如：

```ts
interface GPUBuffer extends GPUObjectBase {
    /**
     * Maps the given range of the {@link GPUBuffer} and resolves the returned {@link Promise} when the
     * {@link GPUBuffer}'s content is ready to be accessed with {@link GPUBuffer#getMappedRange}.
     * @param mode - Whether the buffer should be mapped for reading or writing.
     * @param offset - Offset in bytes into the buffer to the start of the range to map.
     * @param size - Size in bytes of the range to map.
     */
    mapAsync(
        mode: GPUMapModeFlags,
        offset?: GPUSize64,
        size?: GPUSize64
    ): Promise<undefined>;

    /**
     * Returns a {@link ArrayBuffer} with the contents of the {@link GPUBuffer} in the given mapped range.
     * @param offset - Offset in bytes into the buffer to return buffer contents from.
     * @param size - Size in bytes of the {@link ArrayBuffer} to return.
     */
    getMappedRange(
        offset?: GPUSize64,
        size?: GPUSize64
    ): ArrayBuffer;

    /**
     * Unmaps the mapped range of the {@link GPUBuffer} and makes it's contents available for use by the
     * GPU again.
     */
    unmap(): undefined;

    /**
     * Destroys the {@link GPUBuffer}.
     */
    destroy(): undefined;
}
```

对于 GPUBuffer 这样的类型，使用 `interface` 并没有太大的问题，因为构造这些类型的对象是通过 `GPUDevice` 而不是直接 `new` 一个对象。但是，对于许多 Descriptor
对象来说，如果每次都需要用类似 Json 的方式进行构造，就会隐含地触发垃圾回收机制，由于无法直接 `new` 一个 `interface`，因此最好是实现一个符合该 `interface` 的 `class`:

```ts
export class BufferDescriptor implements GPUBufferDescriptor {
    label?: string;
    mappedAtCreation?: boolean;
    size: GPUSize64;
    usage: GPUBufferUsageFlags;
}
```

这些类型可以缓存，也可以作为静态类型用以缓存中间变量，以此减少了触发垃圾回收机制的次数。
