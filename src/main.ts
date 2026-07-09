
import Matter from 'matter-js';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import "./style.css";

// --- Physics Setup (Matter.js) ---
const Engine = Matter.Engine;
const Bodies = Matter.Bodies;
const Composite = Matter.Composite;
const Body = Matter.Body;

// Create an engine
const engine = Engine.create();
// Disable global gravity (top-down view)
engine.gravity.y = 0;
engine.gravity.scale = 0;
const clock = new THREE.Clock();

// Increase solver iterations for stability with high speed collisions
engine.positionIterations = 16;
engine.velocityIterations = 16;

// --- Rendering Setup (Three.js) ---
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000000);

// Orthographic Camera Setup
const aspect = window.innerWidth / window.innerHeight;
const frustumSize = 600; // Controls zoom level (smaller = more zoomed in)
const camera = new THREE.OrthographicCamera(
    frustumSize * aspect / -2,  // left
    frustumSize * aspect / 2,   // right
    frustumSize / 2,            // top
    frustumSize / -2,           // bottom
    0.1,                        // near
    2000                        // far
);
// Position camera for a slanted top-down view
camera.position.set(0, 600, 400);
camera.lookAt(0, 0, 0);
scene.add(camera);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(window.devicePixelRatio); // Fix pixelation
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);

// --- Orbit Controls ---
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = false;
controls.maxPolarAngle = Math.PI / 2 - 0.1; // Keep floor constraint

const criticalFlashUniforms = {
    uIntensity: { value: 0 },
    uOrigin: { value: new THREE.Vector2(0.5, 0.5) },
    uAspect: { value: window.innerWidth / window.innerHeight }
};

const criticalFlashMaterial = new THREE.ShaderMaterial({
    uniforms: criticalFlashUniforms,
    vertexShader: `
        varying vec2 vUv;
        void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
    `,
    fragmentShader: `
        uniform float uIntensity;
        uniform vec2 uOrigin;
        uniform float uAspect;
        varying vec2 vUv;

        void main() {
            vec2 p = vec2((vUv.x - uOrigin.x) * uAspect, vUv.y - uOrigin.y);
            float d = length(p);
            float core = pow(smoothstep(0.13, 0.0, d), 0.55) * 1.18;
            float hotEdge = smoothstep(0.2, 0.11, d) * smoothstep(0.045, 0.12, d) * 0.46;
            float halo = pow(smoothstep(1.22, 0.09, d), 2.8) * 0.64;
            float ring = smoothstep(0.43, 0.34, d) * smoothstep(0.27, 0.36, d) * 0.58;
            float outerSnap = smoothstep(0.78, 0.68, d) * smoothstep(0.56, 0.69, d) * 0.2;
            float alpha = clamp((core + halo + ring) * uIntensity, 0.0, 1.0);
            alpha = clamp(alpha + outerSnap * uIntensity, 0.0, 1.0);
            vec3 color = mix(vec3(1.0), vec3(1.0, 0.86, 0.52), smoothstep(0.08, 0.48, d));
            gl_FragColor = vec4(color, alpha);
        }
    `,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    blending: THREE.AdditiveBlending
});

const criticalFlashPlane = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), criticalFlashMaterial);
criticalFlashPlane.position.set(0, 0, -10);
criticalFlashPlane.renderOrder = 9999;
criticalFlashPlane.visible = false;
camera.add(criticalFlashPlane);

const criticalFlashState = {
    startedAt: -Infinity,
    duration: 0.34,
    worldPoint: undefined as THREE.Vector3 | undefined
};

function syncCriticalFlashPlaneToCamera() {
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);
    const viewWidth = (camera.right - camera.left) / camera.zoom;
    const viewHeight = (camera.top - camera.bottom) / camera.zoom;
    const overscan = 1.08;
    criticalFlashUniforms.uAspect.value = viewWidth / viewHeight;
    criticalFlashPlane.scale.set(viewWidth * overscan, viewHeight * overscan, 1);
}

syncCriticalFlashPlaneToCamera();

// --- Launch UI (Slider + Button)
const launchContainer = document.createElement('div');
launchContainer.id = 'launch-container';
document.body.appendChild(launchContainer);


const DEFAULT_LAUNCH_ANGLE = 180;
const currentLaunchAngle = { value: DEFAULT_LAUNCH_ANGLE };

// -- Linear Slider --
// -- Pointer Lock Drag Zone --
// -- Pointer Lock Drag Zone (Touch Compatible) --
const dragZone = document.createElement('div');
dragZone.className = 'drag-zone';
dragZone.innerHTML = `
    <svg class="aim-icon aim-icon-left" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M15 5L8 12L15 19" />
    </svg>
    <span class="aim-label">Aim</span>
    <svg class="aim-icon aim-icon-right" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M9 5L16 12L9 19" />
    </svg>
`;
launchContainer.appendChild(dragZone);

let isAiming = false;
let previousAimX = 0;

dragZone.addEventListener('pointerdown', (e) => {
    isAiming = true;
    previousAimX = e.clientX;
    dragZone.classList.add('active');
    dragZone.setPointerCapture(e.pointerId);

    // Attempt pointer lock only for mouse to allow infinite scrolling feel
    if (e.pointerType === 'mouse') {
        dragZone.requestPointerLock();
    }
});

// Unified pointer move handler
dragZone.addEventListener('pointermove', (e) => {
    if (!isAiming) return;

    // Use movementX if available (mostly mouse with lock), else calculate delta (touch)
    let deltaX = e.movementX;

    // If movementX is unreliable or zero during touch (common), use clientX delta
    // Note: movementX might be 0 on touch, or available in modern browsers. 
    // We check if we are NOT locked, then we MUST use clientX delta.
    if (document.pointerLockElement !== dragZone) {
        deltaX = e.clientX - previousAimX;
        previousAimX = e.clientX;
    }

    // Apply sensitivity
    const sensitivity = 0.5;
    let newAngle = currentLaunchAngle.value + deltaX * sensitivity;

    // Wrap angle 0-360
    if (newAngle >= 360) newAngle -= 360;
    if (newAngle < 0) newAngle += 360;

    currentLaunchAngle.value = newAngle;

    // Update Guide & Visuals
    updateGuide(currentLaunchAngle.value);
});

const endAim = (e: PointerEvent) => {
    if (!isAiming) return;
    isAiming = false;
    dragZone.classList.remove('active');
    dragZone.releasePointerCapture(e.pointerId);
    if (document.exitPointerLock) document.exitPointerLock();
};

dragZone.addEventListener('pointerup', endAim);
dragZone.addEventListener('pointercancel', endAim);



// Launch Button
const launchBtn = document.createElement('button');
launchBtn.textContent = 'Launch';
launchBtn.className = 'launch-btn';
launchContainer.appendChild(launchBtn);


// move the width segment point to make it a chevron
const arrowVertexShader = `
varying vec2 vUv;
void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const arrowFragmentShader = `
uniform float uTime;
varying vec2 vUv;

