import type { PlatformConfig } from "../../domain/entities/PlatformConfig";
import type { ImageProviderId } from "../../infra/image/types";

export type StockImageProviderId = ImageProviderId;

export interface StockImageProviderPolicy {
    primaryProvider: StockImageProviderId;
    fallbackEnabled: boolean;
    fallbackProviders: StockImageProviderId[];
    allowPicsumFallback: boolean;
    strictPersistence?: boolean;
}

export interface MediaProviderPolicy {
    stockImage: StockImageProviderPolicy;
}

export const DEFAULT_MEDIA_PROVIDER_POLICY: MediaProviderPolicy = {
    stockImage: {
        primaryProvider: "pexels",
        fallbackEnabled: true,
        fallbackProviders: ["pixabay", "unsplash", "loremflickr"],
        allowPicsumFallback: true,
    },
};

const VALID_STOCK_PROVIDERS: StockImageProviderId[] = ["pexels", "pixabay", "unsplash", "loremflickr", "picsum"];

function sanitizeProvider(provider: unknown, fallback: StockImageProviderId): StockImageProviderId {
    return typeof provider === "string" && VALID_STOCK_PROVIDERS.includes(provider as StockImageProviderId)
        ? provider as StockImageProviderId
        : fallback;
}

function sanitizeFallbackProviders(value: unknown, primaryProvider: StockImageProviderId): StockImageProviderId[] {
    const raw = Array.isArray(value) ? value : DEFAULT_MEDIA_PROVIDER_POLICY.stockImage.fallbackProviders;
    const providers = raw
        .map((provider) => sanitizeProvider(provider, "loremflickr"))
        .filter((provider) => provider !== primaryProvider && provider !== "picsum");
    return [...new Set(providers)];
}

export function resolveMediaProviderPolicy(config: Pick<PlatformConfig, "mediaProviderPolicy"> | null | undefined): MediaProviderPolicy {
    const configured = config?.mediaProviderPolicy?.stockImage;
    const primaryProvider = sanitizeProvider(
        configured?.primaryProvider,
        DEFAULT_MEDIA_PROVIDER_POLICY.stockImage.primaryProvider,
    );

    return {
        stockImage: {
            primaryProvider,
            fallbackEnabled: configured?.fallbackEnabled ?? DEFAULT_MEDIA_PROVIDER_POLICY.stockImage.fallbackEnabled,
            fallbackProviders: sanitizeFallbackProviders(configured?.fallbackProviders, primaryProvider),
            allowPicsumFallback: configured?.allowPicsumFallback ?? DEFAULT_MEDIA_PROVIDER_POLICY.stockImage.allowPicsumFallback,
            strictPersistence: configured?.strictPersistence,
        },
    };
}

export function buildStockProviderOrder(policy: MediaProviderPolicy): StockImageProviderId[] {
    const stockPolicy = policy.stockImage;
    const order: StockImageProviderId[] = [stockPolicy.primaryProvider];

    if (stockPolicy.fallbackEnabled) {
        order.push(...stockPolicy.fallbackProviders);
        if (stockPolicy.allowPicsumFallback) {
            order.push("picsum");
        }
    }

    return [...new Set(order)];
}
