/// <reference types="vite/client" />

interface ImportMetaEnv {
	readonly VITE_MCP_MODE?: string;
	readonly VITE_BACKEND_ORIGIN?: string;
}

interface ImportMeta {
	readonly env: ImportMetaEnv;
}

declare module '*.css';
