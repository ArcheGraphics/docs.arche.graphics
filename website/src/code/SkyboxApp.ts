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
import posx from '@site/static/assets/SkyMap/country/posx.png';
import posy from '@site/static/assets/SkyMap/country/posy.png';
import posz from '@site/static/assets/SkyMap/country/posz.png';
import negx from '@site/static/assets/SkyMap/country/negx.png';
import negy from '@site/static/assets/SkyMap/country/negy.png';
import negz from '@site/static/assets/SkyMap/country/negz.png';
import WoodImageUrl from '@site/static/assets/Textures/wood.png';

export function createSkyboxApp() {
    const engine = new WebGPUEngine("canvas");
    engine.canvas.resizeByClientSize();
    engine.init().then(() => {
        engine.resourceManager
            .load<SampledTextureCube>({
                    urls: [posx, negx, posy, negy, posz, negz],
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
            .load<SampledTexture2D>(WoodImageUrl)
            .then((texture) => {
                const unlit = new BlinnPhongMaterial(engine)
                unlit.baseTexture = texture;
                renderer.setMaterial(unlit);
            });

        engine.run();
    });
}
