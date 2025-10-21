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

    deleteProject(id: string) {
        if (!confirm('Are you sure you want to delete this project?')) return;

        fetch(`https://server-backend-brl7.onrender.com/projects/${id}`, {
            method: 'DELETE',
        })
            .then((res) => res.json())
            .then((data) => {
                if (data.success) {
                    // Удаляем проект локально без перезагрузки
                    this.projects.update((prev) => prev.filter((p) => p._id !== id));
                    alert('✅ Project deleted successfully');
                } else {
                    alert('❌ Error deleting project');
                }
            })
            .catch(() => alert('❌ Server connection error'));
    }

    openProject(id: string) {
        this.router.navigate(['/project', id]);
    }

    toLogin() {
        this.router.navigate(['/login']);
    }
}
