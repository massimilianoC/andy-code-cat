# Andy Code Cat — Multi-Provider LLM Architecture

> **Provider primario MVP:** SiliconFlow  
> **Principio:** ogni step del pipeline usa il modello ottimale per quel task  
> **Estendibilità:** aggiungere un provider = implementare un'interfaccia TypeScript

---

## 1. Mappa Funzione → Modello

Ogni step del workflow Andy Code Cat ha requisiti diversi: qualità vs velocità vs costo vs capability specifica.

### 1.1 Assegnazione Default (SiliconFlow)

| Funzione | Ruolo nel sistema | Modello SiliconFlow | Fallback |
|---|---|---|---|
| **CODING** | OpenCode / generazione HTML+CSS+JS | `Qwen/Qwen3-Coder-480B-A35B-Instruct` | `Qwen/Qwen2.5-Coder-32B-Instruct` |
| **CODING_FAST** | Raffinamenti leggeri, fix post-audit | `Qwen/Qwen3-Coder-30B-A3B-Instruct-2507` | `Qwen/Qwen2.5-Coder-32B-Instruct` |
| **DIALOGUE** | Generazione brief wizard (step 5) | `Qwen/Qwen3-32B` | `deepseek-ai/DeepSeek-V3` |
| **DIALOGUE_FAST** | Stima crediti, classificazione tipo progetto | `Qwen/Qwen3-8B` | `zai-org/GLM-4.5-Air` |
| **VISION** | Descrizione immagini allegate dall'utente | `Qwen/Qwen2.5-VL-72B-Instruct` | `zai-org/GLM-4.6V` |
| **VISION_FAST** | Screenshot audit Playwright (verifica layout) | `Qwen/Qwen2.5-VL-7B-Instruct` | `zai-org/GLM-4.5V` |
| **QUALITY_CHECK** | Verifica corrispondenza brief/output | `deepseek-ai/DeepSeek-V3` | `Qwen/Qwen2.5-72B-Instruct` |
| **IMAGE_GEN** | Generazione immagini sito (Phase 2) | `black-forest-labs/FLUX.1-dev` | `black-forest-labs/FLUX.1-schnell` |
| **IMAGE_GEN_FAST** | Thumbnail preview / placeholder veloci | `black-forest-labs/FLUX.1-schnell` | — |
| **EMBEDDINGS** | Similarity search profili preprompt (Phase 3) | `BAAI/bge-m3` | `BAAI/bge-large-en-v1.5` |

### 1.2 Razionale Scelte

**CODING → Qwen3-Coder-480B** è il modello più capace per generazione codice su SiliconFlow.
`Qwen2.5-Coder-32B` come fallback è veloce, economico e già molto buono per siti statici.

**DIALOGUE → Qwen3-32B** per il brief: serve ragionamento, non solo completamento. Supporta `enable_thinking: true` per output più strutturato.

**DIALOGUE_FAST → Qwen3-8B** per task veloci (classificazione, stima, routing): latenza bassa, costo minimo.

**VISION → Qwen2.5-VL-72B** per descrizione immagini allegate: è il VLM più capace disponibile su SiliconFlow.

**QUALITY_CHECK → DeepSeek-V3** per analisi critica del codice generato vs brief: ottimo ragionamento analitico.

**IMAGE_GEN → FLUX.1-dev** per qualità, **FLUX.1-schnell** per velocità/costo nei test.

---

## 2. Interfaccia Provider (TypeScript)

### 2.1 Contratto Base

