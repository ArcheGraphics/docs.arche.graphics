---
sidebar_position: 11
---

# 资源：GLTF格式
![gltf](https://arched-graphics.oss-cn-shanghai.aliyuncs.com/img/gltf_scene.gif)

相比于 FBX 只应用在动画系统，Arche 对于 GLTF 的加载要更加全面。
:::note
目前 GLTF 加载的动画资源只能用于 `GPUSkinnedMeshRenderer`，因为 `GLTF` 的动画变换被解析为有关 `Entity` 之间的变换。
:::
GLTF 的加载需要使用 `GLTFLoader` 加载器，该加载器使用开源的 [tinygltf](https://github.com/syoyo/tinygltf)。
在加载数据时，需要指定一个根实体，通过加载器创建的实体，都会按照子父关系挂载到该实体下：
```cpp
class GLTFLoader {
public:
    std::vector<std::unique_ptr<Image>> images;
    std::vector<SampledTexture2DPtr> textures;
    std::vector<MaterialPtr> materials;
    std::vector<std::vector<std::pair<MeshPtr, MaterialPtr>>> renderers;
    std::vector<GPUSkinnedMeshRenderer::SkinPtr> skins;
    
    GLTFLoader(wgpu::Device& device);
    
    void loadFromFile(std::string filename, EntityPtr defaultSceneRoot, float scale = 1.0f);
};
```

因此在使用时，可以通过如下方式加载 GLTF 资源：
```cpp
auto modelEntity = rootEntity->createChild();
auto loader = loader::GLTFLoader(_device);
loader.loadFromFile("Models/sponza/sponza.gltf", modelEntity);
```

在 `tinygltf` 中，`tinygltf::Model` 代表改 GLTF 文件所使用的所有资源，而一个 GLTF 文件可以包含多个场景，
因此可以通过 `tinygltf::Scene` 选择具体要加载的场景，场景和 `Entity` 的节点树有关。
因此，在加载时，首先从 `tinygltf::Model` 当中读取所有的资源，这些资源都是可复用的数据，可以用于其他场景：
```cpp
void GLTFLoader::loadScene(tinygltf::Model& gltfModel) {
    ...
    
    // Load images
    loadImages(gltfModel);
    
    // Load textures && samplers
    loadTextures(gltfModel);
    
    // Load materials
    loadMaterials(gltfModel);
    
    // Load meshes
    loadMeshes(gltfModel);
    
    ...
}
```

然后再根据 `tinygltf::Scene` 构建具体场景：
```cpp
void GLTFLoader::loadScene(tinygltf::Model& gltfModel) {
    ...
    
    // Load nodes && scenes
    const tinygltf::Scene &scene = gltfModel.scenes[gltfModel.defaultScene > -1 ? gltfModel.defaultScene : 0];
    for (size_t i = 0; i < scene.nodes.size(); i++) {
        const tinygltf::Node node = gltfModel.nodes[scene.nodes[i]];
        loadNode(nullptr, node, scene.nodes[i], gltfModel);
    }
    
    // Load animations
    if (gltfModel.animations.size() > 0) {
        loadAnimations(gltfModel);
    }
    loadSkins(gltfModel);
    for (auto node : _linearNodes) {
        // Assign skins
        if (node.second.second > -1) {
            node.second.first->getComponent<GPUSkinnedMeshRenderer>()->setSkin(skins[node.second.second]);
        }
        // Initial pose
        auto mesh = node.second.first->getComponent<GPUSkinnedMeshRenderer>();
        if (mesh) {
            mesh->update(0);
        }
    }
}
```
