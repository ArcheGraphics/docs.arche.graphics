---
sidebar_position: 9
---

# 资源

如果说 `Component` 是一种依赖某一实体构造的 `std::unique_ptr` 单一对象，那么资源则是使用 `std::shared_ptr` 管理的，可以在多个组件中共享的对象。 在 Arche 中，可以资源主要分为两类：

1. 网格（`Mesh`）：对应 WebGPU 的 `wgpu::Buffer`
2. 附加采样器的贴图（`SampledTexture`）：对应 WebGPU 的 `wgpu::Texture` 和 `wgpu::Sampler`

:::tip 
材质 `Material` 也通过 `std::shared_ptr` 进行管理，并且可以在多个 `Renderer` 上进行复用。但它并不是一种资源，因此没有列在上面。
:::

## 网格

网格是渲染所必须的资源，构造任意网格都需要指定四个信息：

1. IndexBufferBinding：顶点指标
2. VertexBuffer：顶点数据，必须包括位置，可以包含法线，UV等额外数据
3. `wgpu::VertexBufferLayout` 描述 `VertexBuffer` 中的数据排布，使得着色器可以读取特定的数据
4. SubMesh：网格中包含多个子网格，每一个子网格都对应特定的材质，由此使得一个 `Mesh` 上的不同部件对应不同的材质信息

在 Arche 中，`Mesh` 是所有网格的基类，有两种子类实现：

1. ModelMesh：通过设置例如 Position，Normal在内的数据，根据设置的数据自动构造 `wgpu::VertexBufferLayout` 和各种 `Buffer`。
2. BufferMesh：直接设置 `Mesh` 所需要的信息。

其中构造 `ModelMesh` 最简单的方式，是通过 `PrimitiveMesh` 这一工具类，这一类型提供了包括立方体，球，圆锥，胶囊体等基础几何图形，可以用这些工具函数快速测试渲染的效果:
```cpp
auto renderer = cubeEntity->addComponent<MeshRenderer>();
renderer->setMesh(PrimitiveMesh::createCuboid(_device, 1));
```

而 `BufferMesh` 则需要用户自行构建 `wgpu::Buffer` 甚至是 `wgpu::VertexBufferLayout`，例如在 `GLTFLoader` 中，就使用了这种方式，通过 GLTF 中的网格顶点数据构造网格：

```cpp
void GLTFLoader::loadMeshes(tinygltf::Model& model) {
    for (auto &gltf_mesh: model.meshes) {
        std::vector<std::pair<MeshPtr, MaterialPtr>> renderer{};
        for (auto &primitive: gltf_mesh.primitives) {
            if (primitive.indices < 0) {
                continue;
            }
            
            auto bufferMesh = std::make_shared<BufferMesh>();
            ...
        }
    }
}
```

## 附加采样器的贴图

附加采样器的贴图所表示的类型 `SampledTexture` 同时维护了 `wgpu::Texture` 和 `wgpu::Sampler` 这两种对象。
:::note
在现代图形API中，采样器和贴图是两种分开的类型，但是在着色过程中，很难设计容易使用的接口将二者分开处理。例如一个采样器对应多个贴图，如果某个贴图需要特殊的采样，
则需要再构建一个采样器，两者之间的关系很难匹配，需要构建复杂的缓存关系。因此 Arche 还是将二者合在一起处理。
:::

### 采样器
`SampledTexture` 作为基类，其实主要维护了配置 `wgpu::SamplerDescriptor` 所需的相关接口，而子类例如 `SampledTexture2D` 则负责 `wgpu::Texture` 的构造以及数据的存取。
`wgpu::SamplerDescriptor` 拥有如下的配置参数：
```cpp
struct SamplerDescriptor {
    ChainedStruct const * nextInChain = nullptr;
    char const * label = nullptr;
    AddressMode addressModeU = AddressMode::ClampToEdge;
    AddressMode addressModeV = AddressMode::ClampToEdge;
    AddressMode addressModeW = AddressMode::ClampToEdge;
    FilterMode magFilter = FilterMode::Nearest;
    FilterMode minFilter = FilterMode::Nearest;
    FilterMode mipmapFilter = FilterMode::Nearest;
    float lodMinClamp = 0.0f;
    float lodMaxClamp = 1000.0f;
    CompareFunction compare = CompareFunction::Undefined;
    uint16_t maxAnisotropy = 1;
};
```

这些参数都可以在 `SampledTexture` 中看到，当用户配置这些参数时，脏标记会生效，于是当试图获得 `wgpu::Sampler` 时，会根据脏标记选择是否重新构造采样器：
```cpp
wgpu::Sampler& SampledTexture::sampler() {
    if (_isDirty) {
        _nativeSampler = _device.CreateSampler(&_samplerDesc);
        _isDirty = false;
    }
    return _nativeSampler;
}
```

### 贴图
如果需要构造贴图，需要先读取图片文件，然后解码后将其传入到 GPU 中得到 `wgpu::Texture`。`Image` 提供非常简单的静态函数用于加载图片：
```cpp
std::unique_ptr<Image> Image::load(const std::string &uri, bool flipY) {
    std::unique_ptr<Image> image{nullptr};
    
    auto data = fs::readAsset(uri);
    
    // Get extension
    auto extension = fs::extraExtension(uri);
    if (extension == "png" || extension == "jpg") {
        image = std::make_unique<Stb>(data, flipY);
    } else if (extension == "astc") {
        image = std::make_unique<Astc>(data, flipY);
    } else if (extension == "ktx") {
        image = std::make_unique<Ktx>(data, flipY);
    } else if (extension == "ktx2") {
        image = std::make_unique<Ktx>(data, flipY);
    }
    return image;
}
```
可以看到目前支持几乎所有广泛使用的贴图格式，得到 `std::unique_ptr<Image>` 后，就可以通过 `createSampledTexture` 函数将其转换为 `std::shared_ptr<SampledTexture2D>`：
```cpp
std::shared_ptr<SampledTexture2D> Image::createSampledTexture(wgpu::Device &device, wgpu::TextureUsage usage) {
    auto sampledTex = std::make_shared<SampledTexture2D>(device, _mipmaps.at(0).extent.width,
                                                         _mipmaps.at(0).extent.height, _format, usage,
                                                         _mipmaps.size() > 1? true:false);
    sampledTex->setImageSource(this);
    return sampledTex;
}
```


