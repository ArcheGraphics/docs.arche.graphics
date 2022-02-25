import {
    Vector3,
    WebGPUEngine,
    Camera,
    MeshRenderer,
    PrimitiveMesh,
    BlinnPhongMaterial,
    DirectLight,
    RenderFace
} from "arche-engine";
import {OrbitControl} from "@arche-engine/controls";
import {Color} from "@arche-engine/math";

export function createCascadeShadowApp() {
    const engine = new WebGPUEngine("canvas");
    engine.canvas.resizeByClientSize();
    engine.init().then(() => {
        const scene = engine.sceneManager.activeScene;
        const rootEntity = scene.createRootEntity();

        // init camera
        const cameraEntity = rootEntity.createChild("camera");
        cameraEntity.addComponent(Camera);
        cameraEntity.transform.setPosition(0, 10, 50);
        cameraEntity.transform.lookAt(new Vector3());
        cameraEntity.addComponent(OrbitControl)

        const light = rootEntity.createChild("light");
        light.transform.setPosition(10, 10, 0);
        light.transform.lookAt(new Vector3());
        const directLight = light.addComponent(DirectLight);
        directLight.intensity = 1.0;
        directLight.enableShadow = true;

        // create box test entity
        const cubeSize = 2.0;
        const boxMesh = PrimitiveMesh.createCuboid(engine, cubeSize, cubeSize, cubeSize);
        const boxMtl = new BlinnPhongMaterial(engine);
        boxMtl.baseColor = new Color(0.3, 0.3, 0.3, 0.5);
        for (let i = 0; i < 6; i++) {
            const boxEntity = rootEntity.createChild("BoxEntity");
            boxEntity.transform.setPosition(0, 2, i * 10 - 20);

            const boxRenderer = boxEntity.addComponent(MeshRenderer);
            boxRenderer.mesh = boxMesh;
            boxRenderer.setMaterial(boxMtl);
            boxRenderer.castShadow = true;
        }

        const planeEntity = rootEntity.createChild("PlaneEntity");
        const planeMtl = new BlinnPhongMaterial(engine);
        planeMtl.baseColor = new Color(1.0, 0, 0, 1.0);
        planeMtl.renderFace = RenderFace.Double;

        const planeRenderer = planeEntity.addComponent(MeshRenderer);
        planeRenderer.mesh = PrimitiveMesh.createPlane(engine, 10, 80);
        planeRenderer.setMaterial(planeMtl);
        planeRenderer.receiveShadow = true;

        engine.run();
    });
}
