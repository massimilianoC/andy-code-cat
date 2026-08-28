# Andy Code Cat — Multi-Provider LLM Architecture

> **MVP primary provider:** SiliconFlow
> **Principle:** each pipeline step uses the optimal model for that task
> **Extensibility:** adding a provider = implementing a TypeScript interface

---

## 1. Function → Model Map

Every step of the Andy Code Cat workflow has different requirements: quality vs speed vs cost vs a specific capability.

### 1.1 Default Assignment (SiliconFlow)

| Function | Role in the system | SiliconFlow model | Fallback |
|---|---|---|---|
| **CODING** | OpenCode / HTML+CSS+JS generation | `Qwen/Qwen3-Coder-480B-A35B-Instruct` | `Qwen/Qwen2.5-Coder-32B-Instruct` |
| **CODING_FAST** | Light refinements, post-audit fixes | `Qwen/Qwen3-Coder-30B-A3B-Instruct-2507` | `Qwen/Qwen2.5-Coder-32B-Instruct` |
| **DIALOGUE** | Wizard brief generation (step 5) | `Qwen/Qwen3-32B` | `deepseek-ai/DeepSeek-V3` |
| **DIALOGUE_FAST** | Credit estimation, project-type classification | `Qwen/Qwen3-8B` | `zai-org/GLM-4.5-Air` |
| **VISION** | Description of images attached by the user | `Qwen/Qwen2.5-VL-72B-Instruct` | `zai-org/GLM-4.6V` |
| **VISION_FAST** | Playwright screenshot audit (layout check) | `Qwen/Qwen2.5-VL-7B-Instruct` | `zai-org/GLM-4.5V` |
| **QUALITY_CHECK** | Brief/output correspondence check | `deepseek-ai/DeepSeek-V3` | `Qwen/Qwen2.5-72B-Instruct` |
| **IMAGE_GEN** | Site image generation (Phase 2) | `black-forest-labs/FLUX.1-dev` | `black-forest-labs/FLUX.1-schnell` |
| **IMAGE_GEN_FAST** | Thumbnail preview / fast placeholders | `black-forest-labs/FLUX.1-schnell` | — |
| **EMBEDDINGS** | Preprompt profile similarity search (Phase 3) | `BAAI/bge-m3` | `BAAI/bge-large-en-v1.5` |

### 1.2 Rationale Behind the Choices

**CODING → Qwen3-Coder-480B** is the most capable code-generation model on SiliconFlow.
`Qwen2.5-Coder-32B` as a fallback is fast, cheap, and already quite good for static sites.

**DIALOGUE → Qwen3-32B** for the brief: it needs reasoning, not just completion. It supports `enable_thinking: true` for more structured output.

**DIALOGUE_FAST → Qwen3-8B** for fast tasks (classification, estimation, routing): low latency, minimal cost.

**VISION → Qwen2.5-VL-72B** for describing attached images: it's the most capable VLM available on SiliconFlow.

**QUALITY_CHECK → DeepSeek-V3** for critical analysis of generated code vs the brief: excellent analytical reasoning.

**IMAGE_GEN → FLUX.1-dev** for quality, **FLUX.1-schnell** for speed/cost in tests.

---

## 2. Provider Interface (TypeScript)

### 2.1 Base Contract

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
  image_url?: { url: string };  // base64 or URL
}

export interface ChatOptions {
  temperature?: number;
  maxTokens?: number;
  jsonMode?: boolean;
  enableThinking?: boolean;    // for models that support it (Qwen3, DeepSeek-V3.1)
  thinkingBudget?: number;     // max tokens for reasoning
  stream?: boolean;
  stopSequences?: string[];
}

export interface ChatResponse {
  content: string;
  reasoning?: string;           // chain-of-thought if enableThinking=true
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

// Interface every provider MUST implement
export interface LLMProvider {
  name: string;
  
  // Returns the model name for a given role
  resolveModel(role: ModelRole): string;
  
  // Chat completion (text)
  chat(
    role: ModelRole,
    messages: ChatMessage[],
    options?: ChatOptions
  ): Promise<ChatResponse>;
  
  // Chat with streaming
  chatStream(
    role: ModelRole,
    messages: ChatMessage[],
    options?: ChatOptions
  ): AsyncGenerator<string>;
  