void main() {
    float phase = vUv.x * 6.0 - uTime * 2.0;
    float alpha = fract(phase);
    if (alpha > 0.2) discard;
    gl_FragColor = vec4(vec3(.6), 1);
}
`;

const arrowGeo = new THREE.PlaneGeometry();

const arrowMat = new THREE.ShaderMaterial({
    vertexShader: arrowVertexShader,
    fragmentShader: arrowFragmentShader,
    uniforms: {
        uTime: { value: 0 }
    },
    transparent: true,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending
});


const arrowMesh = new THREE.Mesh(arrowGeo, arrowMat);
scene.add(arrowMesh);

// Helper to update arrow mesh to hug ground


// Replace geometry with custom buffer for easier control
// Replace geometry with custom buffer for easier control
const guideGeo = new THREE.BufferGeometry();
const guideSegs = 20;
// 3 points per step (Left, Center, Right)
const guidePositions = new Float32Array((guideSegs + 1) * 3 * 3);
const guideUvs = new Float32Array((guideSegs + 1) * 3 * 2);
const guideIndices = [];

for (let i = 0; i < guideSegs; i++) {
    // 3 points per row: 0:Left, 1:Center, 2:Right
    const base = 3 * i;
    const next = 3 * (i + 1);

    // Quad 1: Left-Center
    // L, L', C
    guideIndices.push(base, next, base + 1);
    // C, L', C'
    guideIndices.push(base + 1, next, next + 1);

    // Quad 2: Center-Right
    // C, C', R
    guideIndices.push(base + 1, next + 1, base + 2);
    // R, C', R'
    guideIndices.push(base + 2, next + 1, next + 2);
}

guideGeo.setIndex(guideIndices);
guideGeo.setAttribute('position', new THREE.BufferAttribute(guidePositions, 3));
guideGeo.setAttribute('uv', new THREE.BufferAttribute(guideUvs, 2));

const guideMesh = new THREE.Mesh(guideGeo, arrowMat);
guideMesh.frustumCulled = false; // Always render
scene.add(guideMesh);
scene.remove(arrowMesh); // Remove the temp plane one

function updateGuide(angleDeg: number) {
    if (!player) return;

    const angleRad = (angleDeg * Math.PI) / 180;
    const dirX = Math.cos(angleRad);
    const dirZ = Math.sin(angleRad);
    const perpX = -dirZ;
    const perpZ = dirX;

    const len = 80;
    const width = 15; // Slightly wider for chevron
    const chevronOffset = 5; // How much the center sticks out

    const posAttr = guideGeo.attributes.position;
    const uvAttr = guideGeo.attributes.uv;

    const startX = player.mesh.position.x;
    const startZ = player.mesh.position.z;

    for (let i = 0; i <= guideSegs; i++) {
        const t = i / guideSegs;
        const dist = t * len;

        // Base center point on the line
        const bx = startX + dirX * dist;
        const bz = startZ + dirZ * dist;

        // Center Point (Pushed forward for V-shape)
        // Actually, "V" usually points forward. So center is LEADING.
        // If center is at 'dist + offset', edges are at 'dist'.
        // BUT, visually a chevron usually looks like this: >
        // So center is further along X than edges.
        const cx = bx + dirX * chevronOffset;
        const cz = bz + dirZ * chevronOffset;
        const cy = getArenaHeight(cx, cz) + 2;

        // Left Point (Edges trail behind center)
        const lx = bx + perpX * width * 0.5;
        const lz = bz + perpZ * width * 0.5;
        const ly = getArenaHeight(lx, lz) + 2;

        // Right Point
        const rx = bx - perpX * width * 0.5;
        const rz = bz - perpZ * width * 0.5;
        const ry = getArenaHeight(rx, rz) + 2;

        // Indices: 3*i, 3*i+1, 3*i+2
        posAttr.setXYZ(3 * i, lx, ly, lz);     // Left
        posAttr.setXYZ(3 * i + 1, cx, cy, cz); // Center
        posAttr.setXYZ(3 * i + 2, rx, ry, rz); // Right

        // UVs
        // Center V=0.5, Left V=0, Right V=1
        uvAttr.setXY(3 * i, t, 0);
        uvAttr.setXY(3 * i + 1, t, 0.5);
        uvAttr.setXY(3 * i + 2, t, 1);
    }

    posAttr.needsUpdate = true;
    uvAttr.needsUpdate = true;
}

// --- Game Constants ---
const ARENA_RADIUS = 300;
const BEYBLADE_RADIUS = 30; // Physics radius
const FORCE_CONSTANT = 0.00002;

// Helper function for Bowl Shape
// y = (r / R)^2 * MaxH
const BOWL_MAX_HEIGHT = 50;
function getArenaHeight(x: number, z: number): number {
    const dist = Math.sqrt(x * x + z * z);
    // Clamp to radius
    if (dist > ARENA_RADIUS) return BOWL_MAX_HEIGHT;
    return Math.pow(dist / ARENA_RADIUS, 2) * BOWL_MAX_HEIGHT;
}

// Get normal vector at position for tilt
function getArenaNormal(x: number, z: number): THREE.Vector3 {
    // Derivative of y = k * (x^2 + z^2) where k = MaxH / R^2
    const k = BOWL_MAX_HEIGHT / (ARENA_RADIUS * ARENA_RADIUS);
    const slopeX = 2 * k * x;
    const slopeZ = 2 * k * z;
    // Normal is (-slopeX, 1, -slopeZ)
    return new THREE.Vector3(-slopeX, 1, -slopeZ).normalize();
}

// Physics Walls (Matter.js) - Keep as is
function createCircularWall(x: number, y: number, radius: number, segments: number, thickness: number) {
    const walls: Matter.Body[] = [];
    const angleStep = (Math.PI * 2) / segments;

    for (let i = 0; i < segments; i++) {
        const angle = i * angleStep;
        const cx = x + Math.cos(angle) * radius;
        const cy = y + Math.sin(angle) * radius;

        // Adjust width to cover the arc (slight overlap)
        const wallWidth = 2 * radius * Math.tan(Math.PI / segments) * 1.1;
        const wall = Bodies.rectangle(cx, cy, wallWidth, thickness, {
            isStatic: true,
            angle: angle + Math.PI / 2,
            label: 'Wall'
        });

        walls.push(wall);
    }
    return walls;
}

// Create physics walls centered at 0,0
const walls = createCircularWall(0, 0, ARENA_RADIUS, 32, 20);
Composite.add(engine.world, walls);

// Visual Arena (Three.js)
const arenaGroup = new THREE.Group();
scene.add(arenaGroup);

function createWrappedArenaPlane(radius: number, radialSegments: number, angularSegments: number) {
    const positions: number[] = [];
    const indices: number[] = [];
    const uvs: number[] = [];

    for (let rIndex = 0; rIndex <= radialSegments; rIndex++) {
        const r = (rIndex / radialSegments) * radius;
        for (let aIndex = 0; aIndex <= angularSegments; aIndex++) {
            const angle = (aIndex / angularSegments) * Math.PI * 2;
            const x = Math.cos(angle) * r;
            const z = Math.sin(angle) * r;
            positions.push(x, getArenaHeight(x, z) + 0.35, z);
            uvs.push(0.5 + x / (radius * 2), 0.5 + z / (radius * 2));
        }
    }

    const rowSize = angularSegments + 1;
    for (let rIndex = 0; rIndex < radialSegments; rIndex++) {
        for (let aIndex = 0; aIndex < angularSegments; aIndex++) {
            const a = rIndex * rowSize + aIndex;
            const b = a + 1;
            const c = (rIndex + 1) * rowSize + aIndex;
            const d = c + 1;
            indices.push(a, c, b, b, c, d);
        }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    return geometry;
}

// Bowl Floor (LatheGeometry)
const profilePoints = [];
const segments = 32;
for (let i = 0; i <= segments; i++) {
    const r = (i / segments) * ARENA_RADIUS;
    const h = Math.pow(i / segments, 2) * BOWL_MAX_HEIGHT;
    profilePoints.push(new THREE.Vector2(r, h));
}
// Extend a bit for the rim
profilePoints.push(new THREE.Vector2(ARENA_RADIUS + 10, BOWL_MAX_HEIGHT + 2));
const floorGeometry = new THREE.LatheGeometry(profilePoints, 128); // Increased segments for smoothness
floorGeometry.computeVertexNormals(); // Ensure smooth normals

const floorMaterial = new THREE.MeshBasicMaterial({
    color: 0x333333,
    side: THREE.DoubleSide
});
const floor = new THREE.Mesh(floorGeometry, floorMaterial);
arenaGroup.add(floor);

const arenaPlaneMaterial = new THREE.MeshBasicMaterial({
    color: 0x222222,
    side: THREE.DoubleSide
});
const arenaPlane = new THREE.Mesh(createWrappedArenaPlane(ARENA_RADIUS - 2, 28, 96), arenaPlaneMaterial);
arenaPlane.renderOrder = 1;
arenaGroup.add(arenaPlane);


// Walls Visual (Ring at top)
const wallGeometry = new THREE.RingGeometry(ARENA_RADIUS + 5, ARENA_RADIUS + 10, 100).translate(0, 0, -2);
const wallMaterial = new THREE.MeshBasicMaterial({ color: 0x333333, side: THREE.DoubleSide });
const wallMesh = new THREE.Mesh(wallGeometry, wallMaterial);
wallMesh.rotation.x = Math.PI / 2;
wallMesh.position.y = BOWL_MAX_HEIGHT;
arenaGroup.add(wallMesh);






// Helper to create Beyblade 3D Model
function createBeybladeMesh(stats: BeybladeStats): { mesh: THREE.Group, tiltGroup: THREE.Group, spinGroup: THREE.Group } {
    enforceBeyColorContrast(stats);

    const mesh = new THREE.Group();
    const tiltGroup = new THREE.Group();
    const spinGroup = new THREE.Group();

    mesh.add(tiltGroup);
    tiltGroup.add(spinGroup);

    // Apply global scale
    spinGroup.scale.setScalar(stats.beyScale || 1.0);

    const pm = stats.partMatcaps || {};
    const wheelTex = getMatcapTexture(getContrastMatcapUrl(pm.wheel));
    const ringTex = getMatcapTexture(getContrastMatcapUrl(pm.ring));
    const boltTex = getMatcapTexture(getContrastMatcapUrl(pm.bolt));
    const trackTex = getMatcapTexture(getContrastMatcapUrl(pm.spinTrack));
    const tipTex = getMatcapTexture(getContrastMatcapUrl(pm.tip));

    // Helper: Fake Smooth Normals
    const makeSmooth = (geo: THREE.BufferGeometry) => {
        geo.deleteAttribute('normal'); // Remove existing normals
        geo = BufferGeometryUtils.mergeVertices(geo, 0.1); // Merge close vertices
        geo.computeVertexNormals(); // Recompute purely based on geometry
        return geo;
    };

    // Helper for Rounded Cylinder using ExtrudeGeometry
    const createRoundedCylinder = (radius: number, height: number, bevelSize: number = 0.5) => {
        const shape = new THREE.Shape();
        shape.absarc(0, 0, radius, 0, Math.PI * 2, false);
        const settings = {
            depth: height - (bevelSize * 2), // Adjust depth so total height includes bevel
            bevelEnabled: true,
            bevelThickness: bevelSize,
            bevelSize: bevelSize,
            bevelSegments: 8, // Doubled for smoothness
            curveSegments: 64 // Doubled for smoothness
        };
        const geo = new THREE.ExtrudeGeometry(shape, settings);
        geo.center(); // Center geometry
        return makeSmooth(geo);
    };

    // 1. Metal Wheel (Base) - Rounded
    const wheelGeo = createRoundedCylinder(BEYBLADE_RADIUS, 5, 0.8);
    const wheelMat = new THREE.MeshMatcapMaterial({
        color: stats.wheelColor || 0x888888,
        matcap: wheelTex
    });
    const wheel = new THREE.Mesh(wheelGeo, wheelMat);
    wheel.position.y = 5;
    wheel.rotation.x = Math.PI / 2; // Extrude creates on XY plane
    spinGroup.add(wheel);

    // 2. Clear Wheel / Energy Ring - Rounded
    const ringRadius = BEYBLADE_RADIUS * (stats.ringRadiusFactor || 0.75);
    const ringShape = new THREE.Shape();
    ringShape.absarc(0, 0, ringRadius, 0, Math.PI * 2, false);

    // Create hole for ring
    const holePath = new THREE.Path();
    holePath.absarc(0, 0, ringRadius * 0.7, 0, Math.PI * 2, true);
    ringShape.holes.push(holePath);

    let ringGeo: THREE.BufferGeometry = new THREE.ExtrudeGeometry(ringShape, {
        depth: 3, // slightly thinner interaction layer
        bevelEnabled: true,
        bevelThickness: 0.5,
        bevelSize: 0.5,
        bevelSegments: 6, // Smoother bevel
        curveSegments: Math.max(stats.ringSides || 32, 64) // Ensure high curve count unless sides specified
    });
    ringGeo.center();
    ringGeo = makeSmooth(ringGeo);

    const ringMat = new THREE.MeshMatcapMaterial({
        color: stats.ringColor || 0x0088ff,
        matcap: ringTex
    });

    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.position.y = 8; // Stacked
    ring.rotation.x = Math.PI / 2;
    spinGroup.add(ring);

    // 3. Face Bolt - Hexagon with Bevel
    const boltShape = new THREE.Shape();
    const sides = stats.boltSides || 6;
    const boltRadius = 10;

    // Draw polygon
    for (let i = 0; i < sides; i++) {
        const theta = (i / sides) * Math.PI * 2;
        const x = Math.cos(theta) * boltRadius;
        const y = Math.sin(theta) * boltRadius;
        if (i === 0) boltShape.moveTo(x, y);
        else boltShape.lineTo(x, y);
    }
    boltShape.closePath();

    let boltGeo: THREE.BufferGeometry = new THREE.ExtrudeGeometry(boltShape, {
        depth: 4,
        bevelEnabled: true,
        bevelThickness: 1,
        bevelSize: 1,
        bevelSegments: 2
    });
    boltGeo.center();
    boltGeo = makeSmooth(boltGeo);

    const boltMat = new THREE.MeshMatcapMaterial({
        color: stats.boltColor || 0x00ccff,
        matcap: boltTex
    });
    const bolt = new THREE.Mesh(boltGeo, boltMat);
    bolt.position.y = 12; // Top
    bolt.rotation.x = Math.PI / 2;
    spinGroup.add(bolt);

    // 4. Spin Track
    const stSize = stats.spinTrackSize || 1.0;
    // Use simple cylinder for stem but rounded for base?
    // Let's stick to Cylinder for the stem part as it's intricate
    let spinTrackGeo: THREE.BufferGeometry = new THREE.CylinderGeometry(BEYBLADE_RADIUS * .3 * stSize, BEYBLADE_RADIUS * .2 * stSize, 10, 32);
    spinTrackGeo = makeSmooth(spinTrackGeo);
    const spinTrackMat = new THREE.MeshMatcapMaterial({
        color: stats.spinTrackColor || 0x777777,
        matcap: trackTex
    });
    const spinTrack = new THREE.Mesh(spinTrackGeo, spinTrackMat);
    spinTrack.position.y = -1;
    spinGroup.add(spinTrack);

    // 5. Tip (Driver) - Rounded Tip
    const tSize = stats.tipSize || 1.0;
    // Lathe for a smooth tip shape
    const tipPoints = [];
    tipPoints.push(new THREE.Vector2(0, 0)); // Bottom contact point (sharp)
    tipPoints.push(new THREE.Vector2(2 * tSize, 1));
    tipPoints.push(new THREE.Vector2(5 * tSize, 8)); // Top wide base
    let tipGeo: THREE.BufferGeometry = new THREE.LatheGeometry(tipPoints, 32); // Smoother tip
    tipGeo = makeSmooth(tipGeo);

    const tipMat = new THREE.MeshMatcapMaterial({
        color: stats.tipColor || 0x888888,
        matcap: tipTex
    });
    const tip = new THREE.Mesh(tipGeo, tipMat);
    tip.position.y = -13;
    spinGroup.add(tip);

    return { mesh, tiltGroup, spinGroup };
}

// Trail System
class TrailSystem {
    mesh: THREE.Line;
    positions: number[] = [];
    maxPoints = 50;
    geometry: THREE.BufferGeometry;

    constructor(color: number, scene: THREE.Scene) {
        this.geometry = new THREE.BufferGeometry();
        // Initialize with default position
        const posArray = new Float32Array(this.maxPoints * 3);
        this.geometry.setAttribute('position', new THREE.BufferAttribute(posArray, 3));

        const material = new THREE.LineBasicMaterial({
            color: color,
            linewidth: 1,
        });

        this.mesh = new THREE.Line(this.geometry, material);
        this.mesh.frustumCulled = false;
        scene.add(this.mesh);
    }

    update(x: number, y: number, z: number) {
        this.positions.push(x, y, z);
        if (this.positions.length > this.maxPoints * 3) {
            this.positions.splice(0, 3);
        }

        const positionAttribute = this.geometry.attributes.position as THREE.BufferAttribute;
        const count = this.positions.length / 3;

        for (let i = 0; i < count; i++) {
            positionAttribute.setXYZ(i, this.positions[i * 3], this.positions[i * 3 + 1], this.positions[i * 3 + 2]);
        }

        // Fill rest with last point to hide
        const lastX = this.positions[this.positions.length - 3] || x;
        const lastY = this.positions[this.positions.length - 2] || y;
        const lastZ = this.positions[this.positions.length - 1] || z;

        for (let i = count; i < this.maxPoints; i++) {
            positionAttribute.setXYZ(i, lastX, lastY, lastZ);
        }

        positionAttribute.needsUpdate = true;
    }

    clear() {
        this.positions = [];
        const positionAttribute = this.geometry.attributes.position as THREE.BufferAttribute;
        for (let i = 0; i < this.maxPoints; i++) {
            positionAttribute.setXYZ(i, 0, 0, 0);
        }
        positionAttribute.needsUpdate = true;
    }
}
// --- Game Logic ---
interface BeybladeStats {
    maxRpm: number;
    atk: number;
    def: number;
    wt: number;
    sta: number;
    spd: number;
    spl: number;
    partMatcaps?: {
        wheel?: string;
        ring?: string;
        bolt?: string;
        spinTrack?: string;
        tip?: string;
    };
    trailColor: number; // New separate trail color
    crtAtk: number; // Critical Damage Value (Guaranteed above threshold)
    crt?: number; // Critical Chance (from pool branch compatibility)
    frictionAir: number;
    restitution: number;
    friction: number;

    densityBase: number;
    radius: number;
    height: number;
    // Arena Forces
    dishForce: number;  // Multiplier for radial force toward center
    curlForce: number;  // Multiplier for tangential clockwise force
    // Visual Stats
    beyScale: number;
    wheelColor: number;
    ringColor: number;
    ringSides: number;
    ringRadiusFactor: number;
    boltColor: number;
    boltSides: number;
    spinTrackColor: number;
    spinTrackSize: number;
    tipColor: number;
    tipSize: number;
    dragFactor: number;
}

interface GameEntity {
    body: Matter.Body;
    mesh: THREE.Object3D;
    tiltGroup: THREE.Group;
    spinGroup: THREE.Group;
    trail: TrailSystem;
    stats?: BeybladeStats;
    currentRpm?: number;
    // Death State
    isDead?: boolean;
    driftVelocity?: THREE.Vector3;
    driftRotation?: THREE.Vector3;
}
const entities: GameEntity[] = [];

// Physics Constants
// Physics Constants
const FRICTION_LOW = 0.02;
const FRICTION_HIGH = 0.035; // Controlled grip while diving

const CRIT_SPEED_THRESHOLD = 20;
const BARRIER_DAMAGE = 20; // Self-damage when hitting walls
const DIVE_BOOST_FORCE = 0.00012;



const DISH_LOW = 1;
const DISH_HIGH = 6;

const CURL_LOW = 1;
const CURL_HIGH = 90;

// Patterns
interface PhysicsPattern {
    name: string;
    dish: number;
    curl: number;
    drag: number;
}

const PATTERNS: PhysicsPattern[] = [
    { name: 'ORBIT', dish: DISH_LOW, curl: CURL_HIGH, drag: FRICTION_LOW },
    { name: 'DIVE', dish: DISH_HIGH, curl: CURL_LOW, drag: FRICTION_HIGH },
];

let currentPatternIndex = 0;
let cpuPatternIndex = 0;

type TGameSpeedId = 'training' | 'arcade' | 'overdrive';

const GAME_SPEEDS: Record<TGameSpeedId, { label: string, multiplier: number, copy: string }> = {
    training: { label: 'Training', multiplier: 0.51, copy: 'Slow lesson pace' },
    arcade: { label: 'Arcade', multiplier: 0.75, copy: 'Balanced match speed' },
    overdrive: { label: 'Overdrive', multiplier: 0.96, copy: 'Faster impacts' }
};

let currentGameSpeed: TGameSpeedId = 'training';
let tutorialComplete = localStorage.getItem('bblade_tutorial_complete') === 'true';
let cpuNextDiveSwitchAt = 0;

// --- Matcap Resources ---
const MATCAP_ROOT = 'https://raw.githubusercontent.com/nidorx/matcaps/master/';
let MATCAP_LIBRARY: { name: string, file: string, category: string, thumb: string }[] = [
    {
        name: 'Ceramic',
        file: MATCAP_ROOT + '256/D5D5D5_929292_ACACAC_B4B4B4-256px.png',
        category: 'Ceramic',
        thumb: MATCAP_ROOT + '64/D5D5D5_929292_ACACAC_B4B4B4-64px.png'
    }
];

// Helper: Hex to HSL for categorization
function getMatcapCategory(filename: string): string {
    if (!filename.endsWith('.png')) return 'Other';
    // Remove resolution suffix if present (e.g. -256px)
    const raw = filename.replace(/-[0-9]+px\.png$/, '.png').replace('.png', '');
    const parts = raw.split('_');
    if (parts.length < 4) return 'Other';

    let r = 0, g = 0, b = 0;
    parts.forEach(hex => {
        const bigint = parseInt(hex, 16);
        r += (bigint >> 16) & 255;
        g += (bigint >> 8) & 255;
        b += bigint & 255;
    });
    r /= parts.length; g /= parts.length; b /= parts.length;

    // RGB to HSL
    r /= 255, g /= 255, b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h = 0, s = 0, l = (max + min) / 2;

    if (max !== min) {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        switch (max) {
            case r: h = (g - b) / d + (g < b ? 6 : 0); break;
            case g: h = (b - r) / d + 2; break;
            case b: h = (r - g) / d + 4; break;
        }
        h /= 6;
    }
    const hDeg = h * 360;

    if (s < 0.15) {
        if (l < 0.2) return 'Dark';
        if (l > 0.8) return 'Ceramic';
        return 'Silver';
    } else {
        if (hDeg >= 30 && hDeg < 60 && l > 0.4) return 'Gold/Bronze';
        if (hDeg >= 0 && hDeg < 30) return 'Red';
        if (hDeg >= 330 && hDeg <= 360) return 'Red';
        if (hDeg >= 60 && hDeg < 150) return 'Green';
        if (hDeg >= 150 && hDeg < 260) return 'Cyan/Blue';
        if (hDeg >= 260 && hDeg < 330) return 'Purple';
        return 'Color';
    }
}

async function loadMatcapLibrary() {
    try {
        const response = await fetch('/matcaps_library.json');
        const data = await response.json();
        MATCAP_LIBRARY = data
            .filter((f: any) => f.name.endsWith('.png'))
            .map((f: any) => {
                // Determine logic to swap resolution
                // Original name is 1024/Hex.png or just Hex.png inside the json "name" field
                // The json "name" from the raw file list is just the filename usually?
                // Let's check the json structure you viewed earlier.
                // It has "path": "1024/..." and "name": "..." 

                const baseName = f.name; // e.g. "0404E8.....png"
                const nameWithoutExt = baseName.replace('.png', '');

                // Nidorx naming convention for other sizes:
                // 1024/NAME.png
                // 256/NAME-256px.png
                // 64/NAME-64px.png

                return {
                    name: baseName,
                    file: `${MATCAP_ROOT}256/${nameWithoutExt}-256px.png`,
                    category: getMatcapCategory(baseName),
                    thumb: `${MATCAP_ROOT}64/${nameWithoutExt}-64px.png`
                };
            });
        console.log(`Loaded ${MATCAP_LIBRARY.length} matcaps.`);
    } catch (e) {
        console.error('Failed to load matcap library:', e);
        // Keep default
    }
}

// Start loading immediately
loadMatcapLibrary();

const textureCache: Record<string, THREE.Texture> = {};
const defaultMatcapUrl = 'https://raw.githubusercontent.com/nidorx/matcaps/master/256/D5D5D5_929292_ACACAC_B4B4B4-256px.png';
const textureLoader = new THREE.TextureLoader();
const matcapTexture = textureLoader.load(defaultMatcapUrl);

function getContrastMatcapUrl(url: string | undefined): string | undefined {
    if (!url) return url;
    const filename = decodeURIComponent(url.split('/').pop() || '').replace(/-[0-9]+px\.png$/, '.png');
    return getMatcapCategory(filename) === 'Dark' ? defaultMatcapUrl : url;
}

function getMatcapTexture(url: string | undefined): THREE.Texture {
    if (!url) return matcapTexture; // Default ceramic

    if (!textureCache[url]) {
        textureCache[url] = textureLoader.load(url);
    }
    return textureCache[url];
}



// Stats Presets
type TPalette = {
    name: string;
    colors: [number, number, number, number, number];
};

type TBeyPreset = {
    name: string;
    style: string;
    stats: Partial<BeybladeStats>;
};

type TRawBeyPreset = {
    name: string;
    style: string;
    stats: Record<string, unknown>;
};

function matcapUrl(name: string) {
    const nameWithoutExt = name.replace('.png', '');
    return `${MATCAP_ROOT}256/${nameWithoutExt}-256px.png`;
}

const PRESET_MATCAP_SETS: Array<Required<BeybladeStats>['partMatcaps']> = [
    {
        wheel: matcapUrl('D5D5D5_929292_ACACAC_B4B4B4.png'),
        ring: matcapUrl('0C0CC3_04049F_040483_04045C.png'),
        bolt: matcapUrl('D5D5D5_929292_ACACAC_B4B4B4.png'),
        spinTrack: matcapUrl('070B0C_B2C7CE_728FA3_5B748B.png'),
        tip: matcapUrl('D5D5D5_929292_ACACAC_B4B4B4.png')
    },
    {
        wheel: matcapUrl('D5D5D5_929292_ACACAC_B4B4B4.png'),
        ring: matcapUrl('0DBD0D_049704_047B04_045504.png'),
        bolt: matcapUrl('D5D5D5_929292_ACACAC_B4B4B4.png'),
        spinTrack: matcapUrl('0C430C_257D25_439A43_3C683C.png'),
        tip: matcapUrl('D5D5D5_929292_ACACAC_B4B4B4.png')
    },
    {
        wheel: matcapUrl('D5D5D5_929292_ACACAC_B4B4B4.png'),
        ring: matcapUrl('0D0DE3_040486_0404AF_0404CF.png'),
        bolt: matcapUrl('D5D5D5_929292_ACACAC_B4B4B4.png'),
        spinTrack: matcapUrl('0F990F_047B04_044604_046704.png'),
        tip: matcapUrl('D5D5D5_929292_ACACAC_B4B4B4.png')
    }
];

const CURATED_PALETTES: TPalette[] = [
    { name: 'Prize Cabinet', colors: [0xfff12b, 0x05d9ff, 0xff2bd6, 0x10131f, 0xffffff] },
    { name: 'Vapor Chrome', colors: [0x79ffe1, 0x6d5dfc, 0xff7ac8, 0x1b1f3a, 0xf3f7ff] },
    { name: 'Solar Punch', colors: [0xffb000, 0xff4d00, 0x2ff3e0, 0x111111, 0xfff7d6] },
    { name: 'Circuit Jade', colors: [0x39ff88, 0x00b8ff, 0xfff12b, 0x0b1020, 0xeafff4] },
    { name: 'Candy Steel', colors: [0xf72585, 0x4cc9f0, 0xb5179e, 0x161a2d, 0xf8f9fb] }
];

const BEY_PRESET_CONFIGS_JSON = `[
  {"name":"Jackpot Volt","style":"crit sprinter","stats":{"atk":13,"def":4,"sta":1.1,"spd":72,"wt":0.9,"crtAtk":30,"beyScale":0.96,"wheelColor":"#18090b","ringColor":"#ff243e","boltColor":"#ffd21a","spinTrackColor":"#2ec7ff","tipColor":"#fff8ed","ringRadiusFactor":0.78,"ringSides":48,"boltSides":6}},
  {"name":"Storm Pegasus","style":"wide attack","stats":{"atk":12,"def":5,"sta":1.0,"spd":74,"wt":0.94,"crtAtk":29,"beyScale":0.98,"wheelColor":"#12315a","ringColor":"#2ec7ff","boltColor":"#fff8ed","spinTrackColor":"#ff243e","tipColor":"#ffd21a","ringRadiusFactor":0.82,"ringSides":64,"boltSides":5}},
  {"name":"Inferno Bull","style":"heavy burst","stats":{"atk":11,"def":8,"sta":1.3,"spd":56,"wt":1.34,"crtAtk":27,"beyScale":1.08,"wheelColor":"#240b0d","ringColor":"#ff7a12","boltColor":"#ff243e","spinTrackColor":"#ffd21a","tipColor":"#fff8ed","ringRadiusFactor":0.86,"ringSides":32,"boltSides":8}},
  {"name":"Aqua Leone","style":"guard counter","stats":{"atk":8,"def":9,"sta":1.5,"spd":58,"wt":1.22,"crtAtk":22,"beyScale":1.04,"wheelColor":"#0b1722","ringColor":"#2ec7ff","boltColor":"#a736ff","spinTrackColor":"#fff8ed","tipColor":"#ffd21a","ringRadiusFactor":0.8,"ringSides":40,"boltSides":6}},
  {"name":"Solar Wyvern","style":"stamina arc","stats":{"atk":9,"def":6,"sta":1.8,"spd":61,"wt":1.05,"crtAtk":24,"beyScale":1.0,"wheelColor":"#23150a","ringColor":"#ffd21a","boltColor":"#ff7a12","spinTrackColor":"#fff8ed","tipColor":"#ff243e","ringRadiusFactor":0.74,"ringSides":48,"boltSides":6}},
  {"name":"Violet Lynx","style":"orbit control","stats":{"atk":10,"def":6,"sta":1.2,"spd":68,"wt":1.0,"crtAtk":26,"beyScale":0.99,"wheelColor":"#170d24","ringColor":"#a736ff","boltColor":"#2ec7ff","spinTrackColor":"#ff243e","tipColor":"#fff8ed","ringRadiusFactor":0.72,"ringSides":64,"boltSides":5}},
  {"name":"Crimson Eagle","style":"air dash","stats":{"atk":13,"def":5,"sta":0.95,"spd":76,"wt":0.92,"crtAtk":31,"beyScale":0.95,"wheelColor":"#160914","ringColor":"#ff243e","boltColor":"#fff8ed","spinTrackColor":"#ff7a12","tipColor":"#2ec7ff","ringRadiusFactor":0.76,"ringSides":56,"boltSides":6}},
  {"name":"Chrome Kraken","style":"dense defense","stats":{"atk":8,"def":10,"sta":1.45,"spd":50,"wt":1.42,"crtAtk":21,"beyScale":1.09,"wheelColor":"#d7dde5","ringColor":"#1d2730","boltColor":"#2ec7ff","spinTrackColor":"#ff7a12","tipColor":"#ffd21a","ringRadiusFactor":0.88,"ringSides":32,"boltSides":8}},
  {"name":"Nova Fox","style":"balanced burst","stats":{"atk":11,"def":6,"sta":1.25,"spd":65,"wt":1.05,"crtAtk":27,"beyScale":1.0,"wheelColor":"#1a1212","ringColor":"#ff7a12","boltColor":"#ffd21a","spinTrackColor":"#2ec7ff","tipColor":"#fff8ed","ringRadiusFactor":0.8,"ringSides":48,"boltSides":6}},
  {"name":"Thunder Roc","style":"impact tank","stats":{"atk":12,"def":8,"sta":1.15,"spd":54,"wt":1.32,"crtAtk":30,"beyScale":1.07,"wheelColor":"#23140a","ringColor":"#ffd21a","boltColor":"#ff243e","spinTrackColor":"#a736ff","tipColor":"#fff8ed","ringRadiusFactor":0.84,"ringSides":40,"boltSides":8}},
  {"name":"Blizzard Hare","style":"light drift","stats":{"atk":9,"def":5,"sta":1.55,"spd":73,"wt":0.86,"crtAtk":23,"beyScale":0.94,"wheelColor":"#eef8ff","ringColor":"#2ec7ff","boltColor":"#a736ff","spinTrackColor":"#fff8ed","tipColor":"#ff243e","ringRadiusFactor":0.7,"ringSides":64,"boltSides":5}},
  {"name":"Magma Serpent","style":"wall bite","stats":{"atk":12,"def":7,"sta":1.05,"spd":62,"wt":1.16,"crtAtk":29,"beyScale":1.02,"wheelColor":"#190707","ringColor":"#ff243e","boltColor":"#ff7a12","spinTrackColor":"#ffd21a","tipColor":"#fff8ed","ringRadiusFactor":0.82,"ringSides":36,"boltSides":6}},
  {"name":"Comet Panda","style":"stamina guard","stats":{"atk":7,"def":8,"sta":1.9,"spd":52,"wt":1.18,"crtAtk":20,"beyScale":1.05,"wheelColor":"#fff8ed","ringColor":"#160914","boltColor":"#ffd21a","spinTrackColor":"#2ec7ff","tipColor":"#ff243e","ringRadiusFactor":0.76,"ringSides":48,"boltSides":8}},
  {"name":"Azure Dragon","style":"fast curve","stats":{"atk":11,"def":5,"sta":1.2,"spd":75,"wt":0.96,"crtAtk":28,"beyScale":0.98,"wheelColor":"#07121f","ringColor":"#2ec7ff","boltColor":"#ffd21a","spinTrackColor":"#a736ff","tipColor":"#fff8ed","ringRadiusFactor":0.74,"ringSides":56,"boltSides":5}},
  {"name":"Ember Tiger","style":"crit brawler","stats":{"atk":14,"def":4,"sta":0.9,"spd":69,"wt":1.02,"crtAtk":33,"beyScale":1.0,"wheelColor":"#240908","ringColor":"#ff7a12","boltColor":"#ff243e","spinTrackColor":"#fff8ed","tipColor":"#ffd21a","ringRadiusFactor":0.78,"ringSides":44,"boltSides":6}},
  {"name":"Ghost Mantis","style":"precision edge","stats":{"atk":10,"def":6,"sta":1.35,"spd":70,"wt":0.98,"crtAtk":25,"beyScale":0.97,"wheelColor":"#fff8ed","ringColor":"#a736ff","boltColor":"#2ec7ff","spinTrackColor":"#160914","tipColor":"#ffd21a","ringRadiusFactor":0.68,"ringSides":64,"boltSides":5}},
  {"name":"Iron Rhino","style":"slow crusher","stats":{"atk":10,"def":11,"sta":1.25,"spd":46,"wt":1.5,"crtAtk":26,"beyScale":1.1,"wheelColor":"#2b2f35","ringColor":"#ff243e","boltColor":"#ffd21a","spinTrackColor":"#fff8ed","tipColor":"#2ec7ff","ringRadiusFactor":0.9,"ringSides":32,"boltSides":8}},
  {"name":"Pulse Phoenix","style":"comeback spin","stats":{"atk":11,"def":7,"sta":1.45,"spd":64,"wt":1.08,"crtAtk":28,"beyScale":1.03,"wheelColor":"#170814","ringColor":"#ff243e","boltColor":"#ffd21a","spinTrackColor":"#ff7a12","tipColor":"#2ec7ff","ringRadiusFactor":0.8,"ringSides":48,"boltSides":6}}
]`;

const COLOR_STAT_KEYS = new Set(['wheelColor', 'ringColor', 'boltColor', 'spinTrackColor', 'tipColor', 'trailColor']);
const BEY_COLOR_KEYS: Array<keyof Pick<BeybladeStats, 'wheelColor' | 'ringColor' | 'boltColor' | 'spinTrackColor' | 'tipColor' | 'trailColor'>> = [
    'wheelColor',
    'ringColor',
    'boltColor',
    'spinTrackColor',
    'tipColor',
    'trailColor'
];
const MIN_BEY_LUMA = 135;

function getColorLuma(color: number) {
    const r = (color >> 16) & 255;
    const g = (color >> 8) & 255;
    const b = color & 255;
    return (r * 0.299) + (g * 0.587) + (b * 0.114);
}

function clampBeyColor(color: number) {
    const normalized = Math.max(0, Math.min(0xffffff, Math.round(color || 0)));
    const luma = getColorLuma(normalized);
    if (luma >= MIN_BEY_LUMA) return normalized;

    const r = (normalized >> 16) & 255;
    const g = (normalized >> 8) & 255;
    const b = normalized & 255;
    const mix = Math.min(1, (MIN_BEY_LUMA - luma) / Math.max(1, 255 - luma));

    return ((Math.round(r + (255 - r) * mix) << 16) |
        (Math.round(g + (255 - g) * mix) << 8) |
        Math.round(b + (255 - b) * mix));
}

function enforceBeyColorContrast(stats: Partial<BeybladeStats>) {
    BEY_COLOR_KEYS.forEach((key) => {
        const value = stats[key];
        if (typeof value === 'number') {
            (stats as any)[key] = clampBeyColor(value);
        }
    });
}

function normalizePresetConfig(config: TRawBeyPreset, index: number): TBeyPreset {
    const stats: Record<string, unknown> = {};
    Object.entries(config.stats).forEach(([key, value]) => {
        stats[key] = COLOR_STAT_KEYS.has(key) && typeof value === 'string'
            ? parseInt(value.replace('#', ''), 16)
            : value;
    });
    stats.partMatcaps = PRESET_MATCAP_SETS[index % PRESET_MATCAP_SETS.length];
    enforceBeyColorContrast(stats as Partial<BeybladeStats>);
    return {
        name: config.name,
        style: config.style,
        stats: stats as Partial<BeybladeStats>
    };
}

const BEY_PRESETS = (JSON.parse(BEY_PRESET_CONFIGS_JSON) as TRawBeyPreset[]).map(normalizePresetConfig);

function applyPaletteToStats(stats: BeybladeStats, palette: TPalette) {
    const [primary, secondary, accent, shadow, light] = palette.colors;
    stats.wheelColor = shadow;
    stats.ringColor = primary;
    stats.boltColor = accent;
    stats.spinTrackColor = secondary;
    stats.tipColor = light;
    stats.trailColor = accent;
    enforceBeyColorContrast(stats);
}

function randomFromRange(min: number, max: number) {
    return min + Math.random() * (max - min);
}

function numberToHex(value: number) {
    return value.toString(16).padStart(6, '0');
}

function hslToHex(h: number, s: number, l: number) {
    const saturation = s / 100;
    const lightness = l / 100;
    const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
    const x = chroma * (1 - Math.abs((h / 60) % 2 - 1));
    const m = lightness - chroma / 2;
    let r = 0;
    let g = 0;
    let b = 0;

    if (h < 60) [r, g, b] = [chroma, x, 0];
    else if (h < 120) [r, g, b] = [x, chroma, 0];
    else if (h < 180) [r, g, b] = [0, chroma, x];
    else if (h < 240) [r, g, b] = [0, x, chroma];
    else if (h < 300) [r, g, b] = [x, 0, chroma];
    else [r, g, b] = [chroma, 0, x];

    return ((Math.round((r + m) * 255) << 16) |
        (Math.round((g + m) * 255) << 8) |
        Math.round((b + m) * 255));
}

async function fetchProfessionalPalette(): Promise<TPalette> {
    const baseHue = Math.floor(Math.random() * 360);
    const sourceColors = [
        hslToHex(baseHue, 88, 54),
        hslToHex((baseHue + 32) % 360, 92, 48),
        hslToHex((baseHue + 174) % 360, 86, 58),
        hslToHex((baseHue + 248) % 360, 76, 18),
        hslToHex((baseHue + 54) % 360, 80, 92)
    ];
    const response = await fetch(`https://api.color.pizza/v1/?values=${sourceColors.map(numberToHex).join(',')}`);
    const data = await response.json() as {
        colors?: Array<{ hex?: string }>;
    };
    const colors = data.colors
        ?.map(color => color.hex?.replace('#', ''))
        .filter((hex): hex is string => Boolean(hex))
        .map(hex => parseInt(hex, 16));

    if (!colors || colors.length < 5) {
        throw new Error('Palette service did not return enough colors');
    }

    return {
        name: 'Color Pizza Harmony',
        colors: [colors[0], colors[1], colors[2], colors[3], colors[4]]
    };
}

