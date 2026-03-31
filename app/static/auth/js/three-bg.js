/* LogiPlanner — Three.js Animated Background */
document.addEventListener("DOMContentLoaded", () => {
    const canvas = document.getElementById("three-canvas");
    if (!canvas) return;

    // Check if THREE is loaded
    if (typeof THREE === "undefined") {
        console.warn("Three.js not loaded.");
        return;
    }

    const parent = canvas.parentElement;
    
    // Scene setup
    const scene = new THREE.Scene();
    
    // Camera setup - slightly looking down
    const camera = new THREE.PerspectiveCamera(60, parent.clientWidth / parent.clientHeight, 0.1, 1000);
    camera.position.z = 40;
    camera.position.y = 15;
    camera.lookAt(0, 0, 0);

    // Renderer setup
    const renderer = new THREE.WebGLRenderer({
        canvas: canvas,
        alpha: true,
        antialias: true
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); // limit pixel ratio for performance
    renderer.setSize(parent.clientWidth, parent.clientHeight);
    
    // Handle resize
    window.addEventListener("resize", () => {
        if (!parent) return;
        camera.aspect = parent.clientWidth / parent.clientHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(parent.clientWidth, parent.clientHeight);
    });

    // Create a particle system (Points) for a cosmic dust / neural network feel
    const particleCount = 2500;
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(particleCount * 3);
    const colors = new Float32Array(particleCount * 3);
    
    const color1 = new THREE.Color("#4f46e5"); // Indigo
    const color2 = new THREE.Color("#06d6a0"); // Teal
    const color3 = new THREE.Color("#8b5cf6"); // Purple

    for (let i = 0; i < particleCount; i++) {
        // Distribute particles in a wide but vertically constrained space
        const x = (Math.random() - 0.5) * 120;
        const y = (Math.random() - 0.5) * 60;
        const z = (Math.random() - 0.5) * 120;
        
        positions[i * 3] = x;
        positions[i * 3 + 1] = y;
        positions[i * 3 + 2] = z;

        // Mix colors randomly
        let mixedColor = color1.clone();
        const rand = Math.random();
        if (rand > 0.6) mixedColor.lerp(color2, Math.random());
        else if (rand > 0.3) mixedColor.lerp(color3, Math.random());

        colors[i * 3] = mixedColor.r;
        colors[i * 3 + 1] = mixedColor.g;
        colors[i * 3 + 2] = mixedColor.b;
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    // Particle Material
    const material = new THREE.PointsMaterial({
        size: 0.25,
        vertexColors: true,
        transparent: true,
        opacity: 0.6,
        sizeAttenuation: true,
        blending: THREE.AdditiveBlending
    });

    const particleSystem = new THREE.Points(geometry, material);
    scene.add(particleSystem);

    // Add some larger glowing spheres for an artistic "data nodes" effect
    const nodes = [];
    const nodeGeom = new THREE.SphereGeometry(0.5, 16, 16);
    const nodeMats = [
        new THREE.MeshBasicMaterial({ color: "#4f46e5", transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending }),
        new THREE.MeshBasicMaterial({ color: "#06d6a0", transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending }),
        new THREE.MeshBasicMaterial({ color: "#8b5cf6", transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending })
    ];

    for(let k=0; k<12; k++) {
        const mesh = new THREE.Mesh(nodeGeom, nodeMats[Math.floor(Math.random() * nodeMats.length)]);
        mesh.position.set(
            (Math.random() - 0.5) * 80,
            (Math.random() - 0.5) * 40,
            (Math.random() - 0.5) * 60 + 10 // bring them a bit closer
        );
        
        // Add a subtle wireframe glow wrapper
        const wireframe = new THREE.Mesh(new THREE.IcosahedronGeometry(1.2, 0), new THREE.MeshBasicMaterial({
            color: mesh.material.color, wireframe: true, transparent: true, opacity: 0.2
        }));
        mesh.add(wireframe);

        mesh.userData = {
            rx: (Math.random() - 0.5) * 0.01,
            ry: (Math.random() - 0.5) * 0.01,
            yOrig: mesh.position.y,
            speed: Math.random() * 0.02 + 0.01,
            offset: Math.random() * Math.PI * 2
        };
        scene.add(mesh);
        nodes.push(mesh);
    }

    // Interactive Mouse Tracking
    let mouseX = 0;
    let mouseY = 0;
    let targetX = 0;
    let targetY = 0;

    document.addEventListener("mousemove", (event) => {
        // Normalized coordinates -1 to 1
        mouseX = (event.clientX / window.innerWidth) * 2 - 1;
        mouseY = -(event.clientY / window.innerHeight) * 2 + 1;
    });

    // Animation Loop
    let time = 0;
    const clock = new THREE.Clock();

    const animate = function () {
        requestAnimationFrame(animate);
        const delta = clock.getDelta();
        time += delta;

        // Smoothly interpolate camera target towards mouse
        targetX = mouseX * 5;
        targetY = mouseY * 5;
        
        // Subtle parallax effect on the particle system based on mouse
        particleSystem.rotation.y += 0.0003;
        particleSystem.rotation.x = Math.sin(time * 0.1) * 0.05;
        
        // Add parallax based on mouse
        camera.position.x += (targetX - camera.position.x) * 0.02;
        camera.position.y += ((targetY + 15) - camera.position.y) * 0.02;
        camera.lookAt(0, 0, 0);

        // Wave animation on particles
        const posAttr = particleSystem.geometry.attributes.position;
        const posArray = posAttr.array;
        
        for (let i = 0; i < particleCount; i++) {
            const ix = i * 3;
            const x = posArray[ix];
            // Slow oscillation wave
            posArray[ix + 1] += Math.sin(time + x * 0.05) * 0.02;
        }
        posAttr.needsUpdate = true;

        // Animate node spheres
        nodes.forEach(node => {
            node.rotation.x += node.userData.rx;
            node.rotation.y += node.userData.ry;
            // Float up and down
            node.position.y = node.userData.yOrig + Math.sin(time + node.userData.offset) * 4 * node.userData.speed;
        });

        renderer.render(scene, camera);
    };

    animate();
});
