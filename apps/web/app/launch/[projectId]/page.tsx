"use client";

import React, { useEffect, useRef, useState, useMemo } from "react";
import dynamic from "next/dynamic";
import { useRouter, useParams } from "next/navigation";
import { launchZeroEffort, getZeroEffortConfig, type ZeroEffortLaunchInput, type ZeroEffortPipelineConfig } from "../../../lib/api/pipelines";
import { getProject, type Project } from "../../../lib/api/projects";
import { getToken } from "../../../lib/token-store";
import { optimizePrompt, streamLlmChatPreview, type LlmChatStreamEvent } from "../../../lib/api/llm";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import {
    ArrowRight,
    Check,
    ChevronRight,
    FileText,
    Loader2,
    Palette,
    Plus,
    Rocket,
    Sparkles,
    Target,
    Trash2,
    Wand2,
    Zap,
} from "lucide-react";

const MonacoEditor = dynamic(() => import("@monaco-editor/react"), { ssr: false });

// ─── Types ────────────────────────────────────────────────────────────────────

interface ContactField {
    id: string;
    key: string;
    value: string;
}

interface ExtendedForm {
    businessName: string;
    siteType: ZeroEffortLaunchInput["siteType"];
    primaryGoal: string;
    audience: string;
    tone?: string;
    primaryCta?: string;
    styleHint?: string;
    contactFields: ContactField[];
    styleAttributes: string[];
}

type GenerationPhase =
    | "review"       // show normalized brief, Avvia Generazione button
    | "optimizing"   // calling optimize API
    | "optimized"    // show optimized prompt for review, Genera Contenuto button
    | "generating"   // streaming HTML generation
    | "done";        // complete, Apri in GodMode

// ─── Constants ────────────────────────────────────────────────────────────────

const SITE_TYPES: Array<{ value: ZeroEffortLaunchInput["siteType"]; label: string }> = [
    { value: "landing_page", label: "Landing" },
    { value: "business_site", label: "Business" },
    { value: "portfolio", label: "Portfolio" },
    { value: "showcase", label: "Showcase" },
];

const STYLE_ATTRIBUTES: Array<{ id: string; label: string }> = [
    { id: "minimal", label: "Minimal" },
    { id: "premium", label: "Premium" },
    { id: "dark", label: "Dark / Night" },
    { id: "bright", label: "Chiaro / Luminoso" },
    { id: "bold", label: "Bold / Impattante" },
    { id: "elegant", label: "Elegante" },
    { id: "corporate", label: "Corporate" },
    { id: "playful", label: "Giocoso / Creativo" },
    { id: "tech", label: "Tech / Moderno" },
    { id: "artisan", label: "Artigianale" },
    { id: "luxury", label: "Luxury" },
    { id: "eco", label: "Eco / Naturale" },
];

const CONTACT_SUGGESTIONS = [
    "Email", "Telefono", "Indirizzo", "Instagram", "Facebook",
    "LinkedIn", "YouTube", "WhatsApp", "Sito web", "P.IVA",
];

// ─── Step sub-components ──────────────────────────────────────────────────────

interface Step1Props {
    form: ExtendedForm;
    onChange: (patch: Partial<ExtendedForm>) => void;
    onNext: () => void;
    canProceed: boolean;
}
function Step1Content({ form, onChange, onNext, canProceed }: Step1Props) {
    return (
        <div className="space-y-4">
            <div className="space-y-2">
                <Label htmlFor="businessName">Nome del brand o dell&apos;azienda</Label>
                <Input
                    id="businessName"
                    value={form.businessName}
                    onChange={(e) => onChange({ businessName: e.target.value })}
                    placeholder="Es. KTM Machina Style"
                />
            </div>

            <div className="space-y-2">
                <Label>Tipo di sito</Label>
                <div className="grid grid-cols-2 gap-2">
                    {SITE_TYPES.map((option) => (
                        <Button
                            key={option.value}
                            type="button"
                            variant={form.siteType === option.value ? "default" : "outline"}
                            size="sm"
                            onClick={() => onChange({ siteType: option.value })}
                        >
                            {option.label}
                        </Button>
                    ))}
                </div>
            </div>

            <div className="space-y-2">
                <Label htmlFor="primaryGoal">Descrizione e obiettivo principale</Label>
                <p className="text-xs text-muted-foreground">
                    Descrivi liberamente il progetto. Puoi usare elenchi puntati (- elemento), grassetto (**testo**) o incollare da Word.
                </p>
                <textarea
                    id="primaryGoal"
                    className="w-full min-h-[180px] rounded-md border border-input bg-background px-3 py-2 text-sm font-mono leading-relaxed text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-y"
                    value={form.primaryGoal}
                    onChange={(e) => onChange({ primaryGoal: e.target.value })}
                    placeholder={"Es. KTM Machina Style è un brand di accessori premium per motociclisti.\n- Obiettivo: aumentare le vendite online\n- Pubblico: appassionati di moto tra 25-45 anni\n- Punto di forza: materiali innovativi e design austriaco"}
                />
            </div>

            <div className="flex justify-end pt-2">
                <Button type="button" onClick={onNext} disabled={!canProceed} className="gap-2">
                    Avanti <ChevronRight className="h-4 w-4" />
                </Button>
            </div>
        </div>
    );
}