async function buildRandomBeyStats(baseStats: BeybladeStats): Promise<BeybladeStats> {
    const nextStats = JSON.parse(JSON.stringify(baseStats)) as BeybladeStats;
    let palette = CURATED_PALETTES[Math.floor(Math.random() * CURATED_PALETTES.length)];

    try {
        palette = await fetchProfessionalPalette();
    } catch (error) {
        console.info('Using curated palette fallback:', error);
    }

    applyPaletteToStats(nextStats, palette);
    nextStats.atk = Math.round(randomFromRange(8, 14));
    nextStats.def = Math.round(randomFromRange(4, 9));
    nextStats.sta = Number(randomFromRange(0.8, 1.6).toFixed(1));
    nextStats.spd = Math.round(randomFromRange(52, 76));
    nextStats.wt = Number(randomFromRange(0.85, 1.35).toFixed(2));
    nextStats.crtAtk = Math.round(nextStats.atk * randomFromRange(2.0, 2.7));
    nextStats.beyScale = Number(randomFromRange(0.94, 1.08).toFixed(2));
    nextStats.ringRadiusFactor = Number(randomFromRange(0.68, 0.86).toFixed(2));
    nextStats.ringSides = [24, 32, 40, 48, 64][Math.floor(Math.random() * 5)];
    nextStats.boltSides = [5, 6, 8][Math.floor(Math.random() * 3)];
    nextStats.spinTrackSize = Number(randomFromRange(0.85, 1.18).toFixed(2));
    nextStats.tipSize = Number(randomFromRange(0.85, 1.15).toFixed(2));
    enforceBeyColorContrast(nextStats);

    return nextStats;
}

