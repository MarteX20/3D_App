import { Component, ElementRef, ViewChild, AfterViewInit, OnDestroy } from '@angular/core';
import * as THREE from 'three';
import { io, Socket } from 'socket.io-client';
import { ActivatedRoute } from '@angular/router';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { throttleTime, Subject } from 'rxjs';

interface Annotation {
    id: string;
    position: THREE.Vector3;
    text: string;
}

@Component({
    selector: 'app-project',
    standalone: true,
    templateUrl: './project.html',
})
export class Project implements AfterViewInit, OnDestroy {
    @ViewChild('rendererContainer', { static: true }) rendererContainer!: ElementRef;

    private scene!: THREE.Scene;
    private camera!: THREE.PerspectiveCamera;
    private renderer!: THREE.WebGLRenderer;
    private labelRenderer!: CSS2DRenderer;
    private cube!: THREE.Mesh;
    private controls!: OrbitControls;
    private animationFrameId!: number;
    private raycaster = new THREE.Raycaster();
    private mouse = new THREE.Vector2();
    private annotations: Annotation[] = [];

    socket: Socket = io('http://localhost:4000');
    projectId!: string;

    private cameraSubject = new Subject<any>();

    constructor(private route: ActivatedRoute) {}

    ngAfterViewInit() {
        this.projectId = this.route.snapshot.paramMap.get('id')!;
        this.socket.emit('joinProject', this.projectId);

        this.initScene();
        this.initSockets();
        this.initCameraSync();
    }

    ngOnDestroy() {
        cancelAnimationFrame(this.animationFrameId);
        this.socket.disconnect();
        window.removeEventListener('keydown', this.handleKey);
        window.removeEventListener('click', this.handleSceneClick);
    }

    private initScene() {
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x202020);

        this.camera = new THREE.PerspectiveCamera(
            75,
            window.innerWidth / window.innerHeight,
            0.1,
            1000
        );
        this.camera.position.set(2, 2, 3);

        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.rendererContainer.nativeElement.appendChild(this.renderer.domElement);

        // === Label Renderer ===
        this.labelRenderer = new CSS2DRenderer();
        this.labelRenderer.setSize(window.innerWidth, window.innerHeight);
        this.labelRenderer.domElement.style.position = 'absolute';
        this.labelRenderer.domElement.style.top = '0';
        this.labelRenderer.domElement.style.pointerEvents = 'none';
        this.rendererContainer.nativeElement.appendChild(this.labelRenderer.domElement);

        const light = new THREE.PointLight(0xffffff, 1);
        light.position.set(5, 5, 5);
        this.scene.add(light);

        // Qube
        const geometry = new THREE.BoxGeometry();
        const material = new THREE.MeshStandardMaterial({ color: 0x00ff00 });
        this.cube = new THREE.Mesh(geometry, material);
        this.scene.add(this.cube);

        // OrbitControls
        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.05;

        window.addEventListener('resize', () => this.onResize());
        window.addEventListener('click', this.handleSceneClick);

        // Camera Sync
        this.controls.addEventListener('change', () => {
            this.cameraSubject.next({
                projectId: this.projectId,
                position: this.camera.position.clone(),
                rotation: this.camera.rotation.clone(),
            });
        });

        this.animate();
    }

    private animate = () => {
        this.animationFrameId = requestAnimationFrame(this.animate);
        this.controls.update();
        this.renderer.render(this.scene, this.camera);
        this.labelRenderer.render(this.scene, this.camera);
    };

    private onResize() {
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.labelRenderer.setSize(window.innerWidth, window.innerHeight);
    }

    private handleKey = (event: KeyboardEvent) => {

    };

    // === Annotaions add ===
    private handleSceneClick = (event: MouseEvent) => {
        // Annotation can be added only when shit key is pressed
        if (!event.shiftKey) return;

        const rect = this.renderer.domElement.getBoundingClientRect();
        this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

        this.raycaster.setFromCamera(this.mouse, this.camera);
        const intersects = this.raycaster.intersectObjects([this.cube]);

        if (intersects.length > 0) {
            const point = intersects[0].point;
            const text = prompt('Введите аннотацию:');
            if (!text) return;

            const annotation: Annotation = {
                id: crypto.randomUUID(),
                position: point.clone(),
                text,
            };

            this.addAnnotation(annotation);
            this.socket.emit('addAnnotation', {
                projectId: this.projectId,
                annotation: {
                    ...annotation,
                    position: { x: point.x, y: point.y, z: point.z },
                },
            });
        }
    };

    private addAnnotation(annotation: Annotation) {
        const sphere = new THREE.Mesh(
            new THREE.SphereGeometry(0.05),
            new THREE.MeshBasicMaterial({ color: 0xff0000 })
        );
        sphere.position.copy(annotation.position);
        this.scene.add(sphere);

        const div = document.createElement('div');
        div.className = 'annotation-label';
        div.textContent = annotation.text;
        div.style.color = 'white';
        div.style.background = 'rgba(0, 0, 0, 0.6)';
        div.style.padding = '2px 6px';
        div.style.borderRadius = '4px';
        div.style.fontSize = '12px';

        const label = new CSS2DObject(div);
        label.position.copy(annotation.position.clone().add(new THREE.Vector3(0, 0.15, 0)));
        this.scene.add(label);

        this.annotations.push(annotation);
    }

    // === Socket.io ===
    private initSockets() {
        // Qube
        this.socket.on('objectUpdated', (data) => {
            if (data.projectId !== this.projectId) return;
            this.cube.position.set(data.position.x, data.position.y, data.position.z);
            this.cube.rotation.set(data.rotation.x, data.rotation.y, data.rotation.z);
            this.cube.scale.set(data.scale.x, data.scale.y, data.scale.z);
        });

        // Camera
        this.socket.on('cameraUpdated', (data) => {
            if (data.projectId !== this.projectId) return;
            if (data.socketId === this.socket.id) return;
            this.camera.position.copy(data.position);
            this.camera.rotation.copy(data.rotation);
        });

        // Annotations
        this.socket.on('annotationAdded', (data) => {
            if (data.projectId !== this.projectId) return;
            const { annotation } = data;
            const pos = new THREE.Vector3(
                annotation.position.x,
                annotation.position.y,
                annotation.position.z
            );
            this.addAnnotation({ ...annotation, position: pos });
        });

        this.socket.on('loadAnnotations', (data) => {
            if (data.projectId !== this.projectId) return;
            data.annotations.forEach((annotation: any) => {
                const pos = new THREE.Vector3(
                    annotation.position.x,
                    annotation.position.y,
                    annotation.position.z
                );
                this.addAnnotation({ ...annotation, position: pos });
            });
        });
    }

    private sendCubeUpdate() {
        const pos = this.cube.position;
        const rot = this.cube.rotation;
        const scale = this.cube.scale;

        this.socket.emit('updateObject', {
            projectId: this.projectId,
            position: { x: pos.x, y: pos.y, z: pos.z },
            rotation: { x: rot.x, y: rot.y, z: rot.z },
            scale: { x: scale.x, y: scale.y, z: scale.z },
        });
    }

    private initCameraSync() {
        this.cameraSubject.pipe(throttleTime(100)).subscribe((data) => {
            this.socket.emit('updateCamera', {
                ...data,
                socketId: this.socket.id,
            });
        });
    }
}