interface Step2Props {
    form: ExtendedForm;
    onChange: (patch: Partial<ExtendedForm>) => void;
    onNext: () => void;
    onBack: () => void;
    canProceed: boolean;
    addContact: () => void;
    updateContact: (id: string, field: "key" | "value", value: string) => void;
    removeContact: (id: string) => void;
}
function Step2Content({ form, onChange, onNext, onBack, canProceed, addContact, updateContact, removeContact }: Step2Props) {
    return (
        <div className="space-y-4">
            <div className="space-y-2">
                <Label htmlFor="audience">Audience e target</Label>
                <p className="text-xs text-muted-foreground">
                    Chi sono i destinatari? Descrivi età, interessi, bisogni, lingua.
                </p>
                <textarea
                    id="audience"
                    className="w-full min-h-[100px] rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-y"
                    value={form.audience}
                    onChange={(e) => onChange({ audience: e.target.value })}
                    placeholder="es. Motociclisti appassionati tra 25-45 anni, italiani e europei, amanti del design e della qualità"
                />
            </div>

            <div className="space-y-3">
                <div className="flex items-center justify-between">
                    <Label>Informazioni di contatto e dati salienti</Label>
                    <Button type="button" variant="outline" size="sm" onClick={addContact} className="gap-1.5">
                        <Plus className="h-3.5 w-3.5" />
                        Aggiungi
                    </Button>
                </div>
                <p className="text-xs text-muted-foreground -mt-2">
                    Email, telefono, indirizzo, social — dati che devono apparire nel sito.
                </p>

                {form.contactFields.length === 0 && (
                    <div className="rounded-md border border-dashed border-border p-4 text-center">
                        <p className="text-sm text-muted-foreground">Nessun dato aggiunto.</p>
                        <div className="flex flex-wrap justify-center gap-1.5 mt-2">
                            {CONTACT_SUGGESTIONS.map((s) => (
                                <button
                                    key={s}
                                    type="button"
                                    onClick={() => addContact()}
                                    className="rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground hover:border-primary hover:text-foreground transition-colors"
                                >
                                    + {s}
                                </button>
                            ))}
                        </div>
                    </div>
                )}

                {form.contactFields.map((cf) => (
                    <div key={cf.id} className="flex items-center gap-2">
                        <div className="w-36 shrink-0">
                            <Input
                                value={cf.key}
                                onChange={(e) => updateContact(cf.id, "key", e.target.value)}
                                placeholder="Email"
                                list="contact-suggestions"
                            />
                            <datalist id="contact-suggestions">
                                {CONTACT_SUGGESTIONS.map((s) => <option key={s} value={s} />)}
                            </datalist>
                        </div>
                        <Input
                            value={cf.value}
                            onChange={(e) => updateContact(cf.id, "value", e.target.value)}
                            placeholder="info@example.com"
                            className="flex-1"
                        />
                        <Button type="button" variant="ghost" size="sm" onClick={() => removeContact(cf.id)}>
                            <Trash2 className="h-4 w-4 text-muted-foreground" />
                        </Button>
                    </div>
                ))}
            </div>

            <div className="flex justify-between pt-2">
                <Button type="button" variant="outline" onClick={onBack} className="gap-2">
                    <ChevronRight className="h-4 w-4 rotate-180" /> Indietro
                </Button>
                <Button type="button" onClick={onNext} disabled={!canProceed} className="gap-2">
                    Avanti <ChevronRight className="h-4 w-4" />
                </Button>
            </div>
        </div>
    );
}

