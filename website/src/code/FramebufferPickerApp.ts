import {
    Vector3,
    SampledTexture2D,
    WebGPUEngine,
    Camera,
    MeshRenderer,
    PrimitiveMesh,
    BlinnPhongMaterial,
    SampledTextureCube,
    AssetType,
    Renderer,
    Mesh,
    SkyboxSubpass, ColorPickerRenderPass, DirectLight
} from "arche-engine";
import {OrbitControl} from "@arche-engine/controls";
import posx from '@site/static/assets/SkyMap/country/posx.png';
import posy from '@site/static/assets/SkyMap/country/posy.png';
import posz from '@site/static/assets/SkyMap/country/posz.png';
import negx from '@site/static/assets/SkyMap/country/negx.png';
import negy from '@site/static/assets/SkyMap/country/negy.png';
import negz from '@site/static/assets/SkyMap/country/negz.png';
import WoodImageUrl from '@site/static/assets/Textures/wood.png';

export function createFramebufferPickerApp() {
    const engine = new WebGPUEngine("canvas");
    engine.canvas.resizeByClientSize();
    engine.init().then(() => {
        engine.resourceManager
            .load<SampledTextureCube>({
                urls: [posx, negx, posy, negy, posz, negz],
                type: AssetType.TextureCube
                }
            )
            // @ts-ignore
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
        const mainCamera = cameraEntity.addComponent(Camera);
        cameraEntity.transform.setPosition(10, 10, 10);
        cameraEntity.transform.lookAt(new Vector3());
        cameraEntity.addComponent(OrbitControl)

        const colorPicker = new ColorPickerRenderPass(engine);
        colorPicker.mainCamera = mainCamera;
        colorPicker.onPick = (renderer: Renderer, mesh: Mesh) => {
            if (renderer) {
                const material = <BlinnPhongMaterial>renderer.getMaterial();
                material.baseColor.setValue(Math.random(), Math.random(), Math.random(), 1);
                material.baseColor = material.baseColor;
            }
        }
        window.addEventListener("mousedown", (event) => {
            colorPicker.pick(event.offsetX, event.offsetY);
        })
        engine.renderPasses.push(colorPicker);

        // init point light
        const light = rootEntity.createChild("light");
        light.transform.setPosition(0, 10, 0);
        light.transform.lookAt(new Vector3());
        const pointLight = light.addComponent(DirectLight);
        pointLight.intensity = 0.6;
        pointLight.enableShadow = true;

        const cubeEntity = rootEntity.createChild();
        const renderer = cubeEntity.addComponent(MeshRenderer);
        renderer.mesh = PrimitiveMesh.createCuboid(engine, 1);
        renderer.castShadow = true;
        engine.resourceManager
            .load<SampledTexture2D>(WoodImageUrl)
            // @ts-ignore
            .then((texture) => {
                const unlit = new BlinnPhongMaterial(engine)
                unlit.baseTexture = texture;
                renderer.setMaterial(unlit);
            });

        engine.run();
    });
}
