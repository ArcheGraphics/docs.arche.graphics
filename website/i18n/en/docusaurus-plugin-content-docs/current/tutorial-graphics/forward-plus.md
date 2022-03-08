---
sidebar_position: 17
---

# Clustered Forward+

Due to the difficulties of deferred rendering in bandwidth usage, transparent objects, multi-material rendering, etc.,
the forward rendering mode is mainly used in Arche-cpp, and Forward+ is integrated to cull light sources. There are
generally two types of light source culling, one is Tile-based, which divides the screen space, and another is
Cluster-based, which divides the viewing frustum. The two methods are similar in nature, and are introduced here on the
basis of Cluster-based. In the process of development, I gradually realized that Forward+ and shadow rendering are very
similar, both of which need to do some "pre-calculation" preparations before official rendering. The former is to
calculate the light source list by cluster, and the latter is to render ShadowMap, so The final code structure is also
very similar.

## Main Logic

In order to allow more pre- and post-processing to be integrated into the main loop, both shadow and lighting updates
are proposed separately:

```cpp
void ForwardApplication::updateGPUTask(wgpu::CommandEncoder& commandEncoder) {
    _shadowManager->draw(commandEncoder);
    _lightManager->draw(commandEncoder);
}
```

:::tip 
Both `ShadowManager` and `LightManager` are singleton patterns, users can also extend the capabilities of the
engine in a similar way, and insert their own singleton manager updates through subclasses.
:::

Therefore, the main logic is concentrated in the `draw` function:

```cpp
void LightManager::draw(wgpu::CommandEncoder& commandEncoder) {
    _updateShaderData(_scene->shaderData);
    
    size_t pointLightCount = _pointLights.size();
    size_t spotLightCount = _spotLights.size();
    if (pointLightCount + spotLightCount > FORWARD_PLUS_ENABLE_MIN_COUNT) {
        _enableForwardPlus = true;
        bool updateBounds = false;
        
        _forwardPlusUniforms.matrix = _camera->projectionMatrix();
        _forwardPlusUniforms.inverseMatrix = _camera->inverseProjectionMatrix();
        if (_forwardPlusUniforms.outputSize.x != _camera->width() ||
            _forwardPlusUniforms.outputSize.y != _camera->height()) {
            updateBounds = true;
            _forwardPlusUniforms.outputSize = Vector2F(_camera->framebufferWidth(), _camera->framebufferHeight());
        }
        _forwardPlusUniforms.zNear = _camera->nearClipPlane();
        _forwardPlusUniforms.zFar = _camera->farClipPlane();
        _forwardPlusUniforms.viewMatrix = _camera->viewMatrix();
        _scene->shaderData.setData(_forwardPlusProp, _forwardPlusUniforms);
        
        // Reset the light offset counter to 0 before populating the light clusters.
        uint32_t empty = 0;
        _clusterLightsBuffer->uploadData(_scene->device(), &empty, sizeof(uint32_t));
        
        auto encoder = commandEncoder.BeginComputePass();
        if (updateBounds) {
            _clusterBoundsCompute->compute(encoder);
        }
        _clusterLightsCompute->compute(encoder);
        encoder.End();
    }
}
```

There are two compute shaders involved in the main logic, the former is only called when the viewport size is updated,
and the latter needs to be called every frame to calculate the light source list. Due to the good design of ComputePass,
we only need to focus on compute shader itself.

### Calculate the Bounding box of the Cluster

The logic of calculating the bounding box is to let each thread on GPU calculate the bounding box of
the screen space, and then go to the view space through the inverse transformation of the projection matrix:

```wgsl
fn clipToView(clip : vec4<f32>) -> vec4<f32> {
  let view = u_cluster_projection.inverseMatrix * clip;
  return view / vec4<f32>(view.w, view.w, view.w, view.w);
}

fn screen2View(screen : vec4<f32>) -> vec4<f32> {
  let texCoord = screen.xy / u_cluster_projection.outputSize.xy;
  let clip = vec4<f32>(vec2<f32>(texCoord.x, 1.0 - texCoord.y) * 2.0 - vec2<f32>(1.0, 1.0), screen.z, screen.w);
  return clipToView(clip);
}
```

### Save the List of lights in each Cluster

What needs to be calculated frame by frame is the list of light sources, so that when rendering, the corresponding
Cluster can be found according to the position of the fragment, and the list of light sources can be extracted for
lighting calculation. This way a large number of unlit fragments do not need to do expensive light traversal. Since we
have calculated the bounding box for each Cluster, the next step is to circulate the light source to determine whether
the circle with the light source coordinate as the center and the radiation range as the radius intersects the bounding
box.

````wgsl
if (!lightInCluster) {
    let lightViewPos = u_cluster_view.matrix * vec4<f32>(u_spotLight[i].position, 1.0);
    let sqDist = sqDistPointAABB(lightViewPos.xyz, u_clusters.bounds[tileIndex].minAABB, u_clusters.bounds[tileIndex].maxAABB);
    lightInCluster = sqDist <= (range * range);
}
````

When `lightInCluster` is true, the indicator of the corresponding light source is recorded. Since we need an array to
record this information, but each thread is computed in parallel, an atomic operation is required to compute the
starting point of each Cluster in this array. And based on this starting point, the calculated information is saved:

```wgsl
var offset = atomicAdd(&u_clusterLights.offset, clusterLightCount);

for(var i = 0u; i < clusterLightCount; i = i + 1u) {
  u_clusterLights.indices[offset + i] = cluserLightIndices[i];
}
u_clusterLights.lights[tileIndex].offset = offset;
u_clusterLights.lights[tileIndex].point_count = clusterLightCount;
```

## Debugging Tools

During development, as with shadows, there is a need to debug "precomputed" results. However, unlike ShadowMap, the
result here is an array and cannot be visualized directly, so the best approach is to provide a shader for debugging:

````cpp
encoder.addEntry({{"in", "VertexOut"}}, {"out", "Output"}, [&](std::string &source){
    source += "let clusterIndex : u32 = getClusterIndex(in.fragCoord);\n";
    source += "let lightCount : u32 = u_clusterLights.lights[clusterIndex].point_count + u_clusterLights.lights[clusterIndex].spot_count;\n";
    source += fmt::format("let lightFactor : f32 = f32(lightCount) / f32({});\n", _maxLightsPerCluster);
    source += "out.finalColor = mix(vec4<f32>(0.0, 0.0, 1.0, 1.0), vec4<f32>(1.0, 0.0, 0.0, 1.0), vec4<f32>(lightFactor, lightFactor, lightFactor, lightFactor ));\n";
});
encoder.flush();
````

The core logic of debugging the shader is to find the Cluster through the fragment, then get the number of light sources
saved in it, and use the number as the color for debugging.
