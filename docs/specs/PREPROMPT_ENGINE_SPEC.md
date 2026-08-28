# Andy Code Cat — PrepromptEngine: Detailed Specification

> **Superseded composition flow:** the live system-prompt composition pipeline (Layer 1 chat-preview
> path) described elsewhere in this document has been superseded by the registry-driven composer in
> `apps/api/src/application/llm/systemPromptComposer.ts` (`composeSystemPromptWithLayers`), wired
> exclusively through `resolveContext()` in `llmRoutes.ts`. See
> [PROMPT_LAYER_SSOT_SPEC.md](PROMPT_LAYER_SSOT_SPEC.md) for the canonical layer registry, trace
> persistence, and frontend rendering contract. This document is retained for the PrepromptEngine's
> other responsibilities (PDF/image ingestion, `resolvedClaudeMd`/`resolvedOpenCodeJson` output).

---

> **Scope:** Full technical specification for the PrepromptEngine service  
> **Dependencies:** MongoDB (`PrepromptProfile`), Nunjucks templates, `pdf-parse`, `sharp`  
> **Project location:** `apps/api/src/services/preprompt/`

---

## 1. Responsibilities

The PrepromptEngine is the service that transforms **raw input** (text prompt, PDF, image) into a **structured, enriched prompt** ready to be passed to OpenCode.

It produces three distinct outputs for each job:

| Output | Description | Used by |
|---|---|---|
| `resolvedPrompt` | Final wrapped and enriched prompt | OpenCode CLI argument |
| `resolvedClaudeMd` | Project-specific `CLAUDE.md` content | Written to the working directory |
| `resolvedOpenCodeJson` | Dynamic `opencode.json` config for the job | Written to the working directory |

---

## 2. Internal Architecture

```
PrepromptEngine
│
├── InputProcessor           — normalises heterogeneous input
│   ├── TextExtractor        — extracts text from PDF
│   ├── ImageDescriber       — describes images via LLM vision
│   └── AttachmentSanitizer  — validates attachment type/size
│
├── ContextBuilder           — builds the job's context
│   ├── ProjectContextLoader — loads project data from the DB
│   ├── IterationContext     — loads the previous iteration's manifest/summary
│   └── ThemeResolver        — resolves theme overrides if present
│
├── LayerComposer            — applies the profile's layers in order
│   ├── TemplateRenderer     — Nunjucks variable rendering
│   ├── ConditionEvaluator   — evaluates JSONata conditions on layers
│   └── LayerMerger          — concatenates layers into the final prompt
│
├── ClaudeMdGenerator        — generates the CLAUDE.md for the session
│   └── SkillsInjector       — copies skill files into the working dir
│
└── OpenCodeConfigGenerator  — generates a dynamic opencode.json
    └── ProviderResolver     — resolves the API key for the chosen provider
```

---

## 3. Execution Flow

```typescript
// Public interface of the service
interface PrepromptEngine {
  process(input: PrepromptInput): Promise<PrepromptOutput>;
  previewResolution(input: PrepromptInput): Promise<PrepromptPreview>;
}

interface PrepromptInput {
  job: Job;                          // MongoDB job with attachments
  project: Project;                  // project with aiConfig
  prepromptProfile: PrepromptProfile; // selected profile
  workspaceDir: string;              // job's working directory path
}

interface PrepromptOutput {
  resolvedPrompt: string;            // prompt da passare a OpenCode CLI
  resolvedClaudeMd: string;          // contenuto CLAUDE.md
  resolvedOpenCodeJson: object;      // oggetto config opencode
  imagesToProcess: string[];         // path immagini allegate per vision
  debugInfo: {                       // for audit/logging
    layersApplied: string[];
    variablesResolved: Record<string, string>;
    attachmentsSummary: string;
    processingTimeMs: number;
  };
}
```

### 3.1 Step 1 — Input Processing

