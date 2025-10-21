import { Component, ElementRef, ViewChild, AfterViewInit, OnDestroy, signal } from '@angular/core';
import * as THREE from 'three';
import { io, Socket } from 'socket.io-client';
import { ActivatedRoute, Router } from '@angular/router';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { throttleTime, Subject, Subscription } from 'rxjs';
import { ReactiveFormsModule, FormControl } from '@angular/forms';
import { CommonModule } from '@angular/common';

interface Annotation {
    id: string;
    position: THREE.Vector3;
    text: string;
    label?: CSS2DObject;
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
    private directionalLight!: THREE.DirectionalLight;
    private animationFrameId!: number;
    private raycaster = new THREE.Raycaster();
    private mouse = new THREE.Vector2();
    private annotations: Annotation[] = [];
    private subscriptions: Subscription[] = [];
    private touchStartY = 0;

    // === Network & chat ===

    socket: Socket = io('https://server-backend-brl7.onrender.com');
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
        console.log('📁 Opened project:', this.projectId);
        this.initScene();
        this.initSockets();
        this.initCameraSync();
        this.socket.emit('joinProject', this.projectId);
    }

    ngOnDestroy() {
        cancelAnimationFrame(this.animationFrameId);
        this.socket.disconnect();
        window.removeEventListener('resize', this.onResize);
        window.removeEventListener('click', this.handleSceneClick);
        this.subscriptions.forEach((sub) => sub.unsubscribe());
    }

    // =========================================================================
    // === SCENE INITIALIZATION ===
    // =========================================================================

    private initScene() {
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x202020);
        // this.scene.add(new THREE.GridHelper(10, 10, 0x444444, 0x444444));

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
        const cubeMaterial = new THREE.MeshStandardMaterial({ color: 0x00aaff, roughness: 0.15 });
        this.cube = new THREE.Mesh(cubeGeometry, cubeMaterial);
        this.cube.position.set(0, 0.5, 0);
        this.cube.castShadow = true;
        this.scene.add(this.cube);

        // Floor
        const floor = new THREE.Mesh(
            new THREE.PlaneGeometry(10, 10),
            new THREE.MeshStandardMaterial({ color: 0x999999, side: THREE.DoubleSide })
        );
        floor.rotation.x = -Math.PI / 2;
        floor.receiveShadow = true;
        this.scene.add(floor);

        // Controls
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

    // =========================================================================
    // === CHAT LOGIC ===
    // =========================================================================

    sendMessage() {
        const text = this.newMessage.value?.trim();
        if (!text) return;

        const message = { user: this.userName, text, time: new Date().toLocaleTimeString() };

        // this.messages.update((prev) => [...prev, message]);

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
        // === Load full project state on join ===
        this.socket.on('loadProject', (state) => {
            // Camera
            if (state.camera) {
                this.camera.position.set(
                    state.camera.position.x,
                    state.camera.position.y,
                    state.camera.position.z
                );
                this.camera.rotation.set(
                    state.camera.rotation.x,
                    state.camera.rotation.y,
                    state.camera.rotation.z
                );
            }

            // Object
            if (state.object) {
                const o = state.object;
                this.cube.position.set(o.position.x, o.position.y, o.position.z);
                this.cube.rotation.set(o.rotation.x, o.rotation.y, o.rotation.z);
                this.cube.scale.set(o.scale.x, o.scale.y, o.scale.z);
            }

            // Annotations
            this.annotations = [];
            state.annotations?.forEach((a: any) => {
                const pos = new THREE.Vector3(a.position.x, a.position.y, a.position.z);
                this.addAnnotation({ ...a, position: pos });
            });

            // Chat
            this.messages.set(state.chat ?? []);
            this.scrollToBottom();
        });

        // Chat
        this.socket.on('receiveMessage', (data) => {
            if (data.projectId === this.projectId) {
                this.messages.update((prev) => [...prev, data.message]);
                this.scrollToBottom();
            }
        });

        // Object update
        this.socket.on('objectUpdated', (data) => {
            if (data.projectId !== this.projectId) return;
            const o = data;
            if (!o.position || !o.rotation || !o.scale) return;
            this.cube.position.set(o.position.x, o.position.y, o.position.z);
            this.cube.rotation.set(o.rotation.x, o.rotation.y, o.rotation.z);
            this.cube.scale.set(o.scale.x, o.scale.y, o.scale.z);
        });

        // Camera sync
        this.socket.on('cameraUpdated', (data) => {
            if (data.projectId !== this.projectId || data.socketId === this.socket.id) return;
            // Smooth camera update
            const targetPos = new THREE.Vector3(
                data.camera.position.x,
                data.camera.position.y,
                data.camera.position.z
            );
            this.camera.position.lerp(targetPos, 0.1);

            // Smooth rotation
            const targetRot = new THREE.Euler(
                data.camera.rotation.x,
                data.camera.rotation.y,
                data.camera.rotation.z
            );

            this.camera.rotation.x += (targetRot.x - this.camera.rotation.x) * 0.1;
            this.camera.rotation.y += (targetRot.y - this.camera.rotation.y) * 0.1;
            this.camera.rotation.z += (targetRot.z - this.camera.rotation.z) * 0.1;
        });

        // Annotations
        this.socket.on('annotationAdded', (data) => {
            if (data.projectId === this.projectId) {
                const pos = new THREE.Vector3(
                    data.annotation.position.x,
                    data.annotation.position.y,
                    data.annotation.position.z
                );

                if (!this.annotations.find((ann) => ann.id === data.annotation.id)) {
                    this.addAnnotation({ ...data.annotation, position: pos });
                }
            }
        });

        this.socket.on('annotationDeleted', (data) => {
            if (data.projectId === this.projectId) {
                this.removeAnnotation(data.annotationId);
            }
        });
    }

    private initCameraSync() {
        const sub = this.cameraSubject.pipe(throttleTime(50)).subscribe((data) => {
            this.socket.emit('updateCamera', {
                projectId: this.projectId,
                camera: { position: data.position, rotation: data.rotation },
                socketId: this.socket.id,
            });
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
        if (!intersects.length) return;
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
        annotation.label = label;
        this.annotations.push(annotation);
    }

    private removeAnnotation(id: string) {
        const index = this.annotations.findIndex((a) => a.id === id);
        if (index === -1) return;
        const annotation = this.annotations[index];

        // Deleting sphere
        const obj = this.scene.children.find((o: any) => o.annotationId === id);
        if (obj) this.scene.remove(obj);

        // Deleting label
        if (annotation.label) {
            this.scene.remove(annotation.label);
        }
        this.annotations.splice(index, 1);
    }

    // =========================================================================
    // === CHAT ===
    // =========================================================================

    toggleChat() {
        this.isChatOpen = !this.isChatOpen;
    }

    changeCubeColor(color: string) {
        if (this.cube) {
            (this.cube.material as THREE.MeshStandardMaterial).color.set(color);
        }
    }

    goBack() {
        this.router.navigate(['/projects']);
    }

    // === SCROLL ===
    handleTouchStart(event: TouchEvent) {
        this.touchStartY = event.touches[0].clientY;
    }

    handleTouchEnd(event: TouchEvent) {
        const touchEndY = event.changedTouches[0].clientY;
        const delta = this.touchStartY - touchEndY;

        // свайп вверх → scroll down
        if (delta > 50) {
            window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
        }

        // свайп вниз → scroll up
        else if (delta < -50) {
            window.scrollTo({ top: 0, behavior: 'smooth' });
        }
    }
}