const PLAYER_STATS: BeybladeStats = {
    maxRpm: 1000,
    atk: 10,
    def: 5,
    wt: 1.0,
    sta: 1,
    spd: 60,
    spl: 0,
    crtAtk: 20, // 2x Atk explicitly
    frictionAir: 0.02, // FRICTION_LOW
    restitution: 0.1,
    friction: 0.2,
    densityBase: 0.05,
    radius: 30, // Standard size
    height: 10,
    // Visuals (Blue Theme from Pool)
    beyScale: 1.0,
    wheelColor: 0x888888,
    ringColor: 0x0088ff, // Blue
    ringSides: 32,
    ringRadiusFactor: 0.75,
    boltColor: 0x00ccff, // Cyan
    boltSides: 6,
    spinTrackColor: 0x777777,
    spinTrackSize: 1.0,
    tipColor: 0x888888,
    tipSize: 1.0,
    trailColor: 0x00ccff,
    // Arena Forces
    dishForce: 2, // DISH_LOW
    curlForce: 1, // CURL_LOW
    dragFactor: 0.000
};

const ENEMY_STATS: BeybladeStats = {
    maxRpm: 1000,
    atk: 10,
    def: 5,
    wt: 1.0,
    sta: 1,
    spd: 60,
    spl: 0,
    crtAtk: 20, // 2x Atk
    crt: 0.2, // Pool branch crit chance
    frictionAir: 0.02, // FRICTION_LOW
    restitution: 0.1,
    friction: 0.2,
    densityBase: 0.05,
    radius: 30, // Standard size
    height: 10,
    // Visuals (Orange Theme from Pool)
    beyScale: 1.0,
    wheelColor: 0x888888,
    ringColor: 0xff6600, // Orange
    ringSides: 32,
    ringRadiusFactor: 0.75,
    boltColor: 0xffaa00, // Gold
    boltSides: 6,
    spinTrackColor: 0x777777,
    spinTrackSize: 1.0,
    tipColor: 0x888888,
    tipSize: 1.0,
    trailColor: 0xffaa00,
    // Arena Forces
    dishForce: 2, // DISH_LOW
    curlForce: 1, // CURL_LOW
    dragFactor: 0.000
};

// Defaults for Reset
const DEFAULT_PLAYER_STATS = JSON.parse(JSON.stringify(PLAYER_STATS));
const DEFAULT_ENEMY_STATS = JSON.parse(JSON.stringify(ENEMY_STATS));

function syncTrailWithBolt(stats: BeybladeStats) {
    stats.trailColor = stats.boltColor;
}

function savePresets() {
    syncTrailWithBolt(PLAYER_STATS);
    syncTrailWithBolt(ENEMY_STATS);
    enforceBeyColorContrast(PLAYER_STATS);
    enforceBeyColorContrast(ENEMY_STATS);
    localStorage.setItem('bblade_player_stats', JSON.stringify(PLAYER_STATS));
    localStorage.setItem('bblade_enemy_stats', JSON.stringify(ENEMY_STATS));
}

function loadPresets() {
    const pData = localStorage.getItem('bblade_player_stats');
    if (pData) {
        // Merge with default to ensure new fields are present
        const parsed = JSON.parse(pData);
        Object.assign(PLAYER_STATS, { ...DEFAULT_PLAYER_STATS, ...parsed });
        if (!parsed.trailColor || parsed.trailColor === 0x00ffff) syncTrailWithBolt(PLAYER_STATS);
        enforceBeyColorContrast(PLAYER_STATS);
    }
    const eData = localStorage.getItem('bblade_enemy_stats');
    if (eData) {
        const parsed = JSON.parse(eData);
        Object.assign(ENEMY_STATS, { ...DEFAULT_ENEMY_STATS, ...parsed });
        if (!parsed.trailColor || parsed.trailColor === 0x00ffff) syncTrailWithBolt(ENEMY_STATS);
        enforceBeyColorContrast(ENEMY_STATS);
    }
}

// Load Immediately
loadPresets();

const VISUAL_FIELDS = [
    { key: 'beyScale', label: 'SCALE', hint: 'Size', type: 'number', step: 0.1 },
    { key: 'wheelColor', label: 'WHEEL', hint: 'Hex', type: 'color' },
    { key: 'ringColor', label: 'RING', hint: 'Hex', type: 'color' },
    { key: 'ringRadiusFactor', label: 'RING RADIUS', hint: 'Size factor', type: 'number', step: 0.05 },
    { key: 'ringSides', label: 'RING SIDES', hint: 'Shape sides', type: 'number', step: 1 },
    { key: 'boltColor', label: 'BOLT', hint: 'Hex', type: 'color' },
    { key: 'boltSides', label: 'BOLT SIDES', hint: 'Hex/Circle', type: 'number', step: 1 },
    { key: 'spinTrackColor', label: 'TRACK', hint: 'Hex', type: 'color' },
    { key: 'spinTrackSize', label: 'ST SIZE', hint: 'Track depth', type: 'number', step: 0.1 },
    { key: 'tipColor', label: 'TIP', hint: 'Hex', type: 'color' },
    { key: 'tipSize', label: 'TIP SIZE', hint: 'Radius', type: 'number', step: 0.1 },
];

const COMBAT_FIELDS = [
    { key: 'atk', label: 'ATTACK', hint: 'Damage', type: 'number', step: 1 },
    { key: 'def', label: 'DEFENSE', hint: 'Resistance', type: 'number', step: 1 },
    { key: 'sta', label: 'STAMINA', hint: 'Endurance', type: 'number', step: 1 },
    { key: 'spd', label: 'SPEED', hint: 'Velocity', type: 'number', step: 1 },
    { key: 'wt', label: 'WEIGHT', hint: 'Mass', type: 'number', step: 0.1 },
    { key: 'crtAtk', label: 'CRIT ATK', hint: 'Crit Dmg', type: 'number', step: 1 },
];

function createBeyblade(x: number, y: number, stats: BeybladeStats): GameEntity {
    const density = stats.densityBase * stats.wt;

    const body = Bodies.circle(x, y, BEYBLADE_RADIUS, {
        restitution: stats.restitution,
        friction: stats.friction,
        frictionAir: stats.frictionAir,
        density: density,
        label: 'Beyblade'
    });

    // Visuals
    const { mesh, tiltGroup, spinGroup } = createBeybladeMesh(stats);
    scene.add(mesh); // Add to scene

    // Trail
    const trail = new TrailSystem(stats.trailColor, scene);

    // Initial Spawn
    Composite.add(engine.world, body);

    const entity: GameEntity = {
        body,
        mesh,
        tiltGroup,
        spinGroup,
        trail,
        stats,
        currentRpm: 0
    };
    entities.push(entity);

    return entity;
}

// Create Player and Enemy
const player = createBeyblade(0, 100, PLAYER_STATS);
const enemy = createBeyblade(0, -100, ENEMY_STATS);

// Initial Guide Update
updateGuide(currentLaunchAngle.value);

// Trigger once logic moved to setup


// --- Interaction State ---
let isDragging = false;
let hasLaunched = false;
let gameOver = false;

// Stats snapshots at match start (for "Keep Power-Ups" reset)
let matchStartPlayerStats: BeybladeStats | null = null;
let matchStartEnemyStats: BeybladeStats | null = null;

