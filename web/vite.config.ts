import { defineConfig } from 'vite';
export default defineConfig({
 root:'web',
 build:{outDir:'dist',emptyOutDir:true},
 server:{proxy:{'/api':'http://localhost:8787','/feed.xml':'http://localhost:8787'}}
});
