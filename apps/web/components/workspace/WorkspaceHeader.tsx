"use client";

import { Bell, Loader2, Settings, BookOpen, Hammer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useNotifications } from "@/lib/notifications";
import CostBadge from "@/components/cost/CostBadge";

interface WorkspaceHeaderProps {
    projectName: string;
    /** Combined cost across chat + optimizer (in EUR) */
    totalCostEur: number;
    /** Project ID used to open the cost ledger drawer when the badge is clicked. */
    projectId?: string;
    onConfigOpen: () => void;
    onDashboard: () => void;
    workMode?: "build" | "didactic";
    onWorkModeChange?: (mode: "build" | "didactic") => void;
}

export function WorkspaceHeader({
    projectName,
    totalCostEur,
    projectId,
    onConfigOpen,
    onDashboard,
    workMode = "build",
    onWorkModeChange,
}: WorkspaceHeaderProps) {
    const { notifications, panelOpen, setPanelOpen } = useNotifications();

    const runningCount = notifications.filter((n) => n.status === "running").length;
    const errorCount = notifications.filter((n) => n.status === "error").length;
    const hasAny = notifications.length > 0;

    return (
        <header className="workspace-header">
            {/* LEFT — navigation + project identity */}
            <div className="workspace-header-left">
                <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={onDashboard}
                    className="workspace-header-back"
                >
                    ← Dashboard
                </Button>
                <span className="workspace-header-project" title={projectName}>
                    {projectName || "…"}
                </span>
                <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={onConfigOpen}
                    title="Configura progetto"
                    className="workspace-header-config"
                >
                    <Settings size={14} />
                </Button>
                {onWorkModeChange && (
                    <div className="flex items-center bg-muted rounded-md p-0.5 ml-2">
                        <Button
                            type="button"
                            variant={workMode === "build" ? "secondary" : "ghost"}
                            size="sm"
                            onClick={() => onWorkModeChange("build")}
                            className="h-7 text-xs gap-1"
                        >
                            <Hammer size={12} />
                            Build
                        </Button>
                        <Button
                            type="button"
                            variant={workMode === "didactic" ? "secondary" : "ghost"}
                            size="sm"
                            onClick={() => onWorkModeChange("didactic")}
                            className="h-7 text-xs gap-1"
                        >
                            <BookOpen size={12} />
                            Didact
                        </Button>
                    </div>
                )}
            </div>

            {/* CENTER — total project cost */}
            <div className="workspace-header-center">
                {totalCostEur > 0 ? (
                    <CostBadge
                        amount={totalCostEur}
                        projectId={projectId}
                        scope="project"
                        label="Costo progetto"
                        className="workspace-header-cost"
                    />
                ) : (
                    <span className="workspace-header-cost-empty">—</span>
                )}
            </div>

            {/* RIGHT — notifications */}
            <div className="workspace-header-right">
                {hasAny && (
                    <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setPanelOpen(!panelOpen)}
                        title={panelOpen ? "Nascondi notifiche" : "Mostra notifiche"}
                        className={`workspace-header-notif-btn gap-1.5 ${runningCount > 0 ? "text-primary" : ""}`}
                    >
                        {runningCount > 0 ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                            <Bell className="h-4 w-4" />
                        )}
                        <Badge
                            variant={runningCount > 0 ? "accent" : errorCount > 0 ? "destructive" : "outline"}
                            className="text-[10px] px-1.5 py-0"
                        >
                            {runningCount > 0 ? runningCount : notifications.length}
                        </Badge>
                    </Button>
                )}
            </div>
        </header>
    );
}
