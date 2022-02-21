---
sidebar_position: 3
---

# Render State

## Status overview
Rendering state is the easiest part of WebGPU to understand. 
There are many enumeration types in WebGPU, 
which can be partially encapsulated into centralized state types, including:

1. RenderTargetBlendState
2. BlendState
3. RasterState
4. StencilState
5. DepthState

The core of this layer of encapsulation lies in the reorganization of concepts, 
which makes it easier to substitute specific concepts when controlling these parameters.

```cpp title="shader/state/render_state.cpp"
void RenderState::apply(wgpu::ColorTargetState* colorTargetState,
                        wgpu::DepthStencilState* depthStencil,
                        wgpu::RenderPipelineDescriptor& pipelineDescriptor,
                        wgpu::RenderPassEncoder &encoder,
                        bool frontFaceInvert) {
    blendState.apply(colorTargetState, pipelineDescriptor.multisample, encoder);
    depthState.apply(depthStencil);
    stencilState.apply(depthStencil, encoder);
    rasterState.apply(pipelineDescriptor.primitive, depthStencil, frontFaceInvert);
}
```

:::note
There are two parameters passed in here that are pointers, because these two parameters are optional in nature. 
The former corresponds to the state related to the fragment shader. 
For example, there is no fragment shader for shadow drawing, and the latter is related to Depth. Related to Stencil, can be empty.
```cpp
struct RenderPipelineDescriptor {
        ChainedStruct const * nextInChain = nullptr;
        char const * label = nullptr;
        PipelineLayout layout = nullptr;
        VertexState vertex;
        PrimitiveState primitive;
        DepthStencilState const * depthStencil = nullptr;
        MultisampleState multisample;
        FragmentState const * fragment = nullptr;
    };
```
:::

---

### RenderTargetBlendState

```cpp title="shader/state/render_target_blend_state.h"
/**
 * The blend state of the render target.
 */
struct RenderTargetBlendState {
    /** Whether to enable blend. */
    bool enabled = false;
    /** color (RGB) blend operation. */
    wgpu::BlendOperation colorBlendOperation = wgpu::BlendOperation::Add;
    /** alpha (A) blend operation. */
    wgpu::BlendOperation alphaBlendOperation = wgpu::BlendOperation::Add;
    /** color blend factor (RGB) for source. */
    wgpu::BlendFactor sourceColorBlendFactor = wgpu::BlendFactor::One;
    /** alpha blend factor (A) for source. */
    wgpu::BlendFactor sourceAlphaBlendFactor = wgpu::BlendFactor::One;
    /** color blend factor (RGB) for destination. */
    wgpu::BlendFactor destinationColorBlendFactor = wgpu::BlendFactor::Zero;
    /** alpha blend factor (A) for destination. */
    wgpu::BlendFactor destinationAlphaBlendFactor = wgpu::BlendFactor::Zero;
    /** color mask. */
    wgpu::ColorWriteMask colorWriteMask = wgpu::ColorWriteMask::All;
};
```
---

### BlendState

`BlendState` actually further encapsulates `RenderTargetBlendState`:

```cpp title="shader/state/blend_state.h"
/**
 * Blend state.
 */
struct BlendState {
    /** The blend state of the render target. */
    RenderTargetBlendState targetBlendState = RenderTargetBlendState();
    /** Constant blend color. */
    Color blendColor = Color(0, 0, 0, 0);
    /** Whether to use (Alpha-to-Coverage) technology. */
    bool alphaToCoverage = false;
};
```

In order to set the blend state, set the enum values to `wgpu::RenderPipelineDescriptor` and `wgpu::RenderPassEncoder`
Among them, because in Dawn, the structure body uses a lot of pointers for concatenation, and the types of the pointers are all const.
Therefore, only the specific structure can be directly passed into the function, but the objects of the two cannot be directly passed in. which is:

