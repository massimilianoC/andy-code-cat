import type { SystemNotification } from "../../domain/entities/SystemNotification";
import type { CreateSystemNotificationInput, SystemNotificationRepository } from "../../domain/repositories/SystemNotificationRepository";

type NotificationInput = CreateSystemNotificationInput;

export class SystemNotifier {
    private static _instance = new SystemNotifier();

    static get instance(): SystemNotifier {
        return SystemNotifier._instance;
    }

    static configure(repo: SystemNotificationRepository): void {
        SystemNotifier._instance = new SystemNotifier(repo);
    }

    constructor(private readonly repo?: SystemNotificationRepository) { }

    emit(input: NotificationInput): void {
        if (!this.repo) return;
        this.repo.create(input).catch((err: unknown) => {
            console.error("[SystemNotifier] Failed to persist notification:", err);
        });
    }

    async emitAsync(input: NotificationInput): Promise<SystemNotification> {
        if (!this.repo) {
            throw new Error("SystemNotifier repository is not configured");
        }
        return this.repo.create(input);
    }
}
