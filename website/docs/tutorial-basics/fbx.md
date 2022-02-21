---
sidebar_position: 10
---

# 资源：FBX格式

Arche 使用 [FBX SDK](https://www.autodesk.com/developer-network/platform-technologies/fbx-sdk-2016-1-2) 加载 FBX 格式文件，加载后的
FBX 文件主要用于 CPU 蒙皮动画系统使用。因此，在 `SkinnedMeshRenderer` 上，直接可以加载对应的资源：
```cpp title="apps/animation_app.cpp"
characterRenderer->addSkinnedMesh("../assets/Models/Doggy/Doggy.fbx",
                                  "../assets/Models/Doggy/doggy_skeleton.ozz");
```

在具体实现中，该函数会调用 `loader` 命名空间的函数：
```cpp
bool loadScene(const char* _filename, const animation::Skeleton& skeleton, vector<Mesh>& _meshes);
```
其中 `Mesh` 并不是前几篇文章介绍过的网格资源，而是专门为了转译 FBX 中网格格式的中间数据：
```cpp
// Defines a mesh with skinning information (joint indices and weights).
// The mesh is subdivided into parts that group vertices according to their
// number of influencing joints. Triangle indices are shared across mesh parts.
struct Mesh {
    // Defines a portion of the mesh. A mesh is subdivided in sets of vertices
    // with the same number of joint influences.
    struct Part {
        int vertex_count() const { return static_cast<int>(positions.size()) / 3; }
        
        int influences_count() const {
            const int _vertex_count = vertex_count();
            if (_vertex_count == 0) {
                return 0;
            }
            return static_cast<int>(joint_indices.size()) / _vertex_count;
        }
        
        typedef vector<float> Positions;
        Positions positions;
        enum { kPositionsCpnts = 3 };  // x, y, z components
        
        typedef vector<float> Normals;
        Normals normals;
        enum { kNormalsCpnts = 3 };  // x, y, z components
        
        typedef vector<float> Tangents;
        Tangents tangents;
        enum { kTangentsCpnts = 4 };  // x, y, z, right or left handed.
        
        typedef vector<float> UVs;
        UVs uvs;  // u, v components
        enum { kUVsCpnts = 2 };
        
        typedef vector<uint8_t> Colors;
        Colors colors;
        enum { kColorsCpnts = 4 };  // r, g, b, a components
        
        typedef vector<uint16_t> JointIndices;
        JointIndices joint_indices;  // Stride equals influences_count
        
        typedef vector<float> JointWeights;
        JointWeights joint_weights;  // Stride equals influences_count - 1
    };
    typedef vector<Part> Parts;
    Parts parts;
};
```

因此，这使得 `SkinnedMeshRenderer` 和 `MeshRenderer` 的渲染函数有很大不同，前者可以拥有多个蒙皮网格，但这些蒙皮网格并不是最终用于渲染的数据，而是要经过 `ozz::geometry::SkinningJob` 转换的数据：
```cpp
ozz::geometry::SkinningJob skinning_job;
skinning_job.vertex_count = static_cast<int>(part_vertex_count);
const int part_influences_count = part.influences_count();

// Clamps joints influence count according to the option.
skinning_job.influences_count = part_influences_count;

// Setup skinning matrices, that came from the animation stage before being
// multiplied by inverse model-space bind-pose.
skinning_job.joint_matrices = _skinning_matrices;

// Setup joint's indices.
skinning_job.joint_indices = make_span(part.joint_indices);
skinning_job.joint_indices_stride = sizeof(uint16_t) * part_influences_count;

// Setup joint's weights.
if (part_influences_count > 1) {
    skinning_job.joint_weights = make_span(part.joint_weights);
    skinning_job.joint_weights_stride =
    sizeof(float) * (part_influences_count - 1);
}

// Setup input positions, coming from the loaded mesh.
skinning_job.in_positions = make_span(part.positions);
skinning_job.in_positions_stride = sizeof(float) * ozz::loader::Mesh::Part::kPositionsCpnts;
```

`ozz::geometry::SkinningJob` 输出的数据才被传入到 GPU 用于渲染。
