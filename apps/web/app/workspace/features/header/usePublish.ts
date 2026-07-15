import { useState, useCallback, useRef, useEffect, useMemo, type RefObject } from "react";
import { useTranslation } from "react-i18next";
import type { SystemNotification } from "../../../../lib/notifications";
import {
    ApiError,
    requestLayer1Export,
    downloadExportBlob,
    downloadSnapshotCapture,
    publishProject,
    getPublishStatus,
    unpublishProject,
    checkSlugAvailability,
    updateDeploymentSlug,
    type SiteDeploymentDto,
    type PreviewSnapshot,
} from "../../../../lib/api";
import { resolvePublicDeploymentUrl } from "./publishUrl";

type AsyncActionState = "idle" | "loading" | "error";
type SlugCheckState = "idle" | "checking" | "available" | "taken" | "invalid" | "reserved" | "error";

interface UsePublishOptions {
    token: string | null;
    projectId: string;
    selectedBackendSnapshotId: string | null;
    previewSnapshots: PreviewSnapshot[];
    addNotification: (notification: Omit<SystemNotification, "id" | "startedAt">) => string;
    updateNotification: (id: string, notification: Partial<Omit<SystemNotification, "id">>) => void;
}

export interface WorkspacePublishController {
    export: {
        state: AsyncActionState;
        error: string | null;
        run: () => Promise<void>;
    };
    capture: {
        state: AsyncActionState;
        dropdownOpen: boolean;
        dropdownRef: RefObject<HTMLDivElement>;
        toggleDropdown: () => void;
        run: (format: "jpg" | "pdf") => Promise<void>;
    };
    publish: {
        state: AsyncActionState;
        deployment: SiteDeploymentDto | null;
        url: string | null;
        copied: boolean;
        run: () => Promise<void>;
        unpublish: () => Promise<void>;
        copyLink: () => void;
    };
    slug: {
        editMode: boolean;
        input: string;
        checkState: SlugCheckState;
        saving: boolean;
        toggleEditor: () => void;
        updateInput: (value: string) => void;
        save: () => Promise<void>;
        remove: () => Promise<void>;
        cancel: () => void;
    };
}

