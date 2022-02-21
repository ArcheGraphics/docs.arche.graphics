---
sidebar_position: 10
---

# Resource: FBX Format

Arche uses [FBX SDK](https://www.autodesk.com/developer-network/platform-technologies/fbx-sdk-2016-1-2) to load FBX
format files, FBX files are primarily used by CPU skinning animation systems. Therefore, on `SkinnedMeshRenderer`, the
corresponding resources can be loaded directly:

```cpp title="apps/animation_app.cpp"
characterRenderer->addSkinnedMesh("../assets/Models/Doggy/Doggy.fbx",
                                   "../assets/Models/Doggy/doggy_skeleton.ozz");
````

In a concrete implementation, this function will call a function in the `loader` namespace:

````cpp
bool loadScene(const char* _filename, const animation::Skeleton& skeleton, vector<Mesh>& _meshes);
````

Among them, `Mesh` is not the mesh resource introduced in the previous articles, but is specially designed to translate
the intermediate data of the mesh format in FBX:

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

Therefore, this makes the rendering functions of `SkinnedMeshRenderer` and `MeshRenderer` very different, the former can
have multiple skinned meshes, but these skinned meshes are not the final data used for rendering, but go
through `ozz ::geometry::SkinningJob` transformed data:

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

Only the data output by `ozz::geometry::SkinningJob` is passed to the GPU for rendering.
