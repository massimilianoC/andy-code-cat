"use client";

import React, { useEffect, useRef, useCallback } from "react";

export interface GrapesJsEditorPanelProps {
    /** Raw HTML content (body or full doc) to seed the editor. */
    html: string;
    /** CSS content to inject into the editor canvas. */
    css: string;
    /** Called when the user commits a save — receives cleaned html+css. */
    onSave: (html: string, css: string) => void;
    /** Called on every user edit for autosave purposes. */
    onHtmlCssChange?: (html: string, css: string) => void;
    /** Whether to show the save button in a loading state. */
    isSaving?: boolean;
}

function extractBody(html: string): string {
    const m = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
    return m ? m[1] : html;
}

export default function GrapesJsEditorPanel({
    html,
    css,
    onSave,
    onHtmlCssChange,
    isSaving = false,
}: GrapesJsEditorPanelProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const editorRef = useRef<any>(null);

    const onSaveRef = useRef(onSave);
    const onChangeRef = useRef(onHtmlCssChange);
    useEffect(() => { onSaveRef.current = onSave; }, [onSave]);
    useEffect(() => { onChangeRef.current = onHtmlCssChange; }, [onHtmlCssChange]);

    // Track latest props so the init effect can read them
    const htmlRef = useRef(html);
    const cssRef = useRef(css);
    useEffect(() => { htmlRef.current = html; }, [html]);
    useEffect(() => { cssRef.current = css; }, [css]);

    // ── Mount GrapesJS once ──────────────────────────────────────────────
    useEffect(() => {
        if (!containerRef.current) return;
        let destroyed = false;

        async function init() {
            // Inject GrapesJS stylesheet
            const cssId = "grapesjs-core-css";
            if (!document.getElementById(cssId)) {
                const link = document.createElement("link");
                link.id = cssId;
                link.rel = "stylesheet";
                link.href = "/grapesjs/grapes.min.css";
                document.head.appendChild(link);
            }

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            let grapesjs: any;
            try {
                // @ts-ignore — installed at container build via npm
                const mod = await import("grapesjs");
                grapesjs = mod.default ?? mod;
            } catch {
                if (containerRef.current) {
                    containerRef.current.innerHTML =
                        '<div style="padding:2rem;color:var(--text-muted);font-size:0.85rem;">' +
                        "⊕ GrapesJS non è ancora installato.<br/>" +
                        "Esegui <code>npm install</code> nel container <em>web</em> e ricarica." +
                        "</div>";
                }
                return;
            }

            if (destroyed || !containerRef.current) return;

            const bodyContent = extractBody(htmlRef.current);

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const editor: any = grapesjs.init({
                container: containerRef.current,
                height: "100%",
                width: "100%",
                fromElement: false,
                storageManager: false,
                panels: { defaults: [] },
                deviceManager: { devices: [] },
                blockManager: { blocks: [] },
                components: bodyContent,
                style: cssRef.current,
                canvas: {
                    styles: [],
                    scripts: [],
                },
                canvasCss: [
                    "* { box-sizing: border-box; }",
                    "body { margin: 0; padding: 0.5rem; background: #fff; }",
                ].join("\n"),
            });

            editorRef.current = editor;

            // Force canvas refresh after init to pick up correct dimensions
            requestAnimationFrame(() => {
                if (!destroyed) editor.refresh();
            });

            editor.on("component:update style:change rte:disable", () => {
                if (onChangeRef.current) {
                    onChangeRef.current(editor.getHtml(), editor.getCss());
                }
            });
        }

        void init();

        return () => {
            destroyed = true;
            if (editorRef.current) {
                try { editorRef.current.destroy(); } catch { /* ignore */ }
                editorRef.current = null;
            }
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // ── Sync content when html/css props change ──────────────────────────
    const prevHtml = useRef(html);
    const prevCss = useRef(css);
    useEffect(() => {
        const ed = editorRef.current;
        if (!ed) return;
        const htmlChanged = html !== prevHtml.current;
        const cssChanged = css !== prevCss.current;
        if (htmlChanged) {
            const body = extractBody(html);
            ed.setComponents(body);
            prevHtml.current = html;
        }
        if (cssChanged) {
            ed.setStyle(css);
            prevCss.current = css;
        }
        if (htmlChanged || cssChanged) {
            requestAnimationFrame(() => ed.refresh());
        }
    }, [html, css]);

    const handleSave = useCallback(() => {
        const ed = editorRef.current;
        if (!ed) return;
        onSaveRef.current(ed.getHtml(), ed.getCss());
    }, []);

    const handleUndo = useCallback(() => { editorRef.current?.UndoManager?.undo(); }, []);
    const handleRedo = useCallback(() => { editorRef.current?.UndoManager?.redo(); }, []);

    return (
        <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0, overflow: "hidden" }}>
            {/* Toolbar */}
            <div
                style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "0.4rem",
                    padding: "0.3rem 0.6rem",
                    borderBottom: "1px solid var(--border)",
                    background: "var(--surface-2, var(--surface))",
                    flexShrink: 0,
                }}
            >
                <span style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginRight: "auto" }}>
                    ⊕ GrapesJS WYSIWYG
                </span>
                <button
                    type="button"
                    className="secondary"
                    style={{ fontSize: "0.73rem", padding: "0.2rem 0.5rem" }}
                    onClick={handleUndo}
                    title="Undo (Ctrl+Z)"
                >
                    ↩ Undo
                </button>
                <button
                    type="button"
                    className="secondary"
                    style={{ fontSize: "0.73rem", padding: "0.2rem 0.5rem" }}
                    onClick={handleRedo}
                    title="Redo (Ctrl+Y)"
                >
                    ↪ Redo
                </button>
                <button
                    type="button"
                    className="primary"
                    disabled={isSaving}
                    style={{ fontSize: "0.73rem", padding: "0.2rem 0.7rem" }}
                    onClick={handleSave}
                    title="Salva come nuova versione editor utente (metatag: wysiwyg-grapesjs)"
                >
                    {isSaving ? "⏳ Salvataggio…" : "💾 Salva versione editor"}
                </button>
            </div>

            {/* GrapesJS canvas mount point */}
            <div
                ref={containerRef}
                style={{ flex: 1, minHeight: 0, overflow: "hidden", position: "relative" }}
            />
        </div>
    );
}
