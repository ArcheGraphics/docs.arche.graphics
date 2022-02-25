import {
    Vector3,
    Script,
    PointLight,
    WebGPUEngine,
    Camera,
    MeshRenderer,
    PrimitiveMesh,
    BlinnPhongMaterial,
    RenderFace
} from "arche-engine";
import {OrbitControl} from "@arche-engine/controls";
import {Color} from "@arche-engine/math";

class MoveScript extends Script {
    totalTime = 0;
    height = 2;
    vel = 4;
    velSign = -1;

    onUpdate(deltaTime: number) {
        if (this.height >= 2) {
            this.velSign = -1;
        }
        if (this.height <= -2) {
            this.velSign = 1;
        }
        deltaTime /= 1000;
        this.height += deltaTime * this.vel * this.velSign;

        this.entity.transform.setPosition(Math.sin(this.totalTime), this.height, Math.cos(this.totalTime));
        this.totalTime += deltaTime;
    }
}

export function createOmniShadowApp() {
    const engine = new WebGPUEngine("canvas");
    engine.canvas.resizeByClientSize();
    engine.init().then(() => {
        const scene = engine.sceneManager.activeScene;
        const rootEntity = scene.createRootEntity();

        // init camera
        const cameraEntity = rootEntity.createChild("camera");
        cameraEntity.addComponent(Camera);
        cameraEntity.transform.setPosition(0, 0, 20);
        cameraEntity.transform.lookAt(new Vector3());
        cameraEntity.addComponent(OrbitControl)

        // init point light
        const light = rootEntity.createChild("light");
        light.transform.setPosition(0, 0, 0);
        const directLight = light.addComponent(PointLight);
        directLight.intensity = 0.5;
        directLight.enableShadow = true;

        const planeMesh = PrimitiveMesh.createPlane(engine, 10, 10);

        const planeEntity = rootEntity.createChild("PlaneEntity");
        planeEntity.transform.setPosition(0, 5, 0);
        const planeMtl = new BlinnPhongMaterial(engine);
        planeMtl.baseColor = new Color(0.2, 0.2, 0.2, 1.0);
        planeMtl.renderFace = RenderFace.Double;
        const planeRenderer = planeEntity.addComponent(MeshRenderer);
        planeRenderer.mesh = planeMesh;
        planeRenderer.setMaterial(planeMtl);
        planeRenderer.receiveShadow = true;

        const planeEntity2 = rootEntity.createChild("PlaneEntity2");
        planeEntity2.transform.setPosition(0, -5, 0);
        const planeMtl2 = new BlinnPhongMaterial(engine);
        planeMtl2.baseColor = new Color(0.4, 0.4, 0.4, 1.0);
        planeMtl2.renderFace = RenderFace.Double;
        const planeRenderer2 = planeEntity2.addComponent(MeshRenderer);
        planeRenderer2.mesh = planeMesh;
        planeRenderer2.setMaterial(planeMtl2);
        planeRenderer2.receiveShadow = true;

        const planeEntity3 = rootEntity.createChild("PlaneEntity3");
        planeEntity3.transform.setPosition(5, 0, 0);
        planeEntity3.transform.setRotation(0, 0, 90);
        const planeMtl3 = new BlinnPhongMaterial(engine);
        planeMtl3.baseColor = new Color(0.6, 0.6, 0.6, 1.0);
        planeMtl3.renderFace = RenderFace.Double;
        const planeRenderer3 = planeEntity3.addComponent(MeshRenderer);
        planeRenderer3.mesh = planeMesh;
        planeRenderer3.setMaterial(planeMtl3);
        planeRenderer3.receiveShadow = true;

        const planeEntity4 = rootEntity.createChild("PlaneEntity4");
        planeEntity4.transform.setPosition(-5, 0, 0);
        planeEntity4.transform.setRotation(0, 0, -90);
        const planeMtl4 = new BlinnPhongMaterial(engine);
        planeMtl4.baseColor = new Color(0.8, 0.8, 0.8, 1.0);
        planeMtl4.renderFace = RenderFace.Double;
        const planeRenderer4 = planeEntity4.addComponent(MeshRenderer);
        planeRenderer4.mesh = planeMesh;
        planeRenderer4.setMaterial(planeMtl4);
        planeRenderer4.receiveShadow = true;

        const planeEntity5 = rootEntity.createChild("PlaneEntity5");
        planeEntity5.transform.setPosition(0, 0, -5);
        planeEntity5.transform.setRotation(90, 0, 0);
        const planeMtl5 = new BlinnPhongMaterial(engine);
        planeMtl5.baseColor = new Color(1.0, 1.0, 1.0, 1.0);
        planeMtl5.renderFace = RenderFace.Double;
        const planeRenderer5 = planeEntity5.addComponent(MeshRenderer);
        planeRenderer5.mesh = planeMesh;
        planeRenderer5.setMaterial(planeMtl5);
        planeRenderer5.receiveShadow = true;

        // create box test entity
        const cubeSize = 1.0;
        const boxMesh = PrimitiveMesh.createCuboid(engine, cubeSize, cubeSize, cubeSize);
        const boxMtl = new BlinnPhongMaterial(engine);
        boxMtl.baseColor = new Color(1.0, 0.0, 0.0, 0.5);
        boxMtl.renderFace = RenderFace.Double; // bug
        const boxEntity = rootEntity.createChild("BoxEntity");
        boxEntity.addComponent(MoveScript);
        const boxRenderer = boxEntity.addComponent(MeshRenderer);
        boxRenderer.mesh = boxMesh;
        boxRenderer.setMaterial(boxMtl);
        boxRenderer.castShadow = true;

        engine.run();
    });
}