```typescript
// apps/api/src/services/llm/providers/base.provider.ts

export type ModelRole = 
  | 'coding'
  | 'coding_fast'
  | 'dialogue'
  | 'dialogue_fast'
  | 'vision'
  | 'vision_fast'
  | 'quality_check'
  | 'image_gen'
  | 'image_gen_fast'
  | 'embeddings';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | ContentPart[];
}

export interface ContentPart {
  type: 'text' | 'image_url';
  text?: string;
  image_url?: { url: string };  // base64 o URL
}

export interface ChatOptions {
  temperature?: number;
  maxTokens?: number;
  jsonMode?: boolean;
  enableThinking?: boolean;    // per modelli che lo supportano (Qwen3, DeepSeek-V3.1)
  thinkingBudget?: number;     // token massimi per reasoning
  stream?: boolean;
  stopSequences?: string[];
}

export interface ChatResponse {
  content: string;
  reasoning?: string;           // chain-of-thought se enableThinking=true
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  model: string;
  latencyMs: number;
}

export interface ImageGenOptions {
  size?: '512x512' | '768x1024' | '1024x768' | '576x1024' | '1024x576';
  outputFormat?: 'png' | 'jpeg';
  seed?: number;
  negativePrompt?: string;
}

export interface ImageGenResponse {
  images: Array<{ url: string }>;
  seed: number;
  latencyMs: number;
}

export interface EmbeddingResponse {
  embeddings: number[][];
  usage: { totalTokens: number };
}

// Interfaccia che ogni provider DEVE implementare
export interface LLMProvider {
  name: string;
  
  // Restituisce il nome del modello per un dato ruolo
  resolveModel(role: ModelRole): string;
  
  // Chat completion (testo)
  chat(
    role: ModelRole,
    messages: ChatMessage[],
    options?: ChatOptions
  ): Promise<ChatResponse>;
  
  // Chat con streaming
  chatStream(
    role: ModelRole,
    messages: ChatMessage[],
    options?: ChatOptions
  ): AsyncGenerator<string>;
  
  // Vision: analisi immagine
  vision(
    role: 'vision' | 'vision_fast',
    imageBase64: string,
    prompt: string,
    options?: ChatOptions
  ): Promise<ChatResponse>;
  
  // Generazione immagini
  imageGen(
    role: 'image_gen' | 'image_gen_fast',
    prompt: string,
    options?: ImageGenOptions
  ): Promise<ImageGenResponse>;
  
  // Embeddings (opzionale, non tutti i provider lo supportano)
  embed?(texts: string[]): Promise<EmbeddingResponse>;
  
  // Health check
  isAvailable(): Promise<boolean>;
  
  // Costo stimato per role (in token-equivalenti interni)
  estimateCost(role: ModelRole, inputTokens: number, outputTokens: number): number;
}
```

### 2.2 Provider Registry

```typescript
// apps/api/src/services/llm/provider-registry.ts

import { LLMProvider, ModelRole } from './providers/base.provider';
import { SiliconFlowProvider } from './providers/siliconflow.provider';
import { OpenAIProvider } from './providers/openai.provider';
import { AnthropicProvider } from './providers/anthropic.provider';
import { OllamaProvider } from './providers/ollama.provider';

type ProviderName = 'siliconflow' | 'openai' | 'anthropic' | 'ollama' | 'openrouter';

class ProviderRegistry {
  private providers: Map<ProviderName, LLMProvider> = new Map();
  private roleOverrides: Map<ModelRole, ProviderName> = new Map();

  register(name: ProviderName, provider: LLMProvider): void {
    this.providers.set(name, provider);
  }

  // Override: usa provider X per il ruolo Y (configurabile da admin)
  setRoleProvider(role: ModelRole, providerName: ProviderName): void {
    this.roleOverrides.set(role, providerName);
  }

  // Restituisce il provider corretto per un ruolo
  getForRole(role: ModelRole): LLMProvider {
    const overrideName = this.roleOverrides.get(role);
    const defaultName = this.getDefaultProvider(role);
    const name = overrideName ?? defaultName;
    
    const provider = this.providers.get(name);
    if (!provider) throw new Error(`Provider '${name}' not registered`);
    return provider;
  }

  private getDefaultProvider(role: ModelRole): ProviderName {
    // Default system-wide: tutto su SiliconFlow
    return 'siliconflow';
  }
}

export const providerRegistry = new ProviderRegistry();

// Inizializzazione in apps/api/src/app.ts:
export function initProviders(config: AppConfig): void {
  providerRegistry.register('siliconflow', new SiliconFlowProvider({
    apiKey: config.SILICONFLOW_API_KEY,
    baseUrl: 'https://api.siliconflow.com/v1'
  }));

  if (config.OPENAI_API_KEY) {
    providerRegistry.register('openai', new OpenAIProvider({
      apiKey: config.OPENAI_API_KEY
    }));
  }

  if (config.ANTHROPIC_API_KEY) {
    providerRegistry.register('anthropic', new AnthropicProvider({
      apiKey: config.ANTHROPIC_API_KEY
    }));
  }

  if (config.OLLAMA_BASE_URL) {
    providerRegistry.register('ollama', new OllamaProvider({
      baseUrl: config.OLLAMA_BASE_URL
    }));
  }
  
  // Role overrides da config (es. usa Anthropic per quality_check)
  for (const [role, providerName] of Object.entries(config.ROLE_PROVIDER_OVERRIDES ?? {})) {
    providerRegistry.setRoleProvider(role as ModelRole, providerName as ProviderName);
  }
}
```

