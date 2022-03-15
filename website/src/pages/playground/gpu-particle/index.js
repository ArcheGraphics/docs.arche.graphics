import React from "react";
import Layout from '@theme/Layout';
import {createParticleApp} from "../../../code/ParticleApp";

function App() {
    React.useEffect(() => {
        createParticleApp();
    }, []);

    return (
        <canvas id="canvas" style={{width: "100vw", height: "100vh"}}/>
    );
}

export default function Home() {
    return (
        <Layout
            title={`playground`}
            description="Description will go into a meta tag in <head />">
            <main>
                <App/>
            </main>
        </Layout>
    );
}
