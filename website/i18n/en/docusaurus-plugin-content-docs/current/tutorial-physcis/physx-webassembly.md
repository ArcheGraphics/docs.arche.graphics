---
sidebar_position: 2
---

# PhysX WebAssembly Compilation

Arche.js develops the physical components of the web engine based
on [PhysX.js](https://github.com/oasis-engine/physX.js). This article will focus on WebAssembly compilation, PhysX
Visual Debugger joint debugging is introduced. I hope that through the explanation, developers can get started with
WebAssembly compilation. And based on [PhysX.js], we provide more easily (https://github.com/oasis-engine/physX.js)
The warehouse carries out secondary development, and physical simulation function is added to the web application.

After the browser supports [WebAssembly](https://webassembly.org/roadmap/), the traditional front-end model that can
only be written in JavaScript is broken, and a lot of high-performance code developed by C++ and Rust can be compiled to
.wasm files and run in the browser cross-platform, while speeding up front-end code execution by an order of magnitude.
At the beginning of the emergence of WebAssembly, the main compilation schemes were based
on [Emscripten(EMSDK)](https://emscripten.org), with The development of the concept of WebAssembly, the emergence
of [WebAssembly System Interface (WASI)](https://github.com/WebAssembly/WASI), this draft proposes to compile as .wasm
binaries can be executed not only on browsers, but on any platform.

So, initially we planned to use [WASI-SDK](https://github.com/WebAssembly/wasi-sdk) to compile PhysX. The advantage of
this is that there will only be one .wasm after compilation file, without the
heavy [glue file](https://emscripten.org/docs/introducing_emscripten/about_emscripten.html?highlight=emits%20javascript)
, to be able to compress the size as much as possible. Compilation process and traditional compilation There is no
difference between C++, just call the clang++ and wasm-ld provided by the SDK to compile and link:

````cpp
typedef int pointer_t;
#define WASM_EXP __attribute__((visibility("default")))

pointer_t WASM_EXP PxTransform_create() {
return (pointer_t) new physx::PxTransform();
}
````

But then we found out that PhysX has a multithreading architecture based on Pthreads, and Pthreads are
currently [not supported by WASI](https://github.com/WebAssembly/WASI/issues/296). but in Pthread is supported in
WebAssembly, mainly through WebWorker and ShareArrayBuffer, these WASI standards are not yet available.

Therefore, we can only go back to the classic solution, which is to use Emscripten. Fortunately, in the new version
after 1.39.0, Emscripten uses a new LLVM backend upstream:
> Fastcomp and upstream use very different LLVM and clang versions (fastcomp has been stuck on LLVM 6, upstream is many releases after). 
> This affects optimizations, usually by making the upstream version faster and smaller.

Therefore, we can compile a smaller and better .wasm binary based on this new version of the SDK. This article will
introduce the specific compilation details. Interested readers are welcome to pay attention to our GitHub
Repository [PhysX.js](https://github.com/oasis-engine/physX.js), we will add more new features to it, including but not
limited to PhysX 4.x The cloth simulation SDK in separate toolkits: NvCloth. If you encounter other problems during the
compilation process, you are welcome to raise a corresponding issue. We will continue to follow up on the progress of
WebAssembly and optimize the compilation effect of PhysX.

## Compiling with Embind

The Emscripten toolchain (hereinafter referred to as EMSDK) revolves around traditional cross-platform C++ The project
provides a tool called [Embind](https://emscripten.org/docs/porting/connecting_cpp_and_javascript/embind.html). Using it
to compile only requires three steps:

![PhysX.js.png](https://intranetproxy.alipay.com/skylark/lark/0/2021/png/24156654/1630913404782-f57afdb2-7d0c-4c6a-b523-6ce22412f1ae.png#clientId=ue4ab2edc-17c6-4&from=drop&id=u2da74616&margin=%5Bobject%20Object%5D&name=PhysX.js.png&originHeight=346&originWidth=2312&originalType=binary&ratio=1&size=50675&status=done&style=none&taskId=uaf9e272d-0c92-4c22-8fd0-78c94fd3f25)

In cross-platform projects, Make and CMake are commonly used in the build system, while using `EMSDK` only needs to add em
before the original compilation command:

```shell
emcmake cmake
emmake make
````

`EMSDK` will automatically call `emcc` and `em++` compilers to complete the work of compiling static libraries. These static
libraries will later be used to link and generate .wasm binaries.

Next, the most important thing is to export the required C++ interface. At this time, you need to write the C++ code
PxWebBindings.cpp according to a scaffolding template provided by `Embind`, for example:

````cpp
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
````

Whether it is a value type, an enumeration, a function, or a class, it can be exported in a similar way to the above
code. You can also take advantage of optional, which override and add new methods to types. For more usage, please refer to the
documentation of [Embind](https://emscripten.org/docs/porting/connecting_cpp_and_javascript/embind.html).

Finally, with such a file to describe the exported function, you can use em++ to compile it. When compiling, you need to
link the static library just compiled, because the header file (.h) in C++ specifies the function signature, and the
implementation file (. cpp)
Implement the final function, compile the header file for other program calls, and generate a binary static library to
record the function implementation. After the executable program is compiled, it finally needs to link the static
library before it can be executed. But unlike normal C++ programs, the compiler will eventually generate .wasm binaries
along with JavaScript glue files for easy loading .wasm binary file.

In PhysX.js, for convenience, for the compilation of PxWebBindings.cpp, we use cmake uniformly To manage dependencies,
the compilation parameters are written
in [PhysXWebBindings.cmake](https://github.com/oasis-engine/physX.js/blob/main/physx/source/compiler/cmake/emscripten/PhysXWebBindings.cmake)
Among them, and provides a convenient [build.sh](https://github.com/oasis-engine/physX.js/blob/main/build.sh) script to
compile the entire project with one click.

### Load .wasm files asynchronously

`EMSDK` provides us with a very small JavaScript glue file, but at the same time provides very convenient loading logic.
We can simply call:

```typescript
PHYSX().then(function (PHYSX) {
    _cb(PHYSX);
});
````

where the name PHYSX is specified by the compile parameters:

````makefile
SET(EMSCRIPTEN_BASE_OPTIONS "--bind -s EXPORT_ES6=1 -s MODULARIZE=1 -s EXPORT_NAME=PHYSX -s ALLOW_MEMORY_GROWTH=1")
````

All the logic for calling PhysX is written in the callback function after asynchronous loading of .wasm files.

### Comparison of different compilation targets

Depending on the compilation target, `EMSDK` will have four compilation results: Release, Profile, Checked, Debug,
corresponding to .wasm binary files and JavaScript glue files of different sizes. at -O3 Under the optimization
parameters of , the indentation space of the glue file is canceled, so that the volume is compressed as small as
possible.

| | .wasm binary | JavaScript glue | | --- | --- | --- | | Debug(-g) | 54.2MB | 241K | | Release(-O3) | 2.6MB | 161K |

Use the same method to compile Bullet and compare the results compiled by the WASI toolchain in the industry:

| | .wasm binaries | JavaScript glue files |
| --- | --- | --- |
| EmBind (the scheme we use) | 457K | 55K |
| WASI-SDK | 483K | 0 |

The glue file given by the `EMSDK`-based solution does not contain any encapsulation content for the PhysX code.
Therefore, with the increase in the number of API exports, if system-level APIs such as Socket are not involved, the
size of the glue file will basically not change. only .wasm The size of the file will grow. It can be seen that the
current solution is currently the best choice for both ease of use and package size.

## PhysX Visual Debugger (PVD) Connection and Debugging

NVIDIA provides a debugging tool called PhysX Visual Debugger, which listens to the TCP port to obtain the data in the
physical scene, records and displays the motion details of the objects in it, so that the bottleneck of the physical
simulation in the scene can be found and optimized.
![physx.jpeg](https://intranetproxy.alipay.com/skylark/lark/0/2021/jpeg/24156654/1630912134583-a8e425d0-c7d3-4b03-8cf7-327400a16dab.jpeg#clientId=u2282450d-c5a1-4&from
=drop&height=269&id=u7d9abb04&margin=%5Bobject%20Object%5D&name=physx.jpeg&originHeight=355&originWidth=632&originalType=binary&ratio=1&size=244126&status=done&style=none&taskId=ude8e3f79-8543-479f-b3ef-width=4796b64)
In this section, we will focus on this feature point, showing how to modify PxWebBindings.cpp, recompile and investigate
through JavaScript code. According to the operations in this section, readers can add or delete the functions contained
in the .wasm file by themselves.

### Step 1: Investigate how PVD is used in PhysX

As you can see from PhysX Snippets, to use PVD, you need to pass in the PVD object when initializing PxPhysics:

````cpp
PxPvd* gPvd = PxCreatePvd(*gFoundation);
PxPvdTransport* transport = PxDefaultPvdSocketTransportCreate(PVD_HOST, 5425, 10);
gPvd->connect(*transport,PxPvdInstrumentationFlag::eALL);

gPhysics = PxCreatePhysics(PX_PHYSICS_VERSION, *gFoundation, PxTolerancesScale(),true,gPvd);
````

### Step 2: Initial solution: add methods directly to PxWebBindings.cpp

In this step, we directly write to PxWebBindings.cpp according to some types and methods we need, for example:

````cpp
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
````

It should be noted here that PVD listens to port 5425 by default, and after compiling with WebAssembly, all Socket
functions will be converted into WebSocket functions. Therefore, in order to avoid port 5425 being occupied, another
port number is selected. Compile to get .wasm Later, it will be found that the JavaScript glue file has nearly doubled
in size. Originally, it only had 4000+ lines. After compiling, it programmed 8000+ lines. The main reason is that a
series of methods of WebSocket, such as connect, close, etc., will be written in the glue file.

But after running, you will find an error. The main problem is the select function in the JavaScript glue file. Select
is a non-blocking function in Socket communication, but the compiled glue file does not support complete functions. will
be seen in the code below. except file descriptor exceptfds must be null, otherwise an error will be reported.

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

But as you can see from the C++ source code of PxDefaultPvdSocketTransportCreate, this method uses this descriptor, so
it cannot run after compiling the code.

````cpp
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
````

In addition, even if all exceptfs in the source code are removed (exceptfs itself is an optional parameter), the console
will still appear WebSocket is closed before the connection is established Error, WebSocket Was closed prematurely,
unable to maintain connection. Therefore, directly using the default method to add methods to PxWebBindings.cpp and
compile, there will be many problems in the size and function of the compiled product. This makes it necessary to
understand the internal details of PhysX and find new solutions.

### Step 3: New solution: write a callback class for PxPvdTransport

You can see in the PhysX code that PxPvdTransport is a pure virtual base class that defines a series of interfaces. And
the PvdDefaultSocketTransport constructed by the function PxDefaultPvdSocketTransportCreate Just a realization of him.
Therefore, we can manually construct the callback class with PxPvdTransport as the base class.

**In order to avoid calling the socket function directly, one idea is to let "C++ call JavaScript". That is, create a
WebSocket connection in JavaScript code and send data through WebSocket. Then put the WebSocket The port is forwarded to
the TCP port for PVD data reception. **

![PVD.png](https://intranetproxy.alipay.com/skylark/lark/0/2021/png/24156654/1630911459576-59515fe4-6064-4b15-a58a-6684a7d7af4e.png#clientId=u97085df2-4702-4&from=drop&height=362&id=u0c5e3c0f&margin=%5Bobject%20Object%5D&name=PVD.png&originHeight=970&originWidth=1504&originalType=binary&ratio=1&size=103592&status=done&style=none&taskId=u61f46be7-bee3-4bd3-a403-4402c52ee53&width=562)

In order to let "C++ call JavaScript", `Embind` provides a convenient way. First, wrap the abstract base class in
PxWebBindings.cpp and specify the corresponding JavaScript function interface:

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

With the help of template scaffolding, wrapper can let C++ call the callback function we will implement in JavaScript
later, and send data through WebSocket through the write method. At the same time, we can also see that compiled in this
way The JavaScript glue file will no longer contain functions such as connect. The code is around 4000+, which is close
to the original size.

### Step 4: JavaScript implements the callback function

The above code requires us to implement the four functions connect, disconnect, isConnected, and write in JavaScript, so
we can write the following code:

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

It can be seen that our callback function has only thirty lines, which is far less than the nearly 4000+ lines of code
generated by the original direct export code.

### Step 5: Implement joint debugging

The last step to realize the joint debugging is to forward the WebSocket to the TCP port of the operating system. We
used [websockify-js](https://github.com/novnc/websockify-js)
, which is also one of
the [officially mentioned tools by EmScripten](https://emscripten.org/docs/porting/networking.html). Since PVD can only
be installed in Windows, we need to install The Windows version of Node, and running (cannot be executed in Windows
Subsystem Linux (WSL)):

```powershell
node .\websockify.js 127.0.0.1:5426 127.0.0.1:5425
````

### Step 6: Final Optimization

Through the above process, we can see how to start from the API of the PhysX official case, and gradually select the
compilation scheme according to the requirements, so that the size of the .wasm file and the JavaScript glue file can be
reduced as much as possible while ensuring the availability of functions. Among them, we noticed that sometimes a
function was introduced that resulted in The JavaScript glue file has doubled in size. In fact, for different
compilation targets, cmake sets different compilation parameters:

````makefile
SET(PHYSX_EMSCRIPTEN_DEBUG_COMPILE_DEFS "NDEBUG;PX_DEBUG=1;PX_CHECKED=1;${NVTX_FLAG};PX_SUPPORT_PVD=1" CACHE INTERNAL "Debug PhysX preprocessor definitions")
SET(PHYSX_EMSCRIPTEN_CHECKED_COMPILE_DEFS "NDEBUG;PX_CHECKED=1;${NVTX_FLAG};PX_SUPPORT_PVD=1" CACHE INTERNAL "Checked PhysX preprocessor definitions")
SET(PHYSX_EMSCRIPTEN_PROFILE_COMPILE_DEFS "NDEBUG;PX_PROFILE=1;${NVTX_FLAG};PX_SUPPORT_PVD=1" CACHE INTERNAL "Profile PhysX preprocessor definitions")
SET(PHYSX_EMSCRIPTEN_RELEASE_COMPILE_DEFS "NDEBUG;PX_SUPPORT_PVD=0" CACHE INTERNAL "Release PhysX preprocessor definitions")
````

That is to say, for the Release version, even if the above PVD function is compiled, it will not send any data when it
is called. Therefore, we can put all PVD-related functions into a specific macro environment, and in Release version, do
not compile at all, thereby reducing the compiled file size as much as possible:

````cpp
#if PX_DEBUG || PX_PROFILE || PX_CHECKED
...
#endif
````

For the methods added later, the corresponding macros can be configured so that only the required interfaces are
compiled to compress the compiled file size as much as possible.

## PhysX Architecture and Summary

The above two sections describe how to choose an appropriate compilation scheme to get PhysX functionality everywhere
and compile it into a .wasm file. The overall compilation scheme is very simple, but this simplicity comes from the
design of the PhysX architecture. For example PxPvdTransport, PxActor Etc. types are abstract base classes, so you can
implement specific methods on JavaScript with methods similar to the above to extend his functions. During the
compilation process, if system functions are involved, such as the Socket mentioned in this article, it is necessary to
consider introducing the code of these functions, which may lead to a sharp increase in the size of the compiled file.

Later, based on this article, we will also introduce how to design the asynchronous loading logic of the engine, build
dependencies between components, and design and implement physical components. Stay tuned.