---

## 3. SiliconFlow Adapter — Implementazione Completa

```typescript
// apps/api/src/services/llm/providers/siliconflow.provider.ts

import axios, { AxiosInstance } from 'axios';
import { logger } from '../../logger';
import type {
  LLMProvider, ModelRole, ChatMessage, ChatOptions,
  ChatResponse, ImageGenOptions, ImageGenResponse, EmbeddingResponse
} from './base.provider';

// Mapping ruolo → modello SiliconFlow
const MODEL_MAP: Record<ModelRole, string> = {
  coding:           'Qwen/Qwen3-Coder-480B-A35B-Instruct',
  coding_fast:      'Qwen/Qwen3-Coder-30B-A3B-Instruct-2507',
  dialogue:         'Qwen/Qwen3-32B',
  dialogue_fast:    'Qwen/Qwen3-8B',
  vision:           'Qwen/Qwen2.5-VL-72B-Instruct',
  vision_fast:      'Qwen/Qwen2.5-VL-7B-Instruct',
  quality_check:    'deepseek-ai/DeepSeek-V3',
  image_gen:        'black-forest-labs/FLUX.1-dev',
  image_gen_fast:   'black-forest-labs/FLUX.1-schnell',
  embeddings:       'BAAI/bge-m3',
};

// Fallback se modello primario non disponibile
const FALLBACK_MAP: Partial<Record<ModelRole, string>> = {
  coding:        'Qwen/Qwen2.5-Coder-32B-Instruct',
  coding_fast:   'Qwen/Qwen2.5-Coder-32B-Instruct',
  dialogue:      'deepseek-ai/DeepSeek-V3',
  dialogue_fast: 'zai-org/GLM-4.5-Air',
  vision:        'zai-org/GLM-4.6V',
  vision_fast:   'zai-org/GLM-4.5V',
  quality_check: 'Qwen/Qwen2.5-72B-Instruct',
  image_gen:     'black-forest-labs/FLUX.1-schnell',
  embeddings:    'BAAI/bge-large-en-v1.5',
};

// Modelli che supportano enable_thinking
const THINKING_CAPABLE = new Set([
  'Qwen/Qwen3-8B', 'Qwen/Qwen3-14B', 'Qwen/Qwen3-32B',
  'Qwen/Qwen3-235B-A22B', 'deepseek-ai/DeepSeek-V3.1',
  'deepseek-ai/DeepSeek-V3.2', 'tencent/Hunyuan-A13B-Instruct'
]);

interface SiliconFlowConfig {
  apiKey: string;
  baseUrl?: string;
  timeout?: number;
}

export class SiliconFlowProvider implements LLMProvider {
  name = 'siliconflow';
  private client: AxiosInstance;
  private modelOverrides: Partial<Record<ModelRole, string>> = {};

  constructor(private config: SiliconFlowConfig) {
    this.client = axios.create({
      baseURL: config.baseUrl ?? 'https://api.siliconflow.com/v1',
      headers: {
        'Authorization': `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: config.timeout ?? 120_000,
    });
  }

  // Override modello per un ruolo specifico (da config/admin)
  setModelOverride(role: ModelRole, model: string): void {
    this.modelOverrides[role] = model;
  }

  resolveModel(role: ModelRole): string {
    return this.modelOverrides[role] ?? MODEL_MAP[role];
  }

  async chat(
    role: ModelRole,
    messages: ChatMessage[],
    options: ChatOptions = {}
  ): Promise<ChatResponse> {
    const model = this.resolveModel(role);
    const start = Date.now();

    const body: Record<string, unknown> = {
      model,
      messages,
      max_tokens: options.maxTokens ?? 8192,
      temperature: options.temperature ?? 0.7,
      stream: false,
    };

    if (options.jsonMode) {
      body.response_format = { type: 'json_object' };
    }

    if (options.stopSequences?.length) {
      body.stop = options.stopSequences;
    }

    // enable_thinking solo per modelli che lo supportano
    if (options.enableThinking && THINKING_CAPABLE.has(model)) {
      body.enable_thinking = true;
      body.thinking_budget = options.thinkingBudget ?? 4096;
    } else if (options.enableThinking) {
      // Modello non supporta thinking — ignora silenziosamente
      logger.debug({ model, role }, 'Model does not support thinking, skipping');
    }

    try {
      const res = await this.client.post('/chat/completions', body);
      const choice = res.data.choices[0];
      
      return {
        content: choice.message.content ?? '',
        reasoning: choice.message.reasoning_content,
        usage: {
          promptTokens: res.data.usage.prompt_tokens,
          completionTokens: res.data.usage.completion_tokens,
          totalTokens: res.data.usage.total_tokens,
        },
        model,
        latencyMs: Date.now() - start,
      };
    } catch (err) {
      return this.handleErrorWithFallback(role, model, err, messages, options, start);
    }
  }

  async *chatStream(
    role: ModelRole,
    messages: ChatMessage[],
    options: ChatOptions = {}
  ): AsyncGenerator<string> {
    const model = this.resolveModel(role);

    const body = {
      model,
      messages,
      max_tokens: options.maxTokens ?? 8192,
      temperature: options.temperature ?? 0.7,
      stream: true,
    };

    const res = await this.client.post('/chat/completions', body, {
      responseType: 'stream',
    });

    for await (const chunk of res.data) {
      const lines = chunk.toString().split('\n').filter(Boolean);
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6);
        if (data === '[DONE]') return;
        try {
          const parsed = JSON.parse(data);
          const delta = parsed.choices?.[0]?.delta?.content;
          if (delta) yield delta;
        } catch {
          // chunk parziale — ignora
        }
      }
    }
  }

  async vision(
    role: 'vision' | 'vision_fast',
    imageBase64: string,
    prompt: string,
    options: ChatOptions = {}
  ): Promise<ChatResponse> {
    const messages: ChatMessage[] = [{
      role: 'user',
      content: [
        {
          type: 'image_url',
          image_url: { url: `data:image/jpeg;base64,${imageBase64}` }
        },
        { type: 'text', text: prompt }
      ]
    }];

    return this.chat(role, messages, options);
  }

  async imageGen(
    role: 'image_gen' | 'image_gen_fast',
    prompt: string,
    options: ImageGenOptions = {}
  ): Promise<ImageGenResponse> {
    const model = this.resolveModel(role);
    const start = Date.now();

    const body: Record<string, unknown> = {
      model,
      prompt,
      image_size: options.size ?? '1024x576',  // 16:9 default per siti web
      output_format: options.outputFormat ?? 'jpeg',
    };

    if (options.seed !== undefined) body.seed = options.seed;
    if (options.negativePrompt) body.negative_prompt = options.negativePrompt;

    const res = await this.client.post('/images/generations', body);

    return {
      images: res.data.images,
      seed: res.data.seed,
      latencyMs: Date.now() - start,
    };
  }

  async embed(texts: string[]): Promise<EmbeddingResponse> {
    const model = this.resolveModel('embeddings');
    
    const res = await this.client.post('/embeddings', {
      model,
      input: texts,
      encoding_format: 'float',
    });

    return {
      embeddings: res.data.data.map((d: { embedding: number[] }) => d.embedding),
      usage: { totalTokens: res.data.usage.total_tokens },
    };
  }

  async isAvailable(): Promise<boolean> {
    try {
      const res = await this.client.get('/models', { timeout: 5000 });
      return res.status === 200;
    } catch {
      return false;
    }
  }

  // Costo stimato in "crediti interni" per analytics
  // (non è il costo reale SiliconFlow, è una stima per il billing agli utenti)
  estimateCost(role: ModelRole, inputTokens: number, outputTokens: number): number {
    const costPer1kTokens: Record<ModelRole, number> = {
      coding:        0.8,   // modello grande → più caro
      coding_fast:   0.3,
      dialogue:      0.4,
      dialogue_fast: 0.05,  // molto economico
      vision:        0.6,
      vision_fast:   0.15,
      quality_check: 0.4,
      image_gen:     2.0,   // per immagine (non per token)
      image_gen_fast: 0.5,
      embeddings:    0.02,
    };
    
    const rate = costPer1kTokens[role] ?? 0.5;
    return ((inputTokens + outputTokens) / 1000) * rate;
  }

  // Retry con fallback model se errore 503/429
  private async handleErrorWithFallback(
    role: ModelRole,
    primaryModel: string,
    err: unknown,
    messages: ChatMessage[],
    options: ChatOptions,
    start: number
  ): Promise<ChatResponse> {
    const fallback = FALLBACK_MAP[role];
    
    if (fallback && axios.isAxiosError(err) && 
        (err.response?.status === 503 || err.response?.status === 429)) {
      logger.warn({ role, primaryModel, fallback }, 'Primary model unavailable, using fallback');
      this.modelOverrides[role] = fallback;  // temporaneo per questa chiamata
      
      try {
        const result = await this.chat(role, messages, options);
        return result;
      } finally {
        delete this.modelOverrides[role];  // ripristina dopo la chiamata
      }
    }
    
    throw err;
  }
}
```

---

## 4. LLM Service — Facade per i Worker

```typescript
// apps/api/src/services/llm/llm.service.ts
// I worker non parlano mai direttamente con il provider — usano questo service

