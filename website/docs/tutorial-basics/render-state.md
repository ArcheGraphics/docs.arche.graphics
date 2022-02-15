---
sidebar_position: 1
---

# 渲染状态

## 状态总揽
渲染状态是 WebGPU 中最容易理解的一部分，在 WebGPU 当中有诸多枚举类型，可以将这些类型部分封装成集中状态类型，包括：

1. RenderTargetBlendState
2. BlendState
3. RasterState
4. StencilState
5. DepthState

这一层封装的核心在于概念的重组，使得在控制这些参数的时候，更加容易代入具体的概念。

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
这里有两个参数传入的是指针，这是因为这两个参数本质上是可选的，前者对应了片段着色器相关的状态，例如阴影绘制都不存在片段着色器，后者则与 Depth 和 Stencil 相关，都可以为空。
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

### 渲染目标的混合状态（RenderTargetBlendState）

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

### 混合状态（BlendState）

`BlendState` 实际上将 `RenderTargetBlendState` 做了进一步的封装：

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

为了设置混合状态，需要将枚举的值设置到 `wgpu::RenderPipelineDescriptor` 和 `wgpu::RenderPassEncoder`
当中去，由于 Dawn 当中，结构体会大量使用指针进行串联，并且指针的类型都是 const，因此，只能直接将具体的结构体传入到函数中，而不能直接传入这两者的对象，即：

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

这里暂时不用去管例如: `wgpu::ColorTargetState`，`wgpu::MultisampleState` 这些东西是什么。 只需要知道这些State的指针将来会被保存到`wgpu::RenderPipelineDescriptor`中， 
并且 `wgpu::RenderPipelineDescriptor`是构造RenderPipeline的关键即可。

---

### 光栅化状态（RasterState）

`RasterState` 主要描述了光栅化的一系列参数，例如三角形旋转的方向，剔除的面等等。

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

这些枚举类型的值同样要被设置到 `wgpu::RenderPipelineDescriptor`：

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

### Stencil状态（StencilState）

`StencilState` 主要关乎与 StencilBuffer 的使用，如果管线中配置了 `wgpu::RenderPassDepthStencilAttachment` 那么就可以通过配置管线的 Stencil 状态来控制他的行为。

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

同样的，这些值都需要设置到`wgpu::RenderPipelineDescriptor`当中：

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

### Depth状态（DepthState）

和 `StencilState` 非常类似，DepthBuffer 如果被设置后，也可以通过配置这一状态控制他的行为，例如深度比较函数等等。

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

同样的，这些值都需要设置到`wgpu::RenderPipelineDescriptor`当中：
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

## TypeScript 上的调用
TypeScript 和 C++ 在这一个地方基本上一致的：
```ts
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
```
最大的差异在于在 TS 当中，如果 `RenderPipelineDescriptor` 绑定了一个对象，那么就可以直接去修改对象中的值。
但是在 C++ 中，这些结构体中的指针都带有 const，是无法直接通过 `wgpu::RenderPipelineDescriptor` 的指针进行修改。因此，此处的函数形参更加简单。

:::tip
同时，`@webgpu/types` 中类型全部都是 `interface`，为了构造对应的对象，并且增加对应的克隆拷贝方法，因此需要将所有这些 `interface` 实现成具体的 `class`，例如：
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
