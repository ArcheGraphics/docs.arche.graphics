---
sidebar_position: 1
---

# Use WebGPU

Before going into the design of Arche in terms of rendering, let's look at how to use WebGPU. The reason for this layer
is that it will determine how we construct and destruct a series of objects. The construction and destruction of objects
are the basis of all programs.

## Arche-cpp

In Arche-cpp, we develop WebGPU applications based on Dawn, and through Git Submodule, we can download the corresponding
code when pulling the repository. The specific operations are not expanded here. Specific to calling WebGPU, there are
two core header files:

````cpp
#include <webgpu/webgpu.h> // C Header
#include <webgpu/webgpu_cpp.h> // C++ Header
````

The former corresponds to the C header file, and the latter uses C++ to encapsulate it. For the C type of WebGPU, such
as `WGPUBuffer` is an Opaque Pointer:

````c
typedef struct WGPUBufferImpl* WGPUBuffer;
````

Concrete objects can be constructed through `WGPUDevice` related functions:

````c
typedef WGPUBuffer (*WGPUProcDeviceCreateBuffer)(WGPUDevice device, WGPUBufferDescriptor const * descriptor);
````

You can see that these functions are also function pointers. Using C types makes it easy to bind with other languages,
such as JavaScript, but in actual use, it is not particularly convenient. So Dawn provides a wrapper version of C++.

In C++, the equivalent `Buffer` declaration is as follows:

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

You can see that this type inherits ObjectBase, and provides two static functions, `WGPUReference` and `WGPURelease`,
recursively through singular templates. In fact, all similar classes are inherited in this way. from `ObjectBase`
It can be seen that a series of constructors are implemented:

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

It can be seen that when these types are constructed, mHandle is stored internally, and when they are
destructed, `Derived::WGPURelease` is automatically called to release these types, which is in line with the C++
construction principle RAII (Resource Acquisition Is Initialization). 
Therefore, using the C++ version of the interface can automatically destruct the object, and there will be
no memory leak problem. Therefore, Arche-cpp uses the C++ interface to build the entire engine.

:::tip 
Sometimes some projects use the C-type WebGPU interface, such as the back-end implementation provided by IMGUI,
so the C pointer saved by the C++ object can be taken out through `Get`, but to avoid these projects from destructing
these pointers, otherwise C++ A pointer in a type becomes a wild pointer before it is destructed:

````cpp
void GUI::draw(ImDrawData* drawData,
               wgpu::RenderPassEncoder& passEncoder) {
    ImGui_ImplWGPU_RenderDrawData(drawData, passEncoder.Get());
}
````

:::

## Arche.js

The standard developer of WebGPU provides a TypeScript Type package,
namely [@webgpu/types](https://www.npmjs.com/package/@webgpu/types) . All types in this package have been encapsulated
as `interface`, for example:

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

For types like GPUBuffer, using `interface` is not too problematic because objects of these types are constructed
via `GPUDevice` rather than `new` an object directly. However, for many Descriptors For the object, if it needs to be
constructed in a way similar to Json every time, the garbage collection mechanism will be triggered implicitly. Since it
is impossible to `new` an `interface` directly, it is best to implement an `interface` that conforms to the `interface`
. `class`:

```ts
export class BufferDescriptor implements GPUBufferDescriptor {
    label?: string;
    mappedAtCreation?: boolean;
    size: GPUSize64;
    usage: GPUBufferUsageFlags;
}
````

These types can be cached or used as static types to cache intermediate variables, thus reducing the number of triggers
for garbage collection mechanisms.