interface Step3Props {
    form: ExtendedForm;
    onChange: (patch: Partial<ExtendedForm>) => void;
    onSubmit: () => void;
    onBack: () => void;
    submitting: boolean;
    error: string | null;
    toggleStyle: (attr: string) => void;
}
function Step3Content({ form, onChange, onSubmit, onBack, submitting, error, toggleStyle }: Step3Props) {
    const selected = form.styleAttributes ?? [];
    return (
        <div className="space-y-4">
            <div className="space-y-2">
                <Label>Attributi visivi</Label>
                <p className="text-xs text-muted-foreground">
                    Seleziona uno o più stili che caratterizzano il progetto.
                </p>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {STYLE_ATTRIBUTES.map((attr) => {
                        const isOn = selected.includes(attr.id);
                        return (
                            <button
                                key={attr.id}
                                type="button"
                                onClick={() => toggleStyle(attr.id)}
                                className={cn(
                                    "flex items-center gap-2 rounded-md border px-3 py-2 text-left text-sm transition-colors",
                                    isOn
                                        ? "border-primary bg-primary/10 text-foreground"
                                        : "border-border bg-background text-muted-foreground hover:border-primary/50 hover:text-foreground",
                                )}
                            >
                                <div className={cn(
                                    "flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors",
                                    isOn ? "border-primary bg-primary" : "border-muted-foreground",
                                )}>
                                    {isOn && <Check className="h-2.5 w-2.5 text-primary-foreground" />}
                                </div>
                                {attr.label}
                            </button>
                        );
                    })}
                </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                    <Label htmlFor="tone">Tono di voce</Label>
                    <Input
                        id="tone"
                        value={form.tone ?? ""}
                        onChange={(e) => onChange({ tone: e.target.value })}
                        placeholder="Es. chiaro e moderno"
                    />
                </div>
                <div className="space-y-2">
                    <Label htmlFor="primaryCta">CTA principale</Label>
                    <Input
                        id="primaryCta"
                        value={form.primaryCta ?? ""}
                        onChange={(e) => onChange({ primaryCta: e.target.value })}
                        placeholder="Es. Acquista ora, Scopri di più"
                    />
                </div>
            </div>

            <div className="space-y-2">
                <Label htmlFor="styleHint">Note stilistiche aggiuntive</Label>
                <Input
                    id="styleHint"
                    value={form.styleHint ?? ""}
                    onChange={(e) => onChange({ styleHint: e.target.value })}
                    placeholder="Es. Telaio in alluminio, primo e-bike per ÖAMTC, colori brand KTM"
                />
            </div>

            {error ? (
                <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                    {error}
                </div>
            ) : null}

            <div className="flex justify-between pt-2">
                <Button type="button" variant="outline" onClick={onBack} className="gap-2">
                    <ChevronRight className="h-4 w-4 rotate-180" /> Indietro
                </Button>
                <Button type="button" onClick={onSubmit} disabled={submitting} className="gap-2">
                    <Rocket className="h-4 w-4" />
                    {submitting ? "Preparazione brief..." : "Prepara Brief"}
                </Button>
            </div>
        </div>
    );
}

// ─── Structured brief builder ─────────────────────────────────────────────────

