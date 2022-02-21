---
sidebar_position: 4
---

# 着色器数据

着色器数据 `ShaderData` 将 UniformBuffer 的创建和上传数据，以及 `wgpu::Buffer`， `wgpuTextureView`， `wgpu::Sampler` 在渲染管线上的绑定进行封装。
在引擎中，一方面方便用户侧上传各种类型的数据， 另外一方面每一个着色器数据都有唯一的标识，该标识使用 `ShaderProperty` 进行描述：

```cpp
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
```

在之后介绍 `WGSLEncoder` 即 WGSL 编码器的时候会提到，编码器会保存 `wgpu::BindGroupLayoutEntry`：

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

其中的 `binding` 参数和 `ShaderProperty::uniqueId` 是相同的，因此，通过编码器不仅可以构建着色器代码，还可以找到对应的数据进行绑定。

## UniformBuffer

为了支持各种类型的数据上传 UniformBuffer，构造和上传数据的成员函数使用函数模板：

```cpp
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
```

该函数首先根据 `ShaderProperty` 寻找内部是否构造了 `Buffer`, 如果找到就直接调用 `WriteBuffer` 更新数据，需要特别强调的是 `wgpu::BufferUsage`，在这里使用了：

```cpp
wgpu::BufferUsage::Uniform | wgpu::BufferUsage::CopyDst
```

前者使得我们可以调用 `WriteBuffer` 函数，后者则意味着该 `Buffer` 是可写的。

:::tip
`wgpu::BufferUsage` 包含多个选项：

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

`Vertex` 用在构造 `Mesh` 的 `VertexBuffer`，`Index` 用在构造 `IndexBuffer`。 如果设定了 `MapRead` 或者 `MapWrite`，就需要在读写数据时，先使用 `MapAsync`
函数，再调用 `GetMappedRange` 才可以获得内存映射的地址，最后还需要 `Unmap` 关闭内存映射，例如：

```cpp
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
```

:::

## 带采样器的贴图（SampledTexture）

在基础教程中曾经提到 `SampledTexture` 这是一种将 `wgpu::Sampler` 和 `wgpu::Texture` 绑定在一起的资源，但是到了配置渲染管线的阶段，两者必须重新拆开，并且每一个都必须配备唯一的 ID。
`ShaderData` 的唯一工作，就是实现以下四个函数：

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

前两者会在介绍 `Material` 时详细介绍使用方式，简单来说就是保存 `SampledTexturePtr`；后两者用于绑定资源时，通过 `SampledTexture::sampler`
和 `SampledTexture::textureView` 获得对应的类型。

## 宏（ShaderMacro）

为了方便起见 `ShaderData` 提供了着色器宏 `ShaderMacroCollection` 相关的成员函数：

```cpp
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
```

着色器宏可以使得 `WGSLEncoder` 根据资源的特点，例如是否包含 Normal，是否需要生成 WorldPosition 等等生成特定的着色器代码。 宏对于用户本身是无感的，在用户配置 `Material`，`Renderer`
的过程中，会自动记录，最终转发到 `WGSLEncoder` 编码着色器代码。

## Arche.js 中的实践

Arche.js 在 `ShaderData` 上的处理本质上和上述代码是一致的。但因为 TypeScript 只有泛型而没有模板，
且无法直接像 C++ 那样直接将任意类型当做数组处理，因此需要对所有用到的类型都定义一个重载函数，例如：
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
这些重载函数根据类型的长度，将数据复制到静态数组类型：
```ts
export class ShaderData implements IRefObject, IClone {
    private static _intArray1: Int32Array = new Int32Array(1);
    private static _floatArray1: Float32Array = new Float32Array(1);
    private static _floatArray2: Float32Array = new Float32Array(2);
    private static _floatArray3: Float32Array = new Float32Array(3);
    private static _floatArray4: Float32Array = new Float32Array(4);
}
```
通过这些数组类型，将数据发送到GPU：
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
需要特别注意由于 value 的类型是 `Float32Array | Int32Array`，因此取数组的长度 `value.length`，而不是数据长度 `byteLength`.
:::