// Drag line visual (Three.js Line)
const dragLineGeometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, 0)]);
const dragLineMaterial = new THREE.LineBasicMaterial({ color: 0xffffff });
const dragLine = new THREE.Line(dragLineGeometry, dragLineMaterial);
dragLine.frustumCulled = false;
dragLine.visible = false;
scene.add(dragLine);

// --- UI Overlay (HTML - Keep mostly same) ---
const uiContainer = document.createElement('div');
uiContainer.style.position = 'absolute';
uiContainer.style.top = '0';
uiContainer.style.left = '0';
uiContainer.style.width = '100%';
uiContainer.style.height = '100%';
uiContainer.style.pointerEvents = 'none'; // Let clicks pass through to canvas
uiContainer.style.zIndex = '10';
document.body.appendChild(uiContainer);

// Consolidated Top Bar HUD
const hudTopBar = document.createElement('div');
hudTopBar.id = 'hud-top-bar';
hudTopBar.innerHTML = `
    <div class="hud-group">
        <button class="rpm-label" id="p1-btn" title="Customize player">P1</button>
        <div class="rpm-meter-wrap">
            <meter id="player-meter" min="0" max="1000" low="200" high="800" optimum="1000" value="0" aria-label="P1 RPM"></meter>
            <span id="player-rpm" class="rpm-text">0</span>
        </div>
    </div>
    <div class="hud-divider">VS</div>
    <div class="hud-group">
        <div class="rpm-meter-wrap">
            <meter id="enemy-meter" min="0" max="1000" low="200" high="800" optimum="1000" value="0" aria-label="CPU RPM" style="transform: scaleX(-1);"></meter>
            <span id="enemy-rpm" class="rpm-text">0</span>
        </div>
        <button class="rpm-label" id="cpu-btn" title="Customize CPU">CPU</button>
    </div>
`;
uiContainer.appendChild(hudTopBar);

// Floating Action HUD (Pool + Reset buttons)
const actionHud = document.createElement('div');
actionHud.id = 'action-hud';
actionHud.className = 'action-hud';

const resetHint = document.createElement('button');
resetHint.className = 'action-hud-btn';
resetHint.innerText = 'RESET';
resetHint.onclick = () => resetMatch();
resetHint.style.display = 'none';
actionHud.appendChild(resetHint);

uiContainer.appendChild(actionHud);




// --- Cycle Button ---
const cycleBtnContainer = document.createElement('div');
cycleBtnContainer.className = 'cycle-container';
cycleBtnContainer.style.display = 'none'; // Hidden initially
uiContainer.appendChild(cycleBtnContainer);

function updatePhysicsFromPattern() {
    if (!player || !player.body || !player.stats) return;

    // Standard Pattern Logic
    const p = PATTERNS[currentPatternIndex];
    player.stats.dishForce = p.dish;
    player.stats.curlForce = p.curl;
    player.body.frictionAir = p.drag;
    player.stats.frictionAir = p.drag;
}

function updateCpuPhysicsFromPattern() {
    if (!enemy || !enemy.body || !enemy.stats) return;

    const p = PATTERNS[cpuPatternIndex];
    enemy.stats.dishForce = p.dish;
    enemy.stats.curlForce = p.curl;
    enemy.body.frictionAir = p.drag;
    enemy.stats.frictionAir = p.drag;
}

function scheduleNextCpuDiveSwitch(now: number) {
    cpuNextDiveSwitchAt = now + randomFromRange(0.85, 2.2);
}

function setCpuPattern(pattern: number) {
    cpuPatternIndex = pattern;
    updateCpuPhysicsFromPattern();
}

function updateCpuDive(now: number) {
    if (!hasLaunched || gameOver) return;
    if (now < cpuNextDiveSwitchAt) return;

    const playerIsDiving = currentPatternIndex === 1;
    const diveChance = playerIsDiving ? 0.62 : 0.38;
    setCpuPattern(Math.random() < diveChance ? 1 : 0);
    scheduleNextCpuDiveSwitch(now);
}

// Dive Logic
const setPattern = (e: Event | null, pattern: number) => {
    if (e) e.preventDefault(); // Prevent ghost clicks
    currentPatternIndex = pattern;
    if (pattern === 1) cycleBtn.classList.add('active');
    else cycleBtn.classList.remove('active');
    updatePhysicsFromPattern();
};

// Input for Dive Mode (Space)
window.addEventListener('keydown', (e) => {
    if (e.code === 'Space' && currentPatternIndex !== 1) {
        setPattern(null, 1);
    }
});

window.addEventListener('keyup', (e) => {
    if (e.code === 'Space') {
        setPattern(null, 0);
    }
});

const cycleBtn = document.createElement('button');
cycleBtn.className = 'pattern-btn';
currentPatternIndex = 0;
cycleBtn.innerHTML = `
    <span class="value">Dive</span>
`;

// Event Listeners for Button
cycleBtn.addEventListener('mousedown', (e) => { setPattern(e, 1) });
cycleBtn.addEventListener('pointerdown', (e) => { setPattern(e, 1) }, { passive: false });

cycleBtn.addEventListener('pointerup', (e) => { setPattern(e, 0) });
cycleBtn.addEventListener('pointerleave', (e) => { setPattern(e, 0) });


cycleBtnContainer.appendChild(cycleBtn);

// Init Physics
updatePhysicsFromPattern();
updateCpuPhysicsFromPattern();

const playerRpmEl = document.getElementById('player-rpm')!;
const enemyRpmEl = document.getElementById('enemy-rpm')!;
const playerMeterEl = document.getElementById('player-meter') as HTMLMeterElement;
const enemyMeterEl = document.getElementById('enemy-meter') as HTMLMeterElement;




// --- Spark System ---
const Events = Matter.Events;

interface Spark {
    mesh: THREE.Mesh;
    velocity: THREE.Vector3;
    life: number;
}
const sparks: Spark[] = [];
const sparkGeo = new THREE.BoxGeometry(3, 3, 3); // Bigger sparks

function createSpark(x: number, y: number, color: number, speedVal: number) {
    const material = new THREE.MeshBasicMaterial({
        color: color,
        transparent: true
    });
    const mesh = new THREE.Mesh(sparkGeo, material);

    mesh.position.set(x, getArenaHeight(x, y) + 5, y);

    scene.add(mesh);

    const angle = Math.random() * Math.PI * 2;

    const velocity = new THREE.Vector3(
        Math.cos(angle) * speedVal,
        Math.random() * speedVal, // jump up
        Math.sin(angle) * speedVal
    );

    sparks.push({ mesh, velocity, life: 1.0 });
}

// --- Audio System ---
const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();

// Create a noise buffer once
const bufferSize = audioCtx.sampleRate * 0.1; // 0.1 seconds
const noiseBuffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
const data = noiseBuffer.getChannelData(0);
for (let i = 0; i < bufferSize; i++) {
    data[i] = Math.random() * 2 - 1;
}

function createReverbImpulse(seconds: number, decay: number) {
    const length = Math.floor(audioCtx.sampleRate * seconds);
    const impulse = audioCtx.createBuffer(2, length, audioCtx.sampleRate);

    for (let channel = 0; channel < impulse.numberOfChannels; channel++) {
        const channelData = impulse.getChannelData(channel);
        for (let i = 0; i < length; i++) {
            const progress = i / length;
            channelData[i] = (Math.random() * 2 - 1) * Math.pow(1 - progress, decay);
        }
    }

    return impulse;
}

const criticalReverbImpulse = createReverbImpulse(1.45, 2.4);

function getCollisionWorldPoint(pair: Matter.Pair) {
    const supports = pair.collision.supports;
    if (!supports.length) return undefined;

    const point = supports.reduce(
        (acc, support) => {
            acc.x += support.x;
            acc.y += support.y;
            return acc;
        },
        { x: 0, y: 0 }
    );
    const x = point.x / supports.length;
    const z = point.y / supports.length;

    return new THREE.Vector3(x, getArenaHeight(x, z) + 18, z);
}

function updateCriticalFlashOrigin() {
    const worldPoint = criticalFlashState.worldPoint;
    if (worldPoint) {
        const projected = worldPoint.clone().project(camera);
        if (Number.isFinite(projected.x) && Number.isFinite(projected.y)) {
            criticalFlashUniforms.uOrigin.value.set(
                THREE.MathUtils.clamp((projected.x + 1) * 0.5, 0, 1),
                THREE.MathUtils.clamp((projected.y + 1) * 0.5, 0, 1)
            );
        }
    } else {
        criticalFlashUniforms.uOrigin.value.set(0.5, 0.5);
    }
}

function triggerCriticalFeedback(worldPoint?: THREE.Vector3) {
    criticalFlashState.worldPoint = worldPoint?.clone();
    camera.updateMatrixWorld(true);
    updateCriticalFlashOrigin();
    criticalFlashState.startedAt = clock.getElapsedTime();
    criticalFlashUniforms.uIntensity.value = 1.22;
    criticalFlashPlane.visible = true;
}

function updateCriticalFlash() {
    if (!criticalFlashPlane.visible) return;

    updateCriticalFlashOrigin();
    const elapsed = clock.getElapsedTime() - criticalFlashState.startedAt;
    if (elapsed < 0.018) {
        criticalFlashUniforms.uIntensity.value = 1.22;
        return;
    }

    const progress = THREE.MathUtils.clamp((elapsed - 0.018) / criticalFlashState.duration, 0, 1);
    const fade = Math.pow(1 - progress, 3.2);
    criticalFlashUniforms.uIntensity.value = fade * 1.22;
    criticalFlashPlane.visible = fade > 0.01;
}

function playCollisionSound(intensity: number, baseFrequency: number, isCritical = false) {
    if (audioCtx.state === 'suspended') {
        audioCtx.resume();
    }

    const t = audioCtx.currentTime;
    const masterGain = audioCtx.createGain();
    masterGain.connect(audioCtx.destination);
    masterGain.gain.setValueAtTime(intensity, t);

    if (isCritical) {
        const convolver = audioCtx.createConvolver();
        const reverbTone = audioCtx.createBiquadFilter();
        const reverbGain = audioCtx.createGain();
        const slapDelay = audioCtx.createDelay(0.25);
        const feedback = audioCtx.createGain();
        const wetGain = audioCtx.createGain();
        const tone = audioCtx.createBiquadFilter();

        convolver.buffer = criticalReverbImpulse;
        reverbTone.type = 'lowpass';
        reverbTone.frequency.setValueAtTime(3600, t);
        reverbGain.gain.setValueAtTime(0.72, t);

        slapDelay.delayTime.setValueAtTime(0.088, t);
        feedback.gain.setValueAtTime(0.62, t);
        wetGain.gain.setValueAtTime(0.64, t);
        tone.type = 'lowpass';
        tone.frequency.setValueAtTime(3400, t);

        masterGain.connect(convolver);
        convolver.connect(reverbTone);
        reverbTone.connect(reverbGain);
        reverbGain.connect(audioCtx.destination);
        masterGain.connect(slapDelay);
        slapDelay.connect(feedback);
        feedback.connect(slapDelay);
        slapDelay.connect(tone);
        tone.connect(wetGain);
        wetGain.connect(audioCtx.destination);
    }

    // 1. Impact "Thud"
    const noise = audioCtx.createBufferSource();
    noise.buffer = noiseBuffer;
    const noiseFilter = audioCtx.createBiquadFilter();
    noiseFilter.type = 'highpass';
    noiseFilter.frequency.value = isCritical ? 900 : 100;
    const noiseGain = audioCtx.createGain();

    noise.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(masterGain);

    noiseGain.gain.setValueAtTime(isCritical ? 0.95 : 0.7, t);
    noiseGain.gain.exponentialRampToValueAtTime(0.025, t + (isCritical ? 0.045 : 0.1));
    noise.start(t);
    noise.stop(t + (isCritical ? 0.055 : 0.1));

    // 2. Heavy Metal Clang
    const scale = isCritical ? [1, 1.25, 1.5, 2] : [1, 3 / 2, 5 / 4, 7 / 4, 2];
    const pick = Math.floor(Math.random() * scale.length);
    const baseFreq = baseFrequency * scale[pick];
    const ratios = isCritical ? [1, 2.15, 3.05, 4.6] : [1, 1.5, 2.0, 2.5];

    ratios.forEach((ratio, index) => {
        const osc = audioCtx.createOscillator();
        const oscGain = audioCtx.createGain();

        osc.type = isCritical ? 'square' : index % 2 == 0 ? 'square' : 'triangle';
        osc.frequency.setValueAtTime(baseFreq * ratio, t);

        osc.connect(oscGain);
        oscGain.connect(masterGain);

        oscGain.gain.setValueAtTime(0.0, t);
        oscGain.gain.linearRampToValueAtTime((isCritical ? 0.42 : 0.6) / (index + 0.8), t + 0.002);

        const decayDuration = isCritical
            ? 0.065 + (Math.random() * 0.035) + (1.0 / (index + 1)) * 0.055
            : 0.3 + (Math.random() * 0.2) + (1.0 / (index + 1)) * 0.5;
        oscGain.gain.exponentialRampToValueAtTime(0.001, t + decayDuration);

        osc.start(t);
        osc.stop(t + decayDuration + 0.1);
    });
}

