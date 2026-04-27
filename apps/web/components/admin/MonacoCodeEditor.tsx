"use client";

import dynamic from "next/dynamic";
import { useMemo } from "react";

const MonacoEditor = dynamic(() => import("@monaco-editor/react"), { ssr: false });

interface MonacoCodeEditorProps {
    language: "html" | "javascript" | "typescript" | "json" | "css" | "markdown" | "nginx";
    value: string;
    onChange?: (next: string) => void;
    height?: string;
    readOnly?: boolean;
}

export function MonacoCodeEditor({
    language,
    value,
    onChange,
    height = "220px",
    readOnly = false,
}: MonacoCodeEditorProps) {
    const options = useMemo(() => ({
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        automaticLayout: true,
        fontSize: 13,
        fontFamily: "JetBrains Mono, Fira Code, monospace",
        fontLigatures: true,
        tabSize: 2,
        wordWrap: "on" as const,
        lineNumbers: "on" as const,
        bracketPairColorization: { enabled: true },
        guides: { bracketPairs: true, indentation: true },
        stickyScroll: { enabled: true, maxLineCount: 3 },
        quickSuggestions: { other: true, comments: false, strings: true },
        suggestOnTriggerCharacters: true,
        folding: true,
        smoothScrolling: true,
        readOnly,
        domReadOnly: readOnly,
    }), [readOnly]);

    return (
        <div className="overflow-hidden rounded-md border border-border bg-card">
            <MonacoEditor
                height={height}
                language={language}
                theme="vs-dark"
                value={value}
                onChange={(next) => onChange?.(next ?? "")}
                options={options}
            />
        </div>
    );
}