```typescript
class InputProcessor {
  async process(job: Job): Promise<ProcessedInput> {
    const results: ProcessedInput = {
      rawPrompt: job.input.prompt ?? '',
      extractedTexts: [],
      imageDescriptions: [],
      sanitizedAttachments: []
    };

    for (const attachment of job.input.attachments ?? []) {
      switch (attachment.mimeType) {

        case 'application/pdf':
          // Extract text with pdf-parse
          // Max 50,000 extracted chars (truncate and note if exceeded)
          // Preserve structure: headers, bullets, and tables as text
          const text = await this.textExtractor.extract(attachment.filePath);
          results.extractedTexts.push({
            filename: attachment.originalName,
            content: text.slice(0, 50000),
            truncated: text.length > 50000
          });
          break;

        case 'image/jpeg':
        case 'image/png':
        case 'image/webp':
          // If the project model supports vision:
          //   → call the LLM with the image and a prompt such as:
          //     "Describe this content in detail so it can be used as
          //      context for generating a website. Include visible text,
          //      layout structure, primary colors, graphic elements,
          //      and perceived tone of voice."
          // If the model does NOT support vision:
          //   → use the filename and EXIF data as minimal context
          const description = await this.imageDescriber.describe(
            attachment.filePath,
            project.aiConfig
          );
          results.imageDescriptions.push({
            filename: attachment.originalName,
            description
          });
          break;
      }
    }

    return results;
  }
}
```

### 3.2 Step 2 — Context Building

The ContextBuilder assembles a `TemplateContext` object used by Nunjucks:

```typescript
interface TemplateContext {
  project: {
    name: string;
    slug: string;
    type: string;            // landing_page | mini_site | etc.
    description?: string;
    lang: string;            // it | en | etc.
  };
  
  input: {
    prompt: string;          // raw user prompt
    attachments: {
      hasAttachments: boolean;
      pdfs: Array<{ filename: string; content: string; truncated: boolean }>;
      images: Array<{ filename: string; description: string }>;
      summary: string;       // aggregated text of all attachments
    };
  };
  
  deployment: {
    domain: string;          // e.g. myclient.Andy Code Cat.io
    mode: string;            // subdomain | custom_domain | zip_export
    baseUrl: string;         // https://myclient.Andy Code Cat.io
  };
  
  iteration: {
    number: number;          // 1 for the first generation, 2+ for refine
    isFirstGeneration: boolean;
    previousManifest?: object; // MANIFEST.json from the last iteration
    previousBuildNotes?: string;
    changesRequested?: string; // refine only: description of changes
  };
  
  theme: {
    primaryColor?: string;
    fontFamily?: string;
    borderRadius?: string;
    mood?: string;           // professional | playful | minimal | bold
    hasOverride: boolean;
  };
  
  meta: {
    jobId: string;
    timestamp: string;       // ISO datetime
    agentType: string;       // Andy Code Cat-builder | Andy Code Cat-refiner
    outputDir: string;       // absolute path of the working dir
  };
}
```

**Resolving the previous iteration's context:**

```typescript
async buildIterationContext(project: Project): Promise<IterationContext> {
  const lastJob = await Job.findOne({
    projectId: project._id,
    status: 'completed',
    type: { $in: ['generation', 'refinement'] }
  }).sort({ completedAt: -1 });

  if (!lastJob || !lastJob.output) {
    return { number: 1, isFirstGeneration: true };
  }

  // Read MANIFEST.json from the last output
  const manifestPath = path.join(lastJob.output.outputDir, 'dist', 'MANIFEST.json');
  const manifest = await fs.readJSON(manifestPath).catch(() => null);

  return {
    number: (project.iterationCount ?? 0) + 1,
    isFirstGeneration: false,
    previousManifest: manifest,
    previousBuildNotes: manifest?.buildNotes,
    previousGitCommit: lastJob.output.gitCommitHash
  };
}
```

### 3.3 Step 3 — Layer Composition

```typescript
class LayerComposer {
  async compose(
    layers: PrepromptLayer[],
    context: TemplateContext
  ): Promise<string> {
    
    // 1. Sort layers by order ASC
    const sortedLayers = [...layers].sort((a, b) => a.order - b.order);
    
    // 2. Filter out layers whose condition is false
    const activeLayers = await Promise.all(
      sortedLayers.map(async layer => {
        if (!layer.condition) return layer;
        const result = await this.conditionEvaluator.evaluate(
          layer.condition,
          context
        );
        return result ? layer : null;
      })
    ).then(layers => layers.filter(Boolean));

    // 3. Render each layer with Nunjucks
    const renderedLayers = await Promise.all(
      activeLayers.map(async layer => {
        const rendered = await this.templateRenderer.render(
          layer.content,
          context
        );
        return {
          name: layer.name,
          type: layer.type,
          content: rendered
        };
      })
    );

    // 4. Concatenate with semantic separators
    return renderedLayers
      .map(layer => `## [${layer.type.toUpperCase()}] ${layer.name}\n\n${layer.content}`)
      .join('\n\n---\n\n');
  }
}
```

**Condition evaluation (JSONata):**

```typescript
// Example layer conditions:
// "input.attachments.hasAttachments == true"
// "iteration.number > 1"
// "project.type == 'landing_page'"
// "theme.mood == 'playful'"