import { providerRegistry } from './provider-registry';
import type { ChatMessage, ChatOptions, ChatResponse, ImageGenOptions } from './providers/base.provider';

export class LlmService {

  // Genera il brief del wizard (step 5)
  async generateBrief(
    userPrompt: string,
    attachmentSummary: string,
    themeId?: string
  ): Promise<{ brief: string; suggestedType: string; suggestedLang: string }> {
    const provider = providerRegistry.getForRole('dialogue');
    
    const messages: ChatMessage[] = [
      {
        role: 'system',
        content: 'Sei un assistente che analizza richieste di siti web e produce brief strutturati in JSON. Rispondi SOLO con JSON valido, senza markdown.'
      },
      {
        role: 'user',
        content: `Analizza questa richiesta e produci un brief strutturato.\n\nRichiesta: ${userPrompt}\n\nAllegati: ${attachmentSummary || 'nessuno'}\n\nTema scelto: ${themeId || 'non specificato'}\n\nRispondi con JSON: { "brief": "testo markdown del brief", "type": "landing_page|mini_site|portfolio|ecommerce", "lang": "it|en|...", "sections": ["sezione1", ...], "estimatedComplexity": "simple|medium|complex" }`
      }
    ];

    const res = await provider.chat('dialogue', messages, {
      jsonMode: true,
      temperature: 0.3,
      maxTokens: 2000,
    });

    return JSON.parse(res.content);
  }