export function usePublish({
    token,
    projectId,
    selectedBackendSnapshotId,
    previewSnapshots,
    addNotification,
    updateNotification,
}: UsePublishOptions): WorkspacePublishController {
    const { t } = useTranslation();

    // Export State
    const [exportState, setExportState] = useState<AsyncActionState>("idle");
    const [exportError, setExportError] = useState<string | null>(null);

    // Capture State
    const [captureState, setCaptureState] = useState<AsyncActionState>("idle");
    const [captureDropdownOpen, setCaptureDropdownOpen] = useState(false);
    const captureDropdownRef = useRef<HTMLDivElement>(null);

    // Publish State
    const [publishState, setPublishState] = useState<AsyncActionState>("idle");
    const [publishDeployment, setPublishDeployment] = useState<SiteDeploymentDto | null>(null);
    const [publishCopied, setPublishCopied] = useState(false);
    const publishUrl = useMemo(
        () => publishDeployment ? resolvePublicDeploymentUrl(publishDeployment) : null,
        [publishDeployment],
    );

    // Slug Edit State
    const [slugEditMode, setSlugEditMode] = useState(false);
    const [slugInput, setSlugInput] = useState("");
    const [slugCheckState, setSlugCheckState] = useState<SlugCheckState>("idle");
    const [slugSaving, setSlugSaving] = useState(false);
    const slugDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // ────────────────────────────────────────────────────────────────────────
    // EXPORT
    // ────────────────────────────────────────────────────────────────────────
    const handleExportLayer1 = useCallback(async () => {
        if (!token) return;
        setExportState("loading");
        setExportError(null);
        const notifId = addNotification({
            label: t("workspace.notifications.export.label"),
            status: "running",
            message: t("workspace.notifications.export.running"),
        });
        try {
            const snapshotId = selectedBackendSnapshotId ?? undefined;
            const res = await requestLayer1Export(token, projectId, snapshotId);

            updateNotification(notifId, { message: t("workspace.notifications.export.downloading") });
            const blob = await downloadExportBlob(token, res.id);

            const objectUrl = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = objectUrl;
            a.download = "export-layer1.zip";
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(objectUrl);

            setExportState("idle");
            updateNotification(notifId, { status: "done", message: t("workspace.notifications.export.done") });
        } catch (err) {
            if (err instanceof ApiError && err.status === 401) {
                window.dispatchEvent(new CustomEvent("session-expired"));
                setExportState("idle");
                updateNotification(notifId, { status: "error", message: t("workspace.notifications.export.sessionExpired") });
                return;
            }
            const msg = err instanceof Error ? err.message : t("workspace.notifications.export.error");
            setExportError(msg);
            setExportState("error");
            updateNotification(notifId, { status: "error", message: msg });
        }
    }, [token, projectId, selectedBackendSnapshotId, addNotification, updateNotification, t]);

    // ────────────────────────────────────────────────────────────────────────
    // CAPTURE (PDF/JPG)
    // ────────────────────────────────────────────────────────────────────────
    useEffect(() => {
        function onDown(e: MouseEvent) {
            if (captureDropdownRef.current && !captureDropdownRef.current.contains(e.target as Node)) {
                setCaptureDropdownOpen(false);
            }
        }
        document.addEventListener("mousedown", onDown);
        return () => document.removeEventListener("mousedown", onDown);
    }, []);

    const handleCaptureSnapshot = useCallback(async (format: "jpg" | "pdf") => {
        if (!token || !selectedBackendSnapshotId) return;
        setCaptureState("loading");
        setCaptureDropdownOpen(false);
        const notifId = addNotification({
            label: t("workspace.notifications.capture.label", { format: format.toUpperCase() }),
            status: "running",
            message: t("workspace.notifications.capture.running"),
        });
        try {
            const blob = await downloadSnapshotCapture(token, projectId, selectedBackendSnapshotId, format);
            const objectUrl = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = objectUrl;
            a.download = `preview-snapshot.${format}`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(objectUrl);

            setCaptureState("idle");
            updateNotification(notifId, { status: "done", message: t("workspace.notifications.capture.done") });
        } catch (err) {
            if (err instanceof ApiError && err.status === 401) {
                window.dispatchEvent(new CustomEvent("session-expired"));
                setCaptureState("idle");
                updateNotification(notifId, { status: "error", message: t("workspace.notifications.capture.sessionExpired") });
                return;
            }
            const msg = err instanceof Error ? err.message : t("workspace.notifications.capture.error");
            console.error("[snapshot-capture]", err);
            setCaptureState("error");
            updateNotification(notifId, { status: "error", message: msg });
            window.setTimeout(() => setCaptureState("idle"), 3000);
        }
    }, [token, projectId, selectedBackendSnapshotId, addNotification, updateNotification, t]);

    // ────────────────────────────────────────────────────────────────────────
    // PUBLISH & SLUG
    // ────────────────────────────────────────────────────────────────────────
    useEffect(() => {
        if (!token) return;
        getPublishStatus(token, projectId)
            .then((d) => setPublishDeployment(d))
            .catch(() => setPublishDeployment(null));
    }, [token, projectId]);

    useEffect(() => {
        if (!slugEditMode) { setSlugCheckState("idle"); return; }
        const slug = slugInput.trim().toLowerCase();
        if (!slug) { setSlugCheckState("idle"); return; }
        if (slug === (publishDeployment?.customSlug ?? "")) {
            setSlugCheckState("available");
            return;
        }
        if (!/^[a-z0-9][a-z0-9-]{0,28}[a-z0-9]$/.test(slug)) {
            setSlugCheckState("invalid");
            return;
        }
        setSlugCheckState("checking");
        if (slugDebounceRef.current) clearTimeout(slugDebounceRef.current);
        slugDebounceRef.current = setTimeout(async () => {
            try {
                const result = await checkSlugAvailability(slug, publishDeployment?.id);
                if (result.available) {
                    setSlugCheckState("available");
                } else if (result.reason === "reserved") {
                    setSlugCheckState("reserved");
                } else if (result.reason === "invalid") {
                    setSlugCheckState("invalid");
                } else {
                    setSlugCheckState("taken");
                }
            } catch {
                setSlugCheckState("error");
            }
        }, 450);
        return () => { if (slugDebounceRef.current) clearTimeout(slugDebounceRef.current); };
    }, [slugInput, slugEditMode, publishDeployment?.customSlug, publishDeployment?.id]);

    const handlePublish = useCallback(async () => {
        if (!token) return;
        setPublishState("loading");
        const activeId = previewSnapshots.find((s) => s.isActive)?.id ?? null;
        const notifId = addNotification({
            label: t("workspace.notifications.publish.label"),
            status: "running",
            message: t("workspace.notifications.publish.running"),
        });
        try {
            const deployment = await publishProject(token, projectId, undefined);
            setPublishDeployment(deployment);
            setPublishState("idle");
            const vn = (() => {
                if (!activeId) return null;
                const idx = previewSnapshots.findIndex((s) => s.id === activeId);
                return idx === -1 ? null : previewSnapshots.length - idx;
            })();
            updateNotification(notifId, {
                status: "done",
                message: vn ? t("workspace.notifications.publish.doneVersioned", { vn }) : t("workspace.notifications.publish.done"),
            });
        } catch (err) {
            if (err instanceof ApiError && err.status === 401) {
                window.dispatchEvent(new CustomEvent("session-expired"));
                setPublishState("idle");
                updateNotification(notifId, { status: "error", message: t("workspace.notifications.publish.sessionExpired") });
                return;
            }
            setPublishState("error");
            const msg = err instanceof Error ? err.message : t("workspace.notifications.publish.error");
            updateNotification(notifId, { status: "error", message: msg });
            window.setTimeout(() => setPublishState("idle"), 3000);
        }
    }, [token, projectId, previewSnapshots, addNotification, updateNotification, t]);

    const handleUnpublish = useCallback(async () => {
        if (!token || !publishDeployment) return;
        setPublishState("loading");
        try {
            await unpublishProject(token, projectId, publishDeployment.id);
            setPublishDeployment(null);
            setPublishState("idle");
        } catch (err) {
            if (err instanceof ApiError && err.status === 401) {
                window.dispatchEvent(new CustomEvent("session-expired"));
                setPublishState("idle");
                return;
            }
            setPublishState("error");
            window.setTimeout(() => setPublishState("idle"), 3000);
        }
    }, [token, projectId, publishDeployment]);

    const handleCopyPublishLink = useCallback(() => {
        if (!publishUrl) return;
        navigator.clipboard.writeText(publishUrl).then(() => {
            setPublishCopied(true);
            window.setTimeout(() => setPublishCopied(false), 2000);
        });
    }, [publishUrl]);

    const handleSlugSave = useCallback(async () => {
        if (!token || !publishDeployment) return;
        const trimmed = slugInput.trim().toLowerCase();
        const newSlug = trimmed || null;
        setSlugSaving(true);
        try {
            const updated = await updateDeploymentSlug(token, projectId, newSlug);
            setPublishDeployment(updated);
            setSlugEditMode(false);
            setSlugInput("");
            setSlugCheckState("idle");
        } catch (err) {
            if (err instanceof ApiError && err.status === 409) {
                setSlugCheckState("taken");
            } else if (err instanceof ApiError && err.status === 400) {
                setSlugCheckState("invalid");
            } else if (err instanceof ApiError && err.status === 401) {
                window.dispatchEvent(new CustomEvent("session-expired"));
            } else {
                setSlugCheckState("error");
            }
        } finally {
            setSlugSaving(false);
        }
    }, [token, projectId, slugInput, publishDeployment]);

    const toggleCaptureDropdown = useCallback(() => {
        setCaptureDropdownOpen((open) => !open);
    }, []);

    const toggleSlugEditor = useCallback(() => {
        setSlugInput(publishDeployment?.customSlug ?? "");
        setSlugEditMode((open) => !open);
        setSlugCheckState("idle");
    }, [publishDeployment?.customSlug]);

    const updateSlugInput = useCallback((value: string) => {
        setSlugInput(value.toLowerCase().replace(/[^a-z0-9-]/g, ""));
    }, []);

    const cancelSlugEdit = useCallback(() => {
        setSlugEditMode(false);
        setSlugInput("");
        setSlugCheckState("idle");
    }, []);

    const handleSlugRemove = useCallback(async () => {
        if (!token || !publishDeployment?.customSlug) return;

        setSlugSaving(true);
        try {
            const updated = await updateDeploymentSlug(token, projectId, null);
            setPublishDeployment(updated);
            setSlugEditMode(false);
            setSlugInput("");
            setSlugCheckState("idle");
        } catch {
            // Preserve the existing best-effort remove behavior.
        } finally {
            setSlugSaving(false);
        }
    }, [token, projectId, publishDeployment?.customSlug]);

    return {
        export: {
            state: exportState,
            error: exportError,
            run: handleExportLayer1,
        },
        capture: {
            state: captureState,
            dropdownOpen: captureDropdownOpen,
            dropdownRef: captureDropdownRef,
            toggleDropdown: toggleCaptureDropdown,
            run: handleCaptureSnapshot,
        },
        publish: {
            state: publishState,
            deployment: publishDeployment,
            url: publishUrl,
            copied: publishCopied,
            run: handlePublish,
            unpublish: handleUnpublish,
            copyLink: handleCopyPublishLink,
        },
        slug: {
            editMode: slugEditMode,
            input: slugInput,
            checkState: slugCheckState,
            saving: slugSaving,
            toggleEditor: toggleSlugEditor,
            updateInput: updateSlugInput,
            save: handleSlugSave,
            remove: handleSlugRemove,
            cancel: cancelSlugEdit,
        },
    };
}
