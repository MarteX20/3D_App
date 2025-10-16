import { Component, ElementRef, ViewChild, AfterViewInit, OnDestroy, signal } from '@angular/core';
import * as THREE from 'three';
import { io, Socket } from 'socket.io-client';
import { ActivatedRoute, Router } from '@angular/router';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { throttleTime, Subject, Subscription } from 'rxjs';
import { ReactiveFormsModule, FormControl } from '@angular/forms';
import { CommonModule } from '@angular/common';

interface Annotation {
    id: string;
    position: THREE.Vector3;
    text: string;
}

@Component({
    selector: 'app-project',
    standalone: true,
    imports: [CommonModule, ReactiveFormsModule],
    templateUrl: './project.html',
})
export class Project implements AfterViewInit, OnDestroy {
    @ViewChild('rendererContainer', { static: true }) rendererContainer!: ElementRef;
    @ViewChild('chatContainer') chatContainer!: ElementRef;

    // === THREE.js core ===
    private scene!: THREE.Scene;
    private camera!: THREE.PerspectiveCamera;
    private renderer!: THREE.WebGLRenderer;
    private labelRenderer!: CSS2DRenderer;
    private cube!: THREE.Mesh;
    private controls!: OrbitControls;
    private transformControls!: TransformControls;
    private directionalLight!: THREE.DirectionalLight;
    private animationFrameId!: number;

    private raycaster = new THREE.Raycaster();
    private mouse = new THREE.Vector2();
    private annotations: Annotation[] = [];
    private subscriptions: Subscription[] = [];

    // === Network & chat ===
    socket: Socket = io('http://localhost:4000');
    projectId!: string;
    userName = localStorage.getItem('userName') || 'User-' + Math.floor(Math.random() * 1000);
    messages = signal<{ user: string; text: string; time: string }[]>([]);
    newMessage = new FormControl('');
    isChatOpen = false;

    private cameraSubject = new Subject<any>();

    constructor(private route: ActivatedRoute, private router: Router) {}

