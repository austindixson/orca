/**
 * llama.cpp Local Model Utilities
 * 
 * Based on mac-code (walter-grace/mac-code) — run LLMs locally on Mac via llama.cpp.
 * Supports Qwen3.5 models with OpenAI-compatible API.
 * 
 * Quick start:
 *   brew install llama.cpp
 *   python3 -c "from huggingface_hub import hf_hub_download; hf_hub_download('unsloth/Qwen3.5-35B-A3B-GGUF', 'Qwen3.5-35B-A3B-UD-IQ2_M.gguf', local_dir='$HOME/models/')"
 *   llama-server --model ~/models/Qwen3.5-35B-A3B-UD-IQ2_M.gguf --port 8000 --host 127.0.0.1 --flash-attn on --ctx-size 12288
 */

import { LLAMACPP_DEFAULT_BASE } from '../../store/settingsStore'

export interface LlamaCppServerStatus {
  running: boolean
  model?: string
  contextSize?: number
  error?: string
}

export interface LlamaCppModelInfo {
  id: string
  name: string
  displayName: string
  huggingfaceRepo: string
  huggingfaceFile: string
  sizeGb: number
  ramRequired: string
  speed: string
  quantization: string
}

export const RECOMMENDED_MODELS: LlamaCppModelInfo[] = [
  {
    id: 'qwen35-35b-a3b-iq2m',
    name: 'Qwen3.5-35B-A3B-UD-IQ2_M.gguf',
    displayName: 'Qwen3.5 35B A3B (IQ2_M)',
    huggingfaceRepo: 'unsloth/Qwen3.5-35B-A3B-GGUF',
    huggingfaceFile: 'Qwen3.5-35B-A3B-UD-IQ2_M.gguf',
    sizeGb: 10.6,
    ramRequired: '16 GB',
    speed: '30 tok/s (M4)',
    quantization: 'IQ2_M (2-bit)',
  },
  {
    id: 'qwen35-9b-q4km',
    name: 'Qwen3.5-9B-Q4_K_M.gguf',
    displayName: 'Qwen3.5 9B (Q4_K_M)',
    huggingfaceRepo: 'unsloth/Qwen3.5-9B-GGUF',
    huggingfaceFile: 'Qwen3.5-9B-Q4_K_M.gguf',
    sizeGb: 5.3,
    ramRequired: '8 GB',
    speed: '16-20 tok/s',
    quantization: 'Q4_K_M (4-bit)',
  },
]

export async function checkServerStatus(
  baseUrl: string = LLAMACPP_DEFAULT_BASE
): Promise<LlamaCppServerStatus> {
  try {
    const url = `${baseUrl.replace(/\/$/, '')}/health`
    const response = await fetch(url, { method: 'GET' })
    
    if (response.ok) {
      const data = await response.json()
      return {
        running: true,
        model: data.model,
        contextSize: data.ctx_size,
      }
    }
    
    return {
      running: false,
      error: `Server returned ${response.status}`,
    }
  } catch (e) {
    return {
      running: false,
      error: e instanceof Error ? e.message : 'Connection failed',
    }
  }
}

export function getLlamaServerCommand(modelPath: string, port: number = 8000): string {
  return `llama-server \\
    --model ${modelPath} \\
    --port ${port} --host 127.0.0.1 \\
    --flash-attn on --ctx-size 12288 \\
    --cache-type-k q4_0 --cache-type-v q4_0 \\
    --n-gpu-layers 99 --reasoning off -np 1 -t 4`
}

export function getModelDownloadCommand(model: LlamaCppModelInfo): string {
  return `python3 -c "
from huggingface_hub import hf_hub_download
hf_hub_download('${model.huggingfaceRepo}',
    '${model.huggingfaceFile}', local_dir='\\$HOME/models/')
"`
}

export function getQuickStartInstructions(): string {
  return `# Install llama.cpp
brew install llama.cpp
pip3 install huggingface_hub --break-system-packages

# Download recommended model (10.6 GB)
${getModelDownloadCommand(RECOMMENDED_MODELS[0])}

# Start server
${getLlamaServerCommand('~/models/Qwen3.5-35B-A3B-UD-IQ2_M.gguf')}

# Then enable llama.cpp in Orca Settings and select the model`
}