import jsonata from 'jsonata';

class ConditionEvaluator {
  async evaluate(condition: string, context: TemplateContext): Promise<boolean> {
    try {
      const expression = jsonata(condition);
      const result = await expression.evaluate(context);
      return Boolean(result);
    } catch (err) {
      // Malformed condition → layer included by default (fail-open)
      logger.warn(`Malformed condition in layer: ${condition}`, err);
      return true;
    }
  }
}
```

### 3.4 Step 4 — Template Rendering

Nunjucks with custom filters:

```typescript
const nunjucksEnv = nunjucks.configure({ autoescape: false });

// Filter: truncate text with an ellipsis
nunjucksEnv.addFilter('truncate', (str: string, length: number) =>
  str.length > length ? str.slice(0, length) + '...' : str
);

// Filter: convert an object to formatted JSON
nunjucksEnv.addFilter('json', (obj: object) =>
  JSON.stringify(obj, null, 2)
);

// Filter: sanitize for use in a prompt (removes problematic characters)
nunjucksEnv.addFilter('promptSafe', (str: string) =>
  str.replace(/[<>]/g, '').replace(/\n{3,}/g, '\n\n').trim()
);

// Filter: format a list as bullet points
nunjucksEnv.addFilter('bullets', (arr: string[]) =>
  arr.map(item => `- ${item}`).join('\n')
);
```

**Example layer template using all filters:**

```
{% if input.attachments.hasAttachments %}
## Attachments provided by the user:

{% if input.attachments.pdfs.length > 0 %}
### PDF documents:
{% for pdf in input.attachments.pdfs %}
**{{ pdf.filename }}:**
{{ pdf.content | truncate(5000) | promptSafe }}
{% if pdf.truncated %}
[... content truncated for length ...]
{% endif %}
{% endfor %}
{% endif %}

{% if input.attachments.images.length > 0 %}
### Images provided:
{% for img in input.attachments.images %}
**{{ img.filename }}:** {{ img.description | promptSafe }}
{% endfor %}
{% endif %}

{% endif %}
```

### 3.5 Step 5 — CLAUDE.md Generation

The CLAUDE.md is generated from the template defined in the PrepromptProfile.  
It is the "full briefing" document that OpenCode reads at the start of the session.

```typescript
// Default CLAUDE.md template (overridable per profile)
const DEFAULT_CLAUDE_MD_TEMPLATE = `
# Andy Code Cat Project: {{ project.name }}

## Job Info
- Job ID: {{ meta.jobId }}
- Iteration: {{ iteration.number }}
- Agent: {{ meta.agentType }}
- Timestamp: {{ meta.timestamp }}
- Output directory: {{ meta.outputDir }}/dist/

## Objective
{{ prompt_section }}

## Deployment Target
- URL: {{ deployment.baseUrl }}
- Domain: {{ deployment.domain }}
- Site language: {{ project.lang }}

{% if theme.hasOverride %}
## Theme Override
- Primary color: {{ theme.primaryColor }}
- Font: {{ theme.fontFamily }}
- Mood: {{ theme.mood }}
{% endif %}

{% if iteration.number > 1 %}
## Previous Iteration Context
Previous build notes: {{ iteration.previousBuildNotes }}
Placeholder images already defined:
{% for img in iteration.previousManifest.imagePlaceholders %}
- {{ img.file }}: {{ img.description }}
{% endfor %}

## Changes Requested in This Iteration
## Modifiche Richieste in Questa Iterazione
{{ iteration.changesRequested }}
{% endif %}
{% endif %}

## Operating Rules
Read and follow AGENTS.md for all technical policies.
Create dist/MANIFEST.json at the end. Do not ask for confirmation.
`;
```

### 3.6 Step 6 — OpenCode Config Generation

```typescript
function generateOpenCodeConfig(
  project: Project,
  profile: PrepromptProfile,
  resolvedApiKey: string
): object {
  return {
    "$schema": "https://opencode.ai/config.json",
    "model": `${project.aiConfig.provider}/${project.aiConfig.model}`,
    
    "provider": {
      [project.aiConfig.provider]: {
        "npm": resolveProviderNpm(project.aiConfig.provider),
        "options": {
          "baseURL": resolveBaseUrl(project.aiConfig.provider),
          "apiKey": resolvedApiKey
        }
      }
    },
    
    // Override from the project (e.g. temperature, max_tokens)
    ...project.aiConfig.openCodeConfigOverride,
    
    "agents": {
      [profile.openCodeConfig.agentProfile ?? 'Andy Code Cat-builder']: {
        "tools": profile.openCodeConfig.allowedTools ?? [
          "Read", "Write", "Edit", "Bash", "Glob", "Grep"
        ]
      }
    }
  };
}