    // =========================================================================
    // === LIFECYCLE ===
    // =========================================================================

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
        window.removeEventListener('resize', this.onResize);
        window.removeEventListener('click', this.handleSceneClick);
        window.removeEventListener('keydown', this.handleKey);
        this.subscriptions.forEach((sub) => sub.unsubscribe());
    }

    // =========================================================================
    // === SCENE INITIALIZATION ===
    // =========================================================================

    private initScene() {
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x202020);
        this.scene.add(new THREE.GridHelper(10, 10, 0x444444, 0x444444));

        this.camera = new THREE.PerspectiveCamera(
            75,
            window.innerWidth / window.innerHeight,
            0.1,
            1000
        );
        this.camera.position.set(3, 3, 5);

        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.shadowMap.enabled = true;
        this.rendererContainer.nativeElement.appendChild(this.renderer.domElement);

        this.labelRenderer = new CSS2DRenderer();
        this.labelRenderer.setSize(window.innerWidth, window.innerHeight);
        this.labelRenderer.domElement.style.position = 'absolute';
        this.labelRenderer.domElement.style.top = '0';
        this.labelRenderer.domElement.style.pointerEvents = 'none';
        this.rendererContainer.nativeElement.appendChild(this.labelRenderer.domElement);

        this.scene.add(new THREE.AmbientLight(0xffffff, 0.4));
        this.directionalLight = new THREE.DirectionalLight(0xffffff, 1.2);
        this.directionalLight.position.set(5, 10, 7);
        this.directionalLight.castShadow = true;
        this.scene.add(this.directionalLight);

        const cubeGeometry = new THREE.BoxGeometry(1, 1, 1);
        const cubeMaterial = new THREE.MeshStandardMaterial({ color: 0x00aaff, roughness: 0.4 });
        this.cube = new THREE.Mesh(cubeGeometry, cubeMaterial);
        this.cube.position.set(0, 0.5, 0);
        this.cube.castShadow = true;
        this.scene.add(this.cube);

        const floor = new THREE.Mesh(
            new THREE.PlaneGeometry(10, 10),
            new THREE.MeshStandardMaterial({ color: 0x999999, side: THREE.DoubleSide })
        );
        floor.rotation.x = -Math.PI / 2;
        floor.receiveShadow = true;
        this.scene.add(floor);

        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.05;

        this.controls.addEventListener('change', () => {
            this.cameraSubject.next({
                projectId: this.projectId,
                position: this.camera.position.clone(),
                rotation: this.camera.rotation.clone(),
            });
        });

        window.addEventListener('resize', this.onResize);
        window.addEventListener('click', this.handleSceneClick);
        window.addEventListener('keydown', this.handleKey);

        this.animate();
    }

    private animate = () => {
        this.animationFrameId = requestAnimationFrame(this.animate);
        this.controls.update();
        this.renderer.render(this.scene, this.camera);
        this.labelRenderer.render(this.scene, this.camera);
    };

    private onResize = () => {
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.labelRenderer.setSize(window.innerWidth, window.innerHeight);
    };

    private handleKey = (event: KeyboardEvent) => {
        // Placeholder for TransformControls or shortcuts
    };

    // =========================================================================
    // === CHAT LOGIC ===
    // =========================================================================

    sendMessage() {
        const text = this.newMessage.value?.trim();
        if (!text) return;

        const message = {
            user: this.userName,
            text,
            time: new Date().toLocaleTimeString(),
        };

        this.messages.update((prev) => [...prev, message]);
        this.scrollToBottom();

        this.socket.emit('sendMessage', { projectId: this.projectId, message });

        this.newMessage.reset();
    }

    private scrollToBottom() {
        setTimeout(() => {
            if (this.chatContainer?.nativeElement) {
                const el = this.chatContainer.nativeElement;
                el.scrollTop = el.scrollHeight;
            }
        });
    }

    // =========================================================================
    // === SOCKET.IO ===
    // =========================================================================

    private initSockets() {
        this.socket.on('receiveMessage', (data) => {
            if (data?.message && data.projectId === this.projectId) {
                if (data.message.user !== this.userName) {
                    this.messages.update((prev) => [...prev, data.message]);
                    this.scrollToBottom();
                }
            }
        });

        this.socket.on('objectUpdated', (data) => {
            if (!this.cube || data.projectId !== this.projectId) return;
            if (!data.position || !data.rotation || !data.scale) return;
            this.cube.position.set(data.position.x, data.position.y, data.position.z);
            this.cube.rotation.set(data.rotation.x, data.rotation.y, data.rotation.z);
            this.cube.scale.set(data.scale.x, data.scale.y, data.scale.z);
        });

        this.socket.on('cameraUpdated', (data) => {
            if (data.projectId !== this.projectId || data.socketId === this.socket.id) return;
            this.camera.position.copy(data.position);
            this.camera.rotation.copy(data.rotation);
        });

        this.socket.on('annotationAdded', (data) => {
            if (data.projectId !== this.projectId) return;
            const pos = new THREE.Vector3(
                data.annotation.position.x,
                data.annotation.position.y,
                data.annotation.position.z
            );
            this.addAnnotation({ ...data.annotation, position: pos });
        });

        this.socket.on('annotationDeleted', (data) => {
            if (data.projectId !== this.projectId) return;
            this.removeAnnotation(data.annotationId);
        });

        this.socket.on('loadAnnotations', (data) => {
            if (data.projectId !== this.projectId) return;
            data.annotations.forEach((a: any) => {
                const pos = new THREE.Vector3(a.position.x, a.position.y, a.position.z);
                if (!this.annotations.find((ann) => ann.id === a.id)) {
                    this.addAnnotation({ ...a, position: pos });
                }
            });
        });
    }

    private initCameraSync() {
        const sub = this.cameraSubject.pipe(throttleTime(100)).subscribe((data) => {
            this.socket.emit('updateCamera', { ...data, socketId: this.socket.id });
        });
        this.subscriptions.push(sub);
    }

    // =========================================================================
    // === ANNOTATIONS ===
    // =========================================================================

    private handleSceneClick = (event: MouseEvent) => {
        const rect = this.renderer.domElement.getBoundingClientRect();
        this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

        this.raycaster.setFromCamera(this.mouse, this.camera);
        const intersects = this.raycaster.intersectObjects(this.scene.children, true);
        if (intersects.length === 0) return;

        const object = intersects[0].object;

        // Delete annotation (Alt+Click)
        if (event.altKey) {
            const ann = this.annotations.find((a) => (object as any).annotationId === a.id);
            if (ann && confirm('Delete annotation?')) {
                this.removeAnnotation(ann.id);
                this.socket.emit('deleteAnnotation', {
                    projectId: this.projectId,
                    annotationId: ann.id,
                });
            }
            return;
        }

        // Add annotation (Shift+Click)
        if (event.shiftKey) {
            const point = intersects[0].point;
            const text = prompt('Enter annotation text:');
            if (!text) return;

            const annotation: Annotation = {
                id: crypto.randomUUID(),
                position: point.clone(),
                text,
            };

            this.addAnnotation(annotation);
            this.socket.emit('addAnnotation', { projectId: this.projectId, annotation });
        }
    };

    private addAnnotation(annotation: Annotation) {
        const sphere = new THREE.Mesh(
            new THREE.SphereGeometry(0.05),
            new THREE.MeshBasicMaterial({ color: 0xff0000 })
        );
        sphere.position.copy(annotation.position);
        (sphere as any).annotationId = annotation.id;
        this.scene.add(sphere);

        const div = document.createElement('div');
        div.textContent = annotation.text;
        div.style.color = 'white';
        div.style.background = 'rgba(0,0,0,0.6)';
        div.style.padding = '2px 6px';
        div.style.borderRadius = '4px';
        div.style.fontSize = '12px';

        const label = new CSS2DObject(div);
        label.position.copy(annotation.position.clone().add(new THREE.Vector3(0, 0.15, 0)));
        this.scene.add(label);

        this.annotations.push(annotation);
    }

    private removeAnnotation(id: string) {
        const index = this.annotations.findIndex((a) => a.id === id);
        if (index === -1) return;
        this.annotations.splice(index, 1);

        const obj = this.scene.children.find((o: any) => o.annotationId === id);
        if (obj) this.scene.remove(obj);
    }

    // =========================================================================
    // === CHAT ===
    // =========================================================================

    toggleChat() {
        this.isChatOpen = !this.isChatOpen;
    }

    // =========================================================================
    // === NAVIGATION ===
    // =========================================================================

    goBack() {
        this.router.navigate(['/projects']);
    }
}
