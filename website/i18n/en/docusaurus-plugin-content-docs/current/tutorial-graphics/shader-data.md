---
sidebar_position: 4
---

# Shader Data

The shader data `ShaderData` wraps the UniformBuffer creation and upload data, and the bindings of `wgpu::Buffer`
, `wgpuTextureView`, `wgpu::Sampler` on the rendering pipeline. In the engine, on the one hand, it is convenient for the
user to upload various types of data, on the other hand, each shader data has a unique identifier, which is described
by `ShaderProperty`:

````cpp
/**
  * Shader property.
  */
struct ShaderProperty {
     /** Shader property name. */
     const std::string name;
    
     const ShaderDataGroup group;
    
     const uint32_t uniqueId;
    
     ShaderProperty(const std::string &name, ShaderDataGroup group);
    
private:
     static uint32_t _propertyNameCounter;
};
````

When I introduce `WGSLEncoder`, the WGSL encoder, it will be mentioned later that the encoder will
save `wgpu::BindGroupLayoutEntry`:

```cpp
struct BindGroupLayoutEntry {
    ChainedStruct const * nextInChain = nullptr;
    uint32_t binding;
    ShaderStage visibility;
    BufferBindingLayout buffer;
    SamplerBindingLayout sampler;
    TextureBindingLayout texture;
    StorageTextureBindingLayout storageTexture;
};
```

The `binding` parameter is the same as `ShaderProperty::uniqueId`, so the encoder can not only build the shader code,
but also find the corresponding data for binding.

## UniformBuffer

In order to support various types of data upload UniformBuffer, the member functions for constructing and uploading data
use function templates:

````cpp
template<typename T>
void setData(ShaderProperty property, const T& value) {
    auto iter = _shaderBuffers.find(property.uniqueId);
    if (iter == _shaderBuffers.end()) {
        _shaderBuffers.insert(std::make_pair(property.uniqueId,
                                             Buffer(_device, sizeof(T),
                                                    wgpu::BufferUsage::Uniform | wgpu::BufferUsage::CopyDst)));
    }
    iter = _shaderBuffers.find(property.uniqueId);
    
    std::vector<uint8_t> bytes = to_bytes(value);
    _device.GetQueue().WriteBuffer(iter->second.handle(), 0, bytes.data(), sizeof(T));
}
````

The function first finds whether a `Buffer` is constructed internally according to `ShaderProperty`, and if found, it
directly calls `WriteBuffer` to update the data. It should be emphasized that `wgpu::BufferUsage` is used here:

````cpp
wgpu::BufferUsage::Uniform | wgpu::BufferUsage::CopyDst
````

The former allows us to call the `WriteBuffer` function, the latter means that the `Buffer` is writable.

:::tip
`wgpu::BufferUsage` contains several options:

```cpp
enum class BufferUsage : uint32_t {
    None = 0x00000000,
    MapRead = 0x00000001,
    MapWrite = 0x00000002,
    CopySrc = 0x00000004,
    CopyDst = 0x00000008,
    Index = 0x00000010,
    Vertex = 0x00000020,
    Uniform = 0x00000040,
    Storage = 0x00000080,
    Indirect = 0x00000100,
    QueryResolve = 0x00000200,
};
```

`Vertex` is used to construct the `VertexBuffer` of the `Mesh`, and `Index` is used to construct the `IndexBuffer`.
If `MapRead` or `MapWrite` is set, you need to use `MapAsync` first when reading and writing data function, and then
call `GetMappedRange` to get the address of the memory map. Finally, you need `Unmap` to close the memory map, for
example:

````cpp
void EditorApplication::_readColorFromRenderTarget() {
    _stageBuffer.MapAsync(wgpu::MapMode::Read, 0, 4, [](WGPUBufferMapAsyncStatus status, void * userdata) {
        if (status == WGPUBufferMapAsyncStatus_Success) {
            EditorApplication* app = static_cast<EditorApplication*>(userdata);
            memcpy(app->_pixel.data(), app->_stageBuffer.GetConstMappedRange(0, 4), 4);
            auto picker = app->_colorPickerSubpass->getObjectByColor(app->_pixel);
            app->pickFunctor(picker.first, picker.second);
            
            app->_stageBuffer.Unmap();
        }
    }, this);
}
````

:::

## SampledTexture

In the basic tutorial, it was mentioned that `SampledTexture` is a resource that binds `wgpu::Sampler`
and `wgpu::Texture` together, but at the stage of configuring the rendering pipeline, the two must be disassembled
again. And each must be equipped with a unique ID. The only job of `ShaderData` is to implement the following four
functions:

```cpp
void setSampledTexture(const std::string &texture_name,
                       const std::string &sample_name,
                       const SampledTexturePtr& value);

void setSampledTexture(const ShaderProperty &texture_prop,
                       const ShaderProperty &sample_prop,
                       const SampledTexturePtr& value);

wgpu::TextureView getTextureView(uint32_t uniqueID);

wgpu::Sampler& getSampler(uint32_t uniqueID);
```

The first two will introduce the usage in detail when introducing `Material`. In short, it is to
save `SampledTexturePtr`; when the latter two are used to bind resources, use `SampledTexture::sampler`
and `SampledTexture::textureView` to get the corresponding type.

## Macro (ShaderMacro)

For convenience, `ShaderData` provides member functions related to the shader macro `ShaderMacroCollection`:

````cpp
void ShaderData::enableMacro(const std::string& macroName) {
    _macroCollection.enableMacro(macroName);
}

void ShaderData::enableMacro(const std::string& macroName, double value) {
    _macroCollection.enableMacro(macroName, value);
}

void ShaderData::disableMacro(const std::string& macroName) {
    _macroCollection.disableMacro(macroName);
}

void ShaderData::mergeMacro(const ShaderMacroCollection &macros,
                            ShaderMacroCollection &result) const {
    ShaderMacroCollection::unionCollection(macros, _macroCollection, result);
}
````

Shader macros can make `WGSLEncoder` generate specific shader code according to the characteristics of the resource,
such as whether it contains Normal, whether it needs to generate WorldPosition, etc. The macro is insensitive to the
user itself. In the process of configuring `Material` and `Renderer`, it will be automatically recorded and finally
forwarded to `WGSLEncoder` to encode the shader code.

## Practice in Arche.js

Arche.js' handling of `ShaderData` is essentially the same as the above code. But since TypeScript only has generics and
no templates, And it is impossible to directly treat any type as a bytes-array like C++, so you need to define an overloaded
function for all types used, for example:

```ts
/**
 * Shader data collection,Correspondence includes shader properties data and macros data.
 */
export class ShaderData implements IRefObject, IClone {
    /**
     * Get two-dimensional from shader property name.
     * @param propertyID - Shader property name
     * @returns Two-dimensional vector
     */
    getVector2(propertyID: number): Buffer;

    /**
     * Get two-dimensional from shader property name.
     * @param propertyName - Shader property name
     * @returns Two-dimensional vector
     */
    getVector2(propertyName: string): Buffer;

    /**
     * Get two-dimensional from shader property.
     * @param property - Shader property
     * @returns Two-dimensional vector
     */
    getVector2(property: ShaderProperty): Buffer;

    getVector2(property: number | string | ShaderProperty): Buffer {
        return this._getDataBuffer(property);
    }

    /**
     * Set two-dimensional vector from shader property name.
     * @remarks Correspondence includes vec2、ivec2 and bvec2 shader property type.
     * @param property - Shader property name
     * @param value - Two-dimensional vector
     */
    setVector2(property: string, value: Vector2): void;

    /**
     * Set two-dimensional vector from shader property.
     * @remarks Correspondence includes vec2、ivec2 and bvec2 shader property type.
     * @param property - Shader property
     * @param value - Two-dimensional vector
     */
    setVector2(property: ShaderProperty, value: Vector2): void;

    setVector2(property: string | ShaderProperty, value: Vector2): void {
        ShaderData._floatArray2[0] = value.x;
        ShaderData._floatArray2[1] = value.y;
        this._setDataBuffer(property, ShaderData._floatArray2);
    }
}
```

These overloaded functions copy data to a static array type based on the length of the type:

```ts
export class ShaderData implements IRefObject, IClone {
    private static _intArray1: Int32Array = new Int32Array(1);
    private static _floatArray1: Float32Array = new Float32Array(1);
    private static _floatArray2: Float32Array = new Float32Array(2);
    private static _floatArray3: Float32Array = new Float32Array(3);
    private static _floatArray4: Float32Array = new Float32Array(4);
}
````

With these array types, data is sent to the GPU:

```ts
export class ShaderData implements IRefObject, IClone {
    /**
     * @internal
     */
    _setDataBuffer(property: string | ShaderProperty, value: Float32Array | Int32Array): void {
        if (typeof property === "string") {
            property = Shader.getPropertyByName(property);
        }

        if (property._group !== this._group) {
            if (property._group === undefined) {
                property._group = this._group;
            } else {
                throw `Shader property ${property.name} has been used as ${ShaderDataGroup[property._group]} property.`;
            }
        }

        if (this._propertyResources[property._uniqueId] == undefined) {
            this._propertyResources[property._uniqueId] = new Buffer(this._engine, value.byteLength, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
        }
        (<Buffer>this._propertyResources[property._uniqueId]).uploadData(value, 0, 0, value.byteLength);
    }
}
```

:::caution 
Note that since the type of value is `Float32Array | Int32Array`, the length of the array is `value.length`,
not the data length `byteLength`.
:::