```cpp title="shader/state/blend_state.cpp"
void BlendState::platformApply(wgpu::ColorTargetState* colorTargetState,
                               wgpu::MultisampleState &multisample,
                               wgpu::RenderPassEncoder &encoder) {
    const auto enabled = targetBlendState.enabled;
    const auto colorBlendOperation = targetBlendState.colorBlendOperation;
    const auto alphaBlendOperation = targetBlendState.alphaBlendOperation;
    const auto sourceColorBlendFactor = targetBlendState.sourceColorBlendFactor;
    const auto destinationColorBlendFactor = targetBlendState.destinationColorBlendFactor;
    const auto sourceAlphaBlendFactor = targetBlendState.sourceAlphaBlendFactor;
    const auto destinationAlphaBlendFactor = targetBlendState.destinationAlphaBlendFactor;
    const auto colorWriteMask = targetBlendState.colorWriteMask;
    
    if (enabled && colorTargetState) {
        colorTargetState->blend = &_blendState;
    } else {
        if (colorTargetState) {
            colorTargetState->blend = nullptr;
        }
    }
    
    if (enabled) {
        // apply blend factor.
        _blendState.color.srcFactor = sourceColorBlendFactor;
        _blendState.color.dstFactor = destinationColorBlendFactor;
        _blendState.alpha.srcFactor = sourceAlphaBlendFactor;
        _blendState.alpha.dstFactor = destinationAlphaBlendFactor;
        
        // apply blend operation.
        _blendState.color.operation = colorBlendOperation;
        _blendState.alpha.operation = alphaBlendOperation;
        
        // apply blend color.
        encoder.SetBlendConstant(reinterpret_cast<wgpu::Color*>(&blendColor));
        
        // apply color mask.
        if (colorTargetState) {
            colorTargetState->writeMask = colorWriteMask;
        }
    }
    
    multisample.alphaToCoverageEnabled = alphaToCoverage;
}
```

For the time being, you don't need to worry about what things like: `wgpu::ColorTargetState`, `wgpu::MultisampleState` are. 
Just need to know that these State pointers will be saved to `wgpu::RenderPipelineDescriptor` in the future,
And `wgpu::RenderPipelineDescriptor` is the key to constructing RenderPipeline.

---

### RasterState

`RasterState` mainly describes a series of parameters of rasterization, such as the direction of triangle rotation, culled faces, etc.

```cpp title="shader/state/render_state.h"
/**
 * Raster state.
 */
struct RasterState {
    /** Specifies whether or not front- and/or back-facing polygons can be culled. */
    wgpu::CullMode cullMode = wgpu::CullMode::Front;
    /** The multiplier by which an implementation-specific value is multiplied with to create a constant depth offset. */
    float depthBias = 0;
    /** The scale factor for the variable depth offset for each polygon. */
    float slopeScaledDepthBias = 0;
};
```

The values of these enum types are also set to `wgpu::RenderPipelineDescriptor`:

```cpp title="shader/state/render_state.cpp"
void RasterState::platformApply(wgpu::PrimitiveState& primitive,
                                wgpu::DepthStencilState* depthStencil,
                                bool frontFaceInvert) {
    primitive.cullMode = cullMode;
    if (frontFaceInvert) {
        primitive.frontFace = wgpu::FrontFace::CW;
    } else {
        primitive.frontFace = wgpu::FrontFace::CCW;
    }
    
    if (depthBias != 0 || slopeScaledDepthBias != 0) {
        if (depthStencil) {
            depthStencil->depthBiasSlopeScale = slopeScaledDepthBias;
            depthStencil->depthBias = depthBias;
        }
    }
}
```
---

### StencilState

`StencilState` is mainly related to the use of StencilBuffer. If `wgpu::RenderPassDepthStencilAttachment` is configured in the pipeline, 
then its behavior can be controlled by configuring the Stencil state of the pipeline.

```cpp title="shader/state/stencil_state.h"
/**
 * Stencil state.
 */
struct StencilState {
    /** Whether to enable stencil test. */
    bool enabled = false;
    /** Write the reference value of the stencil buffer. */
    uint32_t referenceValue = 0;
    /** Specifying a bit-wise mask that is used to AND the reference value and the stored stencil value when the test is done. */
    uint32_t mask = 0xff;
    /** Specifying a bit mask to enable or disable writing of individual bits in the stencil planes. */
    uint32_t writeMask = 0xff;
    /** The comparison function of the reference value of the front face of the geometry and the current buffer storage value. */
    wgpu::CompareFunction compareFunctionFront = wgpu::CompareFunction::Always;
    /** The comparison function of the reference value of the back of the geometry and the current buffer storage value. */
    wgpu::CompareFunction compareFunctionBack = wgpu::CompareFunction::Always;
    /** specifying the function to use for front face when both the stencil test and the depth test pass. */
    wgpu::StencilOperation passOperationFront = wgpu::StencilOperation::Keep;
    /** specifying the function to use for back face when both the stencil test and the depth test pass. */
    wgpu::StencilOperation passOperationBack = wgpu::StencilOperation::Keep;
    /** specifying the function to use for front face when the stencil test fails. */
    wgpu::StencilOperation failOperationFront = wgpu::StencilOperation::Keep;
    /** specifying the function to use for back face when the stencil test fails. */
    wgpu::StencilOperation failOperationBack = wgpu::StencilOperation::Keep;
    /** specifying the function to use for front face when the stencil test passes, but the depth test fails. */
    wgpu::StencilOperation zFailOperationFront = wgpu::StencilOperation::Keep;
    /** specifying the function to use for back face when the stencil test passes, but the depth test fails. */
    wgpu::StencilOperation zFailOperationBack = wgpu::StencilOperation::Keep;
};
```

