import { mount } from 'svelte';
import './styles.css';
import App from './App.svelte';

const target = document.getElementById('app');

if (!target) {
  throw new Error('Missing app element.');
}

mount(App, { target });
