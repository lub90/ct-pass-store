import type { Person } from './utils/ct-types';
import { churchtoolsClient } from '@churchtools/churchtools-client';
import angular from 'angular';
import 'angular-route';
import { SetupController } from './setup/SetupController';
import { mainTemplate } from './ui/mainTemplate';

// only import reset.css in development mode to keep the production bundle small and to simulate CT environment
if (import.meta.env.MODE === 'development') {
    import('./utils/reset.css');
}

declare const window: Window &
    typeof globalThis & {
        settings: {
            base_url?: string;
        };
    };

const baseUrl = window.settings?.base_url ?? import.meta.env.VITE_BASE_URL;
churchtoolsClient.setBaseUrl(baseUrl);

const username = import.meta.env.VITE_USERNAME;
const password = import.meta.env.VITE_PASSWORD;
if (import.meta.env.MODE === 'development' && username && password) {
    await churchtoolsClient.post('/login', { username, password });
}

const KEY = import.meta.env.VITE_KEY;
export { KEY };


// Include bootstrap
const bootstrapCss = document.createElement('link');
bootstrapCss.rel = 'stylesheet';
bootstrapCss.href = 'https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/css/bootstrap.min.css';
document.head.appendChild(bootstrapCss);

const bootstrapIconCss = document.createElement('link');
bootstrapIconCss.rel = 'stylesheet';
bootstrapIconCss.href = 'https://cdn.jsdelivr.net/npm/bootstrap-icons@1.10.5/font/bootstrap-icons.css';
document.head.appendChild(bootstrapIconCss);


// Setup angular
const app = angular.module('ctExtensionApp', ['ngRoute']);

app.config(['$routeProvider', function($routeProvider) {
  $routeProvider
    .when('/setup', {
      template: '<setup></setup>'
    })
    .when('/settings', {
      template: '<settings></settings>'
    })
    .when('/password', {
      template: '<password></password>'
    })
    .otherwise({ redirectTo: '/password' });
}]);

app.component('setup', {
  template: () => mainTemplate(),
  controller: function() {
    this.$onInit = () => {
      const controller = new SetupController();
      controller.init();
    };
  }
});

app.component('settings', {
  template: `<div class="container"><h2>Settings Page</h2></div>`
});

app.component('password', {
  template: `<div class="container"><h2>Password Page</h2></div>`
});




// Inject AngularJS into #app
document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <div ng-app="ctExtensionApp">
    <div ng-view></div>
  </div>
`;

angular.bootstrap(document.querySelector('#app'), ['ctExtensionApp']);


/**
const user = await churchtoolsClient.get<Person>(`/whoami`);

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <div style="display: flex; place-content: center; place-items: center; height: 100vh;">
    <h1>Welcome ${[user.firstName, user.lastName].join(' ')}</h1>
  </div>
`;
*/