Again, these values need to be set to `wgpu::RenderPipelineDescriptor`:

```cpp title="shader/state/stencil_state.cpp"
void StencilState::platformApply(wgpu::DepthStencilState *depthStencil,
                                 wgpu::RenderPassEncoder &encoder) {
    if (enabled && depthStencil) {
        // apply stencil func.
        encoder.SetStencilReference(referenceValue);
        depthStencil->stencilReadMask = mask;
        depthStencil->stencilFront.compare = compareFunctionFront;
        depthStencil->stencilBack.compare = compareFunctionBack;
        
        // apply stencil operation.
        depthStencil->stencilFront.failOp = failOperationFront;
        depthStencil->stencilFront.depthFailOp = zFailOperationFront;
        depthStencil->stencilFront.passOp = passOperationFront;
        
        depthStencil->stencilBack.failOp = failOperationBack;
        depthStencil->stencilBack.depthFailOp = zFailOperationBack;
        depthStencil->stencilBack.passOp = passOperationBack;
        
        // apply write mask.
        depthStencil->stencilWriteMask = writeMask;
    }
}
```
---

### DepthState

Very similar to `StencilState`, if DepthBuffer is set, its behavior can also be controlled by configuring this state, such as depth comparison functions and so on.

```cpp title="shader/state/depth_state.h"
/**
 * Depth state.
 */
struct DepthState {
    /** Whether to enable the depth test. */
    bool enabled = true;
    /** Whether the depth value can be written.*/
    bool writeEnabled = true;
    /** Depth comparison function. */
    wgpu::CompareFunction compareFunction = wgpu::CompareFunction::Less;
};
```

Again, these values need to be set to `wgpu::RenderPipelineDescriptor`:

```cpp title="shader/state/depth_state.cpp"
void DepthState::platformApply(wgpu::DepthStencilState *depthStencil) {
    if (enabled && depthStencil) {
        // apply compare func.
        depthStencil->depthCompare = compareFunction;
        
        // apply write enabled.
        depthStencil->depthWriteEnabled = writeEnabled;
    }
}
```

## Practice in Arche.js
Arche.js and Arche-cpp basically agree in this one place:
```ts
/**
 * Render state.
 */
export class RenderState {
    /**
     * @internal
     */
    _apply(pipelineDescriptor: RenderPipelineDescriptor,
           encoder: GPURenderPassEncoder,
           frontFaceInvert: boolean): void {
        this.blendState.platformApply(pipelineDescriptor, encoder);
        this.depthState.platformApply(pipelineDescriptor);
        this.stencilState.platformApply(pipelineDescriptor, encoder);
        this.rasterState.platformApply(pipelineDescriptor, frontFaceInvert);
    }
}
```
The biggest difference is that in TS, if RenderPipelineDescriptor is bound to an object, you can directly modify the value in the object.
But in C++, the pointers in these structures are all const and cannot be modified directly through the pointer of `wgpu::RenderPipelineDescriptor`. 
So the function parameters here are simpler.

:::tip
At the same time, the types in `@webgpu/types` are all `interface`. In order to construct the corresponding object and add the corresponding clone copy method, 
it is necessary to implement all these `interface` into specific `class`, for example:
```ts
export class RenderPipelineDescriptor implements GPURenderPipelineDescriptor {
  label?: string;
  layout?: GPUPipelineLayout;
  depthStencil?: DepthStencilState;
  fragment?: FragmentState;
  multisample?: MultisampleState;
  primitive?: PrimitiveState;
  vertex: VertexState;
}
```
:::
