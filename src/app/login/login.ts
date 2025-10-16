import { Component, signal } from '@angular/core';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';

@Component({
    selector: 'app-login',
    standalone: true,
    imports: [CommonModule, FormsModule],
    templateUrl: './login.html',
})
export class Login {
    username = signal('');

    constructor(private router: Router) {}

    login() {
        const name = this.username().trim();
        if (name) {
            localStorage.setItem('userName', name);
            this.router.navigate(['/projects']);
        }
    }
}
