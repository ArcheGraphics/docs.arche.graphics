---
sidebar_position: 2
---

# PhysX WebAssembly 编译

Arche.js 基于 [PhysX.js](https://github.com/oasis-engine/physX.js) 开发了 Web 引擎的物理组件，这篇文章将着重围绕 WebAssembly 编译，PhysX Visual
Debugger 联调展开介绍。希望通过讲解让开发者入门 WebAssembly 编译，以及更加方便地基于我们提供的 [PhysX.js](https://github.com/oasis-engine/physX.js)
仓库进行二次开发，在 Web 应用中加入物理仿真功能。

在浏览器支持 [WebAssembly](https://webassembly.org/roadmap/) 之后，传统上只能用 JavaScript 写前端的模式被打破，非常多由 C++ 和 Rust 开发的高性能代码都可以被编译到
.wasm 文件，并且跨平台地在浏览器中运行，同时将前端代码的执行速度提高一个数量级。在 WebAssembly 出现之初，主要的编译方案都是基于 [Emscripten(EMSDK)](https://emscripten.org)，随着
WebAssembly 概念的发展，出现了 [WebAssembly System Interface (WASI)](https://github.com/WebAssembly/WASI)，该草案提出在实现外部接口的基础上，编译为
.wasm 的二进制文件可以不仅限于浏览器，而是在任意平台被执行。

因此，一开始我们计划使用 [WASI-SDK](https://github.com/WebAssembly/wasi-sdk) 来编译 PhysX。这么做的好处在于，编译后只会有一个 .wasm
文件，没有厚重的[胶水文件](https://emscripten.org/docs/introducing_emscripten/about_emscripten.html?highlight=emits%20javascript)，能够尽可能压缩尺寸。编译过程和传统编译
C++ 并没有什么区别，只需要调用 SDK 提供的 clang++ 和 wasm-ld 来编译链接即可：

```cpp
typedef int pointer_t;
#define WASM_EXP __attribute__((visibility("default")))

pointer_t WASM_EXP PxTransform_create() {
	return (pointer_t) new physx::PxTransform();
}
```

但是后来我们发现，PhysX 当中有一套基于 Pthread 的多线程架构，而 Pthread 目前[不被 WASI 支持](https://github.com/WebAssembly/WASI/issues/296)。但在
WebAssembly 当中是支持 Pthread 的，主要通过 WebWorker 和 ShareArrayBuffer 来实现，这些 WASI 标准都还没有。

因此，我们只能回到经典方案，即用 Emscripten，幸运的是在1.39.0之后的新版本当中，Emscripten 使用了全新的 LLVM 后端 upstream：
> Fastcomp and upstream use very different LLVM and clang versions (fastcomp has been stuck on LLVM 6, upstream is many releases after). This affects optimizations, usually by making the upstream version faster and smaller.

因此，我们可以基于这一新版本的 SDK 来编译出更小更优的 .wasm 二进制文件。本文将介绍具体的编译细节，有兴趣的读者欢迎关注我们的 GitHub
仓库 [PhysX.js](https://github.com/oasis-engine/physX.js)，我们会为其添加更多新的功能，包括但不限于在 PhysX 4.x
中被分离成单独工具包的的布料模拟SDK：NvCloth。如果您在编译过程中遇到其他问题，欢迎提出相应的Issue，我们会持续跟进 WebAssembly 的相关进展，优化 PhysX 的编译效果。

## 使用Embind进行编译

Emscripten 工具链（下称 `EMSDK` ）围绕传统的跨平台 C++
项目提供了名为 [Embind](https://emscripten.org/docs/porting/connecting_cpp_and_javascript/embind.html) 的工具。使用他来进行编译只需要三步：
![PhysX.js.png](https://intranetproxy.alipay.com/skylark/lark/0/2021/png/24156654/1630913404782-f57afdb2-7d0c-4c6a-b523-6ce22412f1ae.png#clientId=ue4ab2edc-17c6-4&from=drop&id=u2da74616&margin=%5Bobject%20Object%5D&name=PhysX.js.png&originHeight=346&originWidth=2312&originalType=binary&ratio=1&size=50675&status=done&style=none&taskId=uaf9e272d-0c92-4c22-8fd0-78c94fd3f25)

在跨平台项目中，构建系统普遍使用的是 `Make` 和 `CMake`，而使用 `EMSDK` 则只需在原来的编译命令之前加上 em 即可：

```shell
emcmake cmake
emmake make
```

`EMSDK` 将自动调用 `emcc` 和 `em++` 编译器完成编译静态库的工作。这些静态库后续将用于连接并生成 .wasm 二进制文件。

接着，最关键的是导出所需要的 C++ 接口，这时需要根据 `Embind` 提供的一个脚手架模板，编写 C++ 代码 PxWebBindings.cpp，例如：

```cpp
function("PxCreateFoundation", &PxCreateFoundation, allow_raw_pointers());
function("PxCreatePhysics", &PxCreateBasePhysics, allow_raw_pointers());
function("PxCreatePlane", &PxCreatePlane, allow_raw_pointers());

value_object<PxVec3>("PxVec3")
        .field("x", &PxVec3::x)
        .field("y", &PxVec3::y)
        .field("z", &PxVec3::z);

enum_<PxForceMode::Enum>("PxForceMode")
        .value("eFORCE", PxForceMode::Enum::eFORCE)
        .value("eIMPULSE", PxForceMode::Enum::eIMPULSE)
        .value("eVELOCITY_CHANGE", PxForceMode::Enum::eVELOCITY_CHANGE)
        .value("eACCELERATION", PxForceMode::Enum::eACCELERATION);

class_<PxScene>("PxScene")
        .function("setGravity", &PxScene::setGravity)
        .function("getGravity", &PxScene::getGravity)
        .function("addActor", &PxScene::addActor, allow_raw_pointers())
        .function("removeActor", &PxScene::removeActor, allow_raw_pointers())
        .function("raycastSingle", optional_override(
            [](const PxScene &scene, const PxVec3 &origin, const PxVec3 &unitDir, const PxReal distance,
               PxRaycastHit &hit, const PxSceneQueryFilterData &filterData) {
                return PxSceneQueryExt::raycastSingle(scene, origin, unitDir, distance,
                                                      PxHitFlags(PxHitFlag::eDEFAULT), hit, filterData);
            }));
```

无论是值类型，枚举，函数，类，都可以类似上述代码中写法来导出。也可以利用 optinal_override
给类型添加新的方法。更多的用法请参考 [Embind](https://emscripten.org/docs/porting/connecting_cpp_and_javascript/embind.html) 的文档。

最后，有了这么一个文件来描述导出的函数，就可以使用 em++ 对其进行编译，编译时需要链接刚刚编译出来的静态库，因为 C++ 当中头文件(.h)指定函数签名，实现文件(.cpp)
实现最终的函数，编译后头文件用于其他程序调用，生成二进制的静态库记录函数实现。可执行程序编译后，最终需要链接静态库，才能被执行。但与普通的C++程序不同，编译器最终会生成 .wasm 二进制文件以及 JavaScript 胶水文件以方便加载
.wasm 二进制文件。

在PhysX.js当中，方便起见，对于 PxWebBindings.cpp 的编译，我们统一使用了cmake
来进行管理依赖，编译参数写在 [PhysXWebBindings.cmake](https://github.com/oasis-engine/physX.js/blob/main/physx/source/compiler/cmake/emscripten/PhysXWebBindings.cmake)
当中，并且提供了方便的 [build.sh](https://github.com/oasis-engine/physX.js/blob/main/build.sh) 脚本一键编译整个项目。

### 异步加载.wasm文件

`EMSDK` 给我们提供了一个并不小的 JavaScript 胶水文件，但同时提供了非常方便的加载逻辑。我们可以很简单地调用：

```typescript
PHYSX().then(function (PHYSX) {
    _cb(PHYSX);
});
```

其中 PHYSX 这个名字是由编译参数制定的：

```makefile
SET(EMSCRIPTEN_BASE_OPTIONS "--bind -s EXPORT_ES6=1 -s MODULARIZE=1 -s EXPORT_NAME=PHYSX -s ALLOW_MEMORY_GROWTH=1")
```

所有调用 PhysX 的逻辑全部都写在回调函数当中。后续对于异步加载 .wasm 文件。

### 不同编译目标的对比

根据编译目标的不同，`EMSDK` 会有四种编译结果：Release，Profile，Checked，Debug，分别对应不同大小的 .wasm 二进制文件和 JavaScript 胶水文件。在 -O3
的优化参数下，胶水文件的缩进空格被取消，使得体积被压缩的尽可能小。

|  | .wasm 二进制文件 | JavaScript 胶水文件 |
| --- | --- | --- |
| Debug(-g) | 54.2MB | 241K |
| Release(-O3) | 2.6MB | 161K  |

用同样的方法去编译 Bullet，对比业内通过 WASI 工具链编译的结果：

|  | .wasm 二进制文件 | JavaScript 胶水文件 |
| --- | --- | --- |
| EmBind（我们使用的方案） | 457K | 55K |
| WASI-SDK | 483K | 0 |

基于 `EMSDK` 的方案给出的胶水文件不含有任何对 PhysX 代码的封装内容，因此，随着 API 导出数量的增加，如果不涉及到例如Socket之类的系统级API，胶水文件大小基本不会改变，只有 .wasm
文件的大小会增长。由此可以看出当前的方案是目前兼具易用性和包尺寸的最佳选择。

## PhysX Visual Debugger（PVD）的连接与调试

NVIDIA 提供一个名为 PhysX Visual Debugger 的调试工具，通过监听 TCP 端口来获取物理场景中的数据，录制并且展示其中对象的运动细节，从而可以发现场景中物理模拟的瓶颈，并且进行优化。
![physx.jpeg](https://intranetproxy.alipay.com/skylark/lark/0/2021/jpeg/24156654/1630912134583-a8e425d0-c7d3-4b03-8cf7-327400a16dab.jpeg#clientId=u2282450d-c5a1-4&from=drop&height=269&id=u7d9abb04&margin=%5Bobject%20Object%5D&name=physx.jpeg&originHeight=355&originWidth=632&originalType=binary&ratio=1&size=244126&status=done&style=none&taskId=ude8e3f79-8543-479f-b3ef-cf66b643e85&width=479)
这一节我们将围绕着这一功能点，展示如何修改 PxWebBindings.cpp，重新编译并且通过 JavaScript 代码进行调研的。对照本节的操作，读者可以自行添加或者删除 .wasm 文件所包含的功能。

### 第一步：调研 PhysX 中 PVD 的使用方式

从 PhysX Snippets 中可以看到，要想使用 PVD 需要在初始化 PxPhysics 时传入 PVD 的对象：

```cpp
PxPvd* gPvd = PxCreatePvd(*gFoundation);
PxPvdTransport* transport = PxDefaultPvdSocketTransportCreate(PVD_HOST, 5425, 10);
gPvd->connect(*transport,PxPvdInstrumentationFlag::eALL);

gPhysics = PxCreatePhysics(PX_PHYSICS_VERSION, *gFoundation, PxTolerancesScale(),true,gPvd);
```

### 第二步：初始方案：直接为 PxWebBindings.cpp 增加方法

这一步我们直接根据所需要的一些类型和方法，写入到 PxWebBindings.cpp 当中，例如：

```cpp
function("PxCreatePvd", &PxCreatePvd, allow_raw_pointers());
function("PxDefaultPvdSocketTransportCreate", optional_override(
        []() {
            return PxDefaultPvdSocketTransportCreate("127.0.0.1", 5426, 10);
        }), allow_raw_pointers());

class_<PxPvdInstrumentationFlags>("PxPvdInstrumentationFlags").constructor<int>();
enum_<PxPvdInstrumentationFlag::Enum>("PxPvdInstrumentationFlag")
        .value("eALL", PxPvdInstrumentationFlag::Enum::eALL)
        .value("eDEBUG", PxPvdInstrumentationFlag::Enum::eDEBUG)
        .value("ePROFILE", PxPvdInstrumentationFlag::Enum::ePROFILE)
        .value("eMEMORY", PxPvdInstrumentationFlag::Enum::eMEMORY);

class_<PxPvd>("PxPvd")
        .function("connect", &PxPvd::connect);

class_<PxPvdTransport>("PxPvdTransport");
```

这里面需要注意的是，PVD 默认监听5425端口，而通过 WebAssembly 编译后，所有的 Socket 函数都会被转成 WebSocket 函数，因此，为了避免5425端口被占用，选填了另外的端口号。编译得到 .wasm
后，还会发现，JavaScript 胶水文件膨胀了接近一倍，原先只有4000+行，编译后编程了8000+，主要原因是 WebSocket 的一系列方法，比如 connect，close 等等都会写在胶水文件当中。

但是运行之后会发现出现错误，主要问题出现在 JavaScript 胶水文件中的 select 函数，select 是 Socket 通信中的非阻塞函数，但是编译得到的胶水文件没有支持完整的功能。在下面的代码中会看到。except 文件描述符
exceptfds 必须是 null，否则就会报错。

```javascript
function ___sys__newselect(nfds, readfds, writefds, exceptfds, timeout) {
    try {
        // readfds are supported,
        // writefds checks socket open status
        // exceptfds not supported
        // timeout is always 0 - fully async
        assert(nfds <= 64, 'nfds must be less than or equal to 64');  // fd sets have 64 bits // TODO: this could be 1024 based on current musl headers
        assert(!exceptfds, 'exceptfds not supported');
    } catch (e) {

    }
}
```

但是从 PxDefaultPvdSocketTransportCreate 的 C++ 源码中看可以看到，这个方法使用了该描述符，所以编译代码后无法运行。

```cpp
// Setup select function call to monitor the connect call.
fd_set writefs;
fd_set exceptfs;
FD_ZERO(&writefs);
FD_ZERO(&exceptfs);
FD_SET(mSocket, &writefs);
FD_SET(mSocket, &exceptfs);
timeval timeout_;
timeout_.tv_sec = timeout / 1000;
timeout_.tv_usec = (timeout % 1000) * 1000;
int selret = ::select(mSocket + 1, NULL, &writefs, &exceptfs, &timeout_);
int excepted = FD_ISSET(mSocket, &exceptfs);
int canWrite = FD_ISSET(mSocket, &writefs);
if (selret != 1 || excepted || !canWrite) {
  disconnect();
  return false;
}
```

除此之外，即使将源码中的 exceptfs 全部去掉（exceptfs本身是可选参数），控制台还会出现 WebSocket is closed before the connection is established 的错误，WebSocket
被提前关闭，无法保持连接。因此，直接使用默认的方式将方法添加到 PxWebBindings.cpp 当中并编译，在编译产物的尺寸和功能上都会出现很多的问题。由此使得我们必须理解 PhysX 的内部细节，寻找新的解决方案。

### 第三步：新的方案：为 PxPvdTransport 编写回调类

在 PhysX 代码中可以看到 `PxPvdTransport` 是一个纯虚基类，定义了一系列的接口。而函数 `PxDefaultPvdSocketTransportCreate` 构造的 `PvdDefaultSocketTransport`
只是一种对他的实现。因此，我们可以手动构造以 PxPvdTransport 作为基类的回调类。

**为了避免直接调用socket函数，一种思路是让“ C++ 调用 JavaScript ”。即在 JavaScript 代码中创建 WebSocket 连接，并将数据通过 WebSocket 发送出来。接着将 WebSocket
端口转发到 TCP 端口实现 PVD 的数据接收。**
![PVD.png](https://intranetproxy.alipay.com/skylark/lark/0/2021/png/24156654/1630911459576-59515fe4-6064-4b15-a58a-6684a7d7af4e.png#clientId=u97085df2-4702-4&from=drop&height=362&id=u0c5e3c0f&margin=%5Bobject%20Object%5D&name=PVD.png&originHeight=970&originWidth=1504&originalType=binary&ratio=1&size=103592&status=done&style=none&taskId=u61f46be7-bee3-4bd3-a403-4402c52ee53&width=562)

为了让“ C++ 调用 JavaScript ”，`Embind` 提供了一种便捷的方式，首先在 PxWebBindings.cpp 中将抽象基类做一个包装，并且指定对应的 JavaScript 函数接口：

```cpp
struct PxPvdTransportWrapper : public wrapper<PxPvdTransport> {
    EMSCRIPTEN_WRAPPER(PxPvdTransportWrapper)

    void unlock() override {}

    void flush() override {}

    void release() override {}

    PxPvdTransport &lock() override { return *this; }

    uint64_t getWrittenDataSize() override { return 0; }

    bool connect() override { return call<bool>("connect"); }

    void disconnect() override { call<void>("disconnect"); }

    bool isConnected() override { return call<bool>("isConnected"); }

    bool write(const uint8_t *inBytes, uint32_t inLength) override {
        return call<bool>("write", int(inBytes), int(inLength));
    }
};

class_<PxPvdTransport>("PxPvdTransport")
        .allow_subclass<PxPvdTransportWrapper>("PxPvdTransportWrapper", constructor<>());
```

借助模板脚手架， wrapper 可以让 C++ 调用我们后续在 JavaScript 当中实现的回调函数，并且通过 write 方法，将数据通过 WebSocket 发送出去。同时，我们还可以看到，通过这种方式编译得到的
JavaScript 胶水文件，不会再包含 connect 等函数，代码在4000+左右，和原先的大小接近。

### 第四步：JavaScript 实现回调函数

上述代码中要求我们在 JavaScript 中实现 connect，disconnect，isConnected，write 这四个函数，因此我们可以写出以下的代码：

```javascript
const pvdTransport = PhysX.PxPvdTransport.implement({
    connect: function () {
        socket = new WebSocket('ws://127.0.0.1:5426', ['binary'])
        socket.onopen = () => {
            console.log('Connected to PhysX Debugger');
            queue.forEach(data => socket.send(data));
            queue = []
        }
        socket.onclose = () => {
        }
        return true
    },
    disconnect: function () {
        console.log("Socket disconnect")
    },
    isConnected: function () {
    },
    write: function (inBytes, inLength) {
        const data = PhysX.HEAPU8.slice(inBytes, inBytes + inLength)
        if (socket.readyState === WebSocket.OPEN) {
            if (queue.length) {
                queue.forEach(data => socket.send(data));
                queue.length = 0;
            }
            socket.send(data);
        } else {
            queue.push(data);
        }
        return true;
    }
})

const gPvd = PhysX.PxCreatePvd(foundation);
gPvd.connect(pvdTransport, new PhysX.PxPvdInstrumentationFlags(PhysX.PxPvdInstrumentationFlag.eALL.value));

physics = PhysX.PxCreatePhysics(
    version,
    foundation,
    new PhysX.PxTolerancesScale(),
    true,
    gPvd
)
```

可以看到我们的回调函数只有三十行，远少于原先直接导出代码所生成的接近4000+行代码。

### 第五步：实现联调

实现联调的最后一步，是将 WebSocket 转发到操作系统的 TCP 端口上去，我们使用了 [websockify-js](https://github.com/novnc/websockify-js)
，该工具也是 [EmScripten 官方提到的工具](https://emscripten.org/docs/porting/networking.html)之一。由于 PVD 只能安装在 Windows 中，所以我们需要安装
Windows 版本的 Node，并且运行（不能在 Windows Subsystem Linux(WSL) 中执行）：

```powershell
node .\websockify.js 127.0.0.1:5426 127.0.0.1:5425
```

### 第六步：最后的优化

通过上面的过程我们可以看到如何从 PhysX 官方案例的 API 出发，逐步根据需求来选择编译的方案，使得在保证功能可用的情况下尽可能减小 .wasm 文件和 JavaScript 胶水文件的大小。其中我们注意到，有时候引入了一个函数，结果
JavaScript 胶水文件就膨胀了一倍。事实上，针对不同的编译 target，cmake 设置了不同的编译参数：

```makefile
SET(PHYSX_EMSCRIPTEN_DEBUG_COMPILE_DEFS   "NDEBUG;PX_DEBUG=1;PX_CHECKED=1;${NVTX_FLAG};PX_SUPPORT_PVD=1"  CACHE INTERNAL "Debug PhysX preprocessor definitions")
SET(PHYSX_EMSCRIPTEN_CHECKED_COMPILE_DEFS "NDEBUG;PX_CHECKED=1;${NVTX_FLAG};PX_SUPPORT_PVD=1" CACHE INTERNAL "Checked PhysX preprocessor definitions")
SET(PHYSX_EMSCRIPTEN_PROFILE_COMPILE_DEFS "NDEBUG;PX_PROFILE=1;${NVTX_FLAG};PX_SUPPORT_PVD=1"  CACHE INTERNAL "Profile PhysX preprocessor definitions")
SET(PHYSX_EMSCRIPTEN_RELEASE_COMPILE_DEFS "NDEBUG;PX_SUPPORT_PVD=0" CACHE INTERNAL "Release PhysX preprocessor definitions")
```

也就是说对于 Release 版本，上述 PVD 函数就算是编译出来了，调用的时候也不会发送任何数据。因此，我们可以将 PVD 相关的函数，全部都放到特定的宏环境当中，在 Release
版本中，根本就不编译，由此尽可能缩小编译后的文件大小：

```cpp
#if PX_DEBUG || PX_PROFILE || PX_CHECKED
...
#endif
```

对于后续添加的方法，都可以配置对应的宏，使得只编译需要的接口，以尽可能压缩编译后的文件大小。

## PhysX的架构与总结

上述两节介绍了如何选择合适的编译方案，将 PhysX 的功能到处并编译到 .wasm 文件当中。整体的编译方案是非常简单的，但这种简单性来源自 PhysX 架构的设计。例如 PxPvdTransport，PxActor
等等类型都是抽象基类，因此都可以用类似上述方法在 JavaScript 上实现具体的方法，以扩展他的功能。而在编译的过程中，如果涉及到系统函数，例如本文中提到的 Socket 等，要考虑引入这些函数的代码，有可能会导致编译后的文件大小暴增。

后续，在本文的基础上，我们还将介绍如何设计引擎的异步加载逻辑，构建组件之间依赖关系，以及物理组件的设计与实现。敬请期待。
