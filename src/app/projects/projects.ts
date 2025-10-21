import { Component, OnInit, signal } from '@angular/core';
import { Router } from '@angular/router';
import { HttpClient, HttpClientModule } from '@angular/common/http';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

@Component({
    selector: 'app-projects',
    standalone: true,
    imports: [CommonModule, HttpClientModule, FormsModule],
    templateUrl: './projects.html',
})
export class Projects implements OnInit {
    title = signal('');
    projects = signal<any[]>([]);

    constructor(private http: HttpClient, private router: Router) {}

    ngOnInit() {
        this.http
            .get<any[]>('https://server-backend-brl7.onrender.com/projects')
            .subscribe((p) => this.projects.set(p));
    }

    createProject() {
        const title = this.title().trim();
        if (!title) return;

        this.http
            .post<any>('https://server-backend-brl7.onrender.com/projects', { title })
            .subscribe((p) => this.projects.update((arr) => [...arr, p]));
    }

    openProject(id: string) {
        this.router.navigate(['/project', id]);
    }

    toLogin(){
        this.router.navigate(['/login']);
    }
}
