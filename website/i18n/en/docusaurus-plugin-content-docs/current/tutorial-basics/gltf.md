---
sidebar_position: 11
---

# Resource: GLTF Format
![gltf](https://arched-graphics.oss-cn-shanghai.aliyuncs.com/img/gltf_scene.gif)

Compared with FBX, which is only applied to the animation system, Arche's loading of GLTF is more comprehensive.
:::note 
Currently GLTF loaded animation assets can only be used with `GPUSkinnedMeshRenderer`, because `GLTF` animation
transforms are resolved as per `Entity` transforms.
:::
The loading of GLTF requires the use of the `GLTFLoader` loader, which uses the open
source [tinygltf](https://github.com/syoyo/tinygltf). When loading data, you need to specify a root entity, and the
entities created by the loader will be mounted under the entity according to the child-parent relationship:

````cpp
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
````

Therefore, when using, you can load GLTF resources as follows:

````cpp
auto modelEntity = rootEntity->createChild();
auto loader = loader::GLTFLoader(_device);
loader.loadFromFile("Models/sponza/sponza.gltf", modelEntity);
````

In `tinygltf`, `tinygltf::Model` represents all the resources used by the modified GLTF file, and a GLTF file can
contain multiple scenes, Therefore, the specific scene to be loaded can be selected through `tinygltf::Scene`, and the
scene is related to the node tree of `Entity`. Therefore, when loading, first read all resources from `tinygltf::Model`,
these resources are reusable data, which can be used in other scenarios:

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

Then build a specific scene based on `tinygltf::Scene`:

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
