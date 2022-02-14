import {
    BlinnPhongMaterial,
    Camera,
    MeshRenderer,
    PrimitiveMesh,
    Vector3,
    WebGPUEngine,
    PointLight
} from "arche-engine";
import {OrbitControl} from "@arche-engine/controls";

export function createArche() {
    const engine = new WebGPUEngine("canvas");
    engine.canvas.resizeByClientSize();
    engine.init().then(() => {
        const scene = engine.sceneManager.activeScene;
        const rootEntity = scene.createRootEntity();

        // init camera
        const cameraEntity = rootEntity.createChild("camera");
        cameraEntity.addComponent(Camera);
        const pos = cameraEntity.transform.position;
        pos.setValue(10, 10, 10);
        cameraEntity.transform.position = pos;
        cameraEntity.transform.lookAt(new Vector3(0, 0, 0));
        cameraEntity.addComponent(OrbitControl);

        // init point light
        const light = rootEntity.createChild("light");
        light.transform.setPosition(0, 10, 0);
        light.transform.lookAt(new Vector3());
        const pointLight = light.addComponent(PointLight);
        pointLight.intensity = 0.6;

        // init cube
        const cubeEntity = rootEntity.createChild();
        const renderer = cubeEntity.addComponent(MeshRenderer);
        renderer.mesh = PrimitiveMesh.createCuboid(engine, 1);
        const material = new BlinnPhongMaterial(engine);
        const color = material.baseColor;
        color.setValue(0.4, 0.6, 0.6, 1);
        material.baseColor = color;
        renderer.setMaterial(material);

        engine.run();
    });
}