  // Descrive un'immagine allegata dall'utente
  async describeImage(imageBase64: string): Promise<string> {
    const provider = providerRegistry.getForRole('vision');
    
    const res = await provider.vision(
      'vision',
      imageBase64,
      'Descrivi dettagliatamente questa immagine per usarla come contesto nella generazione di un sito web. Includi: soggetti principali, colori dominanti, stile visivo, testo visibile, tone of voice percepito, elementi grafici rilevanti. Rispondi in italiano.'
    );

    return res.content;
  }

  // Verifica screenshot Playwright vs brief
  async verifyScreenshot(
    screenshotBase64: string,
    originalBrief: string,
    issues: string[]
  ): Promise<{ score: number; issues: string[]; suggestions: string[] }> {
    const provider = providerRegistry.getForRole('vision_fast');
    
    const issuesText = issues.length > 0 ? `\n\nProblemi tecnici rilevati: ${issues.join(', ')}` : '';
    
    const res = await provider.vision(
      'vision_fast',
      screenshotBase64,
      `Analizza questo screenshot di un sito web. Il brief originale era:\n${originalBrief}${issuesText}\n\nValuta: 1) Il sito risponde al brief? 2) Le sezioni richieste ci sono? 3) Il layout è professionale?\n\nRispondi con JSON: { "score": 0-100, "issues": ["problema1"], "suggestions": ["suggerimento1"] }`,
      { jsonMode: true, maxTokens: 1000 }
    );

    return JSON.parse(res.content);
  }

