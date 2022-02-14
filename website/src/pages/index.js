import React from 'react';
import clsx from 'clsx';
import Layout from '@theme/Layout';
import Link from '@docusaurus/Link';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import styles from './index.module.css';
import {createArche} from "./code";
import ReactMarkdown from 'react-markdown'
import {Prism as SyntaxHighlighter} from 'react-syntax-highlighter'

function HomepageHeader() {
    const {siteConfig} = useDocusaurusContext();
    return (
        <header className={clsx('hero hero--primary', styles.heroBanner)}>
            <div className="container">
                <h1 className="hero__title">{siteConfig.title}</h1>
                <p className="hero__subtitle">{siteConfig.tagline}</p>
                <div className={styles.buttons}>
                    <Link
                        className="button button--secondary button--lg"
                        to="/docs/intro">
                        Tutorial - 5min ⏱️
                    </Link>
                </div>
            </div>
        </header>
    );
}

function App() {
    React.useEffect(() => {
        createArche();
    }, []);

    return (
        <canvas id="canvas" style={{width: "50vw", height: "70vh"}}/>
    );
}

const markdown = `
~~~c++
void PrimitiveApp::loadScene(uint32_t width, uint32_t height) {
    _scene->ambientLight().setDiffuseSolidColor(Color(1, 1, 1));
    auto rootEntity = _scene->createRootEntity();
    
    auto cameraEntity = rootEntity->createChild();
    cameraEntity->transform->setPosition(10, 10, 10);
    cameraEntity->transform->lookAt(Point3F(0, 0, 0));
    _mainCamera = cameraEntity->addComponent<Camera>();
    _mainCamera->resize(width, height);
    cameraEntity->addComponent<control::OrbitControl>();
    
    // init point light
    auto light = rootEntity->createChild("light");
    light->transform->setPosition(0, 3, 0);
    auto pointLight = light->addComponent<PointLight>();
    pointLight->intensity = 0.3;
    
    auto cubeEntity = rootEntity->createChild();
    cubeEntity->addComponent<MoveScript>();
    auto renderer = cubeEntity->addComponent<MeshRenderer>();
    renderer->setMesh(PrimitiveMesh::createCuboid(_device, 1));
    auto material = std::make_shared<BlinnPhongMaterial>(_device);
    material->setBaseColor(Color(0.4, 0.6, 0.6));
    renderer->setMaterial(material);
}
~~~
`

export default function Home() {
    const {siteConfig} = useDocusaurusContext();
    return (
        <Layout
            title={`${siteConfig.title}`}
            description="Description will go into a meta tag in <head />">
            <HomepageHeader/>
            <main>

                <div className='row'>
                    <App/>
                    <ReactMarkdown className={styles.code}
                                   children={markdown}
                                   components={{
                                       code({node, inline, className, children, ...props}) {
                                           const match = /language-(\w+)/.exec(className || '')
                                           return !inline && match ? (
                                               <SyntaxHighlighter
                                                   children={String(children).replace(/\n$/, '')}
                                                   language={match[1]}
                                                   PreTag="div"
                                                   {...props}
                                               />
                                           ) : (
                                               <code className={className} {...props}>
                                                   {children}
                                               </code>
                                           )
                                       }
                                   }}
                    />
                </div>

            </main>
        </Layout>
    );
}
