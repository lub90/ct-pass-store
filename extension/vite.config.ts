import { defineConfig, loadEnv } from 'vite';
import vue from '@vitejs/plugin-vue';
import vuetify, { transformAssetUrls } from 'vite-plugin-vuetify';
import path from "path";

// https://vitejs.dev/config/
export default ({ mode }) => {
    process.env = { ...process.env, ...loadEnv(mode, process.cwd()) };
    return defineConfig({
        base: `/ccm/${process.env.VITE_KEY}/`,
        plugins: [
            vue({
                template: { transformAssetUrls }
            }),
            vuetify({ autoImport: true }) 
        ],
        resolve: {
            alias: {
                "@": path.resolve(__dirname, "src")
            }
        }
    });
};