  // Verifica testuale contenuto HTML vs brief (più veloce dello screenshot)
  async verifyContent(
    htmlContent: string,
    originalBrief: string
  ): Promise<{ passed: boolean; score: number; missingElements: string[] }> {
    const provider = providerRegistry.getForRole('quality_check');
    
    const res = await provider.chat('quality_check', [
      {
        role: 'system',
        content: 'Sei un quality checker per siti web. Analizza HTML e verifica che risponda al brief. Rispondi SOLO con JSON.'
      },
      {
        role: 'user',
        content: `Brief originale:\n${originalBrief}\n\nHTML generato (prime 5000 char):\n${htmlContent.slice(0, 5000)}\n\nVerifica: tutte le sezioni richieste ci sono? Il tono è corretto? Il sito risponde all'obiettivo?\n\nJSON: { "passed": bool, "score": 0-100, "missingElements": ["elemento mancante"] }`
      }
    ], { jsonMode: true, temperature: 0.1, maxTokens: 800 });

    return JSON.parse(res.content);
  }

  // Genera prompt ottimizzato per image generation
  async generateImagePrompt(
    placeholderDescription: string,
    siteContext: { primaryColor: string; mood: string; industry: string }
  ): Promise<string> {
    const provider = providerRegistry.getForRole('dialogue_fast');
    
    const res = await provider.chat('dialogue_fast', [
      {
        role: 'user',
        content: `Genera un prompt ottimizzato per FLUX image generation per questa immagine:\n\nDescrizione: ${placeholderDescription}\nContesto sito: settore=${siteContext.industry}, mood=${siteContext.mood}, colore primario=${siteContext.primaryColor}\n\nRispondi SOLO con il prompt in inglese, senza spiegazioni. Max 200 parole.`
      }
    ], { temperature: 0.7, maxTokens: 300 });

    return res.content.trim();
  }

  // Genera un'immagine reale (Phase 2)
  async generateImage(prompt: string, size: string, fast = false) {
    const provider = providerRegistry.getForRole(fast ? 'image_gen_fast' : 'image_gen');
    
    return provider.imageGen(
      fast ? 'image_gen_fast' : 'image_gen',
      prompt,
      {
        size: size as ImageGenOptions['size'],
        negativePrompt: 'blurry, low quality, distorted, text, watermark, cartoon',
        outputFormat: 'jpeg'
      }
    );
  }
}

export const llmService = new LlmService();
```

---

## 5. Configurazione via Environment Variables

```bash
# ===== PROVIDER PRIMARIO =====
SILICONFLOW_API_KEY=sk-xxxxxxxxxxxxx
SILICONFLOW_BASE_URL=https://api.siliconflow.com/v1   # default

# ===== PROVIDER ALTERNATIVI (tutti opzionali) =====
OPENAI_API_KEY=sk-xxxxxxxxxxxxx
ANTHROPIC_API_KEY=sk-ant-xxxxxxxxxxxxx
OLLAMA_BASE_URL=http://localhost:11434/v1
OPENROUTER_API_KEY=sk-or-xxxxxxxxxxxxx

# ===== OVERRIDE RUOLI (opzionale) =====
# Formato: JSON object role → providerName
# Es: usa Anthropic per quality_check, OpenAI per image_gen
ROLE_PROVIDER_OVERRIDES='{"quality_check":"anthropic","image_gen":"openai"}'

# ===== OVERRIDE MODELLI PER RUOLO (opzionale) =====
# Override il modello specifico per un ruolo su SiliconFlow
SILICONFLOW_MODEL_CODING=Qwen/Qwen3-Coder-480B-A35B-Instruct
SILICONFLOW_MODEL_DIALOGUE=Qwen/Qwen3-32B
SILICONFLOW_MODEL_VISION=Qwen/Qwen2.5-VL-72B-Instruct
SILICONFLOW_MODEL_QUALITY_CHECK=deepseek-ai/DeepSeek-V3
SILICONFLOW_MODEL_IMAGE_GEN=black-forest-labs/FLUX.1-dev