Events.on(engine, 'collisionStart', (event) => {
    event.pairs.forEach((pair) => {
        const entityA = entities.find(e => e.body === pair.bodyA);
        const entityB = entities.find(e => e.body === pair.bodyB);

        // Stats-Based Combat
        if (entityA && entityB && entityA.stats && entityB.stats) {

            // A hits B
            const speedA = entityA.body.speed;
            const isCritA = speedA > CRIT_SPEED_THRESHOLD;
            const rawDmgA = isCritA ? entityA.stats.crtAtk : entityA.stats.atk;
            const finalDmgA = Math.max(0, rawDmgA - entityB.stats.def);

            if (entityB.currentRpm !== undefined) {
                entityB.currentRpm = Math.max(0, entityB.currentRpm - finalDmgA);
            }

            // B hits A
            const speedB = entityB.body.speed;
            const isCritB = speedB > CRIT_SPEED_THRESHOLD;
            const rawDmgB = isCritB ? entityB.stats.crtAtk : entityB.stats.atk;
            const finalDmgB = Math.max(0, rawDmgB - entityA.stats.def);

            if (entityA.currentRpm !== undefined) {
                entityA.currentRpm = Math.max(0, entityA.currentRpm - finalDmgB);
            }


            // Sparks & Sound
            const isHighSpeed = isCritA || isCritB;

            const count = isHighSpeed ? 24 : 3;
            const speed = isHighSpeed ? 9 : 2;
            const criticalFlashPoint = getCollisionWorldPoint(pair);

            if (pair.collision.supports.length > 0) {
                const { x, y } = pair.collision.supports[0];
                for (let i = 0; i < count; i++) {
                    if (isCritA)
                        createSpark(x, y, entityA.stats.trailColor, speed);
                    if (isCritB)
                        createSpark(x, y, entityB.stats.trailColor, speed);
                    if (!isCritA && !isCritB)
                        createSpark(x, y, 0xaaaaaa, speed);
                }
                if (isHighSpeed) {
                    for (let i = 0; i < 10; i++) {
                        createSpark(x, y, 0xffffff, speed + 3);
                    }
                }
            }
            if (isHighSpeed) {
                triggerCriticalFeedback(criticalFlashPoint);
                playCollisionSound(0.34, 675, true);
            } else {
                playCollisionSound(0.2, 200); // Normal Pitch
            }
        } else {
            // Fallback / Wall hits
            // If one is a Beyblade and the other is not (Environment), apply Barrier Damage
            if (entityA && !entityB) {
                // A hit a wall
                if (entityA.currentRpm !== undefined) {
                    entityA.currentRpm = Math.max(0, entityA.currentRpm - BARRIER_DAMAGE);
                }
            } else if (entityB && !entityA) {
                // B hit a wall
                if (entityB.currentRpm !== undefined) {
                    entityB.currentRpm = Math.max(0, entityB.currentRpm - BARRIER_DAMAGE);
                }
            }

            if (pair.collision.supports.length > 0) {
                const { x, y } = pair.collision.supports[0];
                for (let i = 0; i < 5; i++) {
                    createSpark(x, y, 0xaaaaaa, 2);
                }
            }
            playCollisionSound(0.5, 100 * 1.67);
        }

    });
});


// --- Game Loop ---
const SUBSTEPS = 8;
let frameCounter = 0;


function animate() {
    requestAnimationFrame(animate);

    // Physics Update
    const speedMultiplier = GAME_SPEEDS[currentGameSpeed].multiplier;
    const subStepDelta = ((1000 / 60) * speedMultiplier) / SUBSTEPS;
    updateCpuDive(clock.getElapsedTime());
    for (let i = 0; i < SUBSTEPS; i++) {
        Engine.update(engine, subStepDelta);

        if (hasLaunched) {
            entities.forEach(entity => {
                if (entity.isDead) return; // Skip physics forces for dead entities

                // Beyblade-Specific Forces (Dish + Curl)
                if (entity.stats) {
                    const px = entity.body.position.x;
                    const py = entity.body.position.y;
                    const dist = Math.sqrt(px * px + py * py);

                    // --- Speed Threshold Visuals (Ground Sparks) ---
                    const speed = entity.body.speed;
                    if (speed > CRIT_SPEED_THRESHOLD) {
                        // Throttled spawn (random chance per frame)
                        if (Math.random() < 0.3) {
                            // Spark at contact point (approximate ground contact)
                            // We can use current position, maybe slightly offset opposite to velocity
                            createSpark(px, py, entity.stats.trailColor, 2);
                        }
                    }

                    // Normalized radial direction (toward center)
                    const safeDist = Math.max(dist, 1);
                    const radialX = -px / safeDist;
                    const radialY = -py / safeDist;


                    // Tangent direction (perpendicular, clockwise)
                    // Rotate radial 90° clockwise: (x, y) -> (y, -x)
                    const tangentX = radialY;
                    const tangentY = -radialX;

                    if (entity.currentRpm === undefined) return;
                    // const life = entity.currentRpm / entity.stats.maxRpm;
                    // Calculate force magnitudes
                    const dishMagnitude = FORCE_CONSTANT * entity.body.mass * safeDist * entity.stats.dishForce;
                    const curlMagnitude = FORCE_CONSTANT * entity.body.mass * (1 - safeDist / ARENA_RADIUS) * entity.stats.curlForce;

                    // Apply combined force
                    Body.applyForce(entity.body, entity.body.position, {
                        x: radialX * dishMagnitude + tangentX * curlMagnitude,
                        y: radialY * dishMagnitude + tangentY * curlMagnitude
                    });

                    const isDiving = (entity === player && currentPatternIndex === 1) || (entity === enemy && cpuPatternIndex === 1);
                    if (isDiving && speed > 0.1) {
                        Body.applyForce(entity.body, entity.body.position, {
                            x: (entity.body.velocity.x / speed) * DIVE_BOOST_FORCE * entity.body.mass,
                            y: (entity.body.velocity.y / speed) * DIVE_BOOST_FORCE * entity.body.mass
                        });
                    }
                }
            });
        }
    }

    // Update Visuals
    entities.forEach(entity => {

        // --- Death Logic Check ---

        if (!entity.isDead && entity.currentRpm !== undefined && hasLaunched) {
            const pos = entity.mesh.position;
            // Ring Out Check
            const dist = Math.sqrt(pos.x * pos.x + pos.z * pos.z);
            const RING_OUT_RADIUS = 350; // Arena is 300

            if (entity.currentRpm <= 0 || dist > RING_OUT_RADIUS) {
                // Trigger Death
                entity.isDead = true;
                entity.currentRpm = 0;

                // Capture last velocity before removing body
                const vx = entity.body.velocity.x;
                const vz = entity.body.velocity.y; // Matter Y is Three Z

                // Calculate Vertical Velocity based on Slope (Tangent)
                // H = k * r^2
                // k = MAX_H / R^2
                // vy = dH/dt = dH/dx * vx + dH/dz * vz
                const k = BOWL_MAX_HEIGHT / (ARENA_RADIUS * ARENA_RADIUS);
                const vy = (2 * k * pos.x * vx) + (2 * k * pos.z * vz);

                const speed = Math.sqrt(vx * vx + vz * vz);

                let driftV = new THREE.Vector3(vx, vy, vz);

                if (speed < 0.5) {
                    // If it died standing still (Stamina 0), give it a gentle float
                    driftV = new THREE.Vector3(
                        (Math.random() - 0.5) * 0.5,
                        0.5, // Slow float up
                        (Math.random() - 0.5) * 0.5
                    );
                } else {
                    // Conserve momentum.
                    // Scale slightly to make the "breakaway" feel impactful
                    driftV.multiplyScalar(1.2);
                    driftV.y += 0.5; // Slight lift to simulate "loss of gravity/grip"
                }

                // Ensure it flies UP (Positive Y)
                if (driftV.y < 0) {
                    driftV.y = -driftV.y;
                }
                // Minimum lift to clear the floor
                driftV.y = Math.max(driftV.y, 0.5);

                entity.driftVelocity = driftV;

                entity.driftRotation = new THREE.Vector3(
                    Math.random() * 0.2 - 0.1,
                    Math.random() * 0.2 - 0.1,
                    Math.random() * 0.2 - 0.1
                );

                // Remove from Physics World
                Composite.remove(engine.world, entity.body);

                // Win Condition Check
                if (!gameOver) {
                    gameOver = true;
                    if (entity === player) {
                        showWinner('CPU WINS');
                    } else if (entity === enemy) {
                        showWinner('P1 WINS');
                    }
                }
            }
        }

        // --- Visual Update ---
        if (entity.isDead) {
            // Asteroid Mode
            if (entity.driftVelocity && entity.driftRotation) {
                entity.mesh.position.add(entity.driftVelocity);
                entity.mesh.rotation.x += entity.driftRotation.x;
                entity.mesh.rotation.y += entity.driftRotation.y;
                entity.mesh.rotation.z += entity.driftRotation.z;

                // Slight fade? Or just fly away.
            }
            return; // Skip normal sync
        }

        // Sync position: Matter (x, y) -> Three (x, z).
        const x = entity.body.position.x;
        const z = entity.body.position.y;

        // Get height from bowl shape
        const y = getArenaHeight(x, z) + 10;
        entity.mesh.position.set(x, y, z);

        // Align to surface normal
        const normal = getArenaNormal(x, z);
        const up = new THREE.Vector3(0, 1, 0);
        const quaternion = new THREE.Quaternion().setFromUnitVectors(up, normal);
        entity.mesh.quaternion.copy(quaternion); // Set base orientation to surface

        // Spin
        entity.spinGroup.rotation.y = -entity.body.angle;

        // Additional Tilt logic (Wobble based on velocity)
        const vel = entity.body.velocity;
        const speed = Math.sqrt(vel.x * vel.x + vel.y * vel.y);
        const maxTilt = 0.5;
        const tiltAmount = Math.min((speed / 20) * maxTilt, maxTilt);

        // Tilt direction should be perpendicular to movement or just "wobbly"
        if (speed > 0.1) {
            const angle = Math.atan2(vel.y, vel.x);
            // Tilt axis is perpendicular to angle. Apply to tiltGroup.
            entity.tiltGroup.rotation.x = Math.sin(angle) * tiltAmount;
            entity.tiltGroup.rotation.z = -Math.cos(angle) * tiltAmount;
        }

        if (speed < 1.0) {
            entity.tiltGroup.rotation.x *= 0.95;
            entity.tiltGroup.rotation.z *= 0.95;
        }

        // Update Trail - Lift slightly above surface
        entity.trail.update(x, y + 2, z);

        // --- RPG Stats Logic ---
        if (entity.stats && entity.currentRpm !== undefined) {
            // Stamina Decay
            // Lose STA per second
            const decay = entity.stats.sta * (subStepDelta / 1000) * SUBSTEPS;
            if (entity.currentRpm > 0) {
                entity.currentRpm = Math.max(0, entity.currentRpm - decay);
            }

            // Force Physics to match RPM Health
            // RPM to Angular Velocity (rad/s) approx factor
            // 100 RPM ~= 1 rad/s (simplified for game feel)
            const targetAngularVelocity = entity.currentRpm / 100;

            // Direction varies? For now assume positive/counter-clockwise.
            // If it was spinning, keep sign. If 0, no spin.
            const sign = Math.sign(entity.body.angularVelocity) || 1;

            Body.setAngularVelocity(entity.body, targetAngularVelocity * sign);
        }
    });

    // Update Sparks
    for (let i = sparks.length - 1; i >= 0; i--) {
        const spark = sparks[i];
        spark.mesh.position.add(spark.velocity);
        spark.velocity.y -= 0.1; // Gravity

        // Bowl bounce check
        const groundHeight = getArenaHeight(spark.mesh.position.x, spark.mesh.position.z);
        if (spark.mesh.position.y < groundHeight) {
            spark.velocity.y *= -0.5;
            spark.mesh.position.y = groundHeight;
            spark.velocity.x *= 0.8;
            spark.velocity.z *= 0.8;
        }

        spark.life -= 0.02;
        (spark.mesh.material as THREE.MeshBasicMaterial).opacity = spark.life;

        if (spark.life <= 0) {
            scene.remove(spark.mesh);
            sparks.splice(i, 1);
        }
    }

    // Update Drag Line
    if (isDragging) {
        // Sync Start point with player position (in case player moves while dragging)
        const positions = dragLine.geometry.attributes.position.array as Float32Array;
        positions[0] = player.body.position.x;
        positions[1] = getArenaHeight(player.body.position.x, player.body.position.y) + 5;
        positions[2] = player.body.position.y;
        dragLine.geometry.attributes.position.needsUpdate = true;
    }

    // UI Updates
    frameCounter++;
    if (frameCounter % 10 === 0) {
        // Use Stats RPM as source of truth, fallback to physics if undefined (e.g. pre-launch)
        // If dead, force 0.
        const playerRpm = player.isDead ? 0 : Math.round(player.currentRpm || 0);
        const enemyRpm = enemy.isDead ? 0 : Math.round(enemy.currentRpm || 0);

        if (playerRpmEl && playerRpmEl.innerText !== playerRpm.toString()) {
            playerRpmEl.innerText = playerRpm.toString();
        }
        if (enemyRpmEl && enemyRpmEl.innerText !== enemyRpm.toString()) {
            enemyRpmEl.innerText = enemyRpm.toString();
        }

        if (playerMeterEl && playerMeterEl.value !== playerRpm) {
            playerMeterEl.value = playerRpm;
        }
        if (enemyMeterEl && enemyMeterEl.value !== enemyRpm) {
            enemyMeterEl.value = enemyRpm;
        }
        playerMeterEl.title = `P1 RPM ${playerRpm}`;
        enemyMeterEl.title = `CPU RPM ${enemyRpm}`;

    }

    // Update controls
    controls.update();
    syncCriticalFlashPlaneToCamera();

    if (!hasLaunched) {
        const angle = currentLaunchAngle.value;
        updateGuide(angle);
        guideMesh.visible = true;
        arrowMat.uniforms.uTime.value = clock.getElapsedTime();
    } else {
        guideMesh.visible = false;
        launchContainer.style.display = 'none';
    }

    updateCriticalFlash();
    renderer.render(scene, camera);


}
// --- Visual Forge Helpers ---

function createInput(id: string, label: string, value: any, hint: string, type: string, step: number | string, onChange: (val: any) => void) {
    const div = document.createElement('div');
    div.className = 'stat-item';
    div.title = `${label}: ${hint}`;

    // Handle color values (hex num to #hex str)
    let displayValue = value;
    if (type === 'color') {
        const safeVal = value ?? 0; // Fallback to black if undefined
        displayValue = '#' + safeVal.toString(16).padStart(6, '0');
    }

    div.innerHTML = `
        <label class="stat-label" for="${id}">${label}</label>
        <input class="stat-input" type="${type}" ${type === 'number' ? `step="${step}"` : ''} id="${id}" value="${displayValue}" aria-label="${label}" title="${label}">
        <span class="stat-hint">${hint}</span>
    `;

    const input = div.querySelector('input')!;
    input.addEventListener('input', (e) => {
        let val: any = (e.target as HTMLInputElement).value;
        if (type === 'number') val = parseFloat(val);
        if (type === 'color') val = parseInt(val.replace('#', ''), 16);
        onChange(val);
    });

    return div;
}

// Preview Scene Helper
// WebGL Renderer Pool (max 3 contexts to prevent exhaustion)
const rendererPool: THREE.WebGLRenderer[] = [];
const MAX_RENDERERS = 3;
let totalCreatedRenderers = 0;

