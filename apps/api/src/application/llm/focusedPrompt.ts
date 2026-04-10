import type { LlmFocusContext } from "@andy-code-cat/contracts";
import { serializePageMap, type PageSection } from "./sectionContextExtractor";

/**
 * Builds the system-prompt addendum injected when the user has activated
 * inspector/code-selection focus mode and current artifacts are available.
 *
 * The addendum overrides the default full-artifact output format with a surgical
 * "focusPatch" protocol that asks the LLM to return only the changed component.
 * The server then merges the patch back into the base artifacts before
 * responding to the client — the frontend always receives complete artifacts.
 */
export function buildFocusedModeSystemAddendum(
  focusContext: LlmFocusContext,
  pageMap?: PageSection[],
): string {
  const targetDesc = focusContext.selectedElement
    ? `element "${focusContext.selectedElement.selector}" <${focusContext.selectedElement.tag}>`
    : focusContext.codeSelection
      ? `${focusContext.codeSelection.language.toUpperCase()} lines ${focusContext.codeSelection.startLine}–${focusContext.codeSelection.endLine}`
      : `${focusContext.targetType} component`;

  // When the inspector sends outerHTML, inject it as a reference block.
  // The LLM uses it to understand the current structure so the replacement
  // faithfully evolves it. The server uses outerHtml as the anchor — the LLM
  // does NOT need to repeat it in the output.
  const outerHtmlBlock = focusContext.selectedElement?.outerHtml
    ? `\n### Target element — outerHTML from live preview (reference only)
Use this to understand the current structure of the element including ALL its children.
Your focusPatch.replacement must be the evolved version of this element.
The server will automatically locate and replace it — you do NOT need to output an anchor.
\`\`\`html
${focusContext.selectedElement.outerHtml}
\`\`\``
    : "";

  // When selectedElement is present, the server derives the anchor from outerHtml.
  // The LLM only needs to output the replacement — no anchor copying needed.
  const hasSelectedElement = Boolean(focusContext.selectedElement);

  const anchorField = hasSelectedElement
    ? `    // anchor: omitted — server derives it from the selected element`
    : `    "anchor": "<VERBATIM substring from the source code — must be unique>"`;

  const anchorRules = hasSelectedElement
    ? `2. focusPatch.anchor MUST be OMITTED — the server will locate the target element automatically.`
    : `2. focusPatch.anchor MUST be a verbatim copy of the exact text from the provided source.
   - Include the COMPLETE element: opening tag, ALL child elements, closing tag.
   - Make it long enough to be unique in the file.
   - For CSS/JS: include the full block or rule.`;

  return `## FOCUSED COMPONENT EDIT MODE — active (${targetDesc})
This is a SURGICAL edit targeting a single component. Follow this STRICT output protocol.
${outerHtmlBlock}
### Mandatory JSON shape for this request
{
  "chat": { "summary": "...", "bullets": [...], "nextActions": [...] },
  "artifacts": { "html": "", "css": "", "js": "" },
  "focusPatch": {
    "targetType": "html|css|js",
${anchorField},
    "replacement": "<new content that replaces the target element — complete HTML including all children>"
  }
}

### Rules (mandatory)
1. artifacts.html, artifacts.css, artifacts.js MUST be empty strings "".
${anchorRules}
3. focusPatch.replacement is the complete new content replacing the target (including all children).
4. focusPatch.targetType: "html" for structure/content, "css" for style-only, "js" for logic.
5. Modify ONLY the targeted component — leave all other code untouched.
6. If the edit requires changes in two different targetTypes, choose the primary one and
   describe the secondary change in chat.nextActions for the user to trigger separately.
7. If NO code change is needed: omit focusPatch entirely, return empty artifacts, use chat only.
8. NEVER output the full page — only focusPatch.replacement is needed.

### CRITICAL — JSON encoding inside focusPatch.replacement
focusPatch.replacement is a JSON string value.
Inside it you MUST escape every character that would break JSON:

  HTML attribute quotes  →  \"   (backslash + quote)  — NEVER bare "
  Newline                →  \\n  (backslash + n)
  Tab                    →  \\t  (backslash + t)
  Literal backslash      →  \\\\

WRONG (bare quotes — breaks JSON.parse):
  "replacement": "<div class="w-16 h-16">"

RIGHT (escaped quotes — valid JSON):
  "replacement": "<div class=\\"w-16 h-16\\">"

Every " inside an HTML attribute, data-* value, or string literal MUST be \\".
Failure to escape will cause the entire response to be discarded.${buildPageMapAddendum(pageMap)}`;
}

/**
 * Appends a compact page-structure guidance block when section-context mode is active.
 * When `pageMap` is undefined the string is empty — no effect on the addendum.
 */
function buildPageMapAddendum(pageMap?: PageSection[]): string {
  if (!pageMap || pageMap.length === 0) return "";

  return `

### Page structure — section map (section-aware context mode)
The page is composed of independent top-level sections (direct children of <body>).
The HTML context above contains ONLY the section marked isTarget:true in the map.
DO NOT output code for sections not shown above — they are not provided and must not change.
Your focusPatch.replacement must be the evolved version of that single section.
Keep all other sections in the page exactly as they are — only the target section HTML is provided.

Section map (one entry per top-level body child):
${serializePageMap(pageMap)}

### HTML output structure guidance
Structure all generated HTML around semantic section blocks:
- Use <section id="...">, <header id="...">, <footer id="...">, <nav id="...">,
  <main id="...">, <aside id="..."> for every top-level content area.
- Never produce a flat <div> soup at the body root.
- Assign a unique semantic id to every top-level section.
- Scope CSS class names to their section where practical (e.g. hero__title, services__card).
- Keep each section self-contained: all its styles in artifacts.css should be identifiable
  by section-scoped selectors.`;
}