function buildStructuredBrief(form: ExtendedForm, projectName: string): string {
    const siteTypeLabels: Record<string, string> = {
        landing_page: "Landing Page",
        business_site: "Business Site",
        portfolio: "Portfolio",
        showcase: "Showcase",
    };
    const siteLabel = siteTypeLabels[form.siteType] ?? form.siteType;
    const brandName = form.businessName.trim() || projectName;

    const sections: string[] = [];

    // ── [IDENTITÀ] ──────────────────────────────────────────────────────────
    sections.push(
        `# BRIEF DI PROGETTO — ${brandName}\n\n` +
        `## [IDENTITÀ] Brand e tipo sito\n` +
        `- **Brand:** ${brandName}\n` +
        `- **Tipo sito:** ${siteLabel}`,
    );

    // ── [OBIETTIVO] ─────────────────────────────────────────────────────────
    if (form.primaryGoal.trim()) {
        sections.push(
            `## [OBIETTIVO] Descrizione e obiettivo principale\n\n` +
            form.primaryGoal.trim(),
        );
    }

    // ── [AUDIENCE] ──────────────────────────────────────────────────────────
    if (form.audience.trim()) {
        sections.push(
            `## [AUDIENCE] Target e pubblico di riferimento\n\n` +
            form.audience.trim(),
        );
    }

    // ── [STILE] ─────────────────────────────────────────────────────────────
    const styleLines: string[] = [];
    const selectedStyles = STYLE_ATTRIBUTES
        .filter((a) => form.styleAttributes.includes(a.id))
        .map((a) => a.label);
    if (selectedStyles.length > 0) {
        styleLines.push(`- **Attributi visivi:** ${selectedStyles.join(", ")}`);
    }
    if (form.tone?.trim()) {
        styleLines.push(`- **Tono di voce:** ${form.tone.trim()}`);
    }
    if (form.primaryCta?.trim()) {
        styleLines.push(`- **CTA principale:** ${form.primaryCta.trim()}`);
    }
    if (form.styleHint?.trim()) {
        styleLines.push(`- **Note stilistiche aggiuntive:** ${form.styleHint.trim()}`);
    }
    if (styleLines.length > 0) {
        sections.push(`## [STILE] Attributi visivi, tono e CTA\n\n${styleLines.join("\n")}`);
    }

    // ── [CONTATTI] ──────────────────────────────────────────────────────────
    const validContacts = form.contactFields.filter((cf) => cf.key.trim() && cf.value.trim());
    if (validContacts.length > 0) {
        const contactLines = validContacts
            .map((cf) => `- **${cf.key.trim()}:** ${cf.value.trim()}`)
            .join("\n");
        sections.push(`## [CONTATTI] Informazioni di contatto e dati salienti\n\n${contactLines}`);
    }

    const footer = `\n---\n*Brief strutturato Zero Effort · ${siteLabel} · Sezioni: ${sections.length - 1}*`;
    return sections.join("\n\n") + footer;
}

// ─── Step config ──────────────────────────────────────────────────────────────

const STEPS = [
    { number: 1, title: "Descrizione", subtitle: "Brand, tipo sito e obiettivo principale", icon: FileText },
    { number: 2, title: "Target & Dati", subtitle: "Audience, contatti e info salienti", icon: Target },
    { number: 3, title: "Stile visivo", subtitle: "Attributi estetici, tono e CTA", icon: Palette },
] as const;

// ─── Phase label helpers ──────────────────────────────────────────────────────