function getOrCreateRenderer(): THREE.WebGLRenderer {
    // Try to reuse an existing renderer
    if (rendererPool.length > 0) {
        return rendererPool.pop()!;
    }

    // Create new renderer if under limit
    if (totalCreatedRenderers < MAX_RENDERERS) {
        const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        renderer.setPixelRatio(window.devicePixelRatio);
        totalCreatedRenderers++;
        // console.log(`Created new renderer. Total: ${totalCreatedRenderers}`);
        return renderer;
    }

    // Fallback: create without adding to pool (shouldn't happen)
    console.warn('Renderer pool exhausted, creating temporary renderer');
    return new THREE.WebGLRenderer({ antialias: true, alpha: true });
}

function returnRenderer(renderer: THREE.WebGLRenderer) {
    // Clear the renderer's DOM parent
    if (renderer.domElement.parentNode) {
        renderer.domElement.parentNode.removeChild(renderer.domElement);
    }

    // Return to pool if under limit
    if (rendererPool.length < MAX_RENDERERS) {
        rendererPool.push(renderer);
    } else {
        // Dispose if pool is full
        renderer.dispose();
    }
}

let previewRenderer: THREE.WebGLRenderer | null = null;
let previewScene: THREE.Scene | null = null;
let previewCamera: THREE.PerspectiveCamera | null = null;
let previewControls: OrbitControls | null = null;
let previewBeyblade: { mesh: THREE.Group, tiltGroup: THREE.Group, spinGroup: THREE.Group } | null = null;
let previewResizeObserver: ResizeObserver | null = null;

function updatePreview(stats: BeybladeStats) {
    if (!previewScene) return;
    if (previewBeyblade) {
        previewScene.remove(previewBeyblade.mesh);
    }
    previewBeyblade = createBeybladeMesh(stats);
    previewScene.add(previewBeyblade.mesh);
    fitPreviewCameraToBey();
}

function fitPreviewCameraToBey() {
    if (!previewCamera || !previewBeyblade) return;

    const box = new THREE.Box3().setFromObject(previewBeyblade.mesh);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const maxSize = Math.max(size.x, size.y, size.z, 1);
    const fitDistance = (maxSize / (2 * Math.tan(THREE.MathUtils.degToRad(previewCamera.fov) / 2))) * 1.45;

    previewCamera.position.set(center.x, center.y + maxSize * 0.62, center.z + fitDistance);
    previewCamera.near = Math.max(0.1, fitDistance / 100);
    previewCamera.far = fitDistance * 100;
    previewCamera.lookAt(center);
    previewCamera.updateProjectionMatrix();

    if (previewControls) {
        previewControls.target.copy(center);
        previewControls.update();
    }
}

// --- Stat Changer UI ---
function openStatEditor(targetStats: BeybladeStats, targetName: string) {
    try {
        // Create a working copy of stats so we don't apply immediately
        let tempStats = JSON.parse(JSON.stringify(targetStats)) as BeybladeStats;


        const dialog = document.createElement('dialog');
        dialog.className = 'stat-editor-dialog';

        const container = document.createElement('div');
        container.className = 'dialog-container';
        dialog.appendChild(container);

        const header = document.createElement('div');
        header.className = 'modal-header';
        header.innerHTML = `<span class="modal-title">Customise ${targetName}</span>`;

        const closeBtn = document.createElement('button');
        closeBtn.className = 'modal-close';
        closeBtn.setAttribute('aria-label', 'Close');
        closeBtn.innerHTML = `
            <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M6 6L18 18M18 6L6 18" />
            </svg>
        `;
        closeBtn.onclick = () => dialog.close();
        header.appendChild(closeBtn);
        container.appendChild(header);

        const layout = document.createElement('div');
        layout.className = 'customizer-layout';
        container.appendChild(layout);

        const previewColumn = document.createElement('div');
        previewColumn.className = 'preview-column';
        layout.appendChild(previewColumn);

        const previewContainer = document.createElement('div');
        previewContainer.className = 'preview-float';
        previewColumn.appendChild(previewContainer);

        const customizeBtn = document.createElement('button');
        customizeBtn.type = 'button';
        customizeBtn.className = 'preview-customize-btn';
        customizeBtn.title = 'Customize visual parameters';
        customizeBtn.setAttribute('aria-label', 'Customize visual parameters');
        customizeBtn.innerHTML = `
            <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M4 7h10M18 7h2M4 17h2M10 17h10" />
                <circle cx="16" cy="7" r="2" />
                <circle cx="8" cy="17" r="2" />
            </svg>
        `;
        previewContainer.appendChild(customizeBtn);

        const statMeterPanel = document.createElement('div');
        statMeterPanel.className = 'stat-meter-panel';
        previewColumn.appendChild(statMeterPanel);

        const randomizeBtn = document.createElement('button');
        randomizeBtn.className = 'icon-action-btn randomize-btn';
        randomizeBtn.type = 'button';
        randomizeBtn.title = 'Random build';
        randomizeBtn.setAttribute('aria-label', 'Random build');
        randomizeBtn.innerHTML = `
            <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M16 3h5v5M4 20l17-17M21 16v5h-5M15 15l6 6M4 4l5 5" />
            </svg>
            <span>Random</span>
        `;

        const detachedVisualControls = document.createElement('div');

        type TStatMeterConfig = {
            key: keyof BeybladeStats;
            label: string;
            max: number;
            format: (value: number) => string;
        };

        const STAT_METER_CONFIGS: TStatMeterConfig[] = [
            { key: 'atk', label: 'ATK', max: 14, format: (value) => Math.round(value).toString() },
            { key: 'def', label: 'DEF', max: 11, format: (value) => Math.round(value).toString() },
            { key: 'sta', label: 'STA', max: 2, format: (value) => value.toFixed(1) },
            { key: 'spd', label: 'SPD', max: 80, format: (value) => Math.round(value).toString() },
            { key: 'wt', label: 'WGT', max: 1.6, format: (value) => value.toFixed(2) },
            { key: 'crtAtk', label: 'CRT', max: 35, format: (value) => Math.round(value).toString() }
        ];

        STAT_METER_CONFIGS.forEach((field) => {
            const row = document.createElement('div');
            row.className = 'stat-meter-row';
            row.dataset.statKey = field.key;
            row.innerHTML = `
                <span class="stat-meter-label">${field.label}</span>
                <span class="stat-meter-track" role="meter" aria-label="${field.label}" aria-valuemin="0" aria-valuemax="${field.max}" aria-valuenow="0">
                    <span class="stat-meter-fill"></span>
                </span>
                <span class="stat-meter-value">0</span>
            `;
            statMeterPanel.appendChild(row);
        });

        function refreshStatMeters() {
            STAT_METER_CONFIGS.forEach((field) => {
                const row = statMeterPanel.querySelector<HTMLElement>(`[data-stat-key="${field.key}"]`);
                if (!row) return;
                const rawValue = Number((tempStats as any)[field.key] ?? 0);
                const meter = row.querySelector<HTMLElement>('.stat-meter-track');
                const fill = row.querySelector<HTMLElement>('.stat-meter-fill');
                const valueEl = row.querySelector<HTMLElement>('.stat-meter-value');
                const clampedValue = Math.min(rawValue, field.max);
                if (meter) meter.setAttribute('aria-valuenow', String(clampedValue));
                if (fill) fill.style.width = `${(clampedValue / field.max) * 100}%`;
                if (valueEl) valueEl.textContent = field.format(rawValue);
            });
        }

        function refreshEditorValues() {
            [...VISUAL_FIELDS, ...COMBAT_FIELDS].forEach(field => {
                const visualInput = detachedVisualControls.querySelector<HTMLInputElement>(`#v-${field.key}`);
                if (visualInput) {
                    const value = (tempStats as any)[field.key];
                    visualInput.value = field.type === 'color' ? `#${numberToHex(value ?? 0)}` : String(value);
                }
            });
            refreshStatMeters();
        }

        refreshStatMeters();

        randomizeBtn.onclick = async () => {
            randomizeBtn.title = 'Fetching palette';
            randomizeBtn.disabled = true;
            const preset = BEY_PRESETS[Math.floor(Math.random() * BEY_PRESETS.length)];
            const seededStats = {
                ...JSON.parse(JSON.stringify(targetStats)),
                ...JSON.parse(JSON.stringify(preset.stats))
            } as BeybladeStats;
            tempStats = await buildRandomBeyStats(seededStats);
            syncTrailWithBolt(tempStats);
            refreshEditorValues();
            updatePreview(tempStats);
            renderMatcapGrid();
            randomizeBtn.title = 'Random build';
            randomizeBtn.disabled = false;
        };

        // Setup Preview Scene
        requestAnimationFrame(() => {
            const width = Math.max(previewContainer.clientWidth, 1);
            const height = Math.max(previewContainer.clientHeight, 1);

            previewRenderer = getOrCreateRenderer();
            previewRenderer.setSize(width, height);
            previewRenderer.setClearColor(0x808080, 1);
            previewContainer.appendChild(previewRenderer.domElement);

            previewScene = new THREE.Scene();
            previewScene.background = new THREE.Color(0x808080);
            previewCamera = new THREE.PerspectiveCamera(45, width / height, 1, 1000);
            previewCamera.position.set(0, 44, 72);
            previewCamera.lookAt(0, 5, 0);

            previewControls = new OrbitControls(previewCamera, previewRenderer.domElement);
            previewControls.enableDamping = false;

            const resizePreview = () => {
                if (!previewRenderer || !previewCamera) return;
                const nextWidth = Math.max(previewContainer.clientWidth, 1);
                const nextHeight = Math.max(previewContainer.clientHeight, 1);
                previewRenderer.setSize(nextWidth, nextHeight);
                previewCamera.aspect = nextWidth / nextHeight;
                previewCamera.updateProjectionMatrix();
                fitPreviewCameraToBey();
            };
            previewResizeObserver = new ResizeObserver(resizePreview);
            previewResizeObserver.observe(previewContainer);

            const ambient = new THREE.AmbientLight(0xffffff, 1.7);
            previewScene.add(ambient);
            const dir = new THREE.DirectionalLight(0xffffff, 2.2);
            dir.position.set(10, 50, 20);
            previewScene.add(dir);

            updatePreview(tempStats);

            function animatePreview() {
                if (!previewRenderer) return;
                requestAnimationFrame(animatePreview);

                if (previewBeyblade) {
                    previewBeyblade.mesh.rotation.y += 0.018;
                    previewBeyblade.spinGroup.rotation.y += 0.04;
                }
                if (previewControls) previewControls.update();
                previewRenderer.render(previewScene!, previewCamera!);
            }
            animatePreview();
        });

        const matcapSection = document.createElement('div');
        matcapSection.className = 'stat-section material-section';
        matcapSection.innerHTML = '<div class="section-title">Parts</div>';
        detachedVisualControls.appendChild(matcapSection);

        type TMatcapPart = 'wheel' | 'ring' | 'bolt' | 'spinTrack' | 'tip';
        const parts: Array<{ id: TMatcapPart, label: string, colorKey: keyof BeybladeStats, shapeKeys: Array<keyof BeybladeStats> }> = [
            { id: 'wheel', label: 'Base', colorKey: 'wheelColor', shapeKeys: ['beyScale'] },
            { id: 'ring', label: 'Ring', colorKey: 'ringColor', shapeKeys: ['ringRadiusFactor', 'ringSides'] },
            { id: 'bolt', label: 'Bolt', colorKey: 'boltColor', shapeKeys: ['boltSides'] },
            { id: 'spinTrack', label: 'Track', colorKey: 'spinTrackColor', shapeKeys: ['spinTrackSize'] },
            { id: 'tip', label: 'Tip', colorKey: 'tipColor', shapeKeys: ['tipSize'] }
        ];
        const visualFieldByKey = new Map(VISUAL_FIELDS.map(field => [field.key, field]));

        const materialList = document.createElement('div');
        materialList.className = 'part-material-list';
        matcapSection.appendChild(materialList);

        parts.forEach((part) => {
            const partCard = document.createElement('div');
            partCard.className = 'part-material-card';
            partCard.dataset.part = part.id;
            partCard.innerHTML = `<div class="part-material-title">${part.label}</div>`;

            const colorControl = createInput(
                `v-${part.colorKey}`,
                `${part.label} color`,
                (targetStats as any)[part.colorKey],
                'Color',
                'color',
                1,
                (val) => {
                    (tempStats as any)[part.colorKey] = clampBeyColor(val);
                    if (part.colorKey === 'boltColor') syncTrailWithBolt(tempStats);
                    enforceBeyColorContrast(tempStats);
                    refreshEditorValues();
                    updatePreview(tempStats);
                }
            );
            colorControl.classList.add('part-color-control');
            partCard.appendChild(colorControl);

            const shapeGrid = document.createElement('div');
            shapeGrid.className = 'part-shape-grid';
            part.shapeKeys.forEach((key) => {
                const field = visualFieldByKey.get(key as string);
                if (!field) return;

                const shapeControl = createInput(
                    `v-${field.key}`,
                    field.label,
                    (targetStats as any)[field.key],
                    field.hint,
                    field.type,
                    field.step || 1,
                    (val) => {
                        (tempStats as any)[field.key] = val;
                        updatePreview(tempStats);
                    }
                );
                shapeControl.classList.add('part-shape-control');
                shapeGrid.appendChild(shapeControl);
            });
            partCard.appendChild(shapeGrid);

            const swatchGrid = document.createElement('div');
            swatchGrid.className = 'matcap-grid';
            partCard.appendChild(swatchGrid);

            materialList.appendChild(partCard);
        });

        function renderMatcapGrid() {
            parts.forEach((part) => {
                const partCard = materialList.querySelector<HTMLElement>(`[data-part="${part.id}"]`);
                const grid = partCard?.querySelector<HTMLElement>('.matcap-grid');
                if (!grid) return;
                grid.innerHTML = '';

                const clearBtn = document.createElement('button');
                clearBtn.type = 'button';
                clearBtn.innerHTML = `
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M6 6L18 18M18 6L6 18" />
                    </svg>
                `;
                clearBtn.className = 'matcap-btn clear';
                clearBtn.title = `Clear ${part.label} material`;
                clearBtn.onclick = () => {
                    if (!tempStats.partMatcaps) tempStats.partMatcaps = {};
                    delete tempStats.partMatcaps[part.id];
                    updatePreview(tempStats);
                    renderMatcapGrid();
                };
                grid.appendChild(clearBtn);

                MATCAP_LIBRARY.filter(mc => mc.category !== 'Dark').slice(0, 12).forEach(mc => {
                    const thumbUrl = mc.thumb;
                    const fullUrl = mc.file;
                    const btn = document.createElement('button');
                    btn.type = 'button';
                    btn.className = 'matcap-btn';
                    btn.title = `${part.label}: ${mc.category}`;
                    btn.style.background = `url(${thumbUrl}) center / cover`;
                    btn.classList.toggle('active', tempStats.partMatcaps?.[part.id] === fullUrl);
                    btn.onclick = () => {
                        if (!tempStats.partMatcaps) tempStats.partMatcaps = {};
                        tempStats.partMatcaps[part.id] = fullUrl;
                        updatePreview(tempStats);
                        renderMatcapGrid();
                    };
                    grid.appendChild(btn);
                });
            });
        }

        renderMatcapGrid();

        let visualDialog: HTMLDialogElement | null = null;
        function openVisualCustomizationDialog() {
            if (visualDialog?.open) return;

            visualDialog = document.createElement('dialog');
            visualDialog.className = 'visual-customization-dialog';

            const visualContainer = document.createElement('div');
            visualContainer.className = 'visual-customization-container';
            visualDialog.appendChild(visualContainer);

            const visualHeader = document.createElement('div');
            visualHeader.className = 'modal-header';
            visualHeader.innerHTML = '<span class="modal-title">Visual customization</span>';

            const visualCloseBtn = document.createElement('button');
            visualCloseBtn.className = 'modal-close';
            visualCloseBtn.setAttribute('aria-label', 'Close');
            visualCloseBtn.innerHTML = `
                <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M6 6L18 18M18 6L6 18" />
                </svg>
            `;
            visualCloseBtn.onclick = () => visualDialog?.close();
            visualHeader.appendChild(visualCloseBtn);
            visualContainer.appendChild(visualHeader);

            const visualBody = document.createElement('div');
            visualBody.className = 'visual-customization-body';
            visualBody.appendChild(matcapSection);
            visualContainer.appendChild(visualBody);

            visualDialog.addEventListener('close', () => {
                detachedVisualControls.appendChild(matcapSection);
                visualDialog?.remove();
                visualDialog = null;
            });

            document.body.appendChild(visualDialog);
            visualDialog.showModal();
        }

        customizeBtn.onclick = openVisualCustomizationDialog;

        const actions = document.createElement('div');
        actions.className = 'preset-actions';

        const resetBtn = document.createElement('button');
        resetBtn.className = 'icon-action-btn reset';
        resetBtn.title = 'Reset defaults';
        resetBtn.setAttribute('aria-label', 'Reset defaults');
        resetBtn.innerHTML = `
            <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M4 4v6h6M20 20v-6h-6M5.5 15A7 7 0 0 0 17 18.5M18.5 9A7 7 0 0 0 7 5.5" />
            </svg>
            <span>Reset</span>
        `;

        resetBtn.onclick = () => {
            if (confirm(`Reset ${targetName} to defaults? This cannot be undone.`)) {
                if (targetName === 'Player') Object.assign(targetStats, DEFAULT_PLAYER_STATS);
                if (targetName === 'CPU') Object.assign(targetStats, DEFAULT_ENEMY_STATS);

                // Update snapshot so resetMatch uses new defaults
                if (targetName === 'Player') matchStartPlayerStats = JSON.parse(JSON.stringify(DEFAULT_PLAYER_STATS));
                if (targetName === 'CPU') matchStartEnemyStats = JSON.parse(JSON.stringify(DEFAULT_ENEMY_STATS));

                savePresets();
                dialog.close();
                resetMatch();
            }
        };

        const saveBtn = document.createElement('button');
        saveBtn.className = 'icon-action-btn save';
        saveBtn.title = 'Apply build';
        saveBtn.setAttribute('aria-label', 'Apply build');
        saveBtn.innerHTML = `
            <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M5 12l4 4L19 6" />
            </svg>
            <span>Apply</span>
        `;

        saveBtn.onclick = () => {
            // Apply temp stats to target
            syncTrailWithBolt(tempStats);
            Object.assign(targetStats, tempStats);

            // Update snapshot so resetMatch uses new stats
            if (targetName === 'Player') matchStartPlayerStats = JSON.parse(JSON.stringify(targetStats));
            if (targetName === 'CPU') matchStartEnemyStats = JSON.parse(JSON.stringify(targetStats));

            savePresets();
            dialog.close();
            resetMatch();
        };

        actions.appendChild(randomizeBtn);
        actions.appendChild(resetBtn);
        actions.appendChild(saveBtn);
        container.appendChild(actions);

        // Handle Dialog Close Event for Cleanup
        dialog.addEventListener('close', () => {
            if (visualDialog?.open) visualDialog.close();
            if (previewResizeObserver) {
                previewResizeObserver.disconnect();
                previewResizeObserver = null;
            }
            if (previewRenderer) {
                returnRenderer(previewRenderer);
                previewRenderer = null;
            }
            if (previewControls) {
                previewControls.dispose();
                previewControls = null;
            }
            if (dialog.parentNode) {
                dialog.parentNode.removeChild(dialog);
            }
        });

        document.body.appendChild(dialog);
        dialog.showModal();

    } catch (e) {
        console.error('Error opening stat editor:', e);
    }
}

