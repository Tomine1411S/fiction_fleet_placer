import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
    plugins: [react()],
    root: './', // Root at project root since index.html will be here
    server: {
        port: 3000
    }
})
