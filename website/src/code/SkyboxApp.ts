import {
    Vector3,
    PointLight,
    SampledTexture2D,
    WebGPUEngine,
    Camera,
    MeshRenderer,
    PrimitiveMesh,
    BlinnPhongMaterial,
    SampledTextureCube,
    AssetType,
    SkyboxSubpass,
} from "arche-engine";
import {OrbitControl} from "@arche-engine/controls";

export function createSkyboxApp() {
    const engine = new WebGPUEngine("canvas");
    engine.canvas.resizeByClientSize();
    engine.init().then(() => {
        engine.resourceManager
            .load<SampledTextureCube>({
                    urls: [
                        "https://github.com/yangfengzzz/Assets/raw/main/SkyMap/country/posx.png",
                        "https://github.com/yangfengzzz/Assets/raw/main/SkyMap/country/negx.png",
                        "https://github.com/yangfengzzz/Assets/raw/main/SkyMap/country/posy.png",
                        "https://github.com/yangfengzzz/Assets/raw/main/SkyMap/country/negy.png",
                        "https://github.com/yangfengzzz/Assets/raw/main/SkyMap/country/posz.png",
                        "https://github.com/yangfengzzz/Assets/raw/main/SkyMap/country/negz.png",
                    ],
                    type: AssetType.TextureCube
                }
            )
            .then((cubeMap) => {
                const skybox = new SkyboxSubpass(engine);
                skybox.createCuboid();
                skybox.textureCubeMap = cubeMap;
                engine.defaultRenderPass.addSubpass(skybox);
            })

        const scene = engine.sceneManager.activeScene;
        const diffuseSolidColor = scene.ambientLight.diffuseSolidColor;
        diffuseSolidColor.setValue(0.5, 0.5, 0.5, 1);
        scene.ambientLight.diffuseSolidColor = diffuseSolidColor;
        const rootEntity = scene.createRootEntity();

        // init camera
        const cameraEntity = rootEntity.createChild("camera");
        cameraEntity.addComponent(Camera);
        cameraEntity.transform.setPosition(10, 10, 10);
        cameraEntity.transform.lookAt(new Vector3());
        cameraEntity.addComponent(OrbitControl)

        // init point light
        const light = rootEntity.createChild("light");
        light.transform.setPosition(0, 10, 0);
        light.transform.lookAt(new Vector3());
        const pointLight = light.addComponent(PointLight);
        pointLight.intensity = 0.6;

        const cubeEntity = rootEntity.createChild();
        const renderer = cubeEntity.addComponent(MeshRenderer);
        renderer.mesh = PrimitiveMesh.createCuboid(engine, 1);
        engine.resourceManager
            .load<SampledTexture2D>("https://github.com/yangfengzzz/Assets/raw/main/Textures/wood.png")
            .then((texture) => {
                const unlit = new BlinnPhongMaterial(engine)
                unlit.baseTexture = texture;
                renderer.setMaterial(unlit);
            });

        engine.run();
    });
}