// Hook up buttons
const p1Btn = document.getElementById('p1-btn');
const cpuBtn = document.getElementById('cpu-btn');

if (p1Btn) {
    p1Btn.onclick = () => {
        openStatEditor(PLAYER_STATS, 'Player');
    };
} else {
    console.error('P1 Btn not found!');
}

if (cpuBtn) {
    cpuBtn.onclick = () => {
        openStatEditor(ENEMY_STATS, 'CPU');
    };
}

function completeTutorial() {
    tutorialComplete = true;
    localStorage.setItem('bblade_tutorial_complete', 'true');
}

function showTutorialOverlay() {
    if (tutorialComplete) return;

    const overlay = document.createElement('div');
    overlay.className = 'tutorial-overlay';
    overlay.innerHTML = `
        <div class="tutorial-panel">
            <span class="kicker">How to win</span>
            <h1>Hold DIVE, release, crash.</h1>
            <p>DIVE pulls your bey into the bowl and builds speed. Release into orbit before contact so the hit lands above critical speed.</p>
            <div class="tutorial-steps">
                <div><strong>1</strong><span>Aim the launch cone.</span></div>
                <div><strong>2</strong><span>Hold DIVE to charge speed.</span></div>
                <div><strong>3</strong><span>Let go before impact for a critical.</span></div>
            </div>
            <div class="tutorial-actions">
                <button class="action-btn reset" id="tutorial-skip">I know this</button>
                <button class="action-btn save" id="tutorial-start">Start training</button>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);

    const close = () => {
        completeTutorial();
        overlay.remove();
    };

    overlay.querySelector('#tutorial-start')?.addEventListener('click', close);
    overlay.querySelector('#tutorial-skip')?.addEventListener('click', close);
}

showTutorialOverlay();

animate();



// --- Input Processing ---
// Removed Drag interaction for Launch. Using UI instead.

launchBtn.addEventListener('click', () => {
    if (hasLaunched) return;

    hasLaunched = true;
    setCpuPattern(0);
    scheduleNextCpuDiveSwitch(clock.getElapsedTime() + 0.5);

    // Player Launch
    const angleRad = (currentLaunchAngle.value * Math.PI) / 180;

    // Use player stats for speed
    const launchSpeed = player.stats ? player.stats.spd : 200;

    // Matter.js velocity
    const vx = Math.cos(angleRad) * launchSpeed * 0.1;
    const vy = Math.sin(angleRad) * launchSpeed * 0.1;

    Body.setVelocity(player.body, { x: vx, y: vy });

    // Initialize Player HP (RPM)
    if (player.stats) {
        player.currentRpm = player.stats.maxRpm;
        // visual spin speed (rad/s approx rpm/100)
        Body.setAngularVelocity(player.body, player.currentRpm / 100);
    } else {
        Body.setAngularVelocity(player.body, 50); // Fallback
    }

    // Enemy Launch (Random Angle, Max Power)
    const enemyAngle = Math.random() * Math.PI * 2;
    const enemySpeed = enemy.stats ? enemy.stats.spd : 200;
    const enemyVx = Math.cos(enemyAngle) * enemySpeed * 0.1;
    const enemyVy = Math.sin(enemyAngle) * enemySpeed * 0.1;

    Body.setVelocity(enemy.body, { x: enemyVx, y: enemyVy });

    // Initialize Enemy HP (RPM)
    if (enemy.stats) {
        enemy.currentRpm = enemy.stats.maxRpm;
        Body.setAngularVelocity(enemy.body, enemy.currentRpm / 100);
    } else {
        Body.setAngularVelocity(enemy.body, 50);
    }

    // Save stats snapshot at match start (for "Keep Power-Ups" reset)
    matchStartPlayerStats = JSON.parse(JSON.stringify(player.stats));
    matchStartEnemyStats = JSON.parse(JSON.stringify(enemy.stats));

    // Hide UI handled in animate loop or here
    launchContainer.style.display = 'none';
    cycleBtnContainer.style.display = 'flex'; // Show Pattern Button

    // Update action HUD buttons
    resetHint.style.display = 'block';
});

// Window Resize Handling
window.addEventListener('resize', () => {
    const aspect = window.innerWidth / window.innerHeight;

    camera.left = frustumSize * aspect / -2;
    camera.right = frustumSize * aspect / 2;
    camera.top = frustumSize / 2;
    camera.bottom = frustumSize / -2;
    syncCriticalFlashPlaneToCamera();

    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
});

// Game Over / Winner UI
function showWinner(text: string) {
    const overlay = document.createElement('div');
    overlay.className = 'winner-overlay';

    const title = document.createElement('div');
    title.className = 'winner-title';
    title.innerText = text;
    overlay.appendChild(title);

    const rematchBtn = document.createElement('button');
    rematchBtn.className = 'rematch-btn';
    rematchBtn.innerText = 'REMATCH';
    rematchBtn.onclick = () => {
        document.body.removeChild(overlay);
        resetMatch();
    };
    overlay.appendChild(rematchBtn);

    document.body.appendChild(overlay);
}

const resetEntityVisualsAndPhysics = (entity: GameEntity, stats: BeybladeStats, startPos: { x: number, y: number }) => {
    // 1. Remove old visual mesh
    scene.remove(entity.mesh);

    // 2. Create new visual mesh
    const newVisuals = createBeybladeMesh(stats);
    entity.mesh = newVisuals.mesh;
    entity.tiltGroup = newVisuals.tiltGroup;
    entity.spinGroup = newVisuals.spinGroup;
    scene.add(entity.mesh);

    // 3. Update Physics Body
    const density = stats.densityBase * stats.wt;
    Body.setDensity(entity.body, density);
    entity.body.restitution = stats.restitution;
    entity.body.friction = stats.friction;
    entity.body.frictionAir = stats.frictionAir;

    // Reset Physics State
    Body.setPosition(entity.body, startPos);
    Body.setVelocity(entity.body, { x: 0, y: 0 });
    Body.setAngularVelocity(entity.body, 0);
    Body.setAngle(entity.body, 0);

    // Clear all forces and torques
    entity.body.force = { x: 0, y: 0 };
    entity.body.torque = 0;

    // Wake the body to ensure physics updates, then it will settle
    Body.setStatic(entity.body, false);

    // Reset Visual Position
    entity.mesh.position.set(startPos.x, getArenaHeight(startPos.x, startPos.y) + 10, startPos.y); // Matter Y is Three Z
    entity.mesh.quaternion.set(0, 0, 0, 1);

    // 4. Update Trail Color
    if (entity.trail && entity.trail.mesh.material instanceof THREE.LineBasicMaterial) {
        entity.trail.mesh.material.color.setHex(stats.trailColor);
        entity.trail.clear();
    }

    // 5. Reset Game Logic Stats
    entity.stats = stats; // Ensure reference is up to date
    entity.isDead = false;
    entity.currentRpm = 0;

    // 6. Clear drift properties (prevents weird movement after reset)
    entity.driftVelocity = undefined;
    entity.driftRotation = undefined;
};

function resetMatch() {
    hasLaunched = false;
    gameOver = false;

    // Update action HUD buttons
    resetHint.style.display = 'none';
    cycleBtnContainer.style.display = 'none'; // Hide Pattern Button
    setPattern(null, 0);
    setCpuPattern(0);
    scheduleNextCpuDiveSwitch(clock.getElapsedTime());


    // Clear Sparks
    sparks.forEach(s => scene.remove(s.mesh));
    sparks.length = 0;

    // Reset to match start stats (before power-ups were applied)
    if (matchStartPlayerStats && matchStartEnemyStats) {

        // Update global stats to match start snapshot
        Object.assign(PLAYER_STATS, matchStartPlayerStats);
        Object.assign(ENEMY_STATS, matchStartEnemyStats);

        // Reset entities with match start stats
        resetEntityVisualsAndPhysics(player, matchStartPlayerStats, { x: 0, y: 100 });
        resetEntityVisualsAndPhysics(enemy, matchStartEnemyStats, { x: 0, y: -100 });

    } else {
        // Fallback if no snapshot exists
        resetEntityVisualsAndPhysics(player, PLAYER_STATS, { x: 0, y: 100 });
        resetEntityVisualsAndPhysics(enemy, ENEMY_STATS, { x: 0, y: -100 });
    }
    // Ensure bodies are in world (safe add)
    Composite.remove(engine.world, player.body);
    Composite.remove(engine.world, enemy.body);
    Composite.add(engine.world, [player.body, enemy.body]);

    // Show UI
    launchContainer.style.display = 'flex';
    currentLaunchAngle.value = DEFAULT_LAUNCH_ANGLE;
    updateGuide(currentLaunchAngle.value);
    guideMesh.visible = true;
}

// showResetDialog removed


// Reset Key
window.addEventListener('keydown', (e) => {
    if (e.key === 'r' || e.key === 'R') {
        const overlay = document.querySelector('.winner-overlay');
        if (overlay && overlay.parentNode) {
            overlay.parentNode.removeChild(overlay);
        }
        resetMatch();
    }
});
