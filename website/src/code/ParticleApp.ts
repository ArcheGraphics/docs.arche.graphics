import {
    Vector3,
    PointLight,
    ParticleRenderer,
    WebGPUEngine,
    Camera,
    MeshRenderer,
    PrimitiveMesh,
    BlinnPhongMaterial,
    SimulationVolume,
    EmitterType
} from "arche-engine";
import {OrbitControl} from "@arche-engine/controls";

export function createParticleApp() {
    const engine = new WebGPUEngine("canvas");
    engine.canvas.resizeByClientSize();
    engine.init().then(() => {
        const scene = engine.sceneManager.activeScene;
        const diffuseSolidColor = scene.ambientLight.diffuseSolidColor;
        diffuseSolidColor.setValue(0.5, 0.5, 0.5, 1);
        scene.ambientLight.diffuseSolidColor = diffuseSolidColor;
        const rootEntity = scene.createRootEntity();

        // init camera
        const cameraEntity = rootEntity.createChild("camera");
        cameraEntity.addComponent(Camera);
        cameraEntity.transform.setPosition(-30, 30, 30);
        cameraEntity.transform.lookAt(new Vector3());
        cameraEntity.addComponent(OrbitControl)

        // init point light
        const light = rootEntity.createChild("light");
        light.transform.setPosition(0, 3, 0);
        light.transform.lookAt(new Vector3());
        const pointLight = light.addComponent(PointLight);
        pointLight.intensity = 0.6;

        const particleEntity = rootEntity.createChild();
        const particle = particleEntity.addComponent(ParticleRenderer);
        // emitter
        particle.particleMinAge = 50.0;
        particle.particleMaxAge = 100.0;
        particle.emitterType = EmitterType.SPHERE;
        particle.emitterDirection = new Vector3(0, 1, 0);
        particle.emitterPosition = new Vector3(); // todo
        particle.emitterRadius = 2;
        particle.boundingVolumeType = SimulationVolume.SPHERE;
        particle.bboxSize = ParticleRenderer.kDefaultSimulationVolumeSize;

        // simulation
        particle.scatteringFactor = 1.0;
        particle.vectorFieldFactor = 1.0;
        particle.curlNoiseFactor = 16;
        particle.curlNoiseScale = 128;
        particle.vectorFieldFactor = 8;

        // material
        particle.material.birthGradient = new Vector3(0, 1, 0);
        particle.material.deathGradient = new Vector3(1, 0, 0);
        particle.material.minParticleSize = 0.75;
        particle.material.maxParticleSize = 4.0;
        particle.material.fadeCoefficient = 0.35;
        particle.material.debugDraw = false;

        const cubeEntity = rootEntity.createChild();
        const renderer = cubeEntity.addComponent(MeshRenderer);
        renderer.mesh = PrimitiveMesh.createPlane(engine, 10, 10);
        const material = new BlinnPhongMaterial(engine);
        material.baseColor.setValue(0.7, 0.5, 0.4, 1);
        material.baseColor = material.baseColor;
        renderer.setMaterial(material);

        engine.run();
    });
}
