"use client";

import React, { createContext, useContext, useState, useRef, useEffect } from "react";

import { PreviewViewport } from "../../../components/workspace/PreviewViewportSelector";

export type PreviewTab = "preview" | "html" | "css" | "js" | "prompt" | "forms" | "data";
export type WorkMode = "build" | "didactic";

const SPLIT_COOKIE = "andy-code-cat_workspace_split";
const CHAT_VSPLIT_COOKIE = "andy-code-cat_chat_vsplit";

function getCookie(name: string): string | null {
    if (typeof document === "undefined") return null;
    const nameEQ = name + "=";
    const ca = document.cookie.split(";");
    for (let i = 0; i < ca.length; i++) {
        let c = ca[i];
        while (c.charAt(0) === " ") c = c.substring(1, c.length);
        if (c.indexOf(nameEQ) === 0) return c.substring(nameEQ.length, c.length);
    }
    return null;
}

function setCookie(name: string, value: string, days = 365) {
    if (typeof document === "undefined") return;
    let expires = "";
    if (days) {
        const date = new Date();
        date.setTime(date.getTime() + days * 24 * 60 * 60 * 1000);
        expires = "; expires=" + date.toUTCString();
    }
    document.cookie = name + "=" + (value || "") + expires + "; path=/";
}

interface WorkspaceLayoutContextValue {
    // Horizontal Split (Sidebar vs Main)
    leftWidth: number;
    setLeftWidth: React.Dispatch<React.SetStateAction<number>>;
    isDragging: boolean;
    setIsDragging: React.Dispatch<React.SetStateAction<boolean>>;

    // Vertical Split (Chat history vs Input)
    chatVSplit: number;
    setChatVSplit: React.Dispatch<React.SetStateAction<number>>;
    chatVSplitRef: React.MutableRefObject<number>;
    isDraggingVChat: boolean;
    setIsDraggingVChat: React.Dispatch<React.SetStateAction<boolean>>;
    chatBodyRef: React.RefObject<HTMLDivElement>;

    // Viewport & Tabs
    previewViewport: PreviewViewport;
    setPreviewViewport: React.Dispatch<React.SetStateAction<PreviewViewport>>;
    previewTab: PreviewTab;
    setPreviewTab: React.Dispatch<React.SetStateAction<PreviewTab>>;
    workMode: WorkMode;
    setWorkMode: React.Dispatch<React.SetStateAction<WorkMode>>;
    splitMode: boolean;
    setSplitMode: React.Dispatch<React.SetStateAction<boolean>>;
}

const WorkspaceLayoutContext = createContext<WorkspaceLayoutContextValue | undefined>(undefined);

export function WorkspaceLayoutProvider({ children }: { children: React.ReactNode }) {
    const [leftWidth, setLeftWidth] = useState(40);
    const [isDragging, setIsDragging] = useState(false);

    const [chatVSplit, setChatVSplit] = useState(65);
    const chatVSplitRef = useRef<number>(65);
    const [isDraggingVChat, setIsDraggingVChat] = useState(false);
    const chatBodyRef = useRef<HTMLDivElement>(null);

    const [previewViewport, setPreviewViewport] = useState<PreviewViewport>("desktop");
    const [previewTab, setPreviewTab] = useState<PreviewTab>("preview");
    const [workMode, setWorkMode] = useState<WorkMode>("build");
    const [splitMode, setSplitMode] = useState(false);

    // Load initial state from cookies on mount
    useEffect(() => {
        const savedSplit = Number(getCookie(SPLIT_COOKIE));
        if (!isNaN(savedSplit) && savedSplit >= 25 && savedSplit <= 60) {
            setLeftWidth(savedSplit);
        }
        const savedVSplit = Number(getCookie(CHAT_VSPLIT_COOKIE));
        if (!isNaN(savedVSplit) && savedVSplit >= 30 && savedVSplit <= 85) {
            setChatVSplit(savedVSplit);
            chatVSplitRef.current = savedVSplit;
        }
    }, []);

    // Global drag handler for Horizontal Split
    useEffect(() => {
        if (!isDragging) return;
        function onMove(e: MouseEvent) {
            const newWidth = (e.clientX / window.innerWidth) * 100;
            const clampedWidth = Math.max(25, Math.min(60, newWidth));
            setLeftWidth(clampedWidth);
        }
        function onUp() {
            setIsDragging(false);
            setCookie(SPLIT_COOKIE, String(Math.round(leftWidth)));
        }
        window.addEventListener("mousemove", onMove);
        window.addEventListener("mouseup", onUp);
        return () => {
            window.removeEventListener("mousemove", onMove);
            window.removeEventListener("mouseup", onUp);
        };
    }, [isDragging, leftWidth]);

    // Global drag handler for Vertical Split (Chat)
    useEffect(() => {
        if (!isDraggingVChat) return;
        function onMove(e: MouseEvent) {
            const body = chatBodyRef.current;
            if (!body) return;
            const rect = body.getBoundingClientRect();
            const pct = Math.min(85, Math.max(30, ((e.clientY - rect.top) / rect.height) * 100));
            setChatVSplit(pct);
            chatVSplitRef.current = pct;
        }
        function onUp() {
            setIsDraggingVChat(false);
            setCookie(CHAT_VSPLIT_COOKIE, String(Math.round(chatVSplitRef.current)));
        }
        document.addEventListener("mousemove", onMove);
        document.addEventListener("mouseup", onUp);
        return () => {
            document.removeEventListener("mousemove", onMove);
            document.removeEventListener("mouseup", onUp);
        };
    }, [isDraggingVChat]);

    return (
        <WorkspaceLayoutContext.Provider
            value={{
                leftWidth,
                setLeftWidth,
                isDragging,
                setIsDragging,
                chatVSplit,
                setChatVSplit,
                chatVSplitRef,
                isDraggingVChat,
                setIsDraggingVChat,
                chatBodyRef,
                previewViewport,
                setPreviewViewport,
                previewTab,
                setPreviewTab,
                workMode,
                setWorkMode,
                splitMode,
                setSplitMode,
            }}
        >
            {children}
        </WorkspaceLayoutContext.Provider>
    );
}

export function useWorkspaceLayout() {
    const context = useContext(WorkspaceLayoutContext);
    if (context === undefined) {
        throw new Error("useWorkspaceLayout must be used within a WorkspaceLayoutProvider");
    }
    return context;
}
