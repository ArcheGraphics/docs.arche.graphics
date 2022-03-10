import {
    Camera,
    MeshRenderer,
    PointLight,
    PrimitiveMesh,
    SpotLight,
    Vector3,
    WebGPUEngine,
    ClusterDebugMaterial,
    SpriteDebug
} from "arche-engine";
import {OrbitControl} from "@arche-engine/controls";

export function createClusterForwardApp() {
    const engine = new WebGPUEngine("canvas");
    engine.canvas.resizeByClientSize();
    engine.init().then(() => {
        const scene = engine.sceneManager.activeScene;
        const rootEntity = scene.createRootEntity();
        rootEntity.addComponent(SpriteDebug);

        // init camera
        const cameraEntity = rootEntity.createChild("camera");
        cameraEntity.addComponent(Camera);
        cameraEntity.transform.setPosition(10, 10, 10);
        cameraEntity.transform.lookAt(new Vector3());
        cameraEntity.addComponent(OrbitControl);

        // init point light
        for (let i = 0; i < 15; i++) {
            const light = rootEntity.createChild("light");
            light.transform.setPosition(10 * Math.random(), 2, 10 * Math.random());
            light.addComponent(PointLight);
        }

        // init spot light
        for (let i = 0; i < 15; i++) {
            const light = rootEntity.createChild("light");
            light.transform.setPosition(10 * Math.random(), 2, 10 * Math.random());
            light.addComponent(SpotLight);
        }

        // create box test entity
        const cubeSize = 20.0;
        const boxEntity = rootEntity.createChild("BoxEntity");
        const boxMtl = new ClusterDebugMaterial(engine);
        const boxRenderer = boxEntity.addComponent(MeshRenderer);
        boxRenderer.mesh = PrimitiveMesh.createPlane(engine, cubeSize, cubeSize, 100, 1000);
        boxRenderer.setMaterial(boxMtl);

        engine.run();
    });
}
