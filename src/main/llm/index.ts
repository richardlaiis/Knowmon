// Ollama client、背景 embedding、混合檢索、總結（agent 工具在階段 7）
export { LlmService } from './service'
export { createOllama, OllamaError, type OllamaClient } from './ollama'
export { retrieve } from './retrieve'