// Mapping provider → npm package
function resolveProviderNpm(provider: string): string {
  const map: Record<string, string> = {
    'anthropic': '@ai-sdk/anthropic',
    'openai': '@ai-sdk/openai',
    'google': '@ai-sdk/google',
    'ollama': '@ai-sdk/openai-compatible',
    'openrouter': '@ai-sdk/openai-compatible',
  };
  return map[provider] ?? '@ai-sdk/openai-compatible';
}
```

---

## 4. Preprompt Profiles — Full Structure

### 4.1 Default Profile: `landing-page-standard`

```json
{
  "_id": "...",
  "name": "Landing Page — Standard",
  "description": "Generic profile for B2C/B2B landing pages. Produces modern, professional, conversion-optimised sites.",
  "version": "1.0.0",
  "scope": {
    "type": "agent_type",
    "agentType": "landing_page"
  },
  "layers": [
    {
      "order": 1,
      "name": "Agent Identity",
      "type": "system",
      "isOptional": false,
      "condition": null,
      "content": "You are Andy Code Cat Builder, an agent specialised in creating high-conversion landing pages. Always produce complete, working, publish-ready HTML/CSS/JS code. Your output goes into the dist/ folder. Never ask for confirmation."
    },
    {
      "order": 2,
      "name": "Project Context",
      "type": "context",
      "isOptional": false,
      "condition": null,
      "content": "Project: {{ project.name }} ({{ project.type }})\nPublish domain: {{ deployment.domain }}\nLanguage: {{ project.lang }}\nIteration: {{ iteration.number }}"
    },
    {
      "order": 3,
      "name": "Attachment Content",
      "type": "context",
      "isOptional": true,
      "condition": "input.attachments.hasAttachments == true",
      "content": "## Material provided by the user:\n{% for pdf in input.attachments.pdfs %}\n### {{ pdf.filename }}\n{{ pdf.content | truncate(8000) | promptSafe }}\n{% endfor %}\n{% for img in input.attachments.images %}\n### Image: {{ img.filename }}\n{{ img.description | promptSafe }}\n{% endfor %}"
    },
    {
      "order": 4,
      "name": "Theme Override",
      "type": "context",
      "isOptional": true,
      "condition": "theme.hasOverride == true",
      "content": "## Requested visual style:\n- Primary color: {{ theme.primaryColor }}\n- Font: {{ theme.fontFamily }}\n- Mood: {{ theme.mood }}\nReflect these choices in the CSS Custom Properties."
    },
    {
      "order": 5,
      "name": "User Request",
      "type": "context",
      "isOptional": false,
      "condition": null,
      "content": "## Request:\n{{ input.prompt | promptSafe }}"
    },
    {
      "order": 6,
      "name": "Technical Constraints",
      "type": "constraint",
      "isOptional": false,
      "condition": null,
      "content": "## ABSOLUTE constraints:\n1. Output only in dist/ (structure: index.html, css/style.css, js/main.js, images/)\n2. No JS framework (React, Vue, etc.) — vanilla HTML/CSS/JS\n3. No CDN except Google Fonts\n4. Mobile-first responsive\n5. Every missing image → placeholder with the IMAGE_PLACEHOLDER pattern\n6. CSS Custom Properties are mandatory for theming\n7. Semantic HTML with complete SEO meta tags"
    },
    {
      "order": 7,
      "name": "Output Format",
      "type": "format",
      "isOptional": false,
      "condition": null,
      "content": "## Required output:\nAt the end of generation, you MUST create dist/MANIFEST.json with the structure defined in AGENTS.md. This is MANDATORY. The system uses this file for post-processing."
    }
  ],
  "openCodeConfig": {
    "agentProfile": "Andy Code Cat-builder",
    "skills": ["no-confirm", "static-site-best-practices", "placeholder-images", "manifest-required"],
    "claudeMdTemplate": "default",
    "allowedTools": ["Read", "Write", "Edit", "Bash", "Glob", "Grep"]
  },
  "outputStructure": {
    "expectedDirs": ["dist/", "dist/css/", "dist/images/"],
    "entryPoint": "dist/index.html",
    "imagePlaceholderPattern": "IMAGE_PLACEHOLDER:",
    "imageDir": "dist/images/"
  }
}
```

### 4.2 Profile: `mini-site-portfolio`

Variant of the standard profile with additional layers for a multi-page portfolio:

```json
{
  "name": "Mini-Site Portfolio",
  "version": "1.0.0",
  "scope": { "type": "agent_type", "agentType": "portfolio" },
  "layers": [
    "... (layers 1-4 identical to the standard profile) ...",
    {
      "order": 5,
      "name": "Multi-Page Structure",
      "type": "constraint",
      "isOptional": false,
      "condition": null,
      "content": "Generate a 3-page mini-site:\n1. index.html — Home/About\n2. work.html — Portfolio/Projects\n3. contact.html — Contact\n\nNavigation: sticky menu linking to all 3 pages.\nEach page must be stand-alone (include header and footer)."
    }
    "... (layers 6-7 identical to the standard profile) ..."
  ]
}
```

### 4.3 Profile: `refine-standard`

Profile specific to refinement iterations:

```json
{
  "name": "Refinement — Standard",
  "version": "1.0.0",
  "scope": { "type": "agent_type", "agentType": "refine" },
  "layers": [
    {
      "order": 1,
      "name": "Refiner Agent Identity",
      "type": "system",
      "content": "You are Andy Code Cat Refiner. You are modifying an existing website. Read the files in dist/ before making changes. Apply ONLY the requested changes. Do not overhaul the existing design."
    },
    {
      "order": 2,
      "name": "Iteration Context",
      "type": "context",
      "condition": "iteration.number > 1",
      "content": "Existing site — iteration {{ iteration.number - 1 }}:\nBuild notes: {{ iteration.previousBuildNotes }}\n\nFiles already present in dist/ — read them before making changes."
    },
    {
      "order": 3,
      "name": "Requested Change",
      "type": "context",
      "content": "## Change to apply:\n{{ input.prompt | promptSafe }}"
    },
    {
      "order": 4,
      "name": "Refine Constraints",
      "type": "constraint",
      "content": "CONSTRAINTS:\n1. Keep the existing visual style\n2. Do not touch files not mentioned in the request (unless strictly necessary)\n3. Update MANIFEST.json with the changes\n4. Do not ask for confirmation"
    }
  ]
}
```

---

## 5. Profile Versioning

### 5.1 Version Bump Rules

| Change type | Bump | Example |
|---|---|---|
| Add optional layer | patch | 1.0.0 → 1.0.1 |
| Edit existing layer text | patch | 1.0.1 → 1.0.2 |
| Add mandatory layer | minor | 1.0.2 → 1.1.0 |
| Remove layer | minor | 1.1.0 → 1.2.0 |
| Change expected output structure | major | 1.2.0 → 2.0.0 |
| Change openCodeConfig.agentProfile | major | 2.0.0 → 3.0.0 |

### 5.2 Version Storage

Every PUT on a profile **does not overwrite** — it creates a new document with:

- The same logical `_id` (tracked via the `profileGroupId` field)
- `version` incremented per the bump rules
- `supersedes: previousDocId`
- `isActive: true` (the previous version becomes `isActive: false`)

Projects reference both `prepromptProfileId` (a specific version) and `prepromptProfileGroupId` (to "always update to the latest version").

### 5.3 API Versioning

```
GET /api/v1/preprompt-profiles/:groupId/history
→ [
    { version: "1.0.0", createdAt: "...", isActive: false, _id: "..." },
    { version: "1.0.1", createdAt: "...", isActive: false, _id: "..." },
    { version: "1.1.0", createdAt: "...", isActive: true,  _id: "..." }  ← current
  ]

