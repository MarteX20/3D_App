import { Component, ElementRef, ViewChild, AfterViewInit } from '@angular/core';
import * as THREE from 'three'
import { io } from 'socket.io-client';
import { ActivatedRoute } from '@angular/router';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';

@Component({
    selector: 'app-project',
    standalone: true,
    imports: [CommonModule],
    templateUrl: './project.html',
})
export class Project implements AfterViewInit {
    @ViewChild('rendererContainer', { static: true }) rendererContainer!: ElementRef;
    socket = io('http://localhost:4000');
    projectId!: string;


    constructor(private route: ActivatedRoute) {}

    ngAfterViewInit() {
        this.projectId = this.route.snapshot.paramMap.get('id')!;
        this.socket.emit('joinProject', this.projectId);
        this.initScene();
    }

    initScene() {
        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(
            75,
            window.innerWidth / window.innerHeight,
            0.1,
            1000
        );
        const renderer = new THREE.WebGLRenderer({ antialias: true });
        renderer.setSize(window.innerWidth, window.innerHeight);
        this.rendererContainer.nativeElement.appendChild(renderer.domElement);

        const cube = new THREE.Mesh(
            new THREE.BoxGeometry(),
            new THREE.MeshStandardMaterial({ color: 0x00ff00 })
        );
        scene.add(cube);

        const light = new THREE.PointLight(0xffffff, 1);
        light.position.set(5, 5, 5);
        scene.add(light);
        camera.position.z = 3;

        const animate = () => {
            requestAnimationFrame(animate);
            cube.rotation.x += 0.01;
            cube.rotation.y += 0.01;
            renderer.render(scene, camera);
        };
        animate();
    }

    back(){
        this.route
    }
}