  // Vision: image analysis
  vision(
    role: 'vision' | 'vision_fast',
    imageBase64: string,
    prompt: string,
    options?: ChatOptions
  ): Promise<ChatResponse>;
  
  // Image generation
  imageGen(
    role: 'image_gen' | 'image_gen_fast',
    prompt: string,
    options?: ImageGenOptions
  ): Promise<ImageGenResponse>;
  
  // Embeddings (optional, not all providers support it)
  embed?(texts: string[]): Promise<EmbeddingResponse>;
  
  // Health check
  isAvailable(): Promise<boolean>;
  
  // Estimated cost per role (in internal token-equivalents)
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

  // Override: use provider X for role Y (admin-configurable)
  setRoleProvider(role: ModelRole, providerName: ProviderName): void {
    this.roleOverrides.set(role, providerName);
  }

  // Returns the correct provider for a role
  getForRole(role: ModelRole): LLMProvider {
    const overrideName = this.roleOverrides.get(role);
    const defaultName = this.getDefaultProvider(role);
    const name = overrideName ?? defaultName;
    
    const provider = this.providers.get(name);
    if (!provider) throw new Error(`Provider '${name}' not registered`);
    return provider;
  }

  private getDefaultProvider(role: ModelRole): ProviderName {
    // System-wide default: everything on SiliconFlow
    return 'siliconflow';
  }
}

export const providerRegistry = new ProviderRegistry();

// Initialization in apps/api/src/app.ts:
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
  
  // Role overrides from config (e.g. use Anthropic for quality_check)
  for (const [role, providerName] of Object.entries(config.ROLE_PROVIDER_OVERRIDES ?? {})) {
    providerRegistry.setRoleProvider(role as ModelRole, providerName as ProviderName);
  }
}
```

---

## 3. SiliconFlow Adapter — Full Implementation

```typescript
// apps/api/src/services/llm/providers/siliconflow.provider.ts

import axios, { AxiosInstance } from 'axios';
import { logger } from '../../logger';
import type {
  LLMProvider, ModelRole, ChatMessage, ChatOptions,
  ChatResponse, ImageGenOptions, ImageGenResponse, EmbeddingResponse
} from './base.provider';

// Role → SiliconFlow model mapping
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

// Fallback if the primary model is unavailable
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

// Models that support enable_thinking
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

  // Override the model for a specific role (from config/admin)
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

    // enable_thinking only for models that support it
    if (options.enableThinking && THINKING_CAPABLE.has(model)) {
      body.enable_thinking = true;
      body.thinking_budget = options.thinkingBudget ?? 4096;
    } else if (options.enableThinking) {
      // Model doesn't support thinking — ignore silently
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
          // partial chunk — ignore
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
      image_size: options.size ?? '1024x576',  // 16:9 default for websites
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

  // Estimated cost in "internal credits" for analytics
  // (not SiliconFlow's real cost, it's an estimate for billing users)
  estimateCost(role: ModelRole, inputTokens: number, outputTokens: number): number {
    const costPer1kTokens: Record<ModelRole, number> = {
      coding:        0.8,   // large model → more expensive
      coding_fast:   0.3,
      dialogue:      0.4,
      dialogue_fast: 0.05,  // very cheap
      vision:        0.6,
      vision_fast:   0.15,
      quality_check: 0.4,
      image_gen:     2.0,   // per image (not per token)
      image_gen_fast: 0.5,
      embeddings:    0.02,
    };
    
    const rate = costPer1kTokens[role] ?? 0.5;
    return ((inputTokens + outputTokens) / 1000) * rate;
  }

  // Retry with a fallback model on a 503/429 error
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
      this.modelOverrides[role] = fallback;  // temporary, for this call only
      
      try {
        const result = await this.chat(role, messages, options);
        return result;
      } finally {
        delete this.modelOverrides[role];  // restore after the call
      }
    }
    
    throw err;
  }
}
```

---

## 4. LLM Service — Facade for the Workers

```typescript
// apps/api/src/services/llm/llm.service.ts
// Workers never talk directly to the provider — they use this service

import { providerRegistry } from './provider-registry';
import type { ChatMessage, ChatOptions, ChatResponse, ImageGenOptions } from './providers/base.provider';

export class LlmService {

