import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { Login} from './login/login';
import { Projects } from './projects/projects';
import { Project } from './project/project';

export const routes: Routes = [
    { path: '', redirectTo: '/login', pathMatch: 'full' },
    { path: 'login', component: Login },
    { path: 'projects', component: Projects },
    { path: 'project/:id', component: Project },
];

@NgModule({
    imports: [RouterModule.forRoot(routes)],
    exports: [RouterModule],
})
export class AppRoutingModule {}
