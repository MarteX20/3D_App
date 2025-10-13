import { Component, ElementRef, ViewChild, AfterViewInit, OnDestroy } from '@angular/core';
import * as THREE from 'three';
import { io, Socket } from 'socket.io-client';
import { ActivatedRoute } from '@angular/router';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { throttleTime, Subject } from 'rxjs';

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
    private cube!: THREE.Mesh;
    private controls!: OrbitControls;
    private transformControls!: TransformControls;
    private animationFrameId!: number;

    socket: Socket = io('http://localhost:4000');
    projectId!: string;

    // For throttle camera sync
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

        // TransformControls
        this.transformControls = new TransformControls(this.camera, this.renderer.domElement);
        this.transformControls.attach(this.cube);
        (this.scene as any).add(this.transformControls);

        this.transformControls.addEventListener('dragging-changed', (event: any) => {
            this.controls.enabled = !event.value;
        });

        this.transformControls.addEventListener('objectChange', () => this.sendCubeUpdate());

        window.addEventListener('keydown', this.handleKey);
        window.addEventListener('resize', () => this.onResize());

        // OrbitControls mouse listener
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
    };

    private onResize() {
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
    }

    private handleKey = (event: KeyboardEvent) => {
        switch (event.key.toLowerCase()) {
            case 'g':
                this.transformControls.setMode('translate');
                break;
            case 'r':
                this.transformControls.setMode('rotate');
                break;
            case 's':
                this.transformControls.setMode('scale');
                break;
        }
    };

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
        // throttle 100ms for camera
        this.cameraSubject.pipe(throttleTime(100)).subscribe((data) => {
            this.socket.emit('updateCamera', {
                ...data,
                socketId: this.socket.id,
            });
        });
    }
}