  // Generates the wizard brief (step 5)
  async generateBrief(
    userPrompt: string,
    attachmentSummary: string,
    themeId?: string
  ): Promise<{ brief: string; suggestedType: string; suggestedLang: string }> {
    const provider = providerRegistry.getForRole('dialogue');
    
    const messages: ChatMessage[] = [
      {
        role: 'system',
        content: 'You are an assistant that analyzes website requests and produces structured briefs in JSON. Respond ONLY with valid JSON, no markdown.'
      },
      {
        role: 'user',
        content: `Analyze this request and produce a structured brief.\n\nRequest: ${userPrompt}\n\nAttachments: ${attachmentSummary || 'none'}\n\nChosen theme: ${themeId || 'not specified'}\n\nRespond with JSON: { "brief": "markdown text of the brief", "type": "landing_page|mini_site|portfolio|ecommerce", "lang": "it|en|...", "sections": ["section1", ...], "estimatedComplexity": "simple|medium|complex" }`
      }
    ];

    const res = await provider.chat('dialogue', messages, {
      jsonMode: true,
      temperature: 0.3,
      maxTokens: 2000,
    });

    return JSON.parse(res.content);
  }

  // Describes an image attached by the user
  async describeImage(imageBase64: string): Promise<string> {
    const provider = providerRegistry.getForRole('vision');
    
    const res = await provider.vision(
      'vision',
      imageBase64,
      'Describe this image in detail so it can be used as context when generating a website. Include: main subjects, dominant colors, visual style, visible text, perceived tone of voice, relevant graphic elements. Answer in English.'
    );

    return res.content;
  }

  // Checks a Playwright screenshot against the brief
  async verifyScreenshot(
    screenshotBase64: string,
    originalBrief: string,
    issues: string[]
  ): Promise<{ score: number; issues: string[]; suggestions: string[] }> {
    const provider = providerRegistry.getForRole('vision_fast');
    
    const issuesText = issues.length > 0 ? `\n\nTechnical issues detected: ${issues.join(', ')}` : '';
    
    const res = await provider.vision(
      'vision_fast',
      screenshotBase64,
      `Analyze this website screenshot. The original brief was:\n${originalBrief}${issuesText}\n\nAssess: 1) Does the site match the brief? 2) Are the requested sections present? 3) Is the layout professional?\n\nRespond with JSON: { "score": 0-100, "issues": ["issue1"], "suggestions": ["suggestion1"] }`,
      { jsonMode: true, maxTokens: 1000 }
    );

    return JSON.parse(res.content);
  }

  // Checks the HTML content's text against the brief (faster than the screenshot)
  async verifyContent(
    htmlContent: string,
    originalBrief: string
  ): Promise<{ passed: boolean; score: number; missingElements: string[] }> {
    const provider = providerRegistry.getForRole('quality_check');
    
    const res = await provider.chat('quality_check', [
      {
        role: 'system',
        content: 'You are a quality checker for websites. Analyze the HTML and verify it matches the brief. Respond ONLY with JSON.'
      },
      {
        role: 'user',
        content: `Original brief:\n${originalBrief}\n\nGenerated HTML (first 5000 chars):\n${htmlContent.slice(0, 5000)}\n\nCheck: are all requested sections present? Is the tone correct? Does the site meet the goal?\n\nJSON: { "passed": bool, "score": 0-100, "missingElements": ["missing element"] }`
      }
    ], { jsonMode: true, temperature: 0.1, maxTokens: 800 });

    return JSON.parse(res.content);
  }

  // Generates an optimized prompt for image generation
  async generateImagePrompt(
    placeholderDescription: string,
    siteContext: { primaryColor: string; mood: string; industry: string }
  ): Promise<string> {
    const provider = providerRegistry.getForRole('dialogue_fast');
    
    const res = await provider.chat('dialogue_fast', [
      {
        role: 'user',
        content: `Generate an optimized prompt for FLUX image generation for this image:\n\nDescription: ${placeholderDescription}\nSite context: industry=${siteContext.industry}, mood=${siteContext.mood}, primary color=${siteContext.primaryColor}\n\nRespond ONLY with the prompt in English, no explanations. Max 200 words.`
      }
    ], { temperature: 0.7, maxTokens: 300 });

    return res.content.trim();
  }