POST /api/v1/projects/:slug/use-profile-version
Body: { profileId: "specific-version-id" }
→ The project will always use that specific version, ignoring future updates
```

---

## 6. Preview and Debug

### 6.1 Preview Endpoint

```
POST /api/v1/preprompt-profiles/:id/test
Body: {
  samplePrompt: "Landing page for a fintech startup called PayFlow",
  projectContext: {
    name: "PayFlow",
    type: "landing_page",
    lang: "it",
    deployment: { domain: "payflow.Andy Code Cat.io" }
  },
  attachments: []  // optional: test attachments
}

Response: {
  resolvedPrompt: "## [SYSTEM] Agent Identity\n\nYou are Andy Code Cat Builder...",
  resolvedClaudeMd: "# Andy Code Cat Project: PayFlow\n...",
  resolvedOpenCodeJson: { ... },
  layersApplied: [
    { name: "Agent Identity", type: "system", included: true },
    { name: "Attachment Content", type: "context", included: false, reason: "condition false: hasAttachments == false" }
  ],
  estimatedTokens: 1250,
  warnings: []
}
```

### 6.2 Debug Logging

Every job stores the resolution's `debugInfo` in MongoDB:

```typescript
job.input.resolvedPrompt = output.resolvedPrompt;  // full text
job.input.debugInfo = {
  layersApplied: output.debugInfo.layersApplied,
  variablesResolved: output.debugInfo.variablesResolved,
  attachmentsSummary: output.debugInfo.attachmentsSummary,
  processingTimeMs: output.debugInfo.processingTimeMs,
  profileVersion: profile.version,
  profileId: profile._id.toString()
};
```

---

## 7. Error Handling

| Error | Behaviour |
|---|---|
| Malformed Nunjucks template | Log the error, use the layer without variable rendering (fail-safe) |
| Unreadable PDF | Skip the attachment, add a warning to debugInfo |
| Image unreadable by vision | Use the filename as a fallback description |
| Invalid JSONata condition | Layer included by default (fail-open), warning logged |
| Profile not found | Fall back to the system default profile (`landing-page-standard`) |
| CLAUDE.md template not found | Use the hardcoded DEFAULT_CLAUDE_MD_TEMPLATE |
| resolvedPrompt > 100,000 chars | Truncate PDF attachments, keep the user prompt intact |

---

## 8. Test Cases

### 8.1 Unit Tests — LayerComposer

```typescript
describe('LayerComposer', () => {
  test('applies layers in the correct order', async () => { ... });
  test('skips a layer whose condition is false', async () => { ... });
  test('includes a layer whose condition is true', async () => { ... });
  test('includes an optional layer whose condition cannot be evaluated', async () => { ... });
  test('renders Nunjucks variables correctly', async () => { ... });
  test('handles a malformed template without crashing', async () => { ... });
});
```

### 8.2 Integration Tests — PrepromptEngine.process()

```typescript
describe('PrepromptEngine', () => {
  test('produces a non-empty resolvedPrompt for minimal input', async () => { ... });
  test('includes extracted PDF content in the prompt', async () => { ... });
  test('generates CLAUDE.md with resolved variables', async () => { ... });
  test('generates opencode.json with the correct provider', async () => { ... });
  test('falls back to the default profile if the ID is not found', async () => { ... });
  test('truncates PDFs beyond 50,000 chars with a note', async () => { ... });
});
```

### 8.3 E2E Test — Preview Endpoint

```typescript
// Test via API
POST /preprompt-profiles/{landingPageProfileId}/test
Body: { samplePrompt: "Sito per pizzeria napoletana", projectContext: {...} }
→ resolvedPrompt contains "pizzeria" ✓
→ layersApplied.length === 7 ✓ (all layers of the standard profile)
→ estimatedTokens < 4000 ✓
```
