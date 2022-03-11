import React from "react";
import Layout from '@theme/Layout';
import {createFramebufferPickerApp} from "../../../code/FramebufferPickerApp";

function App() {
    React.useEffect(() => {
        createFramebufferPickerApp();
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