# ===== OPENCODE (configurazione manuale MVP) =====
# Il worker genera opencode.json per ogni job usando SiliconFlow
# come provider OpenAI-compatible tramite baseURL override
OPENCODE_DEFAULT_PROVIDER=siliconflow
OPENCODE_DEFAULT_MODEL=Qwen/Qwen3-Coder-480B-A35B-Instruct
```

---

## 6. OpenCode con SiliconFlow — Configurazione Manuale MVP

SiliconFlow espone un'API OpenAI-compatible. OpenCode la può usare tramite provider custom.

### 6.1 `opencode.json` generato per ogni job

```json
{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "siliconflow": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "SiliconFlow",
      "options": {
        "baseURL": "https://api.siliconflow.com/v1",
        "apiKey": "${SILICONFLOW_API_KEY}"
      },
      "models": {
        "Qwen/Qwen3-Coder-480B-A35B-Instruct": {
          "name": "Qwen3-Coder-480B",
          "tools": true
        },
        "Qwen/Qwen2.5-Coder-32B-Instruct": {
          "name": "Qwen2.5-Coder-32B",
          "tools": true
        }
      }
    }
  },
  "model": "siliconflow/Qwen/Qwen3-Coder-480B-A35B-Instruct"
}
```

### 6.2 Variabili d'ambiente per OpenCode Worker

```typescript
// Nel GenerationWorker, prima di spawn opencode:
const openCodeEnv = {
  ...process.env,
  // SiliconFlow come provider OpenAI-compatible
  OPENAI_API_KEY: process.env.SILICONFLOW_API_KEY,
  OPENAI_BASE_URL: 'https://api.siliconflow.com/v1',
  // Override esplicito del modello
  OPENCODE_MODEL: project.aiConfig.model ?? 'Qwen/Qwen3-Coder-480B-A35B-Instruct',
};
```

### 6.3 Nota su Tool Calling con Qwen3-Coder

Qwen3-Coder supporta function calling. OpenCode usa tool calling per le operazioni su file. Configurazione raccomandata:

```json
{
  "model": "siliconflow/Qwen/Qwen3-Coder-480B-A35B-Instruct",
  "enable_thinking": false
}
```

> `enable_thinking: false` su Qwen3 quando si usano tool calls — il thinking mode interferisce con il function calling (come documentato da SiliconFlow per DeepSeek-V3.1).

---

## 7. Admin Dashboard — Configurazione Provider (Roadmap Phase 3)

In Phase 3, la configurazione provider sarà gestibile da admin dashboard. Schema MongoDB:

```typescript
interface SystemConfig {
  _id: 'global';                   // singleton document
  
  llm: {
    // Provider attivi e le loro config (API key cifrate)
    providers: Array<{
      name: ProviderName;
      isActive: boolean;
      apiKey: string;              // cifrato con AES-256
      baseUrl?: string;
      lastHealthCheck?: Date;
      healthStatus?: 'ok' | 'degraded' | 'down';
    }>;
    
    // Assegnazione modello per ruolo (sovrascrive default)
    roleAssignments: Array<{
      role: ModelRole;
      providerName: ProviderName;
      modelId: string;
      fallbackModelId?: string;
      isActive: boolean;
    }>;
  };
  
  // OpenCode config globale (in MVP è file-based, in Phase 3 è qui)
  openCode: {
    defaultProvider: ProviderName;
    defaultModel: string;
    maxConcurrentJobs: number;
    timeoutMs: number;
    maxAutoRefinementLoops: number;
    dangerouslySkipPermissions: boolean;
  };
  
  updatedAt: Date;
  updatedBy: ObjectId;
}
```

---

## 8. Aggiunta Nuovo Provider — Checklist

Per aggiungere un nuovo provider (es. Mistral, Cohere, Gemini):

1. Creare `apps/api/src/services/llm/providers/{name}.provider.ts`
2. Implementare l'interfaccia `LLMProvider` completa
3. Aggiungere `MODEL_MAP` con i modelli del provider per ogni ruolo
4. Registrare in `initProviders()` se API key presente
5. Aggiungere env var `{NAME}_API_KEY` a `.env.example`
6. Aggiungere alla tabella §1.1 con i modelli raccomandati

Il resto del sistema (worker, service, billing) non cambia — parla solo con `LlmService`.