function phaseLabel(phase: GenerationPhase): string {
    switch (phase) {
        case "review": return "Pronto per la generazione";
        case "optimizing": return "Ottimizzazione prompt...";
        case "optimized": return "Prompt ottimizzato — pronto per generare";
        case "generating": return "Generazione contenuto...";
        case "done": return "Generazione completata!";
    }
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function ZeroEffortLaunchPage() {
    const params = useParams<{ projectId: string }>();
    const router = useRouter();
    const projectId = params?.projectId ?? "";
    const step4Ref = useRef<HTMLDivElement>(null);
    const abortRef = useRef<AbortController | null>(null);

    const [token, setToken] = useState<string | null>(null);
    const [project, setProject] = useState<Project | null>(null);
    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [result, setResult] = useState<Awaited<ReturnType<typeof launchZeroEffort>> | null>(null);
    const [pipelineConfig, setPipelineConfig] = useState<ZeroEffortPipelineConfig | null>(null);
    const [currentStep, setCurrentStep] = useState(1);
    const [completedSteps, setCompletedSteps] = useState<Set<number>>(new Set());

    // brief editor
    const [editedBrief, setEditedBrief] = useState("");

    // generation phases
    const [phase, setPhase] = useState<GenerationPhase>("review");
    const [genError, setGenError] = useState<string | null>(null);
    const [optimizedPrompt, setOptimizedPrompt] = useState("");
    const [editedOptimizedPrompt, setEditedOptimizedPrompt] = useState("");
    const [genStreamTokens, setGenStreamTokens] = useState(0);
    const [genDone, setGenDone] = useState(false);

    const [form, setForm] = useState<ExtendedForm>({
        businessName: "",
        siteType: "landing_page",
        primaryGoal: "",
        audience: "",
        tone: "clear and modern",
        primaryCta: "Contact us",
        styleHint: "",
        contactFields: [],
        styleAttributes: [],
    });

    function patch(update: Partial<ExtendedForm>) {
        setForm((prev) => ({ ...prev, ...update }));
    }

    useEffect(() => {
        const currentToken = getToken();
        if (!currentToken) { router.replace("/login"); return; }
        setToken(currentToken);
        void getProject(currentToken, projectId)
            .then((res) => {
                setProject(res.project);
                setForm((prev) => ({ ...prev, businessName: prev.businessName || res.project.name }));
            })
            .catch(() => setError("Unable to load the project."))
            .finally(() => setLoading(false));
    }, [projectId, router]);

    useEffect(() => {
        if (result && step4Ref.current) {
            step4Ref.current.scrollIntoView({ behavior: "smooth", block: "start" });
        }
    }, [result]);

    const step1Valid = useMemo(
        () => form.businessName.trim().length >= 2 && form.primaryGoal.trim().length >= 8,
        [form.businessName, form.primaryGoal],
    );
    const step2Valid = useMemo(() => form.audience.trim().length >= 3, [form.audience]);

    function completeStep(n: number) {
        setCompletedSteps((prev) => new Set([...prev, n]));
        setCurrentStep(n + 1);
    }

    function addContact() {
        setForm((prev) => ({
            ...prev,
            contactFields: [...prev.contactFields, { id: `cf-${Date.now()}`, key: "", value: "" }],
        }));
    }
    function updateContact(id: string, field: "key" | "value", value: string) {
        setForm((prev) => ({
            ...prev,
            contactFields: prev.contactFields.map((cf) => cf.id === id ? { ...cf, [field]: value } : cf),
        }));
    }
    function removeContact(id: string) {
        setForm((prev) => ({ ...prev, contactFields: prev.contactFields.filter((cf) => cf.id !== id) }));
    }
    function toggleStyle(attr: string) {
        setForm((prev) => {
            const cur = prev.styleAttributes ?? [];
            return { ...prev, styleAttributes: cur.includes(attr) ? cur.filter((a) => a !== attr) : [...cur, attr] };
        });
    }

    async function handleSubmit() {
        if (!token || !step1Valid || !step2Valid) return;
        setSubmitting(true);
        setError(null);
        const payload: ZeroEffortLaunchInput = {
            businessName: form.businessName,
            siteType: form.siteType,
            primaryGoal: form.primaryGoal,
            audience: form.audience,
            tone: form.tone,
            primaryCta: form.primaryCta,
            styleHint: form.styleHint,
            contactInfo: form.contactFields
                .filter((cf) => cf.key.trim() && cf.value.trim())
                .map((cf) => ({ key: cf.key.trim(), value: cf.value.trim() })),
            styleAttributes: form.styleAttributes,
        };
        try {
            const [briefResult, configResult] = await Promise.all([
                launchZeroEffort(token, projectId, payload),
                getZeroEffortConfig(token, projectId).catch(() => null),
            ]);
            setResult(briefResult);
            // Build the structured brief client-side from the full form data
            // so every section and long-text field is included verbatim.
            setEditedBrief(buildStructuredBrief(form, project?.name ?? ""));
            setPipelineConfig(configResult);
            setCompletedSteps(new Set([1, 2, 3]));
            setPhase("review");
        } catch (submitError) {
            const message = submitError instanceof Error ? submitError.message : "Unable to prepare the launch flow.";
            setError(message);
        } finally {
            setSubmitting(false);
        }
    }

    async function handleOptimize() {
        if (!token || !result) return;
        setPhase("optimizing");
        setGenError(null);
        try {
            const optimizeRes = await optimizePrompt(token, projectId, {
                rawPrompt: editedBrief,
                conversationId: result.conversationId,
            });
            setOptimizedPrompt(optimizeRes.optimizedPrompt);
            setEditedOptimizedPrompt(optimizeRes.optimizedPrompt);
            setPhase("optimized");
        } catch (err) {
            setGenError(err instanceof Error ? err.message : "Errore ottimizzazione prompt");
            setPhase("review");
        }
    }

    async function handleGenerate() {
        if (!token || !result) return;
        setPhase("generating");
        setGenError(null);
        setGenStreamTokens(0);
        setGenDone(false);

        const ctrl = new AbortController();
        abortRef.current = ctrl;

        const cfg = pipelineConfig?.generate;

        try {
            await streamLlmChatPreview(
                token,
                projectId,
                {
                    message: editedOptimizedPrompt || optimizedPrompt,
                    provider: cfg?.provider ?? "siliconflow",
                    model: cfg?.model ?? "MiniMaxAI/MiniMax-M2.5",
                    max_tokens: cfg?.maxCompletionTokens ?? 14000,
                    pipelineRole: "coding",
                },
                (event: LlmChatStreamEvent) => {
                    if (event.type === "thinking" || event.type === "answer") {
                        setGenStreamTokens((n) => n + 1);
                    } else if (event.type === "done") {
                        setGenDone(true);
                        setPhase("done");
                    } else if (event.type === "error") {
                        setGenError("Errore durante la generazione del contenuto.");
                        setPhase("optimized");
                    }
                },
                ctrl.signal,
            );
        } catch (err) {
            if ((err as { name?: string }).name !== "AbortError") {
                setGenError(err instanceof Error ? err.message : "Errore durante la generazione.");
                setPhase("optimized");
            }
        }
    }

    if (loading) {
        return (
            <div className="min-h-screen bg-background flex items-center justify-center">
                <div className="h-8 w-8 rounded-full border-4 border-primary/20 border-t-primary animate-spin" />
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-background text-foreground">
            <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8 md:px-6">

                {/* Header */}
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div>
                        <Badge variant="accent" className="mb-2">Zero Effort</Badge>
                        <h1 className="text-2xl font-semibold tracking-tight">
                            Generazione guidata
                        </h1>
                        <p className="text-sm text-muted-foreground">
                            {project?.name ?? "Il tuo progetto"} · Compila i 3 step e avvia la generazione automatica.
                        </p>
                    </div>
                    <div className="flex gap-2 shrink-0">
                        <Button variant="outline" size="sm" onClick={() => router.push("/dashboard")}>
                            Dashboard
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => router.push(
                            result ? `/workspace/${projectId}?conv=${result.conversationId}` : `/workspace/${projectId}`
                        )}>
                            GodMode
                        </Button>
                    </div>
                </div>

                {/* Step progress bar */}
                <div className="flex items-center gap-2">
                    {STEPS.map((step, index) => (
                        <div key={step.number} className="flex items-center gap-2">
                            <button
                                type="button"
                                onClick={() => {
                                    if (completedSteps.has(step.number) || step.number <= currentStep) {
                                        setCurrentStep(step.number);
                                    }
                                }}
                                className={cn(
                                    "flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold transition-colors",
                                    completedSteps.has(step.number)
                                        ? "bg-primary text-primary-foreground cursor-pointer"
                                        : step.number === currentStep
                                        ? "bg-primary/20 border border-primary text-primary cursor-pointer"
                                        : "bg-muted text-muted-foreground cursor-default",
                                )}
                            >
                                {completedSteps.has(step.number) ? <Check className="h-3.5 w-3.5" /> : step.number}
                            </button>
                            <span className={cn(
                                "hidden text-xs font-medium sm:block",
                                step.number === currentStep ? "text-foreground" : "text-muted-foreground",
                            )}>
                                {step.title}
                            </span>
                            {index < STEPS.length - 1 && (
                                <ChevronRight className="h-3.5 w-3.5 text-muted-foreground mx-1" />
                            )}
                        </div>
                    ))}
                </div>

                {/* Accordion steps */}
                <div className="space-y-3">
                    {STEPS.map((step) => {
                        const isOpen = currentStep === step.number;
                        const isDone = completedSteps.has(step.number);
                        const Icon = step.icon;
                        return (
                            <Card
                                key={step.number}
                                className={cn(
                                    "transition-all",
                                    isOpen ? "border-primary/40" : isDone ? "border-border opacity-80" : "border-border opacity-60",
                                )}
                            >
                                <button
                                    type="button"
                                    className="flex w-full items-center gap-3 p-4 text-left"
                                    onClick={() => {
                                        if (isDone || step.number <= currentStep) {
                                            setCurrentStep(isOpen ? 0 : step.number);
                                        }
                                    }}
                                >
                                    <div className={cn(
                                        "flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
                                        isDone ? "bg-primary/20 text-primary" : isOpen ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground",
                                    )}>
                                        {isDone ? <Check className="h-4 w-4" /> : <Icon className="h-4 w-4" />}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <p className="text-sm font-semibold">Step {step.number} — {step.title}</p>
                                        <p className="text-xs text-muted-foreground">{step.subtitle}</p>
                                    </div>
                                    <ChevronRight className={cn(
                                        "h-4 w-4 text-muted-foreground transition-transform",
                                        isOpen && "rotate-90",
                                    )} />
                                </button>

                                {isOpen && (
                                    <CardContent className="pt-0 pb-4 px-4">
                                        <div className="border-t border-border pt-4">
                                            {step.number === 1 && (
                                                <Step1Content
                                                    form={form}
                                                    onChange={patch}
                                                    onNext={() => { if (step1Valid) completeStep(1); }}
                                                    canProceed={step1Valid}
                                                />
                                            )}
                                            {step.number === 2 && (
                                                <Step2Content
                                                    form={form}
                                                    onChange={patch}
                                                    onNext={() => { if (step2Valid) completeStep(2); }}
                                                    onBack={() => setCurrentStep(1)}
                                                    canProceed={step2Valid}
                                                    addContact={addContact}
                                                    updateContact={updateContact}
                                                    removeContact={removeContact}
                                                />
                                            )}
                                            {step.number === 3 && (
                                                <Step3Content
                                                    form={form}
                                                    onChange={patch}
                                                    onSubmit={handleSubmit}
                                                    onBack={() => setCurrentStep(2)}
                                                    submitting={submitting}
                                                    error={error}
                                                    toggleStyle={toggleStyle}
                                                />
                                            )}
                                        </div>
                                    </CardContent>
                                )}
                            </Card>
                        );
                    })}
                </div>

                {/* ── Step 4 — Generazione automatica (appare dopo API success) ── */}
                {result && (
                    <Card ref={step4Ref} className={cn(
                        "border-primary/40 transition-all",
                        phase === "done" && "border-green-500/40",
                    )}>
                        <CardHeader className="pb-3">
                            <div className="flex items-center gap-3">
                                <div className={cn(
                                    "flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
                                    phase === "done" ? "bg-green-500/20 text-green-400" : "bg-primary/20 text-primary",
                                )}>
                                    {phase === "done" ? <Check className="h-4 w-4" /> :
                                     phase === "optimizing" || phase === "generating" ? <Loader2 className="h-4 w-4 animate-spin" /> :
                                     <Sparkles className="h-4 w-4" />}
                                </div>
                                <div className="flex-1">
                                    <CardTitle className="text-base">Step 4 — Avvia Generazione</CardTitle>
                                    <CardDescription className="text-xs">
                                        {phaseLabel(phase)}
                                    </CardDescription>
                                </div>
                                <Badge variant={phase === "done" ? "success" : "secondary"} className="ml-auto text-xs">
                                    {phase === "done" ? "Completato" : `${pipelineConfig?.generate?.model ?? "MiniMax-M2.5"}`}
                                </Badge>
                            </div>
                        </CardHeader>

                        <CardContent className="space-y-4">

                            {/* ── Phase: review ── */}
                            {(phase === "review" || phase === "optimizing") && (
                                <>
                                    <div className="space-y-1.5">
                                        <Label className="text-xs text-muted-foreground">
                                            Brief strutturato — modificabile prima dell&apos;ottimizzazione
                                        </Label>
                                        <div className="rounded-md border border-border overflow-hidden h-[340px]">
                                            <MonacoEditor
                                                height="340px"
                                                defaultLanguage="markdown"
                                                value={editedBrief}
                                                onChange={(val) => setEditedBrief(val ?? "")}
                                                theme="vs-dark"
                                                options={{
                                                    minimap: { enabled: false },
                                                    wordWrap: "on",
                                                    lineNumbers: "off",
                                                    fontSize: 13,
                                                    padding: { top: 12 },
                                                    scrollBeyondLastLine: false,
                                                    readOnly: phase === "optimizing",
                                                }}
                                            />
                                        </div>
                                    </div>

                                    {genError && (
                                        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                                            {genError}
                                        </div>
                                    )}

                                    <div className="flex items-center justify-between pt-1">
                                        <p className="text-xs text-muted-foreground">
                                            Il brief verrà ottimizzato in prompt, poi usato per generare il sito.
                                        </p>
                                        <Button
                                            onClick={handleOptimize}
                                            disabled={phase === "optimizing" || !editedBrief.trim()}
                                            className="gap-2"
                                        >
                                            {phase === "optimizing" ? (
                                                <><Loader2 className="h-4 w-4 animate-spin" /> Ottimizzazione...</>
                                            ) : (
                                                <><Wand2 className="h-4 w-4" /> Avvia Generazione</>
                                            )}
                                        </Button>
                                    </div>
                                </>
                            )}

                            {/* ── Phase: optimized ── */}
                            {(phase === "optimized" || phase === "generating") && (
                                <>
                                    <div className="space-y-1.5">
                                        <div className="flex items-center justify-between">
                                            <Label className="text-xs text-muted-foreground">
                                                Prompt ottimizzato — modificabile prima della generazione
                                            </Label>
                                            <button
                                                type="button"
                                                onClick={() => setPhase("review")}
                                                className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2 transition-colors"
                                            >
                                                Torna al brief
                                            </button>
                                        </div>
                                        <div className="rounded-md border border-border overflow-hidden h-[220px]">
                                            <MonacoEditor
                                                height="220px"
                                                defaultLanguage="markdown"
                                                value={editedOptimizedPrompt}
                                                onChange={(val) => setEditedOptimizedPrompt(val ?? "")}
                                                theme="vs-dark"
                                                options={{
                                                    minimap: { enabled: false },
                                                    wordWrap: "on",
                                                    lineNumbers: "off",
                                                    fontSize: 13,
                                                    padding: { top: 12 },
                                                    scrollBeyondLastLine: false,
                                                    readOnly: phase === "generating",
                                                }}
                                            />
                                        </div>
                                    </div>

                                    {phase === "generating" && (
                                        <div className="flex items-center gap-2 rounded-md border border-border bg-muted/30 px-3 py-2">
                                            <Loader2 className="h-4 w-4 animate-spin text-primary shrink-0" />
                                            <p className="text-sm text-muted-foreground">
                                                Generazione in corso — {genStreamTokens} token ricevuti...
                                            </p>
                                        </div>
                                    )}

                                    {genError && (
                                        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                                            {genError}
                                        </div>
                                    )}

                                    {phase === "optimized" && (
                                        <div className="flex items-center justify-between pt-1">
                                            <p className="text-xs text-muted-foreground">
                                                {pipelineConfig?.generate
                                                    ? `${pipelineConfig.generate.provider} · ${pipelineConfig.generate.model} · max ${pipelineConfig.generate.maxCompletionTokens} token`
                                                    : "siliconflow · MiniMaxAI/MiniMax-M2.5 · max 14000 token"}
                                            </p>
                                            <Button onClick={handleGenerate} className="gap-2">
                                                <Zap className="h-4 w-4" />
                                                Genera Contenuto
                                            </Button>
                                        </div>
                                    )}
                                </>
                            )}

                            {/* ── Phase: done ── */}
                            {phase === "done" && (
                                <>
                                    <div className="rounded-md border border-green-500/30 bg-green-500/10 px-4 py-3">
                                        <div className="flex items-start gap-3">
                                            <Check className="mt-0.5 h-5 w-5 text-green-400 shrink-0" />
                                            <div>
                                                <p className="text-sm font-medium text-foreground">Contenuto generato con successo</p>
                                                <p className="text-xs text-muted-foreground mt-0.5">
                                                    Il sito è stato generato e salvato nella conversazione. Aprilo in GodMode per visualizzarlo e modificarlo.
                                                </p>
                                            </div>
                                        </div>
                                    </div>

                                    <div className="space-y-1.5">
                                        {result.suggestedNextActions.map((item) => (
                                            <div key={item} className="flex items-start gap-2 text-sm text-muted-foreground">
                                                <ArrowRight className="mt-0.5 h-4 w-4 text-primary shrink-0" />
                                                <span>{item}</span>
                                            </div>
                                        ))}
                                    </div>

                                    <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-border">
                                        <Badge variant="outline" className="font-mono text-xs">
                                            Conv {result.conversationId.slice(0, 8)}
                                        </Badge>
                                        <Badge variant="outline" className="font-mono text-xs">
                                            Job {result.jobId.slice(0, 8)}
                                        </Badge>
                                        <div className="ml-auto flex gap-2">
                                            <Button variant="outline" size="sm" onClick={() => router.push("/dashboard")}>
                                                Dashboard
                                            </Button>
                                            <Button size="sm" onClick={() => router.push(`/workspace/${projectId}?conv=${result.conversationId}`)}>
                                                <Rocket className="mr-1.5 h-3.5 w-3.5" />
                                                Apri in GodMode
                                            </Button>
                                        </div>
                                    </div>
                                </>
                            )}

                        </CardContent>
                    </Card>
                )}

            </main>
        </div>
    );
}