  // Generates a real image (Phase 2)
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

## 5. Configuration via Environment Variables

```bash
# ===== PRIMARY PROVIDER =====
SILICONFLOW_API_KEY=sk-xxxxxxxxxxxxx
SILICONFLOW_BASE_URL=https://api.siliconflow.com/v1   # default

# ===== ALTERNATIVE PROVIDERS (all optional) =====
OPENAI_API_KEY=sk-xxxxxxxxxxxxx
ANTHROPIC_API_KEY=sk-ant-xxxxxxxxxxxxx
OLLAMA_BASE_URL=http://localhost:11434/v1
OPENROUTER_API_KEY=sk-or-xxxxxxxxxxxxx

# ===== ROLE OVERRIDES (optional) =====
# Format: JSON object role → providerName
# E.g.: use Anthropic for quality_check, OpenAI for image_gen
ROLE_PROVIDER_OVERRIDES='{"quality_check":"anthropic","image_gen":"openai"}'

# ===== PER-ROLE MODEL OVERRIDES (optional) =====
# Override the specific model for a role on SiliconFlow
SILICONFLOW_MODEL_CODING=Qwen/Qwen3-Coder-480B-A35B-Instruct
SILICONFLOW_MODEL_DIALOGUE=Qwen/Qwen3-32B
SILICONFLOW_MODEL_VISION=Qwen/Qwen2.5-VL-72B-Instruct
SILICONFLOW_MODEL_QUALITY_CHECK=deepseek-ai/DeepSeek-V3
SILICONFLOW_MODEL_IMAGE_GEN=black-forest-labs/FLUX.1-dev

# ===== OPENCODE (manual MVP configuration) =====
# The worker generates opencode.json for each job using SiliconFlow
# as an OpenAI-compatible provider via baseURL override
OPENCODE_DEFAULT_PROVIDER=siliconflow
OPENCODE_DEFAULT_MODEL=Qwen/Qwen3-Coder-480B-A35B-Instruct
```

---

## 6. OpenCode With SiliconFlow — Manual MVP Configuration

SiliconFlow exposes an OpenAI-compatible API. OpenCode can use it via a custom provider.

### 6.1 `opencode.json` Generated for Each Job

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

### 6.2 Environment Variables for the OpenCode Worker

```typescript
// In GenerationWorker, before spawning opencode:
const openCodeEnv = {
  ...process.env,
  // SiliconFlow as an OpenAI-compatible provider
  OPENAI_API_KEY: process.env.SILICONFLOW_API_KEY,
  OPENAI_BASE_URL: 'https://api.siliconflow.com/v1',
  // Explicit model override
  OPENCODE_MODEL: project.aiConfig.model ?? 'Qwen/Qwen3-Coder-480B-A35B-Instruct',
};
```

### 6.3 Note on Tool Calling With Qwen3-Coder

Qwen3-Coder supports function calling. OpenCode uses tool calling for file operations. Recommended configuration:

```json
{
  "model": "siliconflow/Qwen/Qwen3-Coder-480B-A35B-Instruct",
  "enable_thinking": false
}
```

> `enable_thinking: false` on Qwen3 when using tool calls — thinking mode interferes with function calling (as documented by SiliconFlow for DeepSeek-V3.1).

---

## 7. Admin Dashboard — Provider Configuration (Phase 3 Roadmap)

In Phase 3, provider configuration will be manageable from the admin dashboard. MongoDB schema:

```typescript
interface SystemConfig {
  _id: 'global';                   // singleton document
  
  llm: {
    // Active providers and their config (encrypted API keys)
    providers: Array<{
      name: ProviderName;
      isActive: boolean;
      apiKey: string;              // encrypted with AES-256
      baseUrl?: string;
      lastHealthCheck?: Date;
      healthStatus?: 'ok' | 'degraded' | 'down';
    }>;
    
    // Model assignment per role (overrides the default)
    roleAssignments: Array<{
      role: ModelRole;
      providerName: ProviderName;
      modelId: string;
      fallbackModelId?: string;
      isActive: boolean;
    }>;
  };
  
  // Global OpenCode config (file-based in MVP, here in Phase 3)
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

## 8. Adding a New Provider — Checklist

To add a new provider (e.g. Mistral, Cohere, Gemini):

1. Create `apps/api/src/services/llm/providers/{name}.provider.ts`
2. Implement the full `LLMProvider` interface
3. Add a `MODEL_MAP` with the provider's models for every role
4. Register it in `initProviders()` if the API key is present
5. Add the `{NAME}_API_KEY` env var to `.env.example`
6. Add it to the §1.1 table with the recommended models

The rest of the system (worker, service, billing) doesn't change — it only talks to `LlmService`.
