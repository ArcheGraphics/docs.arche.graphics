---
sidebar_position: 9
---

# Resource

If `Component` is a single object of `std::unique_ptr` constructed from an entity, then resources are managed
with `std::shared_ptr` and can be shared among multiple components. In Arche, resources can be divided into two main
categories:

1. Mesh (`Mesh`): `wgpu::Buffer` corresponding to WebGPU
2. Textures with additional samplers (`SampledTexture`): `wgpu::Texture` and `wgpu::Sampler` for WebGPU

:::tip 
Materials `Material` are also managed through `std::shared_ptr` and can be reused on multiple `Renderers`. But
it's not a resource, so it's not listed above.
:::

## Mesh

The mesh is a necessary resource for rendering. To construct any mesh, you need to specify four pieces of information:

1. IndexBufferBinding: vertex index
2. VertexBuffer: vertex data, must include position, can contain additional data such as normal, UV
3. `wgpu::VertexBufferLayout` describes the data layout in `VertexBuffer` so that shaders can read specific data
4. SubMesh: The mesh contains multiple sub-mesh, each sub-mesh corresponds to a specific material, so that different
   parts on a `Mesh` correspond to different material information

In Arche, `Mesh` is the base class for all meshes, and there are two subclasses implemented:

1. ModelMesh: By setting data such as Position and Normal, `wgpu::VertexBufferLayout` and various `Buffer` are
   automatically constructed according to the set data.
2. BufferMesh: directly set the information required by `Mesh`.

The easiest way to construct a `ModelMesh` is through the `PrimitiveMesh` tool class, which provides basic geometric
shapes including cubes, spheres, cones, capsules, etc. You can use these tool functions to quickly test the rendering
effect. while `BufferMesh`
Users need to build `wgpu::Buffer` or even `wgpu::VertexBufferLayout` by themselves. For example, in `GLTFLoader`, this
method is used to construct the mesh from the mesh vertex data in GLTF:

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

## SampledTexture

The type `SampledTexture` represented by the texture attached to the sampler maintains both `wgpu::Texture`
and `wgpu::Sampler` objects.
:::note 
In modern graphics APIs, samplers and textures are two separate types, but it is difficult to design an
easy-to-use interface to handle the two separately during shading. For example, a sampler corresponds to multiple
textures. If a texture requires special sampling, Then another sampler needs to be built, the relationship between the
two is difficult to match, and a complex cache relationship needs to be built. Therefore, Arche still handles the two
together.
:::

### Sampler

As a base class, `SampledTexture` actually mainly maintains the relevant interfaces required to
configure `wgpu::SamplerDescriptor`, while subclasses such as `SampledTexture2D` are responsible for the construction
of `wgpu::Texture` and data access.
`wgpu::SamplerDescriptor` has the following configuration parameters:

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

These parameters can be seen in `SampledTexture`. When the user configures these parameters, the dirty flag will take
effect, so when trying to get `wgpu::Sampler`, it will choose whether to rebuild the sampler according to the dirty
flag:

````cpp
wgpu::Sampler& SampledTexture::sampler() {
     if (_isDirty) {
         _nativeSampler = _device.CreateSampler(&_samplerDesc);
         _isDirty = false;
     }
     return _nativeSampler;
}
````

### Texture

If you need to construct a texture, you need to read the image file first, then decode it and pass it into the GPU to
get `wgpu::Texture`. `Image` provides very simple static functions for loading images:

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

You can see that almost all widely used texture formats are currently supported. After getting `std::unique_ptr<Image>`,
you can convert it to `std::shared_ptr<SampledTexture2D>` through the `createSampledTexture` function:

````cpp
std::shared_ptr<SampledTexture2D> Image::createSampledTexture(wgpu::Device &device, wgpu::TextureUsage usage) {
     auto sampledTex = std::make_shared<SampledTexture2D>(device, _mipmaps.at(0).extent.width,
                                                          _mipmaps.at(0).extent.height, _format, usage,
                                                          _mipmaps.size() > 1? true:false);
     sampledTex->setImageSource(this);
     return sampledTex;
}
````